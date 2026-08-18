import { app, BrowserWindow, protocol, dialog, ipcMain, Menu } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import JSZip from 'jszip';
import { createSign, createVerify, createHash, X509Certificate } from 'crypto';
import * as forge from 'node-forge';

let zip: JSZip | null = null;
let currentFilePath: string | null = null;
let _promptResolve: ((value: string | null) => void) | null = null;
let _promptWindow: BrowserWindow | null = null;

// Windows launches AltPDF.exe with the double-clicked file's path as a command-line
// argument, both on a cold start and (via 'second-instance') when a window is already open.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    app.quit();
} else {
    app.on('second-instance', (_event, argv) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win) return;
        if (win.isMinimized()) win.restore();
        win.focus();

        const filePath = getApdfPathFromArgv(argv);
        if (filePath) openApdfFile(win, filePath).catch(err => console.error(err));
    });
}

// Names of the mutable files inside a .apdf archive.
// Data is a numbered sequence of contributions (data1.json, data2.json, ...) rather
// than a single file, so multiple participants can each sign their own step.
const TEMPLATE_SIGNATURE_FILE = 'template-signature.json';
const DATA_TEMP_FILE = 'data-temp.json';
const DATA_STEP_PATTERN = /^data(\d+)\.json$/;
const DATA_STEP_SIGNATURE_PATTERN = /^data(\d+)-signature\.json$/;

function dataStepFile(step: number): string { return `data${step}.json`; }
function dataStepSignatureFile(step: number): string { return `data${step}-signature.json`; }

// True for any file that isn't part of the immutable template.
function isMutableFile(filename: string): boolean {
    return filename === DATA_TEMP_FILE
        || DATA_STEP_PATTERN.test(filename)
        || DATA_STEP_SIGNATURE_PATTERN.test(filename);
}

// Excluded when hashing the template: its own signature file, plus everything mutable.
function isExcludedFromTemplateHash(filename: string): boolean {
    return filename === TEMPLATE_SIGNATURE_FILE || isMutableFile(filename);
}

// Step numbers with a data file and/or a signature file present, in ascending order.
// Includes a step even if only one of the pair exists, so an orphaned signature (its
// data file deleted) or an orphaned data file (its signature deleted) still gets
// reported as tampering by checkDataSteps rather than silently skipped.
function listDataSteps(): number[] {
    if (!zip) return [];
    const steps = new Set<number>();
    for (const filename of Object.keys(zip.files)) {
        const dataMatch = filename.match(DATA_STEP_PATTERN);
        if (dataMatch) steps.add(parseInt(dataMatch[1], 10));
        const sigMatch = filename.match(DATA_STEP_SIGNATURE_PATTERN);
        if (sigMatch) steps.add(parseInt(sigMatch[1], 10));
    }
    return [...steps].sort((a, b) => a - b);
}

interface TemplateCertificate {
    version: number;
    signer: string;    // CN from certificate — informational only; always re-read from certPem on verify
    timestamp: string;
    certPem: string;   // full X.509 certificate; public key is extracted from this for verification
    files: Record<string, string>;  // per-file hashes at signing time — lets verify report which file(s) changed
    filesHash: string;              // hash of the canonicalized `files` map; this is what's actually signed
    signature: string;
}

interface DataStepSignature {
    version: number;
    step: number;
    signer: string;
    timestamp: string;
    certPem: string;
    dataHash: string;
    previousDataHash: string | null;   // dataHash of the step this one was built on top of — chains contributions together
    templateFilesHash: string | null;  // template's filesHash at the moment this step was signed, for cross-checking
    signature: string;
}

type TemplateVerifyResult =
    | { signed: false }
    | {
        signed: true;
        sigValid: boolean;
        filesMapValid: boolean;
        changedFiles: string[];
        signer: string;
        timestamp: string;
        issuer: string;
        currentFilesHash: string;
      };

