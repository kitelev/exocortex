/**
 * PAT clipboard affordance — RFC 0002 §3.9 (mobile onboarding parity, P14).
 *
 * Typing a long fine-grained GitHub token on a phone keyboard is painful, so
 * the PAT settings field offers a "Paste" button. This module holds the pure,
 * platform-neutral decision logic (trim + empty detection) so it is unit-test
 * covered independently of the Obsidian-facing button wiring in
 * `ExocortexSettingTab`. `navigator.clipboard.readText()` works on both
 * Electron desktop and the mobile WebView (under a user gesture — a button
 * click qualifies), so the affordance is parity-correct: no `Platform.isMobile`
 * gate, it simply helps most on mobile.
 */

/** Outcome of normalising a clipboard payload destined for the PAT field. */
export type PastedSecretOutcome =
  | { kind: "filled"; value: string }
  | { kind: "empty" };

/**
 * Normalise a raw clipboard string into a PAT field action. Tokens are
 * single-line opaque strings, so surrounding whitespace/newlines (common when
 * a token is copied with a trailing newline) is always trimmed. An
 * all-whitespace / empty clipboard yields `empty` so the caller can prompt the
 * user to copy a token first rather than silently clearing the field.
 */
export function resolvePastedSecret(raw: string): PastedSecretOutcome {
  const trimmed = raw.trim();
  return trimmed.length === 0
    ? { kind: "empty" }
    : { kind: "filled", value: trimmed };
}
