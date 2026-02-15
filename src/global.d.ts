export {};

declare global {
  interface Window {
    deadpdf: {
      openFile: () => Promise<string | null>;
      saveData: (data: any) => Promise<void>;
    };
  }
}


