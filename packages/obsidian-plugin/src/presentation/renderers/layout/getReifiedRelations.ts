import {
  ITripleStore,
  IRI,
  Literal,
  Namespace,
  iriToVaultPath,
} from "@kitelev/exocortex-core";

/**
 * RFC `93a0b2ee` Phase 1 / Task 1.1 — read-path helper that sources reified
 * relations of an asset from its `exo__Statement` *instances* in the triple
 * store, NOT from the materialized D5 logical edge.
 *
 * Why instances and not the materialized edge: the EKA D5 materialize-at-index
 * (`NoteToRDFConverter.convertLegacyNote`) emits a logical edge
 * `<subject> <predicate> <object>` for a reified `exo__Statement`. That edge is
 * **byte-identical** to an inline frontmatter edge and is **deduplicated** by
 * `InMemoryTripleStore.add` — so it is provenance-free: from the edge alone you
 * cannot tell "inline vs reified" nor recover which statement asset backs it
 * (RFC §C1, review-unanimous). The raw `exo__Statement_subject/_predicate/
 * _object` triples DO carry that provenance (the statement asset's IRI is their
 * subject), so this helper queries them.
 *
 * This module is intentionally isolated (callers = 0 at Task 1.1; integration
 * into `RelationsRenderer.getAssetRelations` is Task 1.3, the triple-store
 * ctor-DI + `isReady` cold-start gate are Task 1.2). It performs no inline /
 * reified dedup (Task 1.3) and adds no marker (Task 2).
 */

/** `exo#Statement_subject` — the reified statement's subject slot. */
const STATEMENT_SUBJECT: IRI = Namespace.EXO.term("Statement_subject");
/** `exo#Statement_predicate` — the reified statement's predicate slot. */
const STATEMENT_PREDICATE: IRI = Namespace.EXO.term("Statement_predicate");
/** `exo#Statement_object` — the reified statement's object slot. */
const STATEMENT_OBJECT: IRI = Namespace.EXO.term("Statement_object");

/**
 * One reified relation surfaced for an asset A, derived from a single
 * `exo__Statement` instance. Carries provenance (the statement asset's path +
 * its AssetSpace) so a later phase can render the factual
 * "reified · &lt;AS&gt;" marker (RFC C2).
 */
export interface ReifiedRelation {
  /** IRI of the backing `exo__Statement` asset (its subject IRI in the store). */
  statementIri: string;
  /** Resolved `exo__Statement_subject` IRI of the logical edge. */
  subject: string;
  /** Resolved `exo__Statement_predicate` IRI of the logical edge. */
  predicate: string;
  /** Resolved `exo__Statement_object` — IRI string, or literal lexical value. */
  object: string;
  /** True when the object resolved to a Literal (RFC R6 — Task 1.3 routes those). */
  objectIsLiteral: boolean;
  /** Relative to asset A: `outgoing` (A is subject) or `incoming` (A is object). */
  direction: "outgoing" | "incoming";
  /**
   * Provenance — the vault-relative path of the backing statement asset,
   * derived from `statementIri`. `null` when the statement IRI is not a vault
   * asset IRI (`obsidian://vault/...`).
   */
  statementPath: string | null;
  /**
   * The AssetSpace the statement asset lives in (e.g. `exoas-class-relations`),
   * parsed from `statementPath`. `null` when not derivable.
   */
  assetSpace: string | null;
}

/** The asset A whose reified relations to fetch — only the fields this helper reads. */
export interface ReifiedRelationsAsset {
  /** Vault-relative path of A (e.g. `assetspaces/.../<uid>.md`). */
  path: string;
  /**
   * A's `exo__Asset_label`. Used ONLY to compute the symbolic IRI candidate
   * form for the dual-IRI union (R5) when the label is a `prefix__LocalName`
   * class reference. Plain human-text labels contribute no symbolic form.
   */
  label?: string | null;
}

export interface GetReifiedRelationsParams {
  /** The asset A. */
  file: ReifiedRelationsAsset;
  /** The triple store to query (Task 1.2 wires the live store via ctor-DI). */
  store: ITripleStore;
  /**
   * The indexer's `notePathToIRI` — reused so this helper computes A's path-form
   * IRI with the SAME `subjectIriPrefix` (mount prefix) the converter used when
   * it emitted the statement triples. Injected (not hardcoded) so a
   * prefix-labeled / mounted A resolves instead of silently matching nothing
   * (R5, `sparql-iri-form-pre-verify`).
   */
  notePathToIRI: (path: string) => IRI;
}

/**
 * Compute A's symbolic class IRI candidate (the `…/ns#LocalName` form) when its
 * label is a `prefix__LocalName` reference — mirrors
 * `NoteToRDFConverter.expandClassValue`, the exact resolution the converter
 * applies to a `[[<uid>]]` whose target's label is prefix-parseable. Returns
 * `null` for plain labels. Pure (no store / vault access).
 */
