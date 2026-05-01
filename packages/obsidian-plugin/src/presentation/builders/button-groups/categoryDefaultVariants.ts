import type { ActionButtonVariant } from "@plugin/presentation/components/ActionButtonsGroup";

/**
 * Built-in default variant map per command category (RFC-024 Phase 0,
 * post-RFC f1dc284a-eadc-4d0e-8e72-323e999ea510 rename).
 *
 * Keys are values of `exocmd__Command_category` (the `command.category` field
 * on the domain model). Forward-looking sub-category keys (`status/done`,
 * `status/blocked`, `status/cancelled`) are included per RFC-024 §4 acceptance
 * criteria — they are inert today because starter-kit commands use a flat
 * `status` category, but will activate when sub-category granularity is
 * introduced.
 *
 * Rationale: `Command_category` (UI sectioning) and per-binding
 * `CommandBinding_variant` (button color override) are now separate axes.
 * This map encodes the built-in fallback colour for a category when no
 * per-binding variant is set.
 */
export const categoryDefaultVariant: Readonly<
  Record<string, ActionButtonVariant>
> = Object.freeze({
  creation: "primary",
  "status/done": "success",
  "status/blocked": "warning",
  "status/cancelled": "danger",
  criticality: "warning",
  maintenance: "muted",
});

/**
 * Resolves the default button variant for a command's `category` string.
 * Falls back to `"secondary"` for unknown, empty, or missing categories.
 *
 * Note: prior to RFC f1dc284a this function was named `resolveVariantForGroup`
 * and was keyed by the legacy `binding.group` literal. After the split of
 * `Command_category` (UI sectioning) and `CommandBinding_variant` (button
 * color override) it is now keyed by `command.category` directly.
 */
export function resolveDefaultVariantForCategory(
  category: string | undefined,
): ActionButtonVariant {
  if (!category) return "secondary";
  return categoryDefaultVariant[category] ?? "secondary";
}
