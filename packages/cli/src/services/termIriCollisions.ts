import {
  DomainIRI,
  Namespace,
  type Triple,
  type Violation,
} from "@kitelev/exocortex-core";

/**
 * Detect **term-IRI collisions**: two or more assets emitting the SAME term IRI.
 *
 * An asset whose `exo__Asset_label` parses as `<prefix>__<LocalName>` is emitted
 * into the graph as a **term IRI**, not as a literal (see `Namespace.fromPropertyKey`
 * → `Namespace.term`). When two assets carry the same such label they emit the
 * same IRI, and every join "predicate → its definition" then yields BOTH — the
 * graph can no longer say which asset defines the term.
 *
 * Measured on the live vaults (2026-08-17): a reified statement whose
 * `exo__Statement_predicate` is `http://www.w3.org/2002/07/owl#sameAs` resolves to
 * two definitions at once — an `exo__ObjectProperty` and a `concept__Concept` that
 * happen to share the label. Nothing reported this; `audit-ontology-imports`
 * quietly WORKS AROUND it by grouping on UID instead ("labels have had duplicates
 * — R12"), so the condition was known, routed around, and invisible.
 *
 * ⛔ Only IRI-valued labels count. Plain literal labels are duplicated legitimately
 * and en masse — the same measurement found **214** distinct literal labels shared
 * by more than one asset (`Initiative`, `Idea`, `Area`, `Bug`, `OKR`, …). Reporting
 * those would bury the three real collisions under 214 lines of noise, so the
 * `instanceof DomainIRI` filter is load-bearing, not incidental.
 *
 * Severity is `sh:Warning`, never `sh:Violation`: three collisions already exist in
 * the live vaults and must not turn `conforms` false the moment this ships
 * (founder's call, 2026-08-17). The check makes them visible; deciding each case
 * (genuine duplicate vs. homonym across classes) is separate work.
 *
 * req `00e8079e-fb36-4ce3-b33f-abb18c212143`
 */
export function detectTermIriCollisions(
  triples: readonly Triple[],
): Violation[] {
  const labelPredicate = Namespace.EXO.term("Asset_label").value;

  // term IRI -> the subjects emitting it (Set: one asset stating the same label
  // twice is not a collision).
  const emitters = new Map<string, Set<string>>();

  for (const triple of triples) {
    if (triple.predicate.value !== labelPredicate) continue;
    if (!(triple.object instanceof DomainIRI)) continue;
    // `Subject` is IRI | BlankNode; only an IRI subject is an addressable asset,
    // and a blank node could not be reported to a reader anyway.
    if (!(triple.subject instanceof DomainIRI)) continue;

    const iri = triple.object.value;
    let subjects = emitters.get(iri);
    if (!subjects) {
      subjects = new Set<string>();
      emitters.set(iri, subjects);
    }
    subjects.add(triple.subject.value);
  }

  const violations: Violation[] = [];
  for (const [iri, subjects] of emitters) {
    if (subjects.size < 2) continue;
    const sorted = [...subjects].sort();
    for (const focusNode of sorted) {
      const others = sorted.filter((s) => s !== focusNode);
      violations.push({
        focusNode,
        propertyPath: labelPredicate,
        severity: "sh:Warning",
        message:
          `term-IRI collision: <${iri}> is emitted by ${sorted.length} assets — ` +
          `a join from a predicate to its definition resolves to all of them. ` +
          `Also emitted by: ${others.join(", ")}`,
        constraint: "term-iri-collision",
        actualValue: iri,
      });
    }
  }

  return violations;
}
