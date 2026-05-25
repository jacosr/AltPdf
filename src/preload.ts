import { contextBridge, ipcRenderer } from 'electron';

let _formDataCollector: (() => any) | null = null;
let _bindDataOverride: ((data: any) => void) | null = null;
let _displaySaveResultOverride: ((result: boolean) => void) | null = null;

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
    const res = await fetch('data.json');
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

contextBridge.exposeInMainWorld('altpdf', {

    setGetFormData: (fn: () => any) => { _formDataCollector = fn; },
    setBindData: (fn: (data: any) => void) => { _bindDataOverride = fn; },
    setDisplaySaveResult: (fn: (result: boolean) => void) => { _displaySaveResultOverride = fn; },
    getFormData: () => { return _getFormData(); },
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
}); 



window.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded, loading data...");
    _loadData().then(data => {
        _bindData(data);
    });
});