type DataStepResult =
    | { step: number; status: 'missing-signature' }  // the data file exists but its signature doesn't
    | { step: number; status: 'missing-data' }        // the signature exists but its data file doesn't
    | {
        step: number;
        status: 'checked';
        sigValid: boolean;
        dataMatch: boolean;
        chainValid: boolean;   // this step's previousDataHash matches what the prior step actually signed
        dataHash: string;
        signer: string;
        timestamp: string;
        issuer: string;
        templateFilesHash: string | null;
      };

interface CertificateInfo {
    signer: string;
    privateKeyPem: string;
    certPem: string;
}

// ─── crypto helpers ───────────────────────────────────────────────────────────

// Recursively sorts object keys (by UTF-16 code unit, matching RFC 8785) so that
// semantically identical JSON hashes/signs the same regardless of key order.
function canonicalizeValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(canonicalizeValue);
    }
    if (value !== null && typeof value === 'object') {
        const sorted: Record<string, unknown> = {};
        for (const key of Object.keys(value as Record<string, unknown>).sort()) {
            sorted[key] = canonicalizeValue((value as Record<string, unknown>)[key]);
        }
        return sorted;
    }
    return value;
}

function toCanonicalJson(input: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBufferLike> {
    const parsed = JSON.parse(new TextDecoder('utf-8').decode(input));
    const canonicalText = JSON.stringify(canonicalizeValue(parsed));
    return new TextEncoder().encode(canonicalText);
}

function hashContent(content: Buffer | string): string {
    return createHash('sha256').update(content).digest('hex');
}

function signPayload(payload: string, privateKeyPem: string): string {
    const sign = createSign('SHA256');
    sign.update(payload, 'utf8');
    return sign.sign(privateKeyPem, 'base64');
}

function verifyWithCert(payload: string, signature: string, certPem: string): boolean {
    const x509 = new X509Certificate(certPem);
    const verify = createVerify('SHA256');
    verify.update(payload, 'utf8');
    return verify.verify(x509.publicKey, signature, 'base64');
}

// Always extract the signer name from the certificate itself — never trust the stored string.
function signerFromCert(certPem: string): string {
    const subject = new X509Certificate(certPem).subject;
    const m = subject.match(/CN=([^,\n]+)/);
    return m ? m[1].trim() : subject;
}

function issuerFromCert(certPem: string): string {
    const issuer = new X509Certificate(certPem).issuer;
    return issuer;
}

// ─── certificate selection ────────────────────────────────────────────────────

async function selectCertificate(win: BrowserWindow): Promise<CertificateInfo | null> {
    const result = await dialog.showOpenDialog(win, {
        title: 'Select Signing Certificate',
        filters: [
            { name: 'Certificate Files', extensions: ['pfx', 'p12'] },
            { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile']
    });
    if (result.canceled || !result.filePaths.length) return null;

    const pfxBuffer = fs.readFileSync(result.filePaths[0]);
    const password = await showPromptWindow(win, 'Certificate password:', true) ?? '';

    try {
        const p12 = forge.pkcs12.pkcs12FromAsn1(
            forge.asn1.fromDer(pfxBuffer.toString('binary')), password
        );

        // Certificate bag
        const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag];
        if (!certBags?.length || !certBags[0].cert) throw new Error('No certificate found in PFX.');
        const cert = certBags[0].cert;

        const cnAttr = cert.subject.getField('CN');
        if (!cnAttr) throw new Error('Certificate has no Common Name (CN) field.');

        // Private key bag — try shrouded first, fall back to plain
        let keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag];
        if (!keyBags?.length) keyBags = p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag];
        if (!keyBags?.length || !keyBags[0].key) throw new Error('No private key found in PFX.');

        return {
            signer: String(cnAttr.value),
            privateKeyPem: forge.pki.privateKeyToPem(keyBags[0].key as forge.pki.rsa.PrivateKey),
            certPem: forge.pki.certificateToPem(cert)
        };
    } catch (err) {
        await dialog.showMessageBox(win, {
            type: 'error',
            title: 'Certificate Error',
            message: 'Failed to load certificate.',
            detail: err instanceof Error ? err.message : 'Invalid PFX file or incorrect password.'
        });
        return null;
    }
}

// ─── prompt window ────────────────────────────────────────────────────────────

