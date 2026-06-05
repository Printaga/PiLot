/// <reference types="svelte" />
/// <reference types="vite/client" />

declare global {
	interface Window {
		acquireVsCodeApi: () => {
			getState: () => any;
			setState: (state: any) => void;
			postMessage: (message: any) => void;
		};
	}
}

export {};
