/**
 * RFC `93a0b2ee` Phase 3 / Task 3.2 — the reify/de-reify toggle.
 *
 * This module is the **privacy-critical** core of the toggle: it moves a relation
 * between the open asset A's frontmatter (inline) and a separate `exo__Statement`
 * asset (reified), with a strict atomicity contract so the edge is **never lost**
 * and **never silently duplicated** (a duplicate inline + statement would leak the
 * would-be-private copy on share, RFC R3).
 *
 * It is deliberately UI-free and I/O-free: the actual vault writes arrive through
 * the injected {@link ReifyPorts}, so the create→verify→remove→verify+rollback
 * sequence — and the adversarial crash-between-steps behaviour — is unit-testable
 * and revert-verifiable in isolation (the modal implements the ports against
 * `app.vault` / `app.fileManager`). The predicate-definition resolution and the
 * destination-folder resolution stay in the modal (they need the triple store /
 * vault); this module receives the already-resolved UIDs and validates them.
 *
 * Scope (Task 3.2): the toggle mechanism + atomicity/rollback + predicate-mapping
 * inputs + multi-value + object-IRI validation. The de-reify strong-confirm UX,
 * the object-side read-only, and the destination-AssetSpace picker are Task 3.3.
 */

import { FrontmatterService } from "@kitelev/exocortex-core";
import { wikilinkTarget } from "./relationsEditorModel";

/** Canonical `exo__Statement` class UID (the reified-edge metaclass). */
export const EXO_STATEMENT_CLASS_UID = "7920028c-8613-4756-9761-95846155ce9c";

/**
 * Default reify destination — the `$kitelev-class-relations` junction AssetSpace
 * anchor (RFC mockup default, the эталон where every existing `exo__Statement`
 * lives). The modal resolves this anchor's folder at write time; the
 * destination-AssetSpace picker is Task 3.3.
 */
export const DEFAULT_REIFY_ANCHOR_UID = "55a0f8b9-e908-45bf-9c16-763589f04f16";

/** Strip a trailing `.md` and surrounding whitespace from a UID/target token. */
function bareUid(value: string): string {
  return value.trim().replace(/\.md$/i, "");
}

/** True when two UID-ish tokens denote the same target (ignoring a `.md` suffix). */
export function sameTarget(a: string, b: string): boolean {
  return bareUid(a) === bareUid(b) && bareUid(a).length > 0;
}

/**
 * A reify destination AssetSpace (RFC §C3 Task 3.3 destination picker) — the
 * co-location anchor whose folder a new `exo__Statement` is written into, and
 * which becomes its `exo__Asset_isDefinedBy`. Choosing the destination IS the
 * privacy decision (a private vs a shared AssetSpace).
 */
export interface ReifyDestination {
  /** The co-location anchor UID — the statement's `isDefinedBy` + its target folder. */
  anchorUid: string;
  /** Display label for the picker (e.g. the anchor's `exo__Asset_label` or AS name). */
  label: string;
  /** The AssetSpace (`exoas-<name>`) the anchor lives in, for context (or `null`). */
  assetSpace: string | null;
}

/** A raw destination candidate the modal harvested from an existing statement. */
export interface RawReifyAnchor {
  anchorUid: string;
  label?: string;
  assetSpace?: string | null;
}

/**
 * Build the de-duplicated destination list for the reify picker: the эталон
 * `defaultDestination` first (always present — it is the guaranteed-writable
 * junction default), then every distinct co-location anchor that already hosts
 * statements (proven-writable destinations), de-duplicated by anchor UID. Only
 * mounted/writable anchors should be passed in `rawAnchors` (an absent
 * destination cannot be chosen).
 */
export function buildReifyDestinations(
  rawAnchors: RawReifyAnchor[],
  defaultDestination: ReifyDestination,
): ReifyDestination[] {
  const out: ReifyDestination[] = [];
  const seen = new Set<string>();
  const dfltUid = bareUid(defaultDestination.anchorUid);
  out.push({
    anchorUid: dfltUid,
    label: defaultDestination.label.trim() || dfltUid,
    assetSpace: defaultDestination.assetSpace,
  });
  seen.add(dfltUid);
  for (const raw of rawAnchors) {
    const uid = bareUid(raw.anchorUid);
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    out.push({
      anchorUid: uid,
      label: raw.label?.trim() || uid,
      assetSpace: raw.assetSpace ?? null,
    });
  }
  return out;
}