async function showPromptWindow(parent: BrowserWindow, message: string, isPassword = false): Promise<string | null> {
    return new Promise((resolve) => {
        _promptResolve = resolve;
        _promptWindow = new BrowserWindow({
            width: 420, height: 165,
            parent, modal: true,
            resizable: false, minimizable: false, maximizable: false,
            webPreferences: { nodeIntegration: true, contextIsolation: false }
        });
        _promptWindow.setMenu(null);
        _promptWindow.loadFile(path.join(__dirname, 'renderer/prompt.html'), {
            query: { message, ...(isPassword && { type: 'password' }) }
        });
        _promptWindow.on('closed', () => {
            _promptWindow = null;
            if (_promptResolve) { _promptResolve(null); _promptResolve = null; }
        });
    });
}

ipcMain.on('prompt-result', (_event, value: string | null) => {
    if (_promptResolve) { _promptResolve(value); _promptResolve = null; }
    _promptWindow?.close();
    _promptWindow = null;
});

// ─── zip helpers ──────────────────────────────────────────────────────────────

async function saveZipInPlace(win: BrowserWindow): Promise<boolean> {
    if (!zip) return false;
    let savePath = currentFilePath;
    if (!savePath) {
        const result = await dialog.showSaveDialog(win, {
            title: 'Save AltPDF File',
            defaultPath: 'document.apdf',
            filters: [{ name: 'AltPDF Files', extensions: ['apdf'] }]
        });
        if (!result.filePath) return false;
        savePath = result.filePath;
        currentFilePath = savePath;
    }
    const content = await zip.generateAsync({ type: 'nodebuffer' });
    fs.writeFileSync(savePath, content);
    return true;
}

async function hashZipFiles(exclude: (filename: string) => boolean): Promise<Record<string, string>> {
    if (!zip) return {};
    const files: Record<string, string> = {};
    for (const filename of Object.keys(zip.files)) {
        if (!exclude(filename) && !zip.files[filename].dir) {
            const content = await zip.files[filename].async('uint8array');
            files[filename] = hashContent(Buffer.from(content));
        }
    }
    return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}

// Names of files added, removed, or changed between two per-file hash maps.
function diffFileHashes(original: Record<string, string>, current: Record<string, string>): string[] {
    const changed = new Set<string>();
    for (const [name, hash] of Object.entries(original)) {
        if (current[name] !== hash) changed.add(name);
    }
    for (const name of Object.keys(current)) {
        if (!(name in original)) changed.add(name);
    }
    return [...changed].sort();
}

// ─── sign / verify ────────────────────────────────────────────────────────────

async function signTemplate(win: BrowserWindow): Promise<void> {
    if (!zip) { dialog.showMessageBox(win, { type: 'warning', message: 'No file loaded.' }); return; }
    if (zip.file(TEMPLATE_SIGNATURE_FILE)) {
        dialog.showMessageBox(win, {
            type: 'warning', title: 'Already Signed',
            message: 'This template has already been signed and cannot be re-signed.'
        });
        return;
    }

    const certInfo = await selectCertificate(win);
    if (!certInfo) return;

    const files = await hashZipFiles(isExcludedFromTemplateHash);
    const canonicalFiles = toCanonicalJson(new TextEncoder().encode(JSON.stringify(files)));
    const filesHash = hashContent(Buffer.from(canonicalFiles));
    const timestamp = new Date().toISOString();
    const payload = JSON.stringify({ filesHash, timestamp });

    const cert: TemplateCertificate = {
        version: 1, signer: certInfo.signer, timestamp,
        certPem: certInfo.certPem, files, filesHash,
        signature: signPayload(payload, certInfo.privateKeyPem)
    };

    zip.file(TEMPLATE_SIGNATURE_FILE, JSON.stringify(cert, null, 2));
    if (await saveZipInPlace(win)) {
        dialog.showMessageBox(win, {
            type: 'info', title: 'Template Signed',
            message: '✓ Template signed successfully.',
            detail: `Signed by: ${certInfo.signer}\nTime: ${new Date(timestamp).toLocaleString()}`
        });
    }
}

