/**
 * Built-in display defaults per command-binding category (RFC-024 Phase 3).
 *
 * Provides the human-readable title and `collapsedByDefault` flag that the
 * builder applies when no vault override is configured. Crucially, this map
 * does NOT pin the rendering order — order is supplied per-class via
 * `exo__Layout_commandPanel.includeGroups`, falling back to the
 * {@link FALLBACK_CATEGORY_ORDER} array when no panel is declared.
 *
 * Splitting display metadata away from the previously hardcoded
 * `CATEGORY_ORDER` constant in `DynamicCommandButtonGroupBuilder` removes the
 * single source of truth on category ordering (RFC-024 Phase 3 AC) without
 * regressing the polished default UX for installations with no panel config.
 */
export interface CategoryDisplay {
  readonly title: string;
  readonly collapsedByDefault?: boolean;
}

export const categoryDisplayDefaults: Readonly<Record<string, CategoryDisplay>> =
  Object.freeze({
    creation: { title: "Create" },
    status: { title: "Status" },
    planning: { title: "Planning" },
    criticality: { title: "Criticality" },
    maintenance: { title: "Maintenance", collapsedByDefault: true },
  });

/**
 * Plugin-built-in fallback ordering used only when no
 * `exo__Layout_commandPanel.includeGroups` is configured for the target
 * class. Vault-supplied panel config always wins (RFC-024 §5 precedence).
 */
export const FALLBACK_CATEGORY_ORDER: readonly string[] = Object.freeze([
  "creation",
  "status",
  "planning",
  "criticality",
  "maintenance",
]);

/**
 * Resolve the display title for a category id. Falls back to the raw id
 * (capitalised) so that user-introduced categories still render with a
 * sensible title even without a vault-side localisation override.
 */
export function resolveCategoryTitle(categoryId: string): string {
  const known = categoryDisplayDefaults[categoryId];
  if (known) return known.title;
  if (categoryId.length === 0) return "Other";
  return categoryId.charAt(0).toUpperCase() + categoryId.slice(1);
}

/**
 * Resolve the `collapsedByDefault` flag for a category id.
 *
 * Precedence (RFC layout-collapsedGroups):
 *  1. Vault-supplied `panel.collapsedGroups` wins — if the category id is
 *     listed there, the section renders collapsed regardless of TS defaults.
 *  2. Fallback to {@link categoryDisplayDefaults}`.collapsedByDefault` when
 *     no panel override is provided (preserves pre-RFC UX).
 *  3. Unknown categories default to `false` (expanded).
 *
 * The `panel` parameter is optional so the function stays backward-compatible
 * for call-sites that don't have a panel context.
 */
export function resolveCategoryCollapsed(
  categoryId: string,
  panel?: { collapsedGroups?: readonly string[] },
): boolean {
  if (panel?.collapsedGroups !== undefined) {
    return panel.collapsedGroups.includes(categoryId);
  }
  return categoryDisplayDefaults[categoryId]?.collapsedByDefault ?? false;
}
