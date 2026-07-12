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
  /**
   * Per-block visibility (RL#4a, RFC pn__DailyNote toggles). Holds the EXPLICIT
   * `exo__LayoutBlock_visible` value (`true`/`false`/coerced from
   * `"true"`/`"false"`), or `undefined` when the asset omits the flag.
   *
   * - Generic blocks (properties / backlinks): `ExoLayoutRenderer` renders the
   *   block unless `visible === false` — so `undefined` (legacy, flag absent)
   *   keeps rendering (back-compat).
   * - Daily-efforts blocks: this value is the *Layout default* layer of the
   *   visibility precedence (override > Layout default > built-in VL#3); when
   *   `undefined`, the built-in VL#3 default applies (see
   *   `resolveDailyEffortVisibility`).
   */
  readonly visible?: boolean;
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

/**
 * Which partition of the day's efforts a `daily-efforts-by-class` block shows
 * (RL#4b / VL#4, RFC pn__DailyNote toggles; `closed` axis added by req
 * b2a33efc / issue #3781):
 *   - `actions`  — `ems__Action` instances of the day.
 *   - `tasks`    — the day's efforts EXCEPT Action and Project (so meetings /
 *                  `ems__Meeting` and any other Effort subclass stay here —
 *                  RL#1 inclusive carve-out).
 *   - `projects` — `ems__Project` instances of the day.
 *   - `closed`   — efforts CLOSED on the note's day: those whose
 *                  `ems__Effort_resolutionTimestamp` (or `ems__Effort_endTimestamp`
 *                  fallback) falls on the day. This is an ORTHOGONAL axis to the
 *                  class buckets above — a closed effort can also appear in its
 *                  class bucket (Done tasks) or ONLY here (Trashed-only closures,
 *                  which carry no start/end/planned timestamp so are absent from
 *                  the class buckets). The date-match is computed local-tz by the
 *                  renderer's provider, NOT by this partition function.
 */
export type DailyEffortsPartition =
  | "actions"
  | "tasks"
  | "projects"
  | "closed";

export interface DailyEffortsByClassBlock extends LayoutBlockBase {
  readonly kind: "daily-efforts-by-class";
  readonly partition: DailyEffortsPartition;
}

export type LayoutBlock =
  | PropertiesBlock
  | BacklinksTableBlock
  | DailyEffortsByClassBlock;

export const PROPERTIES_BLOCK_CLASS_IRI = "exo__PropertiesBlock";
export const PROPERTIES_BLOCK_CLASS_UID = "fd039b3c-ed2b-41c2-a42e-bbfcdd074bfe";
export const BACKLINKS_TABLE_BLOCK_CLASS_IRI = "exo__BacklinksTableBlock";
export const BACKLINKS_TABLE_BLOCK_CLASS_UID = "2e868956-d81e-43fd-9817-1addde9cb311";
export const DAILY_EFFORTS_BY_CLASS_BLOCK_CLASS_IRI =
  "exo__DailyEffortsByClassBlock";
export const DAILY_EFFORTS_BY_CLASS_BLOCK_CLASS_UID =
  "22528ed6-6ec9-48d0-8e60-e370c0b242a9";

const DAILY_EFFORTS_PARTITIONS: readonly DailyEffortsPartition[] = [
  "actions",
  "tasks",
  "projects",
  "closed",
];

function parseDailyEffortsPartition(
  value: unknown,
): DailyEffortsPartition | null {
  if (typeof value !== "string") return null;
  const lowered = value.trim().toLowerCase();
  return (DAILY_EFFORTS_PARTITIONS as readonly string[]).includes(lowered)
    ? (lowered as DailyEffortsPartition)
    : null;
}

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

/**
 * Coerce a frontmatter visibility flag to an explicit boolean, or `undefined`
 * when the flag is absent / not coercible. Kept local (not imported from
 * `blockVisibility`) to avoid a runtime import cycle between the two modules.
 * Mirrors `coerceVisibilityOverride` semantics.
 */
function coerceVisible(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered === "true") return true;
    if (lowered === "false") return false;
  }
  return undefined;
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
  // Explicit flag, or undefined when absent. The renderer treats undefined as
  // visible for generic blocks (back-compat) and as «fall to built-in VL#3»
  // for daily-efforts blocks (RL#4a).
  const visible = coerceVisible(frontmatter["exo__LayoutBlock_visible"]);
  return {
    uid,
    title,
    collapsed,
    visible,
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

  if (
    classOf(
      frontmatter,
      DAILY_EFFORTS_BY_CLASS_BLOCK_CLASS_IRI,
      DAILY_EFFORTS_BY_CLASS_BLOCK_CLASS_UID,
    )
  ) {
    const partition = parseDailyEffortsPartition(
      frontmatter["exo__DailyEffortsByClassBlock_partition"],
    );
    if (partition === null) {
      warn(
        `DailyEffortsByClassBlock ${base.uid}: exo__DailyEffortsByClassBlock_partition must be one of actions|tasks|projects (${options.sourcePath})`,
      );
      return null;
    }
    return { ...base, kind: "daily-efforts-by-class", partition };
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
    `LayoutBlock ${base.uid}: unknown block class at ${options.sourcePath} — expected exo__PropertiesBlock, exo__BacklinksTableBlock, or exo__DailyEffortsByClassBlock`,
  );
  return null;
}

export function isLayoutBlockFrontmatter(
  frontmatter: Record<string, unknown> | null | undefined,
): boolean {
  if (!frontmatter) return false;
  return (
    classOf(frontmatter, PROPERTIES_BLOCK_CLASS_IRI, PROPERTIES_BLOCK_CLASS_UID) ||
    classOf(frontmatter, BACKLINKS_TABLE_BLOCK_CLASS_IRI, BACKLINKS_TABLE_BLOCK_CLASS_UID) ||
    classOf(
      frontmatter,
      DAILY_EFFORTS_BY_CLASS_BLOCK_CLASS_IRI,
      DAILY_EFFORTS_BY_CLASS_BLOCK_CLASS_UID,
    )
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

export function isDailyEffortsByClassBlock(
  value: LayoutBlock,
): value is DailyEffortsByClassBlock {
  return value.kind === "daily-efforts-by-class";
}
