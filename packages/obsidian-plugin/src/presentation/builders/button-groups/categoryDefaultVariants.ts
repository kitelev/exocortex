import type { ActionButtonVariant } from "@plugin/presentation/components/ActionButtonsGroup";

/**
 * Built-in default variant map per command-binding group (RFC-024 Phase 0).
 *
 * Keys are values of `exocmd__CommandBinding_group` (or the `binding.group` field
 * on the domain model). Forward-looking sub-category keys (`status/done`,
 * `status/blocked`, `status/cancelled`) are included per RFC-024 §4 acceptance
 * criteria — they are inert today because starter-kit bindings use flat `status`
 * category, but will activate when sub-category granularity is introduced.
 *
 * Rationale: prior implementation hardcoded a 5-case switch in
 * `DynamicCommandButtonGroupBuilder.resolveVariant`; this map is
 * independently testable and removes rollout coupling to starter-kit migration
 * (every installation receives the correct default colors on plugin upgrade).
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
 * Resolves the default button variant for a command binding's `group` string.
 * Falls back to `"secondary"` for unknown, empty, or missing groups.
 */
export function resolveVariantForGroup(
  group: string | undefined,
): ActionButtonVariant {
  if (!group) return "secondary";
  return categoryDefaultVariant[group] ?? "secondary";
}
