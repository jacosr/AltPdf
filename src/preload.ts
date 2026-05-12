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

function _bindData(data: any) {
    if (_bindDataOverride) { _bindDataOverride(data); return; }
    document.querySelectorAll('[name]').forEach(el => {
        const name = el.getAttribute('name');
        if (name && data[name]) {
            (el as any).value = data[name];
        }
    });
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
    }
}); 



window.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded, loading data...");
    _loadData().then(data => {
        _bindData(data);
    });
});


