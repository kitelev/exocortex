/**
 * Enum value unions for `exocmd__CommandBindingStyle` properties (RFC-024 §4 Phase 2).
 *
 * These unions are the canonical source for allowed values. They are mirrored
 * by the starter-kit ontology property definitions (see `exocmd/` in
 * `exocortex-starter-kit`) and consumed by the plugin's UI layer
 * (`ActionButtonsGroup.tsx` etc.) to consolidate duplicate literals.
 *
 * Invariants:
 * - **Non-breaking schema (RFC-024 §3):** whitelists extend, never shrink.
 *   Renames require an explicit migration asset.
 * - **Coerce → warn → fallback:** invalid inbound values are lowercased/trimmed
 *   and matched against the whitelist; misses fall back to vendor defaults and
 *   log a warning capped at 200 chars — never crash (RFC-024 §5).
 */

/**
 * Semantic button variant. Matches `ActionButtonVariant` in the Obsidian plugin;
 * the plugin's copy is the UI-layer alias and must stay in sync with this union.
 *
 * - `primary` — dominant action (≤1 per panel)
 * - `secondary` — default, neutral emphasis
 * - `success` — positive outcome (e.g. status → Done)
 * - `warning` — caution (e.g. status → Blocked)
 * - `danger` — destructive / status → Cancelled
 * - `muted` — power-user / maintenance, visually receded
 */
export type CommandVariant =
  | "primary"
  | "secondary"
  | "success"
  | "warning"
  | "danger"
  | "muted";

/** Frozen whitelist of {@link CommandVariant} values for runtime validation. */
export const COMMAND_VARIANT_VALUES: readonly CommandVariant[] = Object.freeze([
  "primary",
  "secondary",
  "success",
  "warning",
  "danger",
  "muted",
]);

/**
 * Typographic modifier applied to the button label.
 *
 * - `muted` — lower contrast (pairs well with `muted` variant)
 * - `bold` — stronger weight
 * - `uppercase` — ALL-CAPS rendering
 * - `compact` — tighter size / padding
 */
export type LabelClass = "muted" | "bold" | "uppercase" | "compact";

/** Frozen whitelist of {@link LabelClass} values. */
export const LABEL_CLASS_VALUES: readonly LabelClass[] = Object.freeze([
  "muted",
  "bold",
  "uppercase",
  "compact",
]);

/**
 * Governance marker for a CommandBindingStyle asset (RFC-024 §3, §5).
 *
 * - `vendor` — shipped preset (starter-kit example or plugin default)
 * - `user` — user override; wins over vendor per precedence matrix
 */
export type StyleSource = "vendor" | "user";

/** Frozen whitelist of {@link StyleSource} values. */
export const STYLE_SOURCE_VALUES: readonly StyleSource[] = Object.freeze([
  "vendor",
  "user",
]);

/** Narrowing guard for {@link CommandVariant}. Does not coerce — caller coerces. */
export function isCommandVariant(value: unknown): value is CommandVariant {
  return (
    typeof value === "string" &&
    (COMMAND_VARIANT_VALUES as readonly string[]).includes(value)
  );
}

/** Narrowing guard for {@link LabelClass}. Does not coerce. */
export function isLabelClass(value: unknown): value is LabelClass {
  return (
    typeof value === "string" &&
    (LABEL_CLASS_VALUES as readonly string[]).includes(value)
  );
}

/** Narrowing guard for {@link StyleSource}. Does not coerce. */
export function isStyleSource(value: unknown): value is StyleSource {
  return (
    typeof value === "string" &&
    (STYLE_SOURCE_VALUES as readonly string[]).includes(value)
  );
}
