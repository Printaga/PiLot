// Shared jsdom harness for the webview component specs.
//
// All four webview specs run in ONE Mocha process (scripts/run-webview-tests.mjs),
// so every spec re-installing its own DOM globals made the suite order-dependent:
// the last spec imported overwrote the globals earlier components were loaded
// against. This module is the single idempotent bootstrap — import it FIRST in
// each spec (before any component import); repeated imports are no-ops.
import { JSDOM } from "jsdom";

export let domWindow = globalThis.window;
if (!domWindow || !domWindow.document) {
	domWindow = new JSDOM("<!doctype html><html><body></body></html>").window;
	globalThis.window = domWindow;
	globalThis.document = domWindow.document;
}

// Required by Svelte's client runtime (init_operations + navigator sniff).
// defineProperty because Node ≥21 ships a read-only globalThis.navigator.
for (const k of [
	"navigator",
	"Element",
	"Node",
	"Text",
	"Comment",
	"HTMLElement",
	"HTMLDivElement",
	"HTMLInputElement",
	"HTMLTextAreaElement",
	"HTMLSelectElement",
	"HTMLOptionElement",
	"HTMLMediaElement",
	"SVGElement",
	"DocumentFragment",
	"Event",
	"MessageEvent",
	"MouseEvent",
	"MutationObserver",
]) {
	Object.defineProperty(globalThis, k, {
		value: domWindow[k],
		configurable: true,
		writable: true,
	});
}

// Svelte runtime pairs: both halves must exist so a component doing the
// standard `const h = requestAnimationFrame(...); cancelAnimationFrame(h)`
// dance works with consistent handles.
globalThis.window.requestAnimationFrame ??= (cb) => globalThis.setTimeout(cb, 0);
globalThis.window.cancelAnimationFrame ??= (handle) => globalThis.clearTimeout(handle);

// jsdom implements no element scrolling; components legitimately call these
// from effects (auto-scroll, scroll-into-view). No-op them so effects don't
// throw under test — specs that assert scrolling stub the geometry themselves
// (writable scrollTop + non-zero getBoundingClientRect on the elements under
// test, which shadow these prototype defaults per instance).
domWindow.Element.prototype.scrollTo ??= function scrollTo() {};
domWindow.Element.prototype.scrollIntoView ??= function scrollIntoView() {};