export interface BuildStatementParams {
  /** The new statement asset's own UID (caller-generated — no Date/random here). */
  uid: string;
  /** `exo__Statement_subject` — the open asset A's UID. */
  subjectUid: string;
  /** `exo__Statement_predicate` — the predicate-DEFINITION asset's UID. */
  predicateDefUid: string;
  /** `exo__Statement_object` — the relation target's UID. */
  objectUid: string;
  /** `exo__Asset_isDefinedBy` — the destination AssetSpace anchor UID. */
  isDefinedByAnchorUid: string;
}

/**
 * Build the markdown content for a new `exo__Statement` asset, matching the
 * canonical minimal эталон form (bare UID-form wikilinks for the three slots;
 * the class carries its alias). No timestamps / label — the эталон statements in
 * the vault have none and validate; keeping the form identical avoids drift.
 */
export function buildStatementAsset(p: BuildStatementParams): string {
  const link = (uid: string): string => `"[[${bareUid(uid)}]]"`;
  return [
    "---",
    `exo__Asset_isDefinedBy: ${link(p.isDefinedByAnchorUid)}`,
    `exo__Asset_uid: ${bareUid(p.uid)}`,
    "exo__Instance_class:",
    `  - "[[${EXO_STATEMENT_CLASS_UID}|exo__Statement]]"`,
    `exo__Statement_subject: ${link(p.subjectUid)}`,
    `exo__Statement_predicate: ${link(p.predicateDefUid)}`,
    `exo__Statement_object: ${link(p.objectUid)}`,
    "---",
    "",
  ].join("\n");
}

/**
 * The vault I/O the toggle drives. Each write is a single, observable disk
 * mutation so the orchestration can verify-after-write and roll back. The modal
 * implements these against `app.vault` / `app.fileManager`; tests inject fakes to
 * exercise the failure / crash-between-steps paths.
 */
export interface ReifyPorts {
  /** Create the statement asset from `content`; resolve to its vault path. */
  createStatement(content: string, uid: string): Promise<string>;
  /** verify-after-write — `true` iff the statement asset is present on disk. */
  statementExists(path: string): Promise<boolean>;
  /** Delete the statement asset (rollback after a failed reify; de-reify delete). */
  deleteStatement(path: string): Promise<void>;
  /** Remove the single inline value `rawValue` from A's frontmatter under `predicateKey`. */
  removeInline(predicateKey: string, rawValue: string): Promise<void>;
  /** Append an inline `[[targetUid]]` to A's frontmatter under `predicateKey`. */
  appendInline(predicateKey: string, targetUid: string): Promise<void>;
  /**
   * Read A's inline relation targets under `predicateKey` FRESH FROM DISK — the
   * resolved UID of each wikilink value. Used to verify-after-write that the
   * inline copy was removed (reify) or restored (de-reify), independent of any
   * in-memory cache (so a duplicate / loss is detected against the real file).
   */
  readInlineTargets(predicateKey: string): Promise<string[]>;
}

export interface ReifyParams {
  /** The open asset A's UID (the statement subject). */
  subjectUid: string;
  /** The inline relation's frontmatter key (the predicate). */
  predicateKey: string;
  /**
   * The predicate-DEFINITION asset's UID, resolved from `predicateKey` by the
   * modal. Empty string ⇒ no def asset for the key ⇒ REJECT (predicate-mapping).
   */
  predicateDefUid: string;
  /**
   * The relation target's UID, or `null` when the object is a Literal /
   * unresolvable ⇒ REJECT (object-IRI-validate — a Literal is a property, not an
   * edge).
   */
  objectUid: string | null;
  /** The exact raw inline value to remove (multi-value safe — only this element). */
  inlineRawValue: string;
  /** Destination AssetSpace anchor UID for the statement's `isDefinedBy`. */
  isDefinedByAnchorUid: string;
  /** The new statement asset's UID (caller-generated). */
  newStatementUid: string;
}

