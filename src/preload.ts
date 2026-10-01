import { contextBridge, ipcRenderer } from 'electron';

let _formDataCollector: (() => any) | null = null;
let _bindDataOverride: ((data: any) => void) | null = null;
let _displaySaveResultOverride: ((result: boolean) => void) | null = null;
let _highlightStyle: string = 'background-color: yellow';

function _getFormData(): any {
    if (_formDataCollector) return _formDataCollector();
    console.log("Collecting form data...");

    // the default form data collector, which handles nested fieldsets

    const SKIP_TYPES = new Set(['submit', 'button', 'reset', 'image']);
    const form = document.querySelector('form');
    if (!form) { console.warn("No form found in document."); return {}; }

    function addValue(obj: Record<string, any>, key: string, value: any): void {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            if (!Array.isArray(obj[key])) obj[key] = [obj[key]];
            obj[key].push(value);
        } else {
            obj[key] = value;
        }
    }

    function collect(container: Element): Record<string, any> {
        const result: Record<string, any> = {};
        function walk(node: Element): void {
            for (const child of node.children) {
                if (child.tagName.toUpperCase() === 'FIELDSET') {
                    const name = child.getAttribute('name');
                    if (name) {
                        addValue(result, name, collect(child));
                    } else {
                        walk(child);
                    }
                } else if (child.matches('input, textarea, select')) {
                    const el = child as HTMLInputElement;
                    const name = el.getAttribute('name');
                    if (name && !SKIP_TYPES.has(el.type)) {
                        if ((el.type === 'checkbox' || el.type === 'radio') && !el.checked) continue;
                        if (el.type === 'select-multiple') {
                            for (const opt of (el as unknown as HTMLSelectElement).selectedOptions) {
                                addValue(result, name, opt.value);
                            }
                        } else {
                            addValue(result, name, el.value);
                        }
                    }
                } else {
                    walk(child);
                }
            }
        }
        walk(container);
        return result;
    }

    const formName = form.getAttribute('name') || form.id || 'form';
    return { [formName]: collect(form) };
}

async function _loadData(): Promise<any> {
    console.log("Loading data...");
    const res = await fetch('data-temp.json');
    console.log("Loaded data:", res);
    if (!res.ok) { return {}; }
    return res.json();
}

function _bindData(data: any): void {
    if (_bindDataOverride) { _bindDataOverride(data); return; }

    const formName = Object.keys(data)[0];
    if (!formName) return;
    const formData: Record<string, any> = data[formName];

    const form = document.querySelector<HTMLFormElement>(`form[name="${formName}"]`)
        ?? document.getElementById(formName) as HTMLFormElement | null
        ?? document.querySelector('form');
    if (!form) { console.warn("No form found for binding."); return; }

    function fill(container: Element, values: Record<string, any>): void {
        function walk(node: Element): void {
            for (const child of node.children) {
                if (child.tagName.toUpperCase() === 'FIELDSET') {
                    const name = child.getAttribute('name');
                    if (name && name in values && !Array.isArray(values[name]) && typeof values[name] === 'object') {
                        fill(child, values[name]);
                    } else {
                        walk(child);
                    }
                } else if (child.matches('input, textarea, select')) {
                    const el = child as HTMLInputElement;
                    const name = el.getAttribute('name');
                    if (!name || !(name in values)) continue;
                    const val = values[name];

                    if (el.type === 'checkbox') {
                        const arr: string[] = Array.isArray(val) ? val : [val];
                        el.checked = arr.includes(el.value);
                    } else if (el.type === 'radio') {
                        el.checked = el.value === String(val);
                    } else if (el.type === 'select-multiple') {
                        const sel = el as unknown as HTMLSelectElement;
                        const arr: string[] = Array.isArray(val) ? val : [val];
                        for (const opt of sel.options) {
                            opt.selected = arr.includes(opt.value);
                        }
                    } else {
                        el.value = String(val ?? '');
                    }
                } else {
                    walk(child);
                }
            }
        }
        walk(container);
    }

    fill(form, formData);
}

function _displaySaveResult(result: boolean): void {
    if (_displaySaveResultOverride) { _displaySaveResultOverride(result); return; }

    const toast = document.createElement('div');
    toast.textContent = result ? 'Saved' : 'Save failed';
    Object.assign(toast.style, {
        position:     'fixed',
        bottom:       '24px',
        right:        '24px',
        zIndex:       '2147483647',
        padding:      '10px 18px',
        borderRadius: '8px',
        fontSize:     '13px',
        fontWeight:   '600',
        color:        '#fff',
        background:   result ? '#22c55e' : '#ef4444',
        boxShadow:    '0 4px 12px rgba(0,0,0,0.25)',
        opacity:      '1',
        transition:   'opacity 0.4s ease',
        pointerEvents: 'none',
    });

    document.body.appendChild(toast);

    setTimeout(() => { toast.style.opacity = '0'; }, 2000);
    setTimeout(() => { toast.remove(); }, 2400);
}

