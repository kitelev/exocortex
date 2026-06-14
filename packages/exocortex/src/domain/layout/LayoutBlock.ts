/**
 * LayoutBlock — discriminated union of block variants a Layout can reference.
 *
 * Maps to ontology abstract class `exo__LayoutBlock` (starter-kit
 * `exo/6bca6f8d-2a2b-4f38-8e20-97727499009e.md`) and its two MVP subclasses
 * `exo__PropertiesBlock` and `exo__BacklinksTableBlock`.
 *
 * Subclass discriminated via `exo__Instance_class` in frontmatter — NO
 * `rdfs__subClassOf` field is required in the ontology assets because the
 * runtime uses the class wikilink directly.
 *
 * @module domain/layout
 * @since 15.x (RFC exo__Layout Phase 1)
 */

import { WikiLinkHelpers } from "../../utilities/WikiLinkHelpers";
import { normalizeRef } from "./normalizeRef";

export interface LayoutBlockBase {
  readonly uid: string;
  readonly title: string;
  readonly collapsed: boolean;
  readonly sourcePath: string;
}

export interface PropertiesBlock extends LayoutBlockBase {
  readonly kind: "properties";
}

export interface BacklinksTableBlock extends LayoutBlockBase {
  readonly kind: "backlinks-table";
  readonly rowClass: string;
  readonly referencingProperty: string;
  readonly columns: readonly string[];
  readonly sortBy: string | null;
  readonly sortOrder: "asc" | "desc";
  readonly limit: number | null;
  readonly showArchived: boolean;
}

export type LayoutBlock = PropertiesBlock | BacklinksTableBlock;

export const PROPERTIES_BLOCK_CLASS_IRI = "exo__PropertiesBlock";
export const PROPERTIES_BLOCK_CLASS_UID = "fd039b3c-ed2b-41c2-a42e-bbfcdd074bfe";
export const BACKLINKS_TABLE_BLOCK_CLASS_IRI = "exo__BacklinksTableBlock";
export const BACKLINKS_TABLE_BLOCK_CLASS_UID = "2e868956-d81e-43fd-9817-1addde9cb311";

function toStringArray(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string") return [value];
  return [];
}

function basenameFromPath(path: string): string {
  const last = path.lastIndexOf("/");
  const file = last >= 0 ? path.slice(last + 1) : path;
  const dot = file.lastIndexOf(".");
  return dot >= 0 ? file.slice(0, dot) : file;
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered === "true") return true;
    if (lowered === "false") return false;
  }
  return fallback;
}

function parseInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function extractClassIdentifiers(raw: string): readonly string[] {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];
  const wikilinkMatch = trimmed.match(/^\[\[([^\]]+)\]\]$/);
  const inner = wikilinkMatch ? wikilinkMatch[1] : trimmed;
  return inner.split("|").map((part) => part.trim()).filter((p) => p.length > 0);
}

function classOf(
  frontmatter: Record<string, unknown>,
  classIri: string,
  classUid: string,
): boolean {
  const classes = toStringArray(frontmatter["exo__Instance_class"]);
  for (const entry of classes) {
    for (const identifier of extractClassIdentifiers(entry)) {
      if (identifier === classIri || identifier === classUid) return true;
    }
  }
  return false;
}

export interface CreateLayoutBlockOptions {
  readonly sourcePath: string;
  readonly warn?: (message: string) => void;
}