function labelToSymbolicIRI(label: string | null | undefined): IRI | null {
  if (typeof label !== "string" || label.length === 0 || /\s/.test(label)) {
    return null;
  }
  const parsed = Namespace.fromPropertyKey(label);
  if (!parsed) return null;
  // Reject local names whose IRI form would be invalid (parens/space) — same
  // guard as expandClassValue (Issue #3121).
  if (/[\s()]/.test(parsed.localName)) return null;
  try {
    return parsed.namespace.term(parsed.localName);
  } catch {
    return null;
  }
}

/**
 * The union of all IRI forms under which A may appear as a statement's
 * subject/object (R5 dual-IRI):
 *  1. path-form `obsidian://vault/<prefix><path>` via the injected `notePathToIRI`;
 *  2. symbolic-form `…/ns#LocalName` when A's label is a class reference.
 * Querying only one form would silently miss statements stored under the other.
 */
function assetIriForms(
  file: ReifiedRelationsAsset,
  notePathToIRI: (path: string) => IRI,
): IRI[] {
  const forms: IRI[] = [notePathToIRI(file.path)];
  const symbolic = labelToSymbolicIRI(file.label);
  if (symbolic && !forms.some((f) => f.value === symbolic.value)) {
    forms.push(symbolic);
  }
  return forms;
}

/** First `IRI` object of `<subject> <predicate> ?o`, or `null`. */
async function firstObjectIri(
  store: ITripleStore,
  subject: IRI,
  predicate: IRI,
): Promise<IRI | null> {
  const triples = await store.match(subject, predicate, undefined);
  for (const t of triples) {
    if (t.object instanceof IRI) return t.object;
  }
  return null;
}

/** First `IRI`-or-`Literal` object of `<subject> <predicate> ?o`, or `null`. */
async function firstIriOrLiteral(
  store: ITripleStore,
  subject: IRI,
  predicate: IRI,
): Promise<IRI | Literal | null> {
  const triples = await store.match(subject, predicate, undefined);
  for (const t of triples) {
    if (t.object instanceof IRI || t.object instanceof Literal) return t.object;
  }
  return null;
}

/** Parse the `exoas-<name>` AssetSpace segment from a vault path, or `null`. */
function extractAssetSpace(path: string): string | null {
  const m = path.match(/(?:^|\/)(exoas-[a-z0-9-]+)(?:\/|$)/i);
  return m ? m[1] : null;
}

/**
 * Fetch the reified relations of asset A from its `exo__Statement` instances.
 *
 * Outgoing (A is the statement's `_subject`) is found via
 * `match(⊥, exo:Statement_subject, A-form)`; incoming (A is `_object`) via
 * `match(⊥, exo:Statement_object, A-form)` — the same bidirectional match shape
 * `DescribeExecutor` uses. A is matched against ALL of its candidate IRI forms
 * (R5). Each matched statement is read back for its three slots + provenance.
 *
 * Statements are keyed by their IRI, so a statement matched via multiple
 * candidate forms (or that resolves both directions for a self-relation)
 * appears once — `outgoing` wins for a degenerate self-edge. NO inline/reified
 * dedup is done here (Task 1.3).
 *
 * @returns the reified relations; `[]` for an empty store or an asset with none.
 */
export async function getReifiedRelations(
  params: GetReifiedRelationsParams,
): Promise<ReifiedRelation[]> {
  const { file, store, notePathToIRI } = params;
  const forms = assetIriForms(file, notePathToIRI);

  // statementIri.value → direction. Outgoing is collected first so it wins over
  // incoming for a self-relation (A is both subject and object of one statement).
  const direction = new Map<string, "outgoing" | "incoming">();

  for (const form of forms) {
    const outgoing = await store.match(undefined, STATEMENT_SUBJECT, form);
    for (const t of outgoing) {
      if (t.subject instanceof IRI) direction.set(t.subject.value, "outgoing");
    }
  }
  for (const form of forms) {
    const incoming = await store.match(undefined, STATEMENT_OBJECT, form);
    for (const t of incoming) {
      if (t.subject instanceof IRI && !direction.has(t.subject.value)) {
        direction.set(t.subject.value, "incoming");
      }
    }
  }

  const relations: ReifiedRelation[] = [];
  for (const [statementIriValue, dir] of direction) {
    const statementIri = new IRI(statementIriValue);
    const subject = await firstObjectIri(store, statementIri, STATEMENT_SUBJECT);
    const predicate = await firstObjectIri(store, statementIri, STATEMENT_PREDICATE);
    const object = await firstIriOrLiteral(store, statementIri, STATEMENT_OBJECT);
    // A well-formed logical edge needs all three slots; skip a malformed /
    // partial statement rather than surface a half-edge.
    if (!subject || !predicate || !object) continue;

    const statementPath = iriToVaultPath(statementIriValue);
    relations.push({
      statementIri: statementIriValue,
      subject: subject.value,
      predicate: predicate.value,
      object: object.value,
      objectIsLiteral: object instanceof Literal,
      direction: dir,
      statementPath,
      assetSpace: statementPath ? extractAssetSpace(statementPath) : null,
    });
  }
  return relations;
}