async function signData(win: BrowserWindow): Promise<void> {
    if (!zip) { dialog.showMessageBox(win, { type: 'warning', message: 'No file loaded.' }); return; }
    const draftFile = zip.file(DATA_TEMP_FILE);
    if (!draftFile) {
        dialog.showMessageBox(win, { type: 'warning', message: 'No data found. Save the form first.' });
        return;
    }

    const certInfo = await selectCertificate(win);
    if (!certInfo) return;

    const steps = listDataSteps();
    const lastStep = steps.length ? steps[steps.length - 1] : null;

    let targetStep: number;
    if (lastStep !== null) {
        const lastSigFile = zip.file(dataStepSignatureFile(lastStep));
        const lastSig: DataStepSignature | null = lastSigFile
            ? JSON.parse(await lastSigFile.async('text'))
            : null;
        // Compare full certificates, not display names — a CN string can be reused
        // across different keys, but certPem can't collide between different signers.
        const samePerson = lastSig !== null && lastSig.certPem === certInfo.certPem;
        if (samePerson) {
            const { response } = await dialog.showMessageBox(win, {
                type: 'question', buttons: ['Update', 'Cancel'],
                message: `Step ${lastStep} is your most recent contribution. Update it with the current data?`
            });
            if (response !== 0) return;
            targetStep = lastStep;
        } else {
            targetStep = lastStep + 1;
        }
    } else {
        targetStep = 1;
    }

    const draftContent = await draftFile.async('uint8array');
    const canonicalData = toCanonicalJson(draftContent);
    const dataHash = hashContent(Buffer.from(canonicalData));
    const timestamp = new Date().toISOString();

    // Recording the template's filesHash at signing time lets verification later
    // confirm the data was actually entered against this specific template.
    const templateCertFile = zip.file(TEMPLATE_SIGNATURE_FILE);
    const templateFilesHash: string | null = templateCertFile
        ? (JSON.parse(await templateCertFile.async('text')) as TemplateCertificate).filesHash
        : null;

    // Chain onto whatever step immediately precedes this slot, so tampering with an
    // earlier contribution after this one was signed becomes detectable at verify time.
    const previousStep = targetStep > 1 ? targetStep - 1 : null;
    let previousDataHash: string | null = null;
    if (previousStep !== null) {
        const prevSigFile = zip.file(dataStepSignatureFile(previousStep));
        if (prevSigFile) {
            const prevSig: DataStepSignature = JSON.parse(await prevSigFile.async('text'));
            previousDataHash = prevSig.dataHash;
        }
    }

    const payload = JSON.stringify({ dataHash, timestamp, templateFilesHash, previousDataHash });

    const sig: DataStepSignature = {
        version: 1, step: targetStep, signer: certInfo.signer, timestamp,
        certPem: certInfo.certPem, dataHash, previousDataHash, templateFilesHash,
        signature: signPayload(payload, certInfo.privateKeyPem)
    };

    zip.file(dataStepFile(targetStep), draftContent);
    zip.file(dataStepSignatureFile(targetStep), JSON.stringify(sig, null, 2));

    if (await saveZipInPlace(win)) {
        dialog.showMessageBox(win, {
            type: 'info', title: 'Contribution Signed',
            message: `✓ Step ${targetStep} signed successfully.`,
            detail: `Signed by: ${certInfo.signer}\nTime: ${new Date(timestamp).toLocaleString()}`
        });
    }
}