function extractBase(
  frontmatter: Record<string, unknown>,
  options: CreateLayoutBlockOptions,
): LayoutBlockBase | null {
  const warn = options.warn ?? (() => {});
  const uidRaw = frontmatter["exo__Asset_uid"];
  const uid = typeof uidRaw === "string" ? uidRaw.trim() : "";
  if (uid.length === 0) {
    warn(`LayoutBlock: exo__Asset_uid missing at ${options.sourcePath}`);
    return null;
  }
  const titleRaw = frontmatter["exo__LayoutBlock_title"];
  const labelRaw = frontmatter["exo__Asset_label"];
  const title =
    typeof titleRaw === "string" && titleRaw.trim().length > 0
      ? titleRaw.trim()
      : typeof labelRaw === "string" && labelRaw.trim().length > 0
        ? labelRaw.trim()
        : basenameFromPath(options.sourcePath);
  const collapsed = parseBoolean(frontmatter["exo__LayoutBlock_collapsed"], false);
  return {
    uid,
    title,
    collapsed,
    sourcePath: options.sourcePath,
  };
}

export function createLayoutBlockFromFrontmatter(
  frontmatter: Record<string, unknown> | null | undefined,
  options: CreateLayoutBlockOptions,
): LayoutBlock | null {
  const warn = options.warn ?? (() => {});
  if (!frontmatter || typeof frontmatter !== "object") {
    warn(`LayoutBlock: missing frontmatter at ${options.sourcePath}`);
    return null;
  }

  const base = extractBase(frontmatter, options);
  if (base === null) return null;

  if (classOf(frontmatter, PROPERTIES_BLOCK_CLASS_IRI, PROPERTIES_BLOCK_CLASS_UID)) {
    return { ...base, kind: "properties" };
  }

  if (classOf(frontmatter, BACKLINKS_TABLE_BLOCK_CLASS_IRI, BACKLINKS_TABLE_BLOCK_CLASS_UID)) {
    const rowClass = normalizeRef(frontmatter["exo__BacklinksTableBlock_rowClass"]);
    const referencingProperty = normalizeRef(
      frontmatter["exo__BacklinksTableBlock_referencingProperty"],
    );
    if (rowClass === null || referencingProperty === null) {
      warn(
        `BacklinksTableBlock ${base.uid}: rowClass and referencingProperty required (${options.sourcePath})`,
      );
      return null;
    }
    const columnsRaw = toStringArray(frontmatter["exo__BacklinksTableBlock_columns"]);
    const columns: string[] = [];
    for (const entry of columnsRaw) {
      const normalized = WikiLinkHelpers.normalize(entry);
      if (normalized.length > 0) columns.push(normalized);
    }

    const sortBy = normalizeRef(frontmatter["exo__BacklinksTableBlock_sortBy"]);
    const sortOrderRaw = frontmatter["exo__BacklinksTableBlock_sortOrder"];
    const sortOrder: "asc" | "desc" =
      typeof sortOrderRaw === "string" &&
      sortOrderRaw.trim().toLowerCase() === "desc"
        ? "desc"
        : "asc";
    const limit = parseInteger(frontmatter["exo__BacklinksTableBlock_limit"]);
    const showArchived = parseBoolean(
      frontmatter["exo__BacklinksTableBlock_showArchived"],
      false,
    );

    return {
      ...base,
      kind: "backlinks-table",
      rowClass,
      referencingProperty,
      columns,
      sortBy,
      sortOrder,
      limit,
      showArchived,
    };
  }

  warn(
    `LayoutBlock ${base.uid}: unknown block class at ${options.sourcePath} — expected exo__PropertiesBlock or exo__BacklinksTableBlock`,
  );
  return null;
}

export function isLayoutBlockFrontmatter(
  frontmatter: Record<string, unknown> | null | undefined,
): boolean {
  if (!frontmatter) return false;
  return (
    classOf(frontmatter, PROPERTIES_BLOCK_CLASS_IRI, PROPERTIES_BLOCK_CLASS_UID) ||
    classOf(frontmatter, BACKLINKS_TABLE_BLOCK_CLASS_IRI, BACKLINKS_TABLE_BLOCK_CLASS_UID)
  );
}

export function isPropertiesBlock(value: LayoutBlock): value is PropertiesBlock {
  return value.kind === "properties";
}

export function isBacklinksTableBlock(
  value: LayoutBlock,
): value is BacklinksTableBlock {
  return value.kind === "backlinks-table";
}