// ─── changes panel ────────────────────────────────────────────────────────────

const EYE_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
const DELTA_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 21 20 3 20Z"/></svg>';
const CHANGES_PANEL_WIDTH = '300px';

let _changesPanelEl: HTMLElement | null = null;
let _preChangesSnapshot: any = null;

// Resets every field on the form to its blank/unchecked default before applying
// an eye or delta snapshot. Needed because a step's own JSON can omit a field
// entirely (e.g. a checkbox group with nothing checked never gets a key at all),
// which bindData's normal "leave it alone if absent" behavior would otherwise
// read as "keep whatever the previously-viewed step left checked".
function _clearForm(): void {
    const form = document.querySelector('form');
    if (!form) return;
    const SKIP_TYPES = new Set(['submit', 'button', 'reset', 'image']);
    for (const el of form.querySelectorAll('input, textarea, select')) {
        const input = el as HTMLInputElement;
        if (SKIP_TYPES.has(input.type)) continue;
        if (input.type === 'checkbox' || input.type === 'radio') {
            input.checked = false;
        } else if (input.tagName === 'SELECT') {
            for (const opt of (input as unknown as HTMLSelectElement).options) opt.selected = false;
        } else {
            input.value = '';
        }
    }
}

// Elements currently showing the highlight style, paired with their style.cssText
// from just before it was applied — restoring that (rather than trying to peel
// the highlightStyle properties back out) is what lets _clearHighlights() revert
// cleanly regardless of what arbitrary CSS highlightStyle contains.
let _highlightedElements: { el: HTMLElement; originalStyle: string }[] = [];

function _clearHighlights(): void {
    for (const { el, originalStyle } of _highlightedElements) {
        el.style.cssText = originalStyle;
    }
    _highlightedElements = [];
}

function _applyHighlight(el: HTMLElement): void {
    _highlightedElements.push({ el, originalStyle: el.style.cssText });
    el.style.cssText += `;${_highlightStyle}`;
}

// Walks a bindData-shaped payload the same way _bindData's fill() does, but
// instead of setting values, highlights whichever fields it would have touched —
// used to show which fields changed in a delta view. A checkbox/radio group or
// multi-select counts as one field: everything sharing that name gets highlighted
// together, since the diff can only tell us the group's value changed as a whole,
// not which individual option flipped.
function _highlightChangedFields(data: any): void {
    const formName = Object.keys(data)[0];
    if (!formName) return;
    const formData: Record<string, any> = data[formName];

    const form = document.querySelector<HTMLFormElement>(`form[name="${formName}"]`)
        ?? document.getElementById(formName) as HTMLFormElement | null
        ?? document.querySelector('form');
    if (!form) return;

    function walk(container: Element, values: Record<string, any>): void {
        for (const child of container.children) {
            if (child.tagName.toUpperCase() === 'FIELDSET') {
                const name = child.getAttribute('name');
                if (name && name in values && !Array.isArray(values[name]) && typeof values[name] === 'object') {
                    walk(child, values[name]);
                } else {
                    walk(child, values);
                }
            } else if (child.matches('input, textarea, select')) {
                const name = child.getAttribute('name');
                if (name && name in values) {
                    _applyHighlight(child as HTMLElement);
                }
            } else {
                walk(child, values);
            }
        }
    }

    walk(form, formData);
}

async function _renderChangesList(listEl: HTMLElement): Promise<void> {
    listEl.innerHTML = '';
    const changes: { step: number; signer: string; timestamp: string }[] =
        (await ipcRenderer.invoke('list-changes')) ?? [];

    if (!changes.length) {
        const empty = document.createElement('div');
        empty.textContent = 'No signed contributions yet.';
        Object.assign(empty.style, { padding: '16px', color: '#888', fontSize: '13px' });
        listEl.appendChild(empty);
        return;
    }

    changes.forEach((change, index) => {
        const row = document.createElement('div');
        Object.assign(row.style, {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', borderBottom: '1px solid rgba(0,0,0,0.08)', fontSize: '13px',
        });

        const info = document.createElement('div');
        const label = document.createElement('div');
        label.textContent = `Step ${change.step} · ${change.signer}`;
        Object.assign(label.style, { fontWeight: '600' });
        const time = document.createElement('div');
        time.textContent = new Date(change.timestamp).toLocaleString();
        Object.assign(time.style, { color: '#888', fontSize: '11px' });
        info.append(label, time);

        const actions = document.createElement('div');
        Object.assign(actions.style, { display: 'flex', gap: '6px' });

        const eyeBtn = document.createElement('button');
        eyeBtn.innerHTML = EYE_ICON;
        eyeBtn.title = 'View this contribution';
        eyeBtn.onclick = async () => {
            const data = await ipcRenderer.invoke('load-change-step', change.step);
            if (data) { _clearForm(); _clearHighlights(); _bindData(data); }
        };

        const deltaBtn = document.createElement('button');
        deltaBtn.innerHTML = DELTA_ICON;
        // The first contribution chronologically has no predecessor to diff against.
        const isFirst = index === 0;
        deltaBtn.title = isFirst ? 'No previous contribution to compare against' : 'View what changed in this contribution';
        deltaBtn.disabled = isFirst;
        deltaBtn.onclick = async () => {
            if (isFirst) return;
            const diff = await ipcRenderer.invoke('load-change-delta', change.step);
            if (diff) { _clearForm(); _clearHighlights(); _bindData(diff); _highlightChangedFields(diff); }
        };

        for (const btn of [eyeBtn, deltaBtn]) {
            Object.assign(btn.style, {
                border: 'none', background: 'transparent', cursor: btn.disabled ? 'default' : 'pointer',
                padding: '4px', borderRadius: '4px', color: btn.disabled ? '#ccc' : '#555', lineHeight: '0',
            });
        }

        actions.append(eyeBtn, deltaBtn);
        row.append(info, actions);
        listEl.appendChild(row);
    });
}

