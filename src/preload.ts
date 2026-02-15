import { contextBridge, ipcRenderer } from 'electron';


contextBridge.exposeInMainWorld('deadpdf', {
    
    openFile: () => ipcRenderer.invoke('open-dpdf'),
    saveData: (data: any) => ipcRenderer.invoke('save-dpdf', data)
    
}); 








