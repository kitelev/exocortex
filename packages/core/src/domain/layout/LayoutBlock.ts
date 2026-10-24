/**
 * LayoutBlock — discriminated union of block variants a Layout can reference.
 *
 * Maps to ontology abstract class `exo__LayoutBlock` (starter-kit
 * `exo/6bca6f8d-2a2b-4f38-8e20-97727499009e.md`) and its subclasses
 * `exo__PropertiesBlock`, `exo__BacklinksTableBlock`,
 * `exo__DailyEffortsByClassBlock` and `query__TableBlock` (RFC 9821a379).
 *
 * A block names the Layout it belongs to (`exo__LayoutBlock_layout`) and its
 * place in it (`exo__LayoutBlock_order`) — the link points block → Layout
 * (UWI, RFC 9821a379 decision 3); {@link assembleLayoutBlocks} turns those
 * links into each Layout's ordered `blocks` list.
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
  /**
   * The Layout this block belongs to — the TARGET of the
   * `exo__LayoutBlock_layout` wikilink (before `|` and `#`): the Layout's uid,
   * file name or label. The display text after `|` is ignored, as Obsidian
   * ignores it — a copied block whose alias still names another Layout keeps
   * pointing where its target points. `null` when the block names no Layout:
   * such a block is indexed but rendered by none (RFC 9821a379 decision 3).
   */
  readonly layoutRef: string | null;
  /**
   * `exo__LayoutBlock_order` as an integer, or `null` when absent / not an
   * integer (strict: `"1.5"`, `"2nd"`, `1.5` are not integers). Blocks without
   * an order go after the numbered ones.
   */
  readonly order: number | null;
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

/**
 * `query__TableBlock` (RFC 9821a379 §Шаг 2) — a section that shows the rows of
 * a `query__NamedQuery` evaluated against the open asset. Columns are the
 * query's SELECT projection (see `NamedQueryRunner.run` → `variables`); the
 * plugin renders the rows.
 */
export interface QueryTableBlock extends LayoutBlockBase {
  readonly kind: "query-table";
  /**
   * The named query to run — the TARGET of the `query__TableBlock_query`
   * wikilink (the part before `|`), i.e. the query's uid for `[[uid]]` and
   * `[[uid|label]]`. Not `WikiLinkHelpers.normalize`, which would hand back
   * the alias of a UUID target.
   */
  readonly query: string;
  /** Row cap (`query__TableBlock_limit`); {@link QUERY_TABLE_BLOCK_DEFAULT_LIMIT} when absent. */
  readonly limit: number;
  /** Text shown for an empty result (`query__TableBlock_emptyText`). */
  readonly emptyText: string;
}

export type LayoutBlock =
  | PropertiesBlock
  | BacklinksTableBlock
  | DailyEffortsByClassBlock
  | QueryTableBlock;

export const PROPERTIES_BLOCK_CLASS_IRI = "exo__PropertiesBlock";
export const PROPERTIES_BLOCK_CLASS_UID = "fd039b3c-ed2b-41c2-a42e-bbfcdd074bfe";
export const BACKLINKS_TABLE_BLOCK_CLASS_IRI = "exo__BacklinksTableBlock";
export const BACKLINKS_TABLE_BLOCK_CLASS_UID = "2e868956-d81e-43fd-9817-1addde9cb311";
export const DAILY_EFFORTS_BY_CLASS_BLOCK_CLASS_IRI =
  "exo__DailyEffortsByClassBlock";
export const DAILY_EFFORTS_BY_CLASS_BLOCK_CLASS_UID =
  "22528ed6-6ec9-48d0-8e60-e370c0b242a9";
/**
 * `query__TableBlock` class (RFC 9821a379). The UID is a code constant the
 * TBox asset is created WITH (`create-batch` with an explicit uid, phase 1 of
 * the RFC) — a block referencing its class as bare `[[uid]]` is recognised
 * only through this constant.
 */
export const QUERY_TABLE_BLOCK_CLASS_IRI = "query__TableBlock";
export const QUERY_TABLE_BLOCK_CLASS_UID = "0e865363-da38-480c-824f-e59aabec3514";
export const QUERY_TABLE_BLOCK_DEFAULT_LIMIT = 100;
export const QUERY_TABLE_BLOCK_DEFAULT_EMPTY_TEXT = "Нет строк";

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

/**
 * The TARGET of a wikilink — the part before `|` and before a `#` subpath,
 * brackets stripped — or `null` when nothing is left.
 */