export interface DeReifyParams {
  /**
   * The frontmatter KEY the reified predicate maps back to, resolved by the modal
   * (the predicate-def asset's `exo__Asset_label`). Empty ⇒ REJECT.
   */
  predicateKey: string;
  /** The relation target's UID, or `null` when the reified object is not an IRI ⇒ REJECT. */
  targetUid: string | null;
  /** Vault path of the backing statement asset to delete. */
  statementPath: string;
}

/**
 * Parse the inline relation targets under `key` from a markdown file's raw
 * CONTENT (the disk bytes). Callers pass `await app.vault.read(file)` — NOT a
 * cached frontmatter object — so the reify/de-reify verify-after-write reads the
 * REAL file (the privacy-critical "is the inline copy gone/restored" check must
 * not trust a lagging in-memory cache). Returns the resolved wikilink target UIDs
 * (`.md` stripped); non-wikilink (literal) values are skipped.
 */
export function parseInlineTargetsFromContent(
  content: string,
  key: string,
): string[] {
  const parsed = new FrontmatterService().parseObject(content);
  const raw = parsed?.[key];
  const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const targets: string[] = [];
  for (const v of values) {
    const t = wikilinkTarget(v);
    if (t) targets.push(bareUid(t));
  }
  return targets;
}

/** Best-effort rollback delete — never throws (a failing rollback must not mask the cause). */
async function safeDelete(ports: ReifyPorts, path: string): Promise<void> {
  try {
    await ports.deleteStatement(path);
  } catch {
    /* swallow — surfaced via the thrown reify error below */
  }
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Reify an inline relation into an `exo__Statement` asset, atomically.
 *
 * Order (privacy-critical): create-statement → verify-on-disk → remove-inline →
 * verify-inline-gone. The statement (the edge's new home) exists and is verified
 * BEFORE the inline copy is removed, so a removal failure never loses the edge.
 * If the inline copy is still present after the removal (or the removal threw),
 * the just-created statement is rolled back (deleted) — a lingering inline +
 * statement is a duplicate that would leak the would-be-private copy.
 *
 * @returns the vault path of the created statement asset (so the caller can
 * record the authoritative path instead of recomputing it — no TOCTOU).
 * @throws when a guard rejects (no predicate-def, Literal object), when the
 * statement is not written, or when the reify is rolled back. On any throw the
 * caller must NOT show a success marker.
 */
export async function reifyRelation(
  ports: ReifyPorts,
  p: ReifyParams,
): Promise<string> {
  // Predicate-mapping guard: a frontmatter key with no definition asset cannot
  // become a well-formed `exo__Statement_predicate` (RFC HIGH) — reject loudly,
  // never write a broken half-statement.
  if (!p.predicateDefUid) {
    throw new Error(
      `Cannot reify "${p.predicateKey}": no predicate-definition asset was found for this key.`,
    );
  }
  // Object-IRI-validate guard: only an IRI object is an edge (RFC R6). A Literal
  // is a property value and must not be reified into a relation.
  if (!p.objectUid) {
    throw new Error(
      `Cannot reify "${p.predicateKey}": the relation object is not an IRI (a literal value is a property, not an edge).`,
    );
  }

  // 1. Create the statement asset (the edge's new home).
  const content = buildStatementAsset({
    uid: p.newStatementUid,
    subjectUid: p.subjectUid,
    predicateDefUid: p.predicateDefUid,
    objectUid: p.objectUid,
    isDefinedByAnchorUid: p.isDefinedByAnchorUid,
  });
  const path = await ports.createStatement(content, p.newStatementUid);

  // 2. verify-on-disk — the statement must really exist before we touch the inline.
  let written = false;
  try {
    written = await ports.statementExists(path);
  } catch {
    written = false;
  }
  if (!written) {
    // A partial/failed create — clean up best-effort and abort; nothing else changed.
    await safeDelete(ports, path);
    throw new Error(
      "Reify failed: the statement asset was not written to disk; nothing was changed.",
    );
  }

  // 3. Remove the inline copy (the single value — multi-value siblings stay).
  let removeError: unknown = null;
  try {
    await ports.removeInline(p.predicateKey, p.inlineRawValue);
  } catch (e) {
    removeError = e;
  }

  // 4. verify-after-write (authoritative, from disk) — the inline edge must be gone.
  let stillInline: boolean;
  try {
    const targets = await ports.readInlineTargets(p.predicateKey);
    stillInline = targets.some((t) => sameTarget(t, p.objectUid as string));
  } catch (e) {
    // Cannot confirm removal. If the removal itself threw, the inline copy
    // DEFINITELY survived (the edge is preserved) — so deleting the statement is
    // safe and prevents a silent duplicate (privacy leak). Only when the removal
    // SUCCEEDED but the verify read failed do we keep the statement (avoid a
    // possible loss) and surface for a manual retry.
    if (removeError) {
      await safeDelete(ports, path);
      throw new Error(
        `Reify rolled back: removing the inline copy failed (${errMessage(removeError)}) and could not be re-verified; the statement was deleted to avoid a duplicate.`,
      );
    }
    throw new Error(
      `Reify incomplete: could not verify the inline copy was removed (${errMessage(e)}). The statement was created (the edge is preserved); re-open to retry.`,
    );
  }
  if (stillInline) {
    // Duplicate (inline + statement) → privacy leak. Roll back the statement.
    await safeDelete(ports, path);
    throw new Error(
      removeError
        ? `Reify rolled back: removing the inline copy failed (${errMessage(removeError)}); the statement was deleted to avoid a duplicate.`
        : "Reify rolled back: the inline copy is still present after removal; the statement was deleted to avoid a duplicate (privacy leak).",
    );
  }

  // inline gone + statement present → atomic success.
  return path;
}

/**
 * De-reify a reified relation back into an inline frontmatter relation, safely.
 *
 * Order (safety): append-inline → verify-inline-restored → delete-statement →
 * verify-statement-gone. The inline copy is restored and verified BEFORE the
 * statement is deleted, so an aborted delete leaves at worst a transient
 * duplicate (inline + statement) — never a loss. If the inline copy is not
 * confirmed restored, the statement is NOT deleted (the edge stays reified).
 *
 * @throws when a guard rejects, when the inline copy is not restored, or when the
 * statement delete cannot be confirmed. On any throw the caller must NOT show a
 * success marker.
 */
export async function deReifyRelation(
  ports: ReifyPorts,
  p: DeReifyParams,
): Promise<void> {
  // Predicate-mapping (reverse): the def asset's label must map back to a key.
  if (!p.predicateKey) {
    throw new Error(
      "Cannot de-reify: the reified predicate could not be mapped back to a frontmatter key (no definition asset / no label).",
    );
  }
  if (!p.targetUid) {
    throw new Error(
      "Cannot de-reify: the reified object is not an IRI and cannot become an inline relation.",
    );
  }

  // 1. Restore the inline copy FIRST (the edge is never lost).
  await ports.appendInline(p.predicateKey, p.targetUid);

  // 2. verify-after-write — the inline copy must be present before we delete anything.
  let restored: boolean;
  try {
    const targets = await ports.readInlineTargets(p.predicateKey);
    restored = targets.some((t) => sameTarget(t, p.targetUid as string));
  } catch {
    restored = false;
  }
  if (!restored) {
    throw new Error(
      "De-reify aborted: the inline copy was not restored; the statement was NOT deleted (the edge is preserved).",
    );
  }

  // 3. Delete the backing statement (the inline copy is now the edge's home).
  await ports.deleteStatement(p.statementPath);

  // 4. verify the statement is gone. A failure here is a TRANSIENT duplicate
  // (inline restored + statement still present) — never a loss; surface to retry.
  let gone: boolean;
  try {
    gone = !(await ports.statementExists(p.statementPath));
  } catch {
    gone = false;
  }
  if (!gone) {
    throw new Error(
      "De-reify partial: the inline copy was restored but the statement could not be removed (a transient duplicate); re-open to retry — no edge was lost.",
    );
  }

  // inline restored + statement gone → atomic success.
}
