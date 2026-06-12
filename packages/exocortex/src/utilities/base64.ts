/**
 * Platform-neutral base64 ⇄ bytes/UTF-8 helpers (Issue #3486).
 *
 * iOS Obsidian runs in a WebKit webview with NO Node globals — every bare
 * `Buffer` reference throws `ReferenceError: Can't find variable: Buffer`
 * at runtime and broke the entire mobile ExoSync leg (6/14 repos errored,
 * pushed 0 pulled 0). These helpers use only web-platform primitives that
 * exist in BOTH Obsidian webviews (desktop Electron + mobile WebKit) and in
 * Node ≥16 (jest): `atob`/`btoa` + `TextEncoder`/`TextDecoder`.
 *
 * Archgate MOBILE-003 bans bare `Buffer` references in this package — all
 * base64 conversion MUST go through this module. `Buffer` remains fine in
 * tests (Node environment) for output-equivalence assertions.
 *
 * Semantics notes (output-equivalent to the previous `Buffer` path):
 *  - {@link base64ToBytes} strips ALL whitespace first (GitHub blob API
 *    returns base64 with embedded newlines) and tolerates missing `=`
 *    padding (re-pads before `atob`).
 *  - {@link base64ToUtf8} decodes with `ignoreBOM: true` so a leading
 *    UTF-8 BOM survives as U+FEFF — exactly like
 *    `Buffer.toString("utf-8")`. The TextDecoder default would silently
 *    strip it and produce phantom sync diffs on BOM-prefixed files.
 *  - Malformed base64 (invalid characters, impossible length % 4 === 1)
 *    THROWS via `atob` where `Buffer.from` silently skipped bad input.
 *    Fail-loud is intentional and consistent with the callers' contract
 *    (e.g. `ExoSync: malformed blob response`).
 */

/** Encode raw bytes as standard base64 (no line breaks). */
export function bytesToBase64(bytes: Uint8Array): string {
  void bytes;
  throw new Error("not implemented");
}

/**
 * Decode base64 (whitespace-tolerant, padding-tolerant) to raw bytes.
 * Throws on malformed input.
 */
export function base64ToBytes(base64: string): Uint8Array {
  void base64;
  throw new Error("not implemented");
}

/**
 * Decode base64 to a UTF-8 string. BOM-preserving (see module doc).
 * Throws on malformed input.
 */
export function base64ToUtf8(base64: string): string {
  void base64;
  throw new Error("not implemented");
}

/** Encode a UTF-8 string as standard base64. */
export function utf8ToBase64(text: string): string {
  void text;
  throw new Error("not implemented");
}
