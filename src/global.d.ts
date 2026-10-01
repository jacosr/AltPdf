export {};

declare global {
  interface Window {
    altpdf: {
      openFile: () => Promise<string | null>;
      saveFile: () => Promise<void>;
      saveData: (data: any) => Promise<void>;
      loadData: () => Promise<any>;
      bindData: (data: any) => void;
      setGetFormData: (fn: () => any) => void;
      setBindData: (fn: (data: any) => void) => void;
      getFormData: () => any;
      getHighlightStyle: () => string;
      setHighlightStyle: (value: string) => void;
      signTemplate:   () => Promise<void>;
      signData:       () => Promise<void>;
      verifyTemplate: () => Promise<void>;
      verifyData:     () => Promise<void>;
      verifyAll:      () => Promise<void>;
      toggleChangesPanel: () => Promise<void>;
    };
  }
}