function _ensureChangesPanel(): HTMLElement {
    if (_changesPanelEl) return _changesPanelEl;

    const panel = document.createElement('div');
    panel.id = 'altpdf-changes-panel';
    Object.assign(panel.style, {
        position: 'fixed', top: '0', left: '0', width: CHANGES_PANEL_WIDTH, height: '100vh',
        background: '#fff', boxShadow: '2px 0 12px rgba(0,0,0,0.15)', zIndex: '2147483646',
        transform: 'translateX(-100%)', transition: 'transform 0.25s ease',
        display: 'flex', flexDirection: 'column', overflowY: 'auto',
        fontFamily: 'system-ui, sans-serif', boxSizing: 'border-box',
    });

    const header = document.createElement('div');
    header.textContent = 'Changes';
    Object.assign(header.style, {
        padding: '14px', fontWeight: '700', fontSize: '14px',
        borderBottom: '1px solid rgba(0,0,0,0.1)',
    });

    const list = document.createElement('div');
    list.id = 'altpdf-changes-list';

    panel.append(header, list);
    document.body.appendChild(panel);
    document.body.style.transition = 'margin-left 0.25s ease';

    _changesPanelEl = panel;
    return panel;
}

async function _toggleChangesPanel(): Promise<void> {
    const panel = _ensureChangesPanel();
    const isOpen = panel.style.transform === 'translateX(0px)';

    if (isOpen) {
        panel.style.transform = 'translateX(-100%)';
        document.body.style.marginLeft = '0';
        // Undo whatever eye/delta preview is currently on screen and restore
        // exactly what was there — including unsaved edits — before the panel
        // was opened, rather than reloading the last saved draft off disk.
        if (_preChangesSnapshot) {
            _clearForm();
            _clearHighlights();
            _bindData(_preChangesSnapshot);
            _preChangesSnapshot = null;
        }
    } else {
        _preChangesSnapshot = _getFormData();
        const list = panel.querySelector('#altpdf-changes-list') as HTMLElement;
        await _renderChangesList(list);
        panel.style.transform = 'translateX(0px)';
        document.body.style.marginLeft = CHANGES_PANEL_WIDTH;
    }
}

contextBridge.exposeInMainWorld('altpdf', {

    setGetFormData: (fn: () => any) => { _formDataCollector = fn; },
    setBindData: (fn: (data: any) => void) => { _bindDataOverride = fn; },
    setDisplaySaveResult: (fn: (result: boolean) => void) => { _displaySaveResultOverride = fn; },
    getFormData: () => { return _getFormData(); },
    getHighlightStyle: () => _highlightStyle,
    setHighlightStyle: (value: string) => { _highlightStyle = value; },
    openFile: () => ipcRenderer.invoke('open-apdf'),
    saveFile: async () => {
        const data = _getFormData();     
        let result = await ipcRenderer.invoke('save-apdf', data);
        console.log("Save result:", result);
        _displaySaveResult(result);
    },
    saveData: async (data: any) => {
        let result = await ipcRenderer.invoke('save-apdf', data);
        _displaySaveResult(result);
    },
    loadData: async () => {
        return await _loadData();
    },
    bindData: (data: any) => {
        _bindData(data);
    },
    signTemplate:   () => ipcRenderer.invoke('sign-template'),
    signData:       () => ipcRenderer.invoke('sign-data'),
    verifyTemplate: () => ipcRenderer.invoke('verify-template'),
    verifyData:     () => ipcRenderer.invoke('verify-data'),
    verifyAll:      () => ipcRenderer.invoke('verify-all'),
    toggleChangesPanel: () => _toggleChangesPanel(),
});



window.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded, loading data...");
    _loadData().then(data => {
        _bindData(data);
    });
});


