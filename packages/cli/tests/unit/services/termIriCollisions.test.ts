import {
  DomainIRI as IRI,
  DomainLiteral as Literal,
  Namespace,
  DomainTriple as Triple,
  type Violation,
} from "@kitelev/exocortex-core";
import { detectTermIriCollisions } from "../../../src/services/termIriCollisions.js";

const REQ = "@req:00e8079e-fb36-4ce3-b33f-abb18c212143";

const LABEL = Namespace.EXO.term("Asset_label").value;

const asset = (uid: string): IRI =>
  new IRI(`obsidian://vault/assetspaces/kitelev/exoas-x/x/${uid}.md`);

/** `<asset> exo:Asset_label <term-iri>` — the shape a parseable label emits. */
const labelledWithIri = (uid: string, termIri: string): Triple =>
  new Triple(asset(uid), new IRI(LABEL), new IRI(termIri));

/** `<asset> exo:Asset_label "text"` — the shape a plain human label emits. */
const labelledWithLiteral = (uid: string, text: string): Triple =>
  new Triple(asset(uid), new IRI(LABEL), new Literal(text));

const iris = (vs: Violation[]): string[] =>
  [...new Set(vs.map((v) => v.actualValue ?? ""))].sort();

describe("detectTermIriCollisions", () => {
  const OWL_SAME_AS = "http://www.w3.org/2002/07/owl#sameAs";

  it(`${REQ} reports a term IRI emitted by two assets, naming both`, () => {
    // The live case this was written for: an exo__ObjectProperty and a
    // concept__Concept sharing the label `owl__sameAs`.
    const found = detectTermIriCollisions([
      labelledWithIri("9d2128de", OWL_SAME_AS),
      labelledWithIri("3c6240a5", OWL_SAME_AS),
    ]);

    expect(iris(found)).toEqual([OWL_SAME_AS]);
    // one entry per emitter, so whichever asset a reader opens, the report is there
    expect(found).toHaveLength(2);
    expect(found.map((v) => v.focusNode).sort()).toEqual([
      asset("3c6240a5").value,
      asset("9d2128de").value,
    ]);
    // each entry names the OTHER emitter — that is what makes it actionable
    const forFirst = found.find(
      (v) => v.focusNode === asset("9d2128de").value,
    )!;
    expect(forFirst.message).toContain("3c6240a5");
    expect(forFirst.message).not.toContain("9d2128de.md,"); // not listed against itself
  });

  it(`${REQ} classifies collisions as sh:Warning so conforms is never flipped`, () => {
    const found = detectTermIriCollisions([
      labelledWithIri("a", OWL_SAME_AS),
      labelledWithIri("b", OWL_SAME_AS),
    ]);

    expect(found.length).toBeGreaterThan(0);
    for (const v of found) {
      expect(v.severity).toBe("sh:Warning");
      expect(v.severity).not.toBe("sh:Violation");
      expect(v.constraint).toBe("term-iri-collision");
    }
  });

  it(`${REQ} stays silent when a term IRI has exactly one emitter`, () => {
    const found = detectTermIriCollisions([
      labelledWithIri(
        "only",
        "http://www.w3.org/2000/01/rdf-schema#subClassOf",
      ),
      labelledWithIri("other", OWL_SAME_AS),
    ]);

    expect(found).toEqual([]);
  });

  /**
   * ⛔ NEGATIVE CONTROL, and the reason the `instanceof IRI` filter exists.
   * Plain literal labels repeat legitimately and en masse — the live measurement
   * found 214 distinct literal labels shared by more than one asset. If this axis
   * ever goes green while the detector reports literals, the check has become
   * noise rather than a signal.
   */
  it(`${REQ} does NOT report duplicated PLAIN labels (214 such labels exist live)`, () => {
    const found = detectTermIriCollisions([
      labelledWithLiteral("x1", "Initiative"),
      labelledWithLiteral("x2", "Initiative"),
      labelledWithLiteral("x3", "OKR"),
      labelledWithLiteral("x4", "OKR"),
      labelledWithLiteral("x5", "OKR"),
    ]);

    expect(found).toEqual([]);
  });

  it(`${REQ} ignores predicates other than exo__Asset_label`, () => {
    const otherPredicate = Namespace.EXO.term("Asset_relates").value;
    const found = detectTermIriCollisions([
      new Triple(asset("p"), new IRI(otherPredicate), new IRI(OWL_SAME_AS)),
      new Triple(asset("q"), new IRI(otherPredicate), new IRI(OWL_SAME_AS)),
    ]);

    expect(found).toEqual([]);
  });

  it(`${REQ} treats one asset restating the same label as a single emitter`, () => {
    // A duplicated triple is not two assets — de-duplication is on the SUBJECT.
    const found = detectTermIriCollisions([
      labelledWithIri("same", OWL_SAME_AS),
      labelledWithIri("same", OWL_SAME_AS),
    ]);

    expect(found).toEqual([]);
  });

  it(`${REQ} reports every colliding IRI, not just the first`, () => {
    const LIT_URL = "https://exocortex.my/ontology/lit#WebPage_url";
    const found = detectTermIriCollisions([
      labelledWithIri("a", OWL_SAME_AS),
      labelledWithIri("b", OWL_SAME_AS),
      labelledWithIri("c", LIT_URL),
      labelledWithIri("d", LIT_URL),
      labelledWithIri(
        "solo",
        "https://exocortex.my/ontology/ems#Effort_status",
      ),
    ]);

    expect(iris(found)).toEqual([OWL_SAME_AS, LIT_URL].sort());
  });

  it(`${REQ} returns nothing for an empty graph`, () => {
    expect(detectTermIriCollisions([])).toEqual([]);
  });
});
