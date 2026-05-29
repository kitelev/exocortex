/**
 * Layout sections rendered by `UniversalLayoutRenderer`. Each value is the
 * stable string identifier used as a section key throughout the renderer +
 * `IncrementalUpdateHandler.SECTION_SELECTORS` (which maps it to a DOM
 * selector). Values are also referenced by `ExoLayoutRenderer` panel
 * configs, so renaming a value is a breaking change for vault data.
 */
export enum LayoutSection {
  /** Action-buttons section (Create / Status / Planning / Criticality / Misc command groups). */
  BUTTONS = "buttons",
  /** Daily-note tasks section (visible on `pn__DailyNote` pages and via daily roll-ups). */
  DAILY_TASKS = "daily-tasks",
  /** Area-hierarchy tree section (visible on `ems__Area` and Project pages). */
  AREA_TREE = "area-tree",
  /** Asset relations / backlinks section (visible on every asset). */
  RELATIONS = "relations",
}

/**
 * Maps each frontmatter property to the set of layout sections that need to
 * re-render when the property's value changes. Consumed by
 * {@link UniversalLayoutRenderer.handleMetadataChange} → `getAffectedSections`
 * → `IncrementalUpdateHandler.updateSections`.
 *
 * ## Adding a new property
 *
 * 1. Decide which section(s) read the property:
 *    - **BUTTONS** — a command's precondition or grounding reads the property.
 *      Example: `ems__Task_zone` gates the Criticality buttons; `ems__Effort_status`
 *      gates Mark Done / Mark Reviewed.
 *    - **DAILY_TASKS** — the daily-tasks rollup query depends on the property.
 *      Example: `ems__Effort_votes` (priority), `ems__Effort_area` (scope filter),
 *      `ems__Task_size` (sort key).
 *    - **AREA_TREE** — the area-hierarchy tree depends on the property.
 *      Example: `ems__Area_parent` (the hierarchy itself), `exo__Asset_label`
 *      (display name in the tree).
 *    - **RELATIONS** — a backlink target IRI or display name depends on it.
 *      Example: any wikilink-bearing property (`ems__Effort_parent`,
 *      `ims__Concept_broader`, etc.), plus `exo__Asset_label` / `aliases`
 *      for display in the relations table.
 *
 * 2. Add the entry under the correct namespace block below (alphabetical
 *    within a block). Keep entries grouped by ontology prefix to make audit
 *    by `grep -A 5 <Section>` and reverse-lookup by namespace tractable.
 *
 * 3. Pre-existing properties without an entry are treated as
 *    "no-section-affected" — `IncrementalUpdateHandler.updateSections([])`
 *    is a no-op. This is the safe default for properties that have no
 *    runtime UI consumers (e.g. provenance metadata).
 *
 * ## Audit queries
 *
 * - "Which properties affect BUTTONS?" — `grep -B 1 "Section.BUTTONS$" PropertyDependencyResolver.ts`
 * - "Which sections does `ems__Effort_status` invalidate?" — read the
 *   `ems__Effort_status` block below directly.
 * - "Which properties have no entry?" — diff this file's keys against the
 *   set of declared `exo__Property` instances in vault.
 *
 * ## Why this is NOT an RDF declaration
 *
 * The "property → affected layout section" mapping was considered for migration
 * to RDF (`exo__Property_affectsLayoutSection`) per the Homoiconicity Invariant
 * (project CLAUDE.md). After 4-reviewer onto-RFC pass (vault asset
 * `72000327-2d15-41c0-931e-b0eccba7f904`) the proposal was rejected — empirical
 * rate-of-change is ~3-4 property additions per year against a solo
 * maintainer, half of historical commits are refactor-deletions which RDF
 * makes harder not easier, and the mapping is arguably guard-rail /
 * presentation-infrastructure under Q3.b/c (DOM-selector binding, not domain).
 *
 * **Re-open trigger:** entries > 50, OR external contributors, OR
 * `LayoutSection` enum grows past 4 values. Until then this hardcoded map
 * is the source of truth.
 */
export class PropertyDependencyResolver {
  private static PROPERTY_DEPENDENCIES: Record<string, LayoutSection[]> = {
    // ─── exo__ namespace (core asset metadata) ──────────────────────────
    "exo__Asset_label": [
      LayoutSection.RELATIONS,
      LayoutSection.AREA_TREE,
    ],
    "exo__Asset_isArchived": [
      LayoutSection.BUTTONS,
      LayoutSection.DAILY_TASKS,
      LayoutSection.RELATIONS,
    ],
    "exo__Asset_prototype": [LayoutSection.RELATIONS],
    "exo__Instance_class": [
      LayoutSection.BUTTONS,
      LayoutSection.RELATIONS,
    ],

    // ─── ems__Effort_ namespace (cross-cutting effort fields) ───────────
    "ems__Effort_area": [
      LayoutSection.DAILY_TASKS,
    ],
    "ems__Effort_parent": [
      LayoutSection.RELATIONS,
    ],
    "ems__Effort_status": [
      LayoutSection.BUTTONS,
      LayoutSection.DAILY_TASKS,
    ],
    "ems__Effort_votes": [
      LayoutSection.DAILY_TASKS,
    ],

    // ─── ems__Area_ namespace ───────────────────────────────────────────
    "ems__Area_parent": [
      LayoutSection.AREA_TREE,
    ],

    // ─── ems__Task_ namespace ───────────────────────────────────────────
    "ems__Task_blockedBy": [
      LayoutSection.DAILY_TASKS,
      LayoutSection.RELATIONS,
    ],
    "ems__Task_blocks": [
      LayoutSection.RELATIONS,
    ],
    "ems__Task_size": [
      LayoutSection.DAILY_TASKS,
    ],
    // `ems__Task_zone` gates the criticality buttons (Set Criticality
    // Low/Med/High). Their preconditions check the current zone — without
    // re-render after a click that mutates zone, all three remain visible
    // until plugin reload. Added 2026-05-29 via v16.31.3 (PR #3290).
    "ems__Task_zone": [
      LayoutSection.BUTTONS,
    ],

    // ─── ems__Project_ namespace ────────────────────────────────────────
    "ems__Project_blockedBy": [
      LayoutSection.RELATIONS,
    ],
    "ems__Project_blocks": [
      LayoutSection.RELATIONS,
    ],

    // ─── pn__ namespace (period notes) ──────────────────────────────────
    "pn__DailyNote_day": [
      LayoutSection.DAILY_TASKS,
    ],

    // ─── ims__Concept_ namespace ────────────────────────────────────────
    "ims__Concept_broader": [
      LayoutSection.RELATIONS,
    ],
    "ims__Concept_narrower": [
      LayoutSection.RELATIONS,
    ],
    "ims__Concept_related": [
      LayoutSection.RELATIONS,
    ],

    // ─── Obsidian-system properties ─────────────────────────────────────
    // `aliases` is the Obsidian-system YAML field (cross-link aliasing) —
    // not a domain `exo__Property`. Changes affect how the asset is
    // labelled in the relations table and area tree.
    aliases: [
      LayoutSection.RELATIONS,
      LayoutSection.AREA_TREE,
    ],
  };

  getAffectedSections(changedProperties: string[]): LayoutSection[] {
    const affectedSections = new Set<LayoutSection>();

    for (const prop of changedProperties) {
      const sections = PropertyDependencyResolver.PROPERTY_DEPENDENCIES[prop];
      if (sections) {
        sections.forEach((section) => affectedSections.add(section));
      }
    }

    return Array.from(affectedSections);
  }
}
