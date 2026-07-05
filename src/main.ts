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

// Files excluded when hashing the template
const SIGN_EXCLUSIONS = new Set(['template-certificate.json', 'data-signature.json', 'data.json']);

interface TemplateCertificate {
    version: number;
    signer: string;    // CN from certificate — informational only; always re-read from certPem on verify
    timestamp: string;
    certPem: string;   // full X.509 certificate; public key is extracted from this for verification
    files: Record<string, string>;
    signature: string;
}

interface DataSignature {
    version: number;
    signer: string;
    timestamp: string;
    certPem: string;
    dataHash: string;
    signature: string;
}

interface CertificateInfo {
    signer: string;
    privateKeyPem: string;
    certPem: string;
}

// ─── crypto helpers ───────────────────────────────────────────────────────────

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

async function hashZipFiles(exclusions: Set<string>): Promise<Record<string, string>> {
    if (!zip) return {};
    const files: Record<string, string> = {};
    for (const filename of Object.keys(zip.files)) {
        if (!exclusions.has(filename) && !zip.files[filename].dir) {
            const content = await zip.files[filename].async('uint8array');
            files[filename] = hashContent(Buffer.from(content));
        }
    }
    return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}

// ─── sign / verify ────────────────────────────────────────────────────────────

async function signTemplate(win: BrowserWindow): Promise<void> {
    if (!zip) { dialog.showMessageBox(win, { type: 'warning', message: 'No file loaded.' }); return; }
    if (zip.file('template-certificate.json')) {
        dialog.showMessageBox(win, {
            type: 'warning', title: 'Already Signed',
            message: 'This template has already been signed and cannot be re-signed.'
        });
        return;
    }

    const certInfo = await selectCertificate(win);
    if (!certInfo) return;

    const files = await hashZipFiles(SIGN_EXCLUSIONS);
    const timestamp = new Date().toISOString();
    const payload = JSON.stringify({ files, timestamp });

    const cert: TemplateCertificate = {
        version: 1, signer: certInfo.signer, timestamp,
        certPem: certInfo.certPem, files,
        signature: signPayload(payload, certInfo.privateKeyPem)
    };

    zip.file('template-certificate.json', JSON.stringify(cert, null, 2));
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
    const dataFile = zip.file('data.json');
    if (!dataFile) {
        dialog.showMessageBox(win, { type: 'warning', message: 'No data found. Save the form first.' });
        return;
    }
    if (zip.file('data-signature.json')) {
        const { response } = await dialog.showMessageBox(win, {
            type: 'question', buttons: ['Re-sign', 'Cancel'],
            message: 'Data is already signed. Replace the existing signature?'
        });
        if (response !== 0) return;
    }

    const certInfo = await selectCertificate(win);
    if (!certInfo) return;

    const dataContent = await dataFile.async('uint8array');
    const dataHash = hashContent(Buffer.from(dataContent));
    const timestamp = new Date().toISOString();
    const payload = JSON.stringify({ dataHash, timestamp });

    const sig: DataSignature = {
        version: 1, signer: certInfo.signer, timestamp,
        certPem: certInfo.certPem, dataHash,
        signature: signPayload(payload, certInfo.privateKeyPem)
    };

    zip.file('data-signature.json', JSON.stringify(sig, null, 2));
    if (await saveZipInPlace(win)) {
        dialog.showMessageBox(win, {
            type: 'info', title: 'Data Signed',
            message: '✓ Data signed successfully.',
            detail: `Signed by: ${certInfo.signer}\nTime: ${new Date(timestamp).toLocaleString()}`
        });
    }
}

