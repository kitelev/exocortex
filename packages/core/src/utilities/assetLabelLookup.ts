import type { ITripleStore } from "../interfaces/ITripleStore";
import { IRI } from "../domain/models/rdf/IRI";
import { Literal } from "../domain/models/rdf/Literal";
import { Namespace } from "../domain/models/rdf/Namespace";

/**
 * Reverse label lookup: the `exo__Asset_uid` of the asset whose
 * `exo__Asset_label` is `label`, or `null` when no such asset (with a uid) is
 * in the store.
 *
 * `NoteToRDFConverter` emits a label in ONE of two forms, and a lookup that
 * knows only one of them misses half the corpus (issue #4354):
 *
 * - a label of the shape `prefix__Local` — which nearly every class and
 *   property definition has (`ems__Task`, `tbank-public__ProteusReport`) — is
 *   emitted as its TERM IRI, `exo:Asset_label <https://exocortex.my/ontology/ems#Task>`:
 *   the same IRI `valueToRDFObject` gives every reference to that class;
 * - any other label (`"Project area J"`) is emitted as a `Literal` — and so is
 *   the basename fallback of a file with NO `exo__Asset_label`, even when the
 *   file is named `prefix__Local` (live: `kitelev__ReadArticleTask.md`).
 *
 * The two copies this replaces (`CommandResolver.findUidByLabel`,
 * `WorkflowResolver.findUidByLabel`) matched the `Literal` form only, so for a
 * real store they found no class at all: the class-ancestor walk stopped at the
 * first superclass (inherited command bindings, subclass workflows) and a
 * short-name `Grounding_targetClass` never got its UID. Their tests seeded the
 * label as a `Literal` by hand, which is why none of it showed.
 *
 * The term form is tried first (an indexed object match); the `Literal` scan
 * stays as the fallback for labels the converter does not turn into an IRI —
 * and for stores built by hand in that shape.
 */
export async function findUidByAssetLabel(
  store: ITripleStore,
  label: string,
): Promise<string | null> {
  const labelPredicate = Namespace.EXO.term("Asset_label");

  const term = labelTermIRI(label);
  if (term) {
    const [first] = await labelTermBearers(store, term);
    if (first) return first.uid;
  }

  for (const triple of await store.match(undefined, labelPredicate, undefined)) {
    if (
      triple.object instanceof Literal &&
      triple.object.value === label &&
      triple.subject instanceof IRI
    ) {
      const uid = await uidOf(store, triple.subject);
      if (uid) return uid;
    }
  }
  return null;
}

/**
 * Every asset (with a uid) whose `exo__Asset_label` object IS `labelTerm` — the
 * term IRI the converter emits for a `prefix__Local` label — in store order,
 * one entry per distinct uid (the same asset mounted twice is ONE bearer).
 *
 * Shared by {@link findUidByAssetLabel} (first bearer wins, #4354) and
 * `CommandResolver.resolveRefIriSubject` (#4370), which maps a `[[uid]]`
 * reference emitted as that term IRI back to the asset: there more than one
 * distinct bearer means the reference is ambiguous and must not be resolved to
 * whichever happened to be indexed first.
 */
export async function labelTermBearers(
  store: ITripleStore,
  labelTerm: IRI,
): Promise<Array<{ subject: IRI; uid: string }>> {
  const bearers: Array<{ subject: IRI; uid: string }> = [];
  const seen = new Set<string>();
  for (const triple of await store.match(
    undefined,
    Namespace.EXO.term("Asset_label"),
    labelTerm,
  )) {
    if (!(triple.subject instanceof IRI)) continue;
    const uid = await uidOf(store, triple.subject);
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    bearers.push({ subject: triple.subject, uid });
  }
  return bearers;
}

/**
 * The term IRI the converter emits for `label`, or `null` when it keeps the
 * label a `Literal`. Mirrors `NoteToRDFConverter.isClassReference` (no
 * whitespace) + `expandClassValue` (parseable key, no `[\s()]` in the local
 * name) so this lookup and the emitter agree on which labels are IRIs.
 */
function labelTermIRI(label: string): IRI | null {
  if (/\s/.test(label)) return null;
  const parsed = Namespace.fromPropertyKey(label);
  if (!parsed || /[\s()]/.test(parsed.localName)) return null;
  try {
    return parsed.namespace.term(parsed.localName);
  } catch {
    return null;
  }
}

async function uidOf(store: ITripleStore, subject: IRI): Promise<string | null> {
  const uidTriples = await store.match(
    subject,
    Namespace.EXO.term("Asset_uid"),
    undefined,
  );
  return uidTriples.length > 0 && uidTriples[0].object instanceof Literal
    ? uidTriples[0].object.value
    : null;
}
