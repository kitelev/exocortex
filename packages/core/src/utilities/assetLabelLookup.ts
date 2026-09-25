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
 * - a label of the shape `prefix__Local` — which EVERY class and property
 *   definition has (`ems__Task`, `tbank-public__ProteusReport`) — is emitted as
 *   its TERM IRI, `exo:Asset_label <https://exocortex.my/ontology/ems#Task>`:
 *   the same IRI `valueToRDFObject` gives every reference to that class;
 * - any other label (`"Project area J"`) is emitted as a `Literal`.
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
    for (const triple of await store.match(undefined, labelPredicate, term)) {
      if (!(triple.subject instanceof IRI)) continue;
      const uid = await uidOf(store, triple.subject);
      if (uid) return uid;
    }
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
