/// <reference types="svelte" />
/// <reference types="vite/client" />

import type { WebviewMessage } from "../protocol/types.js";

/** Structural view of the VS Code webview API bridge (no `any` in component code). */
export interface VsCodeApi {
  /** Persisted-state APIs are part of the bridge but currently unused by this app. */
  getState(): unknown;
  setState(state: unknown): void;
  /** Outbound payload; `WebviewMessage` in src/protocol/types.ts is the shared contract. */
  postMessage(message: WebviewMessage): void;
}

/** Shape of the toast bridge `Toast.svelte` installs on `window.__toast`. */
export interface ToastBridge {
  /** Resolves to a toast id; feed it back into `dismissToast`/`clearToasts`. */
  showToast: (opts: {
    type: "info" | "success" | "warning" | "error";
    title: string;
    message?: string;
    persistent?: boolean;
    duration?: number;
  }) => string;
  dismissToast: (id: string) => void;
  clearToasts: () => void;
}

declare global {
  interface Window {
    /**
     * Injected only inside a VS Code webview. VS Code permits a single
     * acquisition per webview session — a second call throws. Obtain the API
     * via `getVsCodeApi()` (messages.ts), which memoizes the one permitted
     * instance instead of re-calling this.
     */
    acquireVsCodeApi?: () => VsCodeApi;
    vscode?: VsCodeApi;
    /** Set while the <Toast> component is mounted; absent otherwise, so always null-check. */
    __toast?: ToastBridge;
  }
}

export {};
