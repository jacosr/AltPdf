import { contextBridge, ipcRenderer } from 'electron';

let _formDataCollector: (() => any) | null = null;
let _bindDataOverride: ((data: any) => void) | null = null;

function _getFormData(): any {
    if (_formDataCollector) return _formDataCollector();
    console.log("Collecting form data...");
    const data: any = {};
    document.querySelectorAll('[name]').forEach(el => {
        const name = el.getAttribute('name');
        if (name) {
            data[name] = (el as any).value;
        }
    });
    return data;
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


