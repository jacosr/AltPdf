import { contextBridge, ipcRenderer } from 'electron';

let _formDataCollector: (() => any) | null = null;
let _bindDataOverride: ((data: any) => void) | null = null;

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

contextBridge.exposeInMainWorld('deadpdf', {

    setGetFormData: (fn: () => any) => { _formDataCollector = fn; },
    setBindData: (fn: (data: any) => void) => { _bindDataOverride = fn; },
    getFormData: () => { return _getFormData(); },
    openFile: () => ipcRenderer.invoke('open-dpdf'),
    saveFile: () => {
        console.log("Saving file...");
        const data = _getFormData();
        console.log("Form data to save:", data);
        
        return ipcRenderer.invoke('save-dpdf', data);
    },
    saveData: (data: any) => ipcRenderer.invoke('save-dpdf', data),
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


