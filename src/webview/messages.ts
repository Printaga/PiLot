// ── Shared message-event validation for webview components ────────────────────
import type { WebviewMessage } from "../protocol/types.js";
import type { VsCodeApi } from "./app.d";
//
// Every component listens on window "message". The only legitimate sender is
// the extension host, but any other frame, script, or devtools snippet can
// dispatch a MessageEvent at this window, so each handler must treat
// `event.data` as untrusted input: check the shape before destructuring and
// never assume the payload is an object.

/** True when the value is a non-null, non-array object (a plain record). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Runtime shape guard for messages posted from the extension host.
 * Returns a normalized `{ type, data }` view, or null when the event is not a
 * well-formed host message (wrong envelope or a primitive payload).
 *
 * `data` may be an object or an array — some host broadcasts (e.g. `installed`,
 * `sessions-list`) have historically carried a bare list, and collapsing an
 * array to {} silently blanked those lists in the UI. Consumers must still
 * shape-check every field they read; this guard only rejects envelopes that
 * cannot carry a payload at all.
 */
export function parseHostMessage(
  event: MessageEvent,
): { type: string; data: Record<string, unknown> | unknown[] } | null {
  const envelope: unknown = event.data;
  // Defense-in-depth against forged events: reject anything not dispatched by
  // this window itself (the host bridge posts with the webview window as
  // source; a devtools snippet or injected frame typically does not).
  if (typeof event.source !== "undefined" && event.source !== window) return null;
  if (!isRecord(envelope) || typeof envelope.type !== "string") return null;
  const data: unknown = envelope.data;
  return { type: envelope.type, data: isRecord(data) || Array.isArray(data) ? data : {} };
}

/** Coerce an unknown value to a string with a fallback (hostile/missing fields never crash a handler). */
export function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/** Coerce an unknown value to a finite number with a fallback. */
export function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Clamp a number into [min, max], returning a safe in-range fallback for
 *  non-finite input or invalid bounds (min > max would otherwise yield an
 *  arbitrary value; an out-of-range fallback would silently defeat the clamp). */
export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
    return fallback;
  }
  const safeFallback = Math.min(max, Math.max(min, Number.isFinite(fallback) ? fallback : min));
  const n = asNumber(value, safeFallback);
  return Math.min(max, Math.max(min, n));
}

/** Maximum items retained by asArray: the payload is untrusted, and a forged
 *  hole-preserved huge array must not be walked in full. */
const MAX_ARRAY_ITEMS = 10_000;

/** True when the value is an array (optionally with every item passing `item`). */
export function asArray<T = unknown>(value: unknown, item?: (v: unknown) => v is T): T[] {
  if (!Array.isArray(value)) return [];
  const slice = value.slice(0, MAX_ARRAY_ITEMS);
  if (!item) return [...slice] as T[];
  return slice.filter((v): v is T => item(v));
}

/**
 * Post a message to the extension host if the API is available.
 *
 * Single shared implementation — five components previously carried byte-ident
 * copies of this helper (fallow dupes.json flagged the clone group).
 */
export function postToHost(message: WebviewMessage): void {
  const vscode = window.vscode;
  if (typeof vscode?.postMessage === "function") {
    vscode.postMessage(message);
  }
}

/**
 * Memoized acquisition of the single permitted VS Code API instance.
 *
 * VS Code grants exactly one `acquireVsCodeApi()` call per webview session —
 * a second call throws — so every consumer must go through this helper
 * instead of calling the raw API directly.
 */
export function getVsCodeApi(): VsCodeApi | undefined {
  if (window.vscode) return window.vscode;
  if (typeof window.acquireVsCodeApi !== "function") return undefined;
  try {
    window.vscode = window.acquireVsCodeApi();
  } catch {
    // Already acquired elsewhere without populating the cache: nothing to do.
  }
  return window.vscode;
}