async function verifyTemplate(win: BrowserWindow): Promise<void> {
    if (!zip) { dialog.showMessageBox(win, { type: 'warning', message: 'No file loaded.' }); return; }
    const certFile = zip.file('template-certificate.json');
    if (!certFile) {
        dialog.showMessageBox(win, { type: 'info', message: 'This template has not been signed.' });
        return;
    }

    const cert: TemplateCertificate = JSON.parse(await certFile.async('text'));
    const currentFiles = await hashZipFiles(SIGN_EXCLUSIONS);

    const payload = JSON.stringify({ files: cert.files, timestamp: cert.timestamp });
    let sigValid = false;
    try { sigValid = verifyWithCert(payload, cert.signature, cert.certPem); } catch { /* tampered cert */ }

    const filesMatch = JSON.stringify(currentFiles) === JSON.stringify(cert.files);
    const ok = sigValid && filesMatch;

    let detail = `Signed by: ${signerFromCert(cert.certPem)}\nSigned: ${new Date(cert.timestamp).toLocaleString()}\nIssuer: ${issuerFromCert(cert.certPem)}`;
    if (!filesMatch) detail += '\n\nThe template files do not match what was originally signed.';
    if (!sigValid)   detail += '\n\nThe certificate signature is invalid.';

    dialog.showMessageBox(win, {
        type: ok ? 'info' : 'error',
        title: ok ? 'Template Verified' : 'Verification Failed',
        message: ok ? '✓ Template is authentic and unmodified.' : '✗ Template has been tampered with.',
        detail
    });
}

async function verifyData(win: BrowserWindow): Promise<void> {
    if (!zip) { dialog.showMessageBox(win, { type: 'warning', message: 'No file loaded.' }); return; }
    const sigFile = zip.file('data-signature.json');
    if (!sigFile) {
        dialog.showMessageBox(win, { type: 'info', message: 'The data in this file has not been signed.' });
        return;
    }
    const dataFile = zip.file('data.json');
    if (!dataFile) {
        dialog.showMessageBox(win, { type: 'error', message: 'No data.json found.' });
        return;
    }

    const sig: DataSignature = JSON.parse(await sigFile.async('text'));
    const dataContent = await dataFile.async('uint8array');
    const currentHash = hashContent(Buffer.from(dataContent));

    const payload = JSON.stringify({ dataHash: sig.dataHash, timestamp: sig.timestamp });
    let sigValid = false;
    try { sigValid = verifyWithCert(payload, sig.signature, sig.certPem); } catch { /* tampered cert */ }

    const dataMatches = currentHash === sig.dataHash;
    const ok = sigValid && dataMatches;

    let detail = `Signed by: ${signerFromCert(sig.certPem)}\nSigned: ${new Date(sig.timestamp).toLocaleString()}\nIssuer: ${issuerFromCert(sig.certPem)}`;
    if (!dataMatches) detail += '\n\nThe data does not match what was signed.';
    if (!sigValid)    detail += '\n\nThe data signature is invalid.';

    dialog.showMessageBox(win, {
        type: ok ? 'info' : 'error',
        title: ok ? 'Data Verified' : 'Verification Failed',
        message: ok ? '✓ Data is authentic and unmodified.' : '✗ Data has been tampered with.',
        detail
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
                    await loadZipIntoMemory(filePath).catch(err => console.error(err));
                    await (browserWindow as BrowserWindow).loadURL('apdf://localhost/index.html');
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

app.whenReady().then(() => {
    protocol.handle('apdf', async (request) => {
        const { pathname } = new URL(request.url);
        const filePath = pathname.slice(1);
        const data = await getFileFromZip(filePath);
        if (data) {
            return new Response(data.toString(), { headers: { 'Content-Type': getMimeType(filePath) } });
        }
        return new Response(`Not found: ${filePath}`, { status: 404, headers: { 'Content-Type': 'text/plain' } });
    });

    Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
    createWindow();

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
    await loadZipIntoMemory(filePath).catch(err => console.error(err));
    BrowserWindow.fromWebContents(event.sender)?.loadURL('apdf://localhost/index.html');
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
    zip.file('data.json', JSON.stringify(data, null, 2));
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
    zip.file('data.json', JSON.stringify(data, null, 2));
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
