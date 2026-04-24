/**
 * RelationColumnSet — RDF-configurable column set for UniversalLayout auto-backlinks.
 *
 * Maps to ontology class `ui__RelationColumnSet` (starter-kit
 * `ui/97fc9862-c886-4d86-9a60-e0cf9d778575.md`).
 *
 * One asset declares the ordered column set for a specific pair
 * (row-asset class, referencing property) in the backlinks table.
 * Phase 1 provides the domain model + Repository; Phase 2 ships the resolver
 * with the 4-tier priority ladder; Phase 3 integrates into RelationsRenderer.
 *
 * @module domain/layout
 * @since 15.x (RFC be70f741-a8e3-4826-aab1-d3f950068861 Phase 1)
 */

import { WikiLinkHelpers } from "../../utilities/WikiLinkHelpers";

export interface RelationColumnSet {
  readonly uid: string;
  readonly label: string;
  readonly targetClasses: readonly string[] | null;
  readonly referencingProperty: string | null;
  readonly columns: readonly string[];
  readonly priority: number;
  readonly sourcePath: string;
}

/**
 * Normalize a wikilink or raw identifier to its canonical string form, or
 * `null` when the input cannot be normalized.
 *
 * Delegates to {@link WikiLinkHelpers.normalize} so the resolver + repository
 * share the SAME wikilink semantics as every other `@exocortex/core` consumer
 * (issue #2941 — prior asymmetric "before-pipe wins" behaviour caused
 * `ui__RelationColumnSet` match failures for starter-kit-style
 * `[[uuid|alias]]` frontmatter).
 *
 * Behaviour (via `WikiLinkHelpers.normalize`):
 * - `"[[ems__Area]]"` → `"ems__Area"`
 * - `"[[UUID|ems__Area]]"` → `"ems__Area"` (UUID target ⇒ alias wins)
 * - `"[[Some Note|Display]]"` → `"Some Note"` (non-UUID target ⇒ target wins)
 *
 * Preserves the `string | null` contract of the original function: returns
 * `null` for non-string inputs, empty strings, and wikilinks whose inner text
 * collapses to empty (e.g. `"[[|alias]]"`).
 */
export function normalizeRef(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = WikiLinkHelpers.normalize(value);
  return normalized.length > 0 ? normalized : null;
}

function toStringArray(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string") {
    return [value];
  }
  return [];
}

function basenameFromPath(path: string): string {
  const last = path.lastIndexOf("/");
  const file = last >= 0 ? path.slice(last + 1) : path;
  const dot = file.lastIndexOf(".");
  return dot >= 0 ? file.slice(0, dot) : file;
}

export interface CreateRelationColumnSetOptions {
  readonly sourcePath: string;
  readonly warn?: (message: string) => void;
}

