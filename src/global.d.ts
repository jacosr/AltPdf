export {};

declare global {
  interface Window {
    deadpdf: {
      openFile: () => Promise<string | null>;
      saveFile: () => Promise<void>;
      saveData: (data: any) => Promise<void>;
      loadData: () => Promise<any>;
      bindData: (data: any) => void;
      getFormData: () => any;
    };
  }
}


