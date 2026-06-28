/**
 * blockVisibility — pure resolution of a LayoutBlock's effective visibility.
 *
 * Precedence (VL#2 / VL#3, RFC pn__DailyNote toggles):
 *
 *   per-note frontmatter override  >  exo__Layout per-block default  >  built-in
 *
 * The built-in default for the three daily-efforts partitions is
 * {@link BUILTIN_DAILY_EFFORTS_VISIBILITY}: Actions shown, Tasks shown,
 * Projects HIDDEN (VL#3 — a deliberate, accepted partial regression).
 *
 * Coercion of the override value is explicit and total: a real boolean or the
 * strings `"true"`/`"false"` (case-insensitive, trimmed) decide the result;
 * anything else (absent / null / `""` / unrelated string / a partial key set
 * that omits this partition) is treated as «not set» and falls through to the
 * next precedence layer. This makes a partial frontmatter override (e.g. only
 * `pn__DailyNote_showProjects: true`) leave the other partitions on their
 * Layout/built-in defaults rather than collapsing them to a single value.
 *
 * @module domain/layout
 * @since RFC pn__DailyNote toggles (req a38ac95b)
 */

import type { DailyEffortsPartition } from "./LayoutBlock";

/**
 * Out-of-the-box visibility for the three daily-efforts partitions (VL#3).
 * Used as the lowest precedence layer when neither a frontmatter override nor
 * an `exo__Layout` per-block default is present.
 */
export const BUILTIN_DAILY_EFFORTS_VISIBILITY: Readonly<
  Record<DailyEffortsPartition, boolean>
> = Object.freeze({
  actions: true,
  tasks: true,
  projects: false,
});

/**
 * Per-note frontmatter override keys for the three daily-efforts partitions
 * (VL#2). Present on the `pn__DailyNote` instance; absent keys fall through to
 * the Layout / built-in default.
 */
export const DAILY_EFFORTS_OVERRIDE_KEYS: Readonly<
  Record<DailyEffortsPartition, string>
> = Object.freeze({
  actions: "pn__DailyNote_showActions",
  tasks: "pn__DailyNote_showTasks",
  projects: "pn__DailyNote_showProjects",
});

/**
 * Coerce a raw override value to a definite boolean, or `undefined` when it is
 * «not set» / not coercible. Accepts native booleans and the case-insensitive,
 * trimmed strings `"true"`/`"false"`. Everything else (absent / null / empty /
 * arbitrary string / number / object) → `undefined`.
 */
export function coerceVisibilityOverride(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered === "true") return true;
    if (lowered === "false") return false;
  }
  return undefined;
}

/**
 * Resolve effective visibility from the three precedence layers.
 *
 * @param override      raw per-note frontmatter value (coerced internally).
 * @param layoutDefault the `exo__Layout` per-block default, or `undefined` when
 *                      there is no Layout asset / no per-block flag.
 * @param builtin       the built-in fallback (VL#3 for daily-efforts).
 */
export function resolveBlockVisibility(
  override: unknown,
  layoutDefault: boolean | undefined,
  builtin: boolean,
): boolean {
  const coerced = coerceVisibilityOverride(override);
  if (coerced !== undefined) return coerced;
  if (layoutDefault !== undefined) return layoutDefault;
  return builtin;
}

/**
 * Convenience wrapper for a daily-efforts partition: reads the matching
 * frontmatter override key off the note, then applies the full precedence
 * (override > Layout default > built-in VL#3). A `null`/`undefined`
 * frontmatter, or a frontmatter that omits this partition's key, falls through
 * to `layoutDefault` then to the built-in.
 */
export function resolveDailyEffortVisibility(
  partition: DailyEffortsPartition,
  noteFrontmatter: Record<string, unknown> | null | undefined,
  layoutDefault: boolean | undefined,
): boolean {
  const key = DAILY_EFFORTS_OVERRIDE_KEYS[partition];
  const override =
    noteFrontmatter && typeof noteFrontmatter === "object"
      ? noteFrontmatter[key]
      : undefined;
  return resolveBlockVisibility(
    override,
    layoutDefault,
    BUILTIN_DAILY_EFFORTS_VISIBILITY[partition],
  );
}
