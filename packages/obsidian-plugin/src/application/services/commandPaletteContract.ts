/**
 * Command-palette grooming contract — RFC 0002 §3.2 ([P2, P3, P4, P16]).
 *
 * Single source of truth for the **display `name`** of every command groomed in
 * §3.2, so the de-jargon renames (P3), the casing fix (P3), and the destructive
 * «(advanced)» text markers (P4/P16) are unit-testable and the production
 * registration sites can never drift from the contract. Each registration site
 * (`ExocortexPlugin`, `EditPropertiesCommand`, `registerExoSyncCommands`,
 * `UnmountAssetSpaceCommand`) imports its name from here rather than re-typing a
 * literal — so the jest contract test asserts the exact strings users see.
 *
 * ⛔ Command **ids are immutable**. Obsidian persists hotkeys + automation by
 * command id, and `addCommand({ id, name })` treats them as independent keys
 * with no id-from-name derivation (`CommandManager.ts:66`). §3.2 changes the
 * display `name` ONLY; the keys of {@link GROOMED_COMMAND_NAMES} are the stable
 * ids and must stay byte-exact.
 *
 * Scope: only the commands §3.2 grooms. Other commands (`reload-layout`,
 * `sync`/`pull`/`push`, `apply-profile`, …) are deliberately absent — their
 * names are already plain and benign. `open-activity-log` / `open-logs` are
 * likewise out of §3.2 scope; their «(live)» / «(saved)» disambiguation is owned
 * by the separate logs-dedup change, not this grooming contract.
 */

/** The user-facing text marker that flags a destructive / power-user command. */
export const ADVANCED_MARKER = "(advanced)";

/**
 * Canonical de-jargoned display names, keyed by stable (immutable) command id.
 *
 * Naming convention: sentence case (matching the existing `Reload layout` /
 * `Setup (getting started)` siblings — first word capitalised, the rest lower
 * except proper nouns; the parenthetical marker stays lowercase, consistent
 * with `(advanced)`).
 */
export const GROOMED_COMMAND_NAMES = {
  // — De-jargon renames (P3) —
  "bootstrap-vault": "Set up the engine",
  "add-assetspace": "Add a knowledge pack",
  "push-current-assetspace": "Push current knowledge pack",
  "show-profile-state": "Show active profile",
  "exosync-parity-report": "Check sync status",
  // — Casing fix (P3): was lowercase «edit properties» —
  "edit-properties": "Edit properties",
  // — Destructive, flagged with the «(advanced)» text marker (P4/P16:
  //   never an emoji glyph alone — assistive-tech reliable) —
  "unmount-assetspace": "Remove knowledge pack (advanced)",
  "clear-switch-cache": "Reset profile cache (advanced)",
} as const;

export type GroomedCommandId = keyof typeof GROOMED_COMMAND_NAMES;

/**
 * Commands that mutate / destroy user state and therefore MUST carry the
 * {@link ADVANCED_MARKER} text marker in their display name (RFC 0002 §3.2 P4 /
 * M5 — 100% of destructive commands carry a text marker, not a glyph alone).
 */
export const DESTRUCTIVE_COMMAND_IDS: readonly GroomedCommandId[] = [
  "unmount-assetspace",
  "clear-switch-cache",
];

/**
 * Action-language titles for the «Remove knowledge pack» (unmount) flow's
 * picker + confirm step, kept coherent with the groomed palette name so the
 * de-jargon doesn't reappear mid-flow. The «(advanced)» marker lives only on
 * the palette entry (a pre-invocation warning); once the user is in the flow the
 * copy is plain action language.
 */
export const REMOVE_PACK_PICKER_TITLE = "Remove knowledge pack";
export const REMOVE_PACK_CONFIRM_TITLE = "Remove knowledge pack?";
export const REMOVE_PACK_CONFIRM_LABEL = "Remove";

/**
 * Rough emoji / pictographic detection — a name that is ONLY such glyphs (plus
 * whitespace) fails accessibility (screen readers cannot reliably announce a
 * lone glyph; RFC 0002 P16). Used by the contract test to assert no groomed
 * name relies on a glyph alone.
 */
export function isGlyphOnly(name: string): boolean {
  const stripped = name.replace(
    /[\p{Extended_Pictographic}\p{Emoji_Presentation}️‍\s]/gu,
    "",
  );
  return stripped.length === 0;
}
