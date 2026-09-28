// ── Shared message-event validation for webview components ────────────────────
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
 * well-formed host message (wrong envelope, non-object payload, or a payload
 * that is not an object when present).
 */
export function parseHostMessage(
  event: MessageEvent,
): { type: string; data: Record<string, unknown> } | null {
  const envelope: unknown = event.data;
  if (!isRecord(envelope) || typeof envelope.type !== "string") return null;
  const data: unknown = envelope.data;
  return { type: envelope.type, data: isRecord(data) ? data : {} };
}

/** Coerce an unknown value to a string with a fallback (hostile/missing fields never crash a handler). */
export function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/** Coerce an unknown value to a finite number with a fallback. */
export function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Clamp a number into [min, max], returning fallback for non-finite input
 *  or invalid bounds (min > max would otherwise yield an arbitrary value). */
export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(fallback) || min > max) {
    return fallback;
  }
  const n = asNumber(value, fallback);
  return Math.min(max, Math.max(min, n));
}

/** True when the value is an array (optionally with every item passing `item`). */
export function asArray<T = unknown>(value: unknown, item?: (v: unknown) => v is T): T[] {
  if (!Array.isArray(value)) return [];
  if (!item) return [...value] as T[];
  return value.filter((v): v is T => item(v));
}

/**
 * Post a message to the extension host if the API is available.
 *
 * Single shared implementation — five components previously carried byte-ident
 * copies of this helper (fallow dupes.json flagged the clone group).
 */
export function postToHost(message: unknown): void {
  const vscode = (window as any).vscode;
  if (typeof vscode?.postMessage === "function") {
    vscode.postMessage(message);
  }
}
