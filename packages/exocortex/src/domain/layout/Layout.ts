/**
 * Layout — RDF-configurable class-level layout declaration.
 *
 * Maps to ontology class `exo__Layout` (starter-kit
 * `exo/08d00289-a5c8-4df1-8885-40a00a014004.md`).
 *
 * One asset declares the ordered body structure (array of block wikilinks)
 * for a single target class.  When multiple `exo__Layout` assets target the
 * same class, the resolver picks the highest `priority`; ties resolved by
 * `exo__Asset_uid` ascending for deterministic cross-vault behaviour.
 *
 * Phase 1 of RFC `6628d78a-78a9-473c-ace3-e9b6d28750d1` ships the domain
 * model + Repository; Phase 2 integrates the resolver into
 * `UniversalLayoutRenderer`.
 *
 * @module domain/layout
 * @since 15.x (RFC exo__Layout Phase 1)
 */

import { WikiLinkHelpers } from "../../utilities/WikiLinkHelpers";
import { normalizeRef } from "./RelationColumnSet";

export interface Layout {
  readonly uid: string;
  readonly label: string;
  readonly targetClass: string;
  readonly blocks: readonly string[];
  readonly priority: number;
  readonly coexistsWithDefault: boolean;
  readonly sourcePath: string;
}

export const LAYOUT_CLASS_IRI = "exo__Layout";
export const LAYOUT_CLASS_UID = "08d00289-a5c8-4df1-8885-40a00a014004";

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

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered === "true") return true;
    if (lowered === "false") return false;
  }
  return fallback;
}

function parsePriority(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export interface CreateLayoutOptions {
  readonly sourcePath: string;
  readonly warn?: (message: string) => void;
}

export function createLayoutFromFrontmatter(
  frontmatter: Record<string, unknown> | null | undefined,
  options: CreateLayoutOptions,
): Layout | null {
  const warn = options.warn ?? (() => {});
  const sourcePath = options.sourcePath;

  if (!frontmatter || typeof frontmatter !== "object") {
    warn(`Layout: missing frontmatter at ${sourcePath}`);
    return null;
  }

  const uidRaw = frontmatter["exo__Asset_uid"];
  const uid = typeof uidRaw === "string" ? uidRaw.trim() : "";
  if (uid.length === 0) {
    warn(`Layout: exo__Asset_uid missing at ${sourcePath}`);
    return null;
  }

  const targetClass = normalizeRef(frontmatter["exo__Layout_targetClass"]);
  if (targetClass === null) {
    warn(
      `Layout ${uid}: exo__Layout_targetClass required (${sourcePath})`,
    );
    return null;
  }

  const blocksRaw = toStringArray(frontmatter["exo__Layout_blocks"]);
  const blocks: string[] = [];
  for (const entry of blocksRaw) {
    const normalized = WikiLinkHelpers.normalize(entry);
    if (normalized.length > 0) {
      blocks.push(normalized);
    }
  }
  if (blocks.length === 0) {
    warn(
      `Layout ${uid}: exo__Layout_blocks must contain at least one block (${sourcePath})`,
    );
    return null;
  }

  const labelRaw = frontmatter["exo__Asset_label"];
  const label =
    typeof labelRaw === "string" && labelRaw.trim().length > 0
      ? labelRaw.trim()
      : basenameFromPath(sourcePath);

  const priority = parsePriority(frontmatter["exo__Layout_priority"]);

  const coexistsWithDefault = parseBoolean(
    frontmatter["exo__Layout_coexistsWithDefault"],
    false,
  );

  return {
    uid,
    label,
    targetClass,
    blocks,
    priority,
    coexistsWithDefault,
    sourcePath,
  };
}

export function isLayout(value: unknown): value is Layout {
  if (!value || typeof value !== "object") return false;
  const c = value as Partial<Layout>;
  if (typeof c.uid !== "string" || c.uid.length === 0) return false;
  if (typeof c.label !== "string") return false;
  if (typeof c.targetClass !== "string" || c.targetClass.length === 0) return false;
  if (!Array.isArray(c.blocks) || c.blocks.length === 0) return false;
  if (c.blocks.some((b) => typeof b !== "string")) return false;
  if (typeof c.priority !== "number" || !Number.isFinite(c.priority)) return false;
  if (typeof c.coexistsWithDefault !== "boolean") return false;
  if (typeof c.sourcePath !== "string") return false;
  return true;
}

function extractClassIdentifiers(raw: string): readonly string[] {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];
  const wikilinkMatch = trimmed.match(/^\[\[([^\]]+)\]\]$/);
  const inner = wikilinkMatch ? wikilinkMatch[1] : trimmed;
  return inner.split("|").map((part) => part.trim()).filter((p) => p.length > 0);
}

export function isLayoutFrontmatter(
  frontmatter: Record<string, unknown> | null | undefined,
): boolean {
  if (!frontmatter) return false;
  const classes = toStringArray(frontmatter["exo__Instance_class"]);
  for (const entry of classes) {
    for (const identifier of extractClassIdentifiers(entry)) {
      if (identifier === LAYOUT_CLASS_IRI || identifier === LAYOUT_CLASS_UID) {
        return true;
      }
    }
  }
  return false;
}
