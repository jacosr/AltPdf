// Minimal stand-in for the 'electron' module so preload.ts can be loaded
// under plain Node/jsdom in tests. contextBridge.exposeInMainWorld just
// assigns the exposed API onto `window` instead of crossing a context
// boundary, which is close enough for exercising the underlying functions.

export const ipcRenderer = {
    invoke: jest.fn().mockResolvedValue(undefined),
};

export const contextBridge = {
    exposeInMainWorld: (apiKey: string, api: unknown): void => {
        (window as unknown as Record<string, unknown>)[apiKey] = api;
    },
};