// Recomputes and validates the template signature without showing any UI.
async function checkTemplate(): Promise<TemplateVerifyResult> {
    if (!zip) return { signed: false };
    const certFile = zip.file(TEMPLATE_SIGNATURE_FILE);
    if (!certFile) return { signed: false };

    const cert: TemplateCertificate = JSON.parse(await certFile.async('text'));

    // Recompute the hash of the *stored* files map before trusting it — otherwise
    // someone could tamper with a file and edit its entry in cert.files to match,
    // and a naive currentFiles-vs-cert.files comparison would miss it.
    const canonicalStoredFiles = toCanonicalJson(new TextEncoder().encode(JSON.stringify(cert.files)));
    const storedFilesHash = hashContent(Buffer.from(canonicalStoredFiles));
    const filesMapValid = storedFilesHash === cert.filesHash;

    const payload = JSON.stringify({ filesHash: cert.filesHash, timestamp: cert.timestamp });
    let sigValid = false;
    try { sigValid = verifyWithCert(payload, cert.signature, cert.certPem); } catch { /* tampered cert */ }

    const currentFiles = await hashZipFiles(isExcludedFromTemplateHash);
    const changedFiles = diffFileHashes(cert.files, currentFiles);

    const canonicalCurrentFiles = toCanonicalJson(new TextEncoder().encode(JSON.stringify(currentFiles)));
    const currentFilesHash = hashContent(Buffer.from(canonicalCurrentFiles));

    return {
        signed: true, sigValid, filesMapValid, changedFiles,
        signer: signerFromCert(cert.certPem),
        timestamp: cert.timestamp,
        issuer: issuerFromCert(cert.certPem),
        currentFilesHash
    };
}

// Recomputes and validates every signed data step, without showing any UI.
async function checkDataSteps(): Promise<DataStepResult[]> {
    if (!zip) return [];
    const steps = listDataSteps();
    const results: DataStepResult[] = [];

    for (const step of steps) {
        const dataFile = zip.file(dataStepFile(step));
        const sigFile = zip.file(dataStepSignatureFile(step));

        if (!sigFile) { results.push({ step, status: 'missing-signature' }); continue; }
        if (!dataFile) { results.push({ step, status: 'missing-data' }); continue; }

        const sig: DataStepSignature = JSON.parse(await sigFile.async('text'));
        const dataContent = await dataFile.async('uint8array');
        const canonicalData = toCanonicalJson(dataContent);
        const currentHash = hashContent(Buffer.from(canonicalData));

        const payload = JSON.stringify({
            dataHash: sig.dataHash, timestamp: sig.timestamp,
            templateFilesHash: sig.templateFilesHash, previousDataHash: sig.previousDataHash
        });
        let sigValid = false;
        try { sigValid = verifyWithCert(payload, sig.signature, sig.certPem); } catch { /* tampered cert */ }

        const dataMatch = currentHash === sig.dataHash;

        // Confirm this step's recorded predecessor hash still matches what the
        // previous step actually signed — this is what makes tampering with an
        // earlier, already-superseded step detectable.
        let chainValid: boolean;
        if (sig.previousDataHash === null) {
            chainValid = step === steps[0];
        } else {
            const prev = results.find(r => r.step === step - 1);
            chainValid = prev !== undefined && prev.status === 'checked' && prev.dataHash === sig.previousDataHash;
        }

        results.push({
            step, status: 'checked', sigValid, dataMatch, chainValid,
            dataHash: sig.dataHash,
            signer: signerFromCert(sig.certPem),
            timestamp: sig.timestamp,
            issuer: issuerFromCert(sig.certPem),
            templateFilesHash: sig.templateFilesHash
        });
    }

    return results;
}

// Shared by verifyTemplate and verifyAll so both describe the template the same way.
function formatTemplateResult(result: Extract<TemplateVerifyResult, { signed: true }>): string {
    const filesMatch = result.filesMapValid && result.changedFiles.length === 0;
    let s = `TEMPLATE\nSigned by: ${result.signer}\nSigned: ${new Date(result.timestamp).toLocaleString()}\nIssuer: ${result.issuer}`;
    if (!result.filesMapValid)           s += '\n⚠ WARNING: tampering has occurred — the signed file record itself has been altered.';
    else if (result.changedFiles.length) s += `\n⚠ WARNING: tampering has occurred — the following file(s) do not match what was signed:\n${result.changedFiles.join('\n')}`;
    if (!result.sigValid)                s += '\n⚠ WARNING: tampering has occurred — the certificate signature is invalid.';
    if (filesMatch && result.sigValid)   s += '\nStatus: OK.';
    return s;
}

