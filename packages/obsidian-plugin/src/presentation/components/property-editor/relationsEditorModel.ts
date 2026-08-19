import type { ReifiedRelation } from "@plugin/presentation/renderers/layout/getReifiedRelations";

/**
 * Composite-key separator, built at runtime. The byte must not appear as a
 * literal in this file — see scripts/check-no-nul-bytes.mjs for why, and issue
 * #4071 for what it cost.
 */
const KEY_SEP = String.fromCharCode(0);

/**
 * RFC `93a0b2ee` Phase 3 / Task 3.1 — pure model for the property editor's
 * Relations section. This module is deliberately UI-free (no React, no Obsidian,
 * no triple store) so the dedup / extraction / canonicalisation logic is
 * unit-testable and revert-verifiable in isolation. The React section
 * ({@link RelationsSection}) and the modal glue
 * ({@link PropertyEditorModal}) consume these functions.
 *
 * Scope (Task 3.1): list (inline + reified, deduplicated), and the data shapes
 * the create / delete write-paths key off. The reify/de-reify toggle is
 * Task 3.2 — NOT modelled here.
 */

/**
 * Frontmatter keys that are NOT user-facing relations: housekeeping / identity /
 * the class-membership edge. Everything else whose value is a wikilink is
 * treated as an outgoing inline relation.
 */
export const RELATION_SYSTEM_KEYS: ReadonlySet<string> = new Set([
  "exo__Instance_class",
  "exo__Asset_isDefinedBy",
  "exo__Asset_uid",
  "exo__Asset_label",
  "exo__Asset_createdAt",
  "exo__Asset_updatedAt",
  "aliases",
]);

/** A single relation row shown in the editor's Relations section. */
export interface RelationRow {
  /**
   * The predicate's frontmatter key (inline) or a key derived from the reified
   * statement's `_predicate` IRI (reified). Used as the row's React key and the
   * inline write-path target.
   */
  predicateKey: string;
  /** Human-readable predicate label (the key with the `ns__` prefix stripped). */
  predicateLabel: string;
  /** The target asset's UID, or `null` when it could not be resolved. */
  objectUid: string | null;
  /** Display text for the target — the wikilink alias, the UID, or a literal. */
  objectDisplay: string;
  /** How this relation is stored. */
  kind: "inline" | "reified";
  /**
   * Relative to the open asset A. `outgoing` (A is the subject — editable: A owns
   * the relation) is the default and is omitted on the existing Task 3.1/3.2 rows.
   * `incoming` (A is the object — RFC §C3 Task 3.3) marks a relation A does NOT
   * own: toggling it would mutate the SUBJECT's file, so it is shown read-only.
   */
  direction?: "outgoing" | "incoming";
  /**
   * RFC §C3 Task 3.3 — object-side read-only. `true` on incoming reified rows:
   * the `reified · <AS>` marker is shown but the reify/de-reify toggle is NOT
   * actionable from the object's side (it would edit the subject's asset). Only
   * the subject-owner can toggle.
   */
  readOnly?: boolean;
  /**
   * RFC §C3 Task 3.3 — incoming rows only: the SUBJECT (owner) asset's display
   * token, used for the read-only «изменит <subject>» affordance label (toggling
   * the relation would change that asset, not the open object asset).
   */
  ownerDisplay?: string;
  /**
   * Inline only — the exact raw frontmatter value string for this edge, so the
   * delete write-path can remove this single value (and keep sibling values of
   * a multi-value key).
   */
  inlineRawValue?: string;
  /** Reified only — vault path of the backing `exo__Statement` asset (delete target). */
  statementPath?: string | null;
  /** Reified only — the AssetSpace the statement lives in (for the `reified · <AS>` marker). */
  assetSpace?: string | null;
  /**
   * Reified only (RFC §C3 Task 3.2) — the frontmatter KEY the reified predicate
   * maps back to (the predicate-definition asset's `exo__Asset_label`, e.g.
   * `ems__Effort_area`), resolved by the modal. De-reify writes the restored
   * inline relation under this key. `undefined` when the predicate could not be
   * mapped to a key (de-reify then rejects rather than guess).
   */
  predicateFrontmatterKey?: string;
}

/** True when a frontmatter value is a wikilink (`[[...]]`, optionally quoted). */
export function isWikilinkValue(value: unknown): value is string {
  return typeof value === "string" && /^\s*"?\[\[.+\]\]"?\s*$/.test(value);
}

/** Extract the bare UID/target from a wikilink string `[[uid|alias]]` (or `null`). */
export function wikilinkTarget(value: string): string | null {
  const m = /\[\[([^|\]]+)(?:\|[^\]]*)?\]\]/.exec(value);
  return m ? m[1].trim() : null;
}

/** Extract the alias from a wikilink `[[uid|alias]]`, falling back to the target. */
function wikilinkDisplay(value: string): string {
  const m = /\[\[([^|\]]+)(?:\|([^\]]*))?\]\]/.exec(value);
  if (!m) return value.trim();
  const alias = m[2]?.trim();
  return alias && alias.length > 0 ? alias : m[1].trim();
}

