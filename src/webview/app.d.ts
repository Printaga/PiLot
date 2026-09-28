/// <reference types="svelte" />
/// <reference types="vite/client" />

/** Structural view of the VS Code webview API bridge (no `any` in component code). */
export interface VsCodeApi {
  getState(): unknown;
  setState(state: unknown): void;
  postMessage(message: unknown): void;
}

declare global {
  interface Window {
    acquireVsCodeApi: () => VsCodeApi;
    vscode?: VsCodeApi;
    __toast?: {
      showToast: (opts: {
        type: "info" | "success" | "warning" | "error";
        title: string;
        message?: string;
        persistent?: boolean;
        duration?: number;
      }) => string;
      dismissToast: (id: string) => void;
      clearToasts: () => void;
    };
  }
}

export {};