// Shared by verifyData and verifyAll so both describe a step's status the same way.
// templateNote, when given, is appended as-is (verifyAll uses it to report whether
// this step's contribution matches the current template).
function formatDataStepResult(r: DataStepResult, templateNote?: string): string {
    if (r.status === 'missing-signature') {
        return `STEP ${r.step}\n⚠ WARNING: tampering has occurred — this step's signature is missing.`;
    }
    if (r.status === 'missing-data') {
        return `STEP ${r.step}\n⚠ WARNING: tampering has occurred — this step's data is missing even though it was signed.`;
    }

    let s = `STEP ${r.step}\nSigned by: ${r.signer}\nSigned: ${new Date(r.timestamp).toLocaleString()}\nIssuer: ${r.issuer}`;
    if (!r.dataMatch)  s += '\n⚠ WARNING: tampering has occurred — this contribution does not match what was signed.';
    if (!r.sigValid)   s += '\n⚠ WARNING: tampering has occurred — the signature is invalid.';
    if (!r.chainValid) s += '\n⚠ WARNING: tampering has occurred — this step no longer links to the previous contribution; an earlier step may have been altered after the fact.';
    if (templateNote) s += `\n${templateNote}`;
    const ok = r.dataMatch && r.sigValid && r.chainValid && !(templateNote && templateNote.startsWith('⚠'));
    if (ok) s += '\nStatus: OK.';
    return s;
}

async function verifyTemplate(win: BrowserWindow): Promise<void> {
    if (!zip) { dialog.showMessageBox(win, { type: 'warning', message: 'No file loaded.' }); return; }
    const result = await checkTemplate();
    if (!result.signed) {
        dialog.showMessageBox(win, { type: 'info', message: 'This template has not been signed.' });
        return;
    }

    const filesMatch = result.filesMapValid && result.changedFiles.length === 0;
    const ok = result.sigValid && filesMatch;

    dialog.showMessageBox(win, {
        type: ok ? 'info' : 'error',
        title: ok ? 'Template Verified' : 'Verification Failed',
        message: ok ? '✓ Template is authentic and unmodified.' : '✗ Template has been tampered with.',
        detail: formatTemplateResult(result)
    });
}

async function verifyData(win: BrowserWindow): Promise<void> {
    if (!zip) { dialog.showMessageBox(win, { type: 'warning', message: 'No file loaded.' }); return; }
    const results = await checkDataSteps();
    if (!results.length) {
        dialog.showMessageBox(win, { type: 'info', message: 'The data in this file has not been signed.' });
        return;
    }

    const ok = results.every(r => r.status === 'checked' && r.sigValid && r.dataMatch && r.chainValid);

    dialog.showMessageBox(win, {
        type: ok ? 'info' : 'error',
        title: ok ? 'Data Verified' : 'Verification Failed',
        message: ok ? '✓ All contributions are authentic and unmodified.' : '✗ Tampering detected in one or more contributions.',
        detail: results.map(r => formatDataStepResult(r)).join('\n\n')
    });
}

