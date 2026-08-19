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
 * discriminator is `Namespace.fromTermIRI`. Both halves are load-bearing and each
 * now HAS its own reddening axis — the literal-text-that-looks-like-an-IRI fixture
 * pins `instanceof`, the file-IRI fixtures pin `fromTermIRI`. ⚠ That sentence was
 * asserted here before either axis existed, and review measured that dropping
 * `instanceof` reddened nothing; the fixture was added in response.
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
    // and three assets in the live vault do exactly this. That particular IRI is
    // used as a predicate 0 times, so the message below ("a join from a predicate
    // to its definition resolves to all of them") would be false for it.
    // ⚠ Do NOT generalise that to "file IRIs are never predicates" — they can be.
    // Measured: `adapter-exo-ims__relatesToConcept` has a hyphenated prefix, which
    // `Namespace.forPrefix` rejects (`^[a-z][a-zA-Z0-9]*$`), so it never gets a term
    // IRI and is used by FILE IRI in the predicate slot 64× (vault-my) / 102×
    // (vault-exodev). The guard is therefore justified by that one IRI's measured
    // 0 predicate uses, not by an invariant about file IRIs.
    // `Namespace.fromTermIRI` is the documented inverse of the forward path
    // `fromPropertyKey` → `term`. ⛔ It is NOT an exact inverse, and claiming so
    // here was false (review round 3, probe P3): `Namespace.term()` will mint an
    // IRI for a local name containing `/` or `#` (label `exo__Asset/Sub` →
    // `…/exo#Asset/Sub`), while `fromTermIRI` rejects those by design — its own
    // docstring says the narrowing "is reachable by construction". So this guard
    // has a small FALSE-NEGATIVE class: a collision on such a label goes
    // unreported. Accepted deliberately — widening the inverse to admit `/` and
    // `#` would make the local-name boundary ambiguous, which is the reason the
    // narrowing exists. What the guard does guarantee is the direction that
    // matters here: nothing it accepts is a file IRI or a literal.
    if (Namespace.fromTermIRI(triple.object.value) === null) continue;

    const iri = triple.object.value;
    let subjects = emitters.get(iri);
    if (!subjects) {
      subjects = new Set<string>();
      emitters.set(iri, subjects);
    }
    // `Subject` is IRI | BlankNode | QuotedTriple, and the three carry their
    // identity under DIFFERENT accessors: `IRI.value`, `BlankNode.id`,
    // `QuotedTriple.toString()`. ⛔ Reading `.value` off the non-IRI branch (as
    // this did until review round 3) type-errors AND collapses every blank
    // emitter to one key, so N distinct blank nodes rendered as a single
    // `_:blank` and the reported emitter count was wrong. The fixture hid it by
    // faking the node as `{ value }` — a shape the real class does not have
    // (test-fixture-realism). The axis below now uses a real `BlankNode`.
    //
    // A blank node is kept in the COUNT (it is a genuine second emitter and its
    // presence is what makes the term ambiguous) but cannot be a focusNode a
    // reader could open — it is skipped at render time below. Filtering it here
    // instead would suppress the report for the addressable half too.
    // Non-IRI subjects key on `toString()`, which each class already defines in
    // its canonical form: `BlankNode` → `_:${id}`, `QuotedTriple` → `<< … >>`
    // (both measured by execution, not read). That is why two branches suffice
    // and no per-class accessor is needed.
    //
    // ⛔ History, because both mistakes are instructive. (1) This read
    // `subject.value` on the non-IRI branch — a property `BlankNode` does not
    // have — so every blank emitter collapsed to one key and the reported count
    // was wrong; the fixture hid it by faking the node as `{ value }`. (2) The
    // replacement then hand-rolled `_:${id}` and wrapped the quoted form in
    // literal `<<…>>` — but `QuotedTriple.toString()` ALREADY returns `<< … >>`,
    // so that produced `<<<< … >>>>`. Alongside it stood the claim that a
    // QuotedTriple axis "cannot exist in this package because QuotedTriple is
    // not re-exported from the core barrel", justified by a grep of
    // `packages/core/src/index.ts`. The grep was true and measured the wrong
    // thing: that barrel does `export * from "./domain/models/rdf"`, which
    // re-exports it. A probe imported and constructed one in this package on the
    // first try. ⇒ before writing "X cannot be done", RUN the thing that would
    // do X. The axis that claim said was impossible is now below.
    const subject = triple.subject;
    subjects.add(subject instanceof DomainIRI ? subject.value : String(subject));
  }

  const violations: Violation[] = [];
  for (const [iri, subjects] of emitters) {
    if (subjects.size < 2) continue;
    const sorted = [...subjects].sort();
    for (const focusNode of sorted) {
      // Blank nodes and quoted triples are counted above but cannot anchor a
      // report entry — a reader cannot open them.
      if (focusNode.startsWith("_:") || focusNode.startsWith("<<")) continue;
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