/**
 * The local name of a predicate, used as the predicate component of the dedup
 * key so an inline frontmatter key (`ems__Effort_parent`) and a reified
 * `_predicate` IRI (`…/ems#Effort_parent`) canonicalise to the same token
 * (`Effort_parent`) — the dual-IRI reconciliation (RFC §C3, HIGH;
 * `sparql-iri-form-pre-verify`).
 */
export function predicateLocalName(keyOrIri: string): string {
  const trimmed = keyOrIri.trim();
  // Symbolic IRI: `…/ns#LocalName`.
  const hash = trimmed.lastIndexOf("#");
  if (hash >= 0 && hash < trimmed.length - 1) return trimmed.slice(hash + 1);
  // Path-form IRI / file ref: `obsidian://vault/…/<basename>.md` → basename.
  if (trimmed.includes("/")) {
    const last = trimmed.split("/").pop() ?? trimmed;
    return last.replace(/\.md$/i, "");
  }
  // Frontmatter key: `ns__LocalName` → LocalName.
  const us = trimmed.lastIndexOf("__");
  if (us >= 0 && us < trimmed.length - 2) return trimmed.slice(us + 2);
  return trimmed;
}

/** A human label for a predicate frontmatter key — strips the `ns__` prefix. */
export function humanizePredicate(key: string): string {
  return predicateLocalName(key);
}

/** Strip an `obsidian://…/<uid>.md` or `…/ns#Local` IRI to its identifying token. */
function iriToUidToken(iri: string): string {
  const trimmed = iri.trim();
  const hash = trimmed.lastIndexOf("#");
  if (hash >= 0) return trimmed.slice(hash + 1);
  if (trimmed.includes("/")) {
    const last = trimmed.split("/").pop() ?? trimmed;
    return decodeURIComponent(last.replace(/\.md$/i, ""));
  }
  return trimmed;
}

/**
 * Extract the open asset A's OUTGOING inline relations from its frontmatter:
 * every wikilink-valued entry of a non-housekeeping key. Multi-value keys yield
 * one row per wikilink element; non-wikilink (literal / scalar) values are
 * properties, not relations, and are skipped.
 *
 * `nonRelationKeys` excludes keys the class schema declares as NON-object
 * properties — chiefly the wikilink-valued ENUMS (`ems__Effort_status`,
 * `ems__Effort_size`) which are `status-select` / `size-select`, not relations.
 * Without this they would (a) be mis-listed as deletable relations and (b)
 * double-render (their select field stays in the form). When omitted (e.g. unit
 * tests with no schema), all non-housekeeping wikilink values are relations.
 */
export function extractInlineRelations(
  frontmatter: Record<string, unknown>,
  nonRelationKeys?: ReadonlySet<string>,
): RelationRow[] {
  const rows: RelationRow[] = [];
  for (const [key, raw] of Object.entries(frontmatter)) {
    if (RELATION_SYSTEM_KEYS.has(key)) continue;
    if (nonRelationKeys?.has(key)) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    for (const v of values) {
      if (!isWikilinkValue(v)) continue;
      rows.push({
        predicateKey: key,
        predicateLabel: humanizePredicate(key),
        objectUid: wikilinkTarget(v),
        objectDisplay: wikilinkDisplay(v),
        kind: "inline",
        inlineRawValue: v,
      });
    }
  }
  return rows;
}

/**
 * Convert the P1 helper's reified relations into editor rows: only OUTGOING
 * relations (A is the statement subject — editable/deletable from A's page) and
 * only IRI objects (a Literal object is a property value, not a relation —
 * RFC R6, excluded).
 */
export function reifiedToRows(reified: ReifiedRelation[]): RelationRow[] {
  const rows: RelationRow[] = [];
  for (const r of reified) {
    if (r.direction !== "outgoing") continue;
    if (r.objectIsLiteral) continue;
    rows.push({
      predicateKey: r.predicate,
      predicateLabel: predicateLocalName(r.predicate),
      objectUid: iriToUidToken(r.object),
      objectDisplay: iriToUidToken(r.object),
      kind: "reified",
      direction: "outgoing",
      statementPath: r.statementPath,
      assetSpace: r.assetSpace,
    });
  }
  return rows;
}

/**
 * Convert the P1 helper's reified relations into INCOMING editor rows (A is the
 * statement `_object`) — RFC §C3 Task 3.3 object-side read-only. Each row is
 * marked `readOnly` so the toggle is shown disabled (toggling would mutate the
 * SUBJECT's file, not A's — least astonishment). The displayed "other end" is the
 * subject (the owner), and `ownerDisplay` carries the subject token for the
 * «изменит <subject>» affordance label. Literal objects (a degenerate incoming
 * shape) are excluded (RFC R6).
 */