// Lays out the template signature and every data step in chronological order, so a
// template signed in between two data steps shows up exactly where it happened —
// rather than as a single aggregate "matches" summary that hides *when* it was signed
// relative to each contribution. Each data step separately reports whether it matches
// the current template or predates any template signature.
async function verifyAll(win: BrowserWindow): Promise<void> {
    if (!zip) { dialog.showMessageBox(win, { type: 'warning', message: 'No file loaded.' }); return; }

    const template = await checkTemplate();
    const dataSteps = await checkDataSteps();

    let anyTampering = false;
    const leading: string[] = [];
    const timeline: { timestamp: string; text: string }[] = [];
    const undated: string[] = [];

    if (!template.signed) {
        leading.push('TEMPLATE\nNot signed.');
    } else {
        if (!template.filesMapValid || template.changedFiles.length > 0 || !template.sigValid) anyTampering = true;
        timeline.push({ timestamp: template.timestamp, text: formatTemplateResult(template) });
    }

    if (!dataSteps.length) {
        leading.push('DATA\nNot signed.');
    } else {
        for (const r of dataSteps) {
            if (r.status !== 'checked') {
                undated.push(formatDataStepResult(r));
                anyTampering = true;
                continue;
            }

            let templateNote: string;
            if (r.templateFilesHash === null) {
                templateNote = 'Template: had not been signed at the time of this contribution.';
            } else if (!template.signed) {
                templateNote = '⚠ WARNING: tampering has occurred — this contribution was signed against a template, but no template signature is present now.';
                anyTampering = true;
            } else if (r.templateFilesHash === template.currentFilesHash) {
                templateNote = 'Template: matches the current template.';
            } else {
                templateNote = '⚠ WARNING: tampering has occurred — the current template does not match what this contribution was signed against.';
                anyTampering = true;
            }

            if (!r.sigValid || !r.dataMatch || !r.chainValid) anyTampering = true;
            timeline.push({ timestamp: r.timestamp, text: formatDataStepResult(r, templateNote) });
        }
    }

    // ISO timestamps sort correctly as plain strings, so the template's signing event
    // interleaves with data steps exactly where it actually occurred.
    timeline.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    const sections = [...leading, ...timeline.map(t => t.text), ...undated];

    dialog.showMessageBox(win, {
        type: anyTampering ? 'warning' : 'info',
        title: 'Verify All',
        message: anyTampering ? '⚠ Tampering detected — see details below.' : 'Verification Results',
        detail: sections.join('\n\n')
    });
}

// ─── menu ─────────────────────────────────────────────────────────────────────

const menuTemplate: Electron.MenuItemConstructorOptions[] = [
    {
        label: 'File',
        submenu: [
            {
                label: 'Open',
                click: async (_item, browserWindow) => {
                    if (!browserWindow) return;
                    const filePath = await selectFilePath();
                    if (!filePath) return;
                    await openApdfFile(browserWindow as BrowserWindow, filePath).catch(err => console.error(err));
                }
            },
            {
                label: 'Save',
                click: async (_item, browserWindow) => {
                    if (!browserWindow) return;
                    await (browserWindow as BrowserWindow).webContents.executeJavaScript('window.altpdf.saveFile()');
                }
            },
            { type: 'separator' },
            {
                label: 'Print',
                accelerator: 'CmdOrCtrl+P',
                click: (_item, browserWindow) => {
                    if (!browserWindow) return;
                    (browserWindow as BrowserWindow).webContents.print({}, (success, errorType) => {
                        if (!success && errorType) console.error('Print failed:', errorType);
                    });
                }
            },
            { type: 'separator' },
            {
                label: 'Sign Template',
                click: async (_item, browserWindow) => {
                    if (browserWindow) await signTemplate(browserWindow as BrowserWindow);
                }
            },
            {
                label: 'Sign Data',
                click: async (_item, browserWindow) => {
                    if (browserWindow) await signData(browserWindow as BrowserWindow);
                }
            },
            { type: 'separator' },
            {
                label: 'Verify Template',
                click: async (_item, browserWindow) => {
                    if (browserWindow) await verifyTemplate(browserWindow as BrowserWindow);
                }
            },
            {
                label: 'Verify Data',
                click: async (_item, browserWindow) => {
                    if (browserWindow) await verifyData(browserWindow as BrowserWindow);
                }
            },
            {
                label: 'Verify All',
                click: async (_item, browserWindow) => {
                    if (browserWindow) await verifyAll(browserWindow as BrowserWindow);
                }
            },
            { type: 'separator' },
            { role: 'quit' }
        ]
    },
    {
        label: 'View',
        submenu: [
            { role: 'reload' },
            { role: 'toggleDevTools' }
        ]
    }
];

// ─── app setup ────────────────────────────────────────────────────────────────

