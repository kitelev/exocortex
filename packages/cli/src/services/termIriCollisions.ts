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
 * quietly WORKS AROUND it by grouping on UID instead — the comment at
 * `audit-ontology-imports.ts:871` reads verbatim "UID is the grouping key (labels
 * have had duplicates — R12)". (Quote verified against origin/main; the "R12"
 * identifier itself is defined nowhere in the repo, so treat it as an unresolved
 * reference rather than a citation a reader can follow.) The condition was known,
 * routed around, and invisible.
 *
 * ⛔ Only IRI-valued labels count. Plain literal labels are duplicated legitimately
 * and en masse — the same measurement found **214** distinct literal labels shared
 * by more than one asset (`Initiative`, `Idea`, `Area`, `Bug`, `OKR`, …). Reporting
 * those would bury the real collisions under 214 lines of noise. ⛔ But `instanceof
 * DomainIRI` alone is NOT sufficient (see the comment at the filter): the actual
 * discriminator is `Namespace.fromTermIRI`, and both halves are load-bearing —
 * dropping either has its own reddening axis.
 *
 * Severity is `sh:Warning`, never `sh:Violation`: three collisions already exist in
 * the live vaults and must not turn `conforms` false the moment this ships
 * (founder's call, 2026-08-17). The check makes them visible; deciding each case
 * (genuine duplicate vs. homonym across classes) is separate work.
 *
 * ⚠ SCOPE, measured — this finds AMBIGUOUS definitions, not MISSING ones. An asset
 * with no `exo__Asset_label` key gets a synthesised `Literal(file.basename)`
 * (`NoteToRDFConverter.ts:454`), so a class file named `kitelev__ReadArticleTask.md`
 * emits its label as a LITERAL even though the name parses. Live consequence in
 * vault-my: that term has 2 uses as an IRI in the graph and **0** definitions
 * reachable by `?def exo:Asset_label <term>`. A second asset declaring the same
 * label in frontmatter would create exactly the ambiguity hunted here and stay
 * silent (one IRI emitter, one Literal emitter). The mirror defect — zero
 * definitions — is arguably more common and is deliberately out of scope.
 *
 * ⚠ CLI-only by design (UI/CLI parity #3417 noted, not met): the plugin's
 * `PluginVaultCheckReader` and core's `shaclCheck` do not run this. It is wired
 * into `validate schema` because that is the surface the vault-mutation floor
 * already runs after every change; a plugin-side equivalent is separate work.
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
    // ⛔ `instanceof DomainIRI` is NOT the "is a term IRI" test. A label written
    // as a wikilink (`exo__Asset_label: "[[<uid>]]"`) is emitted by the converter
    // as the TARGET'S FILE IRI (`obsidian://vault/…/<uid>.md`) — also a DomainIRI,
    // and three assets in the live vault do exactly this. Such an IRI is never a
    // predicate, so the message below ("a join from a predicate to its definition
    // resolves to all of them") would be false for them. `Namespace.fromTermIRI`
    // is the documented inverse of the forward path `fromPropertyKey` → `term`,
    // so it accepts exactly the IRIs that path can produce and nothing else.
    if (Namespace.fromTermIRI(triple.object.value) === null) continue;

    const iri = triple.object.value;
    let subjects = emitters.get(iri);
    if (!subjects) {
      subjects = new Set<string>();
      emitters.set(iri, subjects);
    }
    // `Subject` is IRI | BlankNode. A blank node is kept in the COUNT (it is a
    // genuine second emitter and its presence is what makes the term ambiguous)
    // but cannot be a focusNode a reader could open — it is skipped at render
    // time below. Filtering it here instead would suppress the report for the
    // addressable half too.
    subjects.add(
      triple.subject instanceof DomainIRI
        ? triple.subject.value
        : `_:${String(triple.subject.value ?? "blank")}`,
    );
  }

  const violations: Violation[] = [];
  for (const [iri, subjects] of emitters) {
    if (subjects.size < 2) continue;
    const sorted = [...subjects].sort();
    for (const focusNode of sorted) {
      // Blank nodes are counted above but cannot anchor a report entry.
      if (focusNode.startsWith("_:")) continue;
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