function wikilinkTarget(value: string): string | null {
  const stripped = value.trim().replace(/^\[\[/, "").replace(/\]\]$/, "");
  const target = stripped.split("|")[0].split("#")[0].trim();
  return target.length > 0 ? target : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Strict integer: a finite integer number, or a string of digits with an
 * optional sign. Unlike {@link parseInteger} (`Number.parseInt`, kept for the
 * existing backlinks `limit`), `"2.5"`, `"10abc"` and `"1e2"` are NOT integers.
 */
function parseStrictInteger(value: unknown): number | null {
  if (typeof value === "number") return Number.isInteger(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return /^[+-]?\d+$/.test(trimmed) ? Number(trimmed) : null;
  }
  return null;
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
  const layoutRaw = frontmatter["exo__LayoutBlock_layout"];
  let layoutRef: string | null = null;
  if (typeof layoutRaw === "string") {
    layoutRef = wikilinkTarget(layoutRaw);
  } else if (layoutRaw != null) {
    warn(
      `LayoutBlock ${uid}: exo__LayoutBlock_layout must be a single wikilink to an exo__Layout — the block belongs to no Layout (${options.sourcePath})`,
    );
  }
  const orderRaw = frontmatter["exo__LayoutBlock_order"];
  const order = parseStrictInteger(orderRaw);
  if (orderRaw != null && order === null) {
    warn(
      `LayoutBlock ${uid}: exo__LayoutBlock_order must be an integer — the block goes after the numbered blocks (${options.sourcePath})`,
    );
  }
  return {
    uid,
    title,
    collapsed,
    visible,
    layoutRef,
    order,
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
        `DailyEffortsByClassBlock ${base.uid}: exo__DailyEffortsByClassBlock_partition must be one of actions|tasks|projects|closed (${options.sourcePath})`,
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

  if (classOf(frontmatter, QUERY_TABLE_BLOCK_CLASS_IRI, QUERY_TABLE_BLOCK_CLASS_UID)) {
    const queryRaw = frontmatter["query__TableBlock_query"];
    if (queryRaw != null && typeof queryRaw !== "string") {
      const shape = Array.isArray(queryRaw) ? "a list" : `a value of type ${typeof queryRaw}`;
      warn(
        `QueryTableBlock ${base.uid}: query__TableBlock_query must be a single wikilink to a query__NamedQuery, not ${shape} — the block is not rendered (${options.sourcePath})`,
      );
      return null;
    }
    const query = typeof queryRaw === "string" ? wikilinkTarget(queryRaw) : null;
    if (query === null) {
      warn(
        `QueryTableBlock ${base.uid}: query__TableBlock_query required — the block is not rendered (${options.sourcePath})`,
      );
      return null;
    }
    if (!UUID_RE.test(query)) {
      // Kept (the page shows the runner's «query not found» in the block, not a
      // silently missing section) but named here: the runner looks a query up
      // only by its exo__Asset_uid.
      warn(
        `QueryTableBlock ${base.uid}: query__TableBlock_query names "${query}", not a uid — the runner finds a query only by its exo__Asset_uid; write [[<uid>]] or [[<uid>|label]] (${options.sourcePath})`,
      );
    }
    const limitRaw = frontmatter["query__TableBlock_limit"];
    const parsedLimit = parseStrictInteger(limitRaw);
    let limit = QUERY_TABLE_BLOCK_DEFAULT_LIMIT;
    if (parsedLimit !== null && parsedLimit > 0) {
      limit = parsedLimit;
    } else if (limitRaw != null) {
      warn(
        `QueryTableBlock ${base.uid}: query__TableBlock_limit must be a positive integer — using ${QUERY_TABLE_BLOCK_DEFAULT_LIMIT} (${options.sourcePath})`,
      );
    }
    const emptyTextRaw = frontmatter["query__TableBlock_emptyText"];
    const emptyText =
      typeof emptyTextRaw === "string" && emptyTextRaw.trim().length > 0
        ? emptyTextRaw.trim()
        : QUERY_TABLE_BLOCK_DEFAULT_EMPTY_TEXT;
    return { ...base, kind: "query-table", query, limit, emptyText };
  }

  warn(
    `LayoutBlock ${base.uid}: unknown block class at ${options.sourcePath} — expected exo__PropertiesBlock, exo__BacklinksTableBlock, exo__DailyEffortsByClassBlock, or query__TableBlock`,
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
    ) ||
    classOf(frontmatter, QUERY_TABLE_BLOCK_CLASS_IRI, QUERY_TABLE_BLOCK_CLASS_UID)
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

export function isQueryTableBlock(value: LayoutBlock): value is QueryTableBlock {
  return value.kind === "query-table";
}