protocol.registerSchemesAsPrivileged([
    { scheme: 'apdf', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

app.whenReady().then(async () => {
    protocol.handle('apdf', async (request) => {
        const { pathname } = new URL(request.url);
        const filePath = pathname.slice(1);
        const data = await getFileFromZip(filePath);
        // Every open .apdf file serves its pages from this same apdf://localhost/...
        // URL space, so without this, Chromium's HTTP cache would keep serving
        // whichever file's CSS/JS it first fetched instead of the currently loaded one.
        if (data) {
            return new Response(data.toString(), {
                headers: { 'Content-Type': getMimeType(filePath), 'Cache-Control': 'no-store' }
            });
        }
        return new Response(`Not found: ${filePath}`, {
            status: 404,
            headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }
        });
    });

    Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
    createWindow();

    const initialFilePath = getApdfPathFromArgv(process.argv);
    if (initialFilePath) {
        const win = BrowserWindow.getAllWindows()[0];
        if (win) await openApdfFile(win, initialFilePath).catch(err => console.error(err));
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// ─── IPC handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('open-apdf', async (event) => {
    const filePath = await selectFilePath();
    if (!filePath) return null;
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) await openApdfFile(win, filePath).catch(err => console.error(err));
    return filePath;
});

ipcMain.handle('save-apdf', async (_event, data) => {
    try {
        return await saveDataToFile(data);
    } catch (err) {
        console.error(err);
        return false;
    }
});

ipcMain.handle('sign-template', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) await signTemplate(win);
});

ipcMain.handle('sign-data', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) await signData(win);
});

ipcMain.handle('verify-template', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) await verifyTemplate(win);
});

ipcMain.handle('verify-data', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) await verifyData(win);
});

ipcMain.handle('verify-all', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) await verifyAll(win);
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function createWindow() {
    const win = new BrowserWindow({
        width: 1000, height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    win.loadFile(path.join(__dirname, 'renderer/index.html'));
}

async function loadZipIntoMemory(filePath: string): Promise<void> {
    const buffer = fs.readFileSync(filePath);
    zip = await JSZip.loadAsync(buffer);
    currentFilePath = filePath;
}

async function openApdfFile(win: BrowserWindow, filePath: string): Promise<void> {
    await loadZipIntoMemory(filePath);
    await win.loadURL('apdf://localhost/index.html');
}

function getApdfPathFromArgv(argv: string[]): string | null {
    return argv.find(arg => arg.toLowerCase().endsWith('.apdf')) ?? null;
}

async function getFileFromZip(filePath: string): Promise<Buffer | null> {
    if (!zip) return null;
    const file = zip.file(filePath);
    if (!file) return null;
    return Buffer.from(await file.async('uint8array'));
}

function getMimeType(filePath: string): string {
    switch (path.extname(filePath).toLowerCase()) {
        case '.html': return 'text/html';
        case '.css':  return 'text/css';
        case '.js':   return 'application/javascript';
        case '.png':  return 'image/png';
        case '.jpg':
        case '.jpeg': return 'image/jpeg';
        default:      return 'application/octet-stream';
    }
}

async function selectFilePath(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
        title: 'Open AltPDF File',
        filters: [
            { name: 'AltPDF Files', extensions: ['apdf', 'zip'] },
            { name: 'All files', extensions: ['*'] }
        ],
        properties: ['openFile']
    });
    return result.canceled || !result.filePaths.length ? null : result.filePaths[0];
}

async function saveDataToFile(data: any): Promise<boolean> {
    if (!zip) return false;
    zip.file(DATA_TEMP_FILE, JSON.stringify(data, null, 2));
    const content = await zip.generateAsync({ type: 'nodebuffer' });
    const filePath = currentFilePath;
    if (filePath) {
        fs.writeFileSync(filePath, content);
        return true;
    }
    return false;
}

async function saveAsDataToFile(data: any): Promise<void> {
    if (!zip) return;
    zip.file(DATA_TEMP_FILE, JSON.stringify(data, null, 2));
    const content = await zip.generateAsync({ type: 'nodebuffer' });
    const { filePath } = await dialog.showSaveDialog({
        title: 'Save AltPDF File',
        defaultPath: 'altpdf_output.apdf',
        filters: [
            { name: 'AltPDF Files', extensions: ['apdf'] },
            { name: 'All files', extensions: ['*'] }
        ]
    });
    if (filePath) {
        fs.writeFileSync(filePath, content);
        currentFilePath = filePath;
    }
}