export function createRelationColumnSetFromFrontmatter(
  frontmatter: Record<string, unknown> | null | undefined,
  options: CreateRelationColumnSetOptions,
): RelationColumnSet | null {
  const warn = options.warn ?? (() => {});
  const sourcePath = options.sourcePath;

  if (!frontmatter || typeof frontmatter !== "object") {
    warn(`RelationColumnSet: missing frontmatter at ${sourcePath}`);
    return null;
  }

  const uidRaw = frontmatter["exo__Asset_uid"];
  const uid = typeof uidRaw === "string" ? uidRaw.trim() : "";
  if (uid.length === 0) {
    warn(`RelationColumnSet: exo__Asset_uid missing at ${sourcePath}`);
    return null;
  }

  const targetRaw = toStringArray(frontmatter["ui__RelationColumnSet_targetClass"]);
  const targetClassesNormalized: string[] = [];
  for (const entry of targetRaw) {
    const normalized = normalizeRef(entry);
    if (normalized !== null) {
      targetClassesNormalized.push(normalized);
    }
  }
  const targetClasses =
    targetClassesNormalized.length > 0 ? targetClassesNormalized : null;

  const referencingProperty = normalizeRef(
    frontmatter["ui__RelationColumnSet_referencingProperty"],
  );

  if (targetClasses === null && referencingProperty === null) {
    warn(
      `RelationColumnSet ${uid}: at least one of targetClass / referencingProperty required (${sourcePath})`,
    );
    return null;
  }

  // Normalize column entries through the shared wikilink normalizer so
  // downstream consumers (`AssetRelationsTable`, `RelationsRenderer`) receive
  // bare property names even when the frontmatter uses starter-kit-style
  // wikilink forms (`[[exo__Asset_createdAt]]`, `[[UUID|exo__Asset_label]]`).
  // Issue #2942 — raw wikilinks were previously passed through as literal
  // React metadata keys, yielding undefined column values.
  const columnsRaw = toStringArray(frontmatter["ui__RelationColumnSet_columns"]);
  const columns: string[] = [];
  for (const entry of columnsRaw) {
    const normalized = WikiLinkHelpers.normalize(entry);
    if (normalized.length > 0) {
      columns.push(normalized);
    }
  }
  if (columns.length === 0) {
    warn(
      `RelationColumnSet ${uid}: columns array must contain at least one entry (${sourcePath})`,
    );
    return null;
  }

  const labelRaw = frontmatter["ui__RelationColumnSet_label"];
  const label =
    typeof labelRaw === "string" && labelRaw.trim().length > 0
      ? labelRaw.trim()
      : basenameFromPath(sourcePath);

  const priorityRaw = frontmatter["ui__RelationColumnSet_priority"];
  let priority = 0;
  if (typeof priorityRaw === "number" && Number.isFinite(priorityRaw)) {
    priority = priorityRaw;
  } else if (typeof priorityRaw === "string") {
    const parsed = Number.parseFloat(priorityRaw);
    if (Number.isFinite(parsed)) {
      priority = parsed;
    }
  }

  return {
    uid,
    label,
    targetClasses,
    referencingProperty,
    columns,
    priority,
    sourcePath,
  };
}

export function isRelationColumnSet(value: unknown): value is RelationColumnSet {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RelationColumnSet>;
  if (typeof candidate.uid !== "string" || candidate.uid.length === 0) return false;
  if (typeof candidate.label !== "string") return false;
  if (
    candidate.targetClasses !== null &&
    (!Array.isArray(candidate.targetClasses) ||
      candidate.targetClasses.some((c) => typeof c !== "string"))
  ) {
    return false;
  }
  if (
    candidate.referencingProperty !== null &&
    typeof candidate.referencingProperty !== "string"
  ) {
    return false;
  }
  if (!Array.isArray(candidate.columns) || candidate.columns.length === 0) return false;
  if (candidate.columns.some((c) => typeof c !== "string")) return false;
  if (typeof candidate.priority !== "number" || !Number.isFinite(candidate.priority)) return false;
  if (typeof candidate.sourcePath !== "string") return false;
  return true;
}

export const RELATION_COLUMN_SET_CLASS_IRI = "ui__RelationColumnSet";
export const RELATION_COLUMN_SET_CLASS_UID =
  "97fc9862-c886-4d86-9a60-e0cf9d778575";

function extractClassIdentifiers(raw: string): readonly string[] {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];
  const wikilinkMatch = trimmed.match(/^\[\[([^\]]+)\]\]$/);
  const inner = wikilinkMatch ? wikilinkMatch[1] : trimmed;
  const parts = inner.split("|").map((part) => part.trim()).filter((p) => p.length > 0);
  return parts;
}

export function isRelationColumnSetFrontmatter(
  frontmatter: Record<string, unknown> | null | undefined,
): boolean {
  if (!frontmatter) return false;
  const instanceClass = frontmatter["exo__Instance_class"];
  const classes = toStringArray(instanceClass);
  for (const entry of classes) {
    for (const identifier of extractClassIdentifiers(entry)) {
      if (
        identifier === RELATION_COLUMN_SET_CLASS_IRI ||
        identifier === RELATION_COLUMN_SET_CLASS_UID
      ) {
        return true;
      }
    }
  }
  return false;
}