export function incomingReifiedToRows(reified: ReifiedRelation[]): RelationRow[] {
  const rows: RelationRow[] = [];
  for (const r of reified) {
    if (r.direction !== "incoming") continue;
    if (r.objectIsLiteral) continue;
    // A is the object; the relation's "other end" (and the owner whose file a
    // toggle would change) is the subject.
    const subjectToken = iriToUidToken(r.subject);
    rows.push({
      predicateKey: r.predicate,
      predicateLabel: predicateLocalName(r.predicate),
      objectUid: subjectToken,
      objectDisplay: subjectToken,
      kind: "reified",
      direction: "incoming",
      readOnly: true,
      ownerDisplay: subjectToken,
      statementPath: r.statementPath,
      assetSpace: r.assetSpace,
    });
  }
  return rows;
}

/** The canonical dedup key for a row: `(predicate-localName, object-canonical)`. */
function dedupKey(row: RelationRow): string {
  const pred = predicateLocalName(row.predicateKey);
  const obj =
    row.kind === "inline"
      ? row.objectUid
        ? `uid:${row.objectUid.replace(/\.md$/i, "")}`
        : `raw:${row.inlineRawValue ?? ""}`
      : `uid:${(row.objectUid ?? "").replace(/\.md$/i, "")}`;
  return `${pred}${KEY_SEP}${obj}`;
}

/**
 * Merge inline and reified relation rows into the unified list shown in the
 * editor, de-duplicated by `(predicate-localName, object-UID)`. When a relation
 * exists BOTH inline and reified, the INLINE row wins (RFC §C3 — the inline copy
 * is what travels on share; showing it as inline is the honest representation).
 * Inline rows are emitted first, then reified rows whose key is not already
 * present.
 */
export function dedupeRelations(
  inline: RelationRow[],
  reified: RelationRow[],
): RelationRow[] {
  const seen = new Set<string>();
  const out: RelationRow[] = [];
  for (const row of inline) {
    const k = dedupKey(row);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(row);
  }
  for (const row of reified) {
    const k = dedupKey(row);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(row);
  }
  return out;
}

/**
 * Build the unified, deduplicated relation list for asset A from its frontmatter
 * (inline) and its reified relations (from the P1 helper). The single entry
 * point the section / modal use.
 */
export function buildRelationRows(params: {
  frontmatter: Record<string, unknown>;
  reified: ReifiedRelation[];
  /** Schema keys that are NON-object properties (enums/scalars) to exclude. */
  nonRelationKeys?: ReadonlySet<string>;
}): RelationRow[] {
  const inline = extractInlineRelations(params.frontmatter, params.nonRelationKeys);
  const reified = reifiedToRows(params.reified);
  return dedupeRelations(inline, reified);
}

/** Normalise a frontmatter value to an array of its elements (scalar → singleton). */
function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value.slice() : [value];
}

/**
 * Compute the new frontmatter value for `predicateKey` after appending an inline
 * relation to `targetUid`. Multi-value safe: an existing scalar/array keeps its
 * values; the new `"[[<uid>]]"` wikilink is appended (never replacing). A single
 * resulting value is written as a scalar, multiple as an array. An exact
 * duplicate wikilink is not added twice. Returns the value to write (Frontmatter
 * write-path).
 */
export function appendInlineRelationValue(
  currentValue: unknown,
  targetUid: string,
): string | string[] {
  // Parsed (unquoted) wikilink form, matching the metadataCache representation
  // the in-memory frontmatter holds; YAML quoting is applied at write time.
  const wikilink = `[[${targetUid}]]`;
  const elements = asArray(currentValue)
    .filter((v): v is string => typeof v === "string");
  // De-dup by resolved target so the same edge is not appended twice.
  const exists = elements.some((v) => {
    const t = wikilinkTarget(v);
    return t !== null && t.replace(/\.md$/i, "") === targetUid.replace(/\.md$/i, "");
  });
  const next = exists ? elements : [...elements, wikilink];
  return next.length === 1 ? next[0] : next;
}

/**
 * Ensure a frontmatter relation value is YAML-safe: each wikilink element is
 * wrapped in double quotes (`[[uid]]` → `"[[uid]]"`) so `[` does not start a
 * YAML flow sequence. Already-quoted elements are left as-is. Applied at write
 * time only (the in-memory form stays unquoted/parsed).
 */
export function quoteRelationValueForYaml(
  value: string | string[],
): string | string[] {
  return Array.isArray(value)
    ? value.map(ensureQuoted)
    : ensureQuoted(value);
}

function ensureQuoted(element: string): string {
  const trimmed = element.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed;
  return `"${trimmed}"`;
}

/**
 * Compute the new frontmatter value for `predicateKey` after removing ONE inline
 * relation (the element whose raw value equals `rawValue`). Sibling values of a
 * multi-value key are kept. Returns `undefined` when the last value is removed
 * (the caller should then drop the key entirely). A single remaining value is
 * written as a scalar.
 */
export function removeInlineRelationValue(
  currentValue: unknown,
  rawValue: string,
): string | string[] | undefined {
  const elements = asArray(currentValue)
    .filter((v): v is string => typeof v === "string");
  const remaining = elements.filter((v) => v !== rawValue);
  if (remaining.length === 0) return undefined;
  return remaining.length === 1 ? remaining[0] : remaining;
}
