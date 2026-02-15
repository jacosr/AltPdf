import { app, BrowserWindow, protocol, webContents } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import JSZip, { file } from 'jszip';
import {dialog,ipcMain} from 'electron';
import { Menu } from 'electron';


let zip: JSZip | null = null;

const menuTemplate: Electron.MenuItemConstructorOptions[] = [
    {
        label: 'File',
        submenu: [
            {
                label: 'Open',
                click: async (menuItem, browserWindow) => {
                    if (!browserWindow) return;

                    const filePath = await selectFilePath();
                    console.log("Selected file:", filePath);
                    if (!filePath) { return; }

                    await loadZipIntoMemory(filePath).catch((err) => {
                        console.error("Error loading zip file:", err);
                    });

                    const win = browserWindow as Electron.BrowserWindow;
                    win.loadURL('dpdf://index.html');
                }
            },
            {
                label: 'Save',
                click: async (menuItem, browserWindow) => {
                    if (!browserWindow) return;

                    
                }
            },
            { type: 'separator' },
            { role: 'quit' }
        ]
    },
];

app.whenReady().then(() => {

    protocol.registerBufferProtocol('dpdf', (request, callback) => {
        const url = request.url.replace('dpdf://', '');    // all urls start with dpdf://
        
        // try to load from zip
        getFileFromZip(url).then((data) => {
            if (data) {

                callback({
                    mimeType: getMimeType(url),
                    data: data  
                });
                return;
            }
            else {
                // default fallback
                callback({
                    data: Buffer.from(`Not found: ${url}`), 
                    mimeType: 'text/plain' 
                });
            }
        }).catch((err) => {
            console.error("Error loading from zip:", err);
        });

    });

    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu);

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

ipcMain.handle('open-dpdf', async (webContents) => {
    const filePath = await selectFilePath();
    console.log("Selected file:", filePath);
    if (!filePath) { return null; }

    await loadZipIntoMemory(filePath).catch((err) => {
        console.error("Error loading zip file:", err);
    });
    console.log("Loaded zip into memory:", filePath);

    const win = BrowserWindow.getFocusedWindow();
    win?.loadURL('dpdf://index.html');

    return filePath;
});

ipcMain.handle('save-dpdf', async (webContents, data) => {
    await saveDataToFile(data).catch((err) => {
        console.error("Error saving data to zip:", err);
    });
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
    },
  });
}

async function loadZipIntoMemory(filePath: string) {
    const buffer = fs.readFileSync(filePath);
    zip = await JSZip.loadAsync(buffer);
}

async function getFileFromZip(filePath: string): Promise<Buffer | null> {
    if (!zip) return null;

    const file = zip.file(filePath);
    if (!file) return null;

    const data = await file.async('uint8array');
    return Buffer.from(data);
}

function getMimeType(filePath: string): string {
    const extension = path.extname(filePath).toLowerCase();
    switch (extension) {
        case '.html':
            return 'text/html';
        case '.css':
            return 'text/css';
        case '.js':
            return 'application/javascript';
        case '.png':
            return 'image/png';
        case '.jpg':
        case '.jpeg':
            return 'image/jpeg';
        default:
            return 'application/octet-stream';
    }
}

async function selectFilePath(): Promise<string | null> { 

    const result = await dialog.showOpenDialog({
        title: 'Open DeadPDF File',
        filters: [
            { name: 'DeadPDF Files', extensions: ['dpdf','zip'] },
            { name: 'All files', extensions: ['*'] }
        ],
        properties: ['openFile']
    });

    if (result.canceled || result.filePaths.length === 0) {
        return null;
    }

    return result.filePaths[0];
}

async function saveDataToFile(data: any): Promise<void> {
    if (!zip) { return; }

    const json = JSON.stringify(data, null, 2);
    zip.file('data.json', json);

    const content = await zip.generateAsync({ type: 'nodebuffer' });
    const { filePath } = await dialog.showSaveDialog({
        title: 'Save DeadPDF File',
        defaultPath: 'deadpdf_output.dpdf',
        filters: [
            { name: 'DeadPDF Files', extensions: ['dpdf'] },
            { name: 'All files', extensions: ['*'] }
        ]
    });

    if (filePath) {
        fs.writeFileSync(filePath, content);
    }
}

