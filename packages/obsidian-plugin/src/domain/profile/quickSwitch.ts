/**
 * req 38e2fdd5 — low-friction switching of the active profile, i.e. of the
 * mount CONTEXT.
 *
 * ## Why "context switching" and not "speed-up"
 *
 * The parent project's falsification gate (task `8b8466bb`, measured 2026-08-02
 * on the real vaults) found that mounting *less* through profiles does NOT
 * materially help: the active profile already resolves to 100 % of vault-my
 * (8 738 / 8 738) and 99.4 % of vault-exodev, because the transitive
 * `exo__AssetSpace_dependsOn` closure drags almost the whole vault in. The
 * "minimal profile that still has my data" saves 58 files (0.7 %), and the
 * measured index delta was −0.6 %.
 *
 * The one lever the same measurement found to be large is *switching context*
 * — mounting the work profile and unmounting the personal one — at **−44 %**
 * (6 120 → 3 409 ms). That changes *what is available*, not the speed of the
 * same thing. The gate's explicit recommendation for this task was therefore:
 * keep it, but sell it as **fast context switching**, never as a speed-up.
 *
 * These helpers carry that: name the context you are in, and put the context
 * you came from within one tap.
 */

/** Text shown when no profile has ever been applied on this device. */
export const NO_ACTIVE_PROFILE_TEXT = "No profile";

/**
 * Text shown when a profile UID is recorded but no profile asset matches it —
 * e.g. the profile was deleted or lives in an AssetSpace that is not currently
 * mounted. Deliberately NOT the raw UID: the pickers never show UIDs to the
 * user either (RFC 0002 §3.4 P10), and a bare UUID in the status bar is noise.
 */
export const UNRESOLVED_PROFILE_TEXT = "Unknown profile";

/**
 * Leading glyph for the status-bar item, so the entry reads as "a profile" at a
 * glance rather than as an unlabelled word among the other status-bar items.
 */
export const INDICATOR_GLYPH = "◆";

/**
 * The short status-bar text naming the active profile.
 *
 * `null` ⇒ nothing has been applied yet, which is stated explicitly — the
 * indicator is never blank and never silently keeps a stale label.
 */
export function formatActiveProfileIndicator(label: string | null): string {
  const name =
    label === null || label.length === 0 ? NO_ACTIVE_PROFILE_TEXT : label;
  return `${INDICATOR_GLYPH} ${name}`;
}

/**
 * The hover/long-press tooltip, also used as the ribbon entry's accessible
 * label — on mobile, where Obsidian has no status bar, this is what names the
 * active profile.
 *
 * It says "context", not "speed": per the gate above, switching profiles buys
 * you a different working context, and the honest index-cost figure already
 * lives inside the picker (req 6171f443).
 */
export function formatActiveProfileTooltip(label: string | null): string {
  if (label === null || label.length === 0) {
    return "No profile applied — choose a context";
  }
  return `Active profile: ${label} — switch context`;
}

/**
 * Order the switcher's rows so the profile you came FROM is offered first.
 *
 * The dominant use of profiles is a two-context ping-pong (personal ↔ work), so
 * the previously-active profile is nearly always the one being switched back
 * to. `FuzzySuggestModal` presents `getItems()` in order while the query box is
 * empty — which is exactly the state the picker opens in — so this is what the
 * user sees on the tap that matters, and switching back costs one more tap.
 *
 * Everything else keeps its existing relative order (the callers sort
 * alphabetically). When `previousUid` is `null` or matches nothing the input
 * order is returned untouched — that is what makes the zero-regression
 * guarantee structural rather than argued.
 *
 * The synthetic «Show all profiles…» sentinel can never be promoted: its UID is
 * a constant that is never written to the previous-profile slot.
 */
export function orderProfilesForQuickSwitch<T extends { uid: string }>(
  choices: readonly T[],
  previousUid: string | null,
): T[] {
  if (previousUid === null || previousUid.length === 0) return [...choices];
  const idx = choices.findIndex((c) => c.uid === previousUid);
  if (idx < 0) return [...choices];
  const promoted = choices[idx];
  if (promoted === undefined) return [...choices];
  return [promoted, ...choices.slice(0, idx), ...choices.slice(idx + 1)];
}
