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

/**
 * `<asset> exo:Asset_label <obsidian://…/uid.md>` — what a label written as a
 * WIKILINK emits: the converter returns the target's FILE IRI, which is an IRI
 * like any other. Three live assets do exactly this, so `instanceof IRI` alone
 * cannot be the "is a term IRI" test.
 */
const labelledWithFileIri = (uid: string, targetUid: string): Triple =>
  new Triple(
    asset(uid),
    new IRI(LABEL),
    new IRI(
      `obsidian://vault/assetspaces/kitelev/exoas-exocmd/exocmd/${targetUid}.md`,
    ),
  );

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
    // ⛔ Each entry names the OTHER emitters and NEVER itself. Checking one entry
    // is not enough: with sorted emitters, an entry that wrongly includes itself
    // is only detectable on the one where self does NOT sort last (a trailing-comma
    // assertion silently passes on the last). Both entries are therefore asserted.
    for (const v of found) {
      const others = found
        .map((o) => o.focusNode)
        .filter((f) => f !== v.focusNode);
      const listed = v.message.split("Also emitted by: ")[1] ?? "";
      expect(listed).not.toContain(v.focusNode);
      for (const other of others) expect(listed).toContain(other);
    }
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

  /**
   * ⛔ The discriminator is `Namespace.fromTermIRI`, NOT `instanceof IRI`.
   * A label written as a wikilink emits the target's FILE IRI — an IRI that is
   * never used as a predicate, so the message ("a join from a predicate to its
   * definition resolves to all of them") would be factually false for it. Three
   * live assets in vault-my share one such file IRI; before this guard they made
   * up 3 of 7 reported entries.
   */
  it(`${REQ} does NOT report a shared FILE IRI (wikilink label), only real term IRIs`, () => {
    const found = detectTermIriCollisions([
      labelledWithFileIri("8816b3c7", "ecd68426"),
      labelledWithFileIri("78c05b6b", "ecd68426"),
      labelledWithFileIri("c82ef048", "ecd68426"),
    ]);

    expect(found).toEqual([]);
  });

  it(`${REQ} still reports real term IRIs when file-IRI labels are present`, () => {
    const found = detectTermIriCollisions([
      labelledWithFileIri("8816b3c7", "ecd68426"),
      labelledWithFileIri("78c05b6b", "ecd68426"),
      labelledWithIri("9d2128de", OWL_SAME_AS),
      labelledWithIri("3c6240a5", OWL_SAME_AS),
    ]);

    expect(iris(found)).toEqual([OWL_SAME_AS]);
    expect(found).toHaveLength(2);
  });

  /**
   * A blank-node co-emitter still makes the term ambiguous, so it must COUNT —
   * but it cannot anchor an entry a reader could open. Filtering it out before
   * counting (the earlier shape) suppressed the report for the addressable asset
   * too, which is the half that is actionable.
   */
  it(`${REQ} counts a blank-node co-emitter but reports only the addressable one`, () => {
    const blank = { value: "b0" } as unknown as IRI; // not a DomainIRI instance
    const found = detectTermIriCollisions([
      labelledWithIri("addressable", OWL_SAME_AS),
      new Triple(blank, new IRI(LABEL), new IRI(OWL_SAME_AS)),
    ]);

    expect(found).toHaveLength(1);
    expect(found[0]!.focusNode).toBe(asset("addressable").value);
    expect(found[0]!.message).toContain("2 assets");
  });
});

/**
 * The collisions are folded into the report BEFORE `filterReportToStagedFocusNodes`
 * and `applyLegacyExceptionFilter`, so that `--staged` scopes them like any other
 * finding. Review measured the earlier shape (append AFTER the filters) emitting
 * warnings for untouched files on every pre-commit run in a vault with pre-existing
 * collisions. These axes pin the two properties that makes the new placement correct.
 *
 * The vaults here are git-free, so `--staged` cannot be exercised end-to-end on live
 * data; the real filter is therefore driven directly.
 */
describe("collision warnings under the report filters", () => {
  const REQ2 = "@req:00e8079e-fb36-4ce3-b33f-abb18c212143";
  const OWL = "http://www.w3.org/2002/07/owl#sameAs";

  const collisionsFor = (uids: string[]): Violation[] =>
    detectTermIriCollisions(uids.map((u) => labelledWithIri(u, OWL)));

  it(`${REQ2} --staged keeps only the emitters that are staged`, async () => {
    const { filterReportToStagedFocusNodes } =
      await import("../../../src/commands/validate-schema.js");
    const violations = collisionsFor(["A", "B"]);
    expect(violations).toHaveLength(2); // canary: the filter has something to drop

    const stagedA = "assetspaces/kitelev/exoas-x/x/A.md";
    const filtered = filterReportToStagedFocusNodes(
      { conforms: true, violations },
      new Set([stagedA]),
    );

    // introducing a collision still surfaces (the staged file is itself an emitter)
    expect(filtered.violations).toHaveLength(1);
    expect(filtered.violations[0]!.focusNode).toContain("A.md");
    // …and the untouched co-emitter no longer nags on every unrelated commit
    expect(filtered.violations.some((v) => v.focusNode.includes("B.md"))).toBe(
      false,
    );
  });

  it(`${REQ2} --staged drops collisions entirely when no emitter is staged`, async () => {
    const { filterReportToStagedFocusNodes } =
      await import("../../../src/commands/validate-schema.js");
    const violations = collisionsFor(["A", "B"]);
    const filtered = filterReportToStagedFocusNodes(
      { conforms: true, violations },
      new Set(["assetspaces/kitelev/exoas-x/x/UNRELATED.md"]),
    );

    expect(filtered.violations).toEqual([]);
  });

  it(`${REQ2} passing through a filter never flips conforms (warnings only)`, async () => {
    const { filterReportToStagedFocusNodes } =
      await import("../../../src/commands/validate-schema.js");
    const violations = collisionsFor(["A", "B"]);
    const filtered = filterReportToStagedFocusNodes(
      { conforms: true, violations },
      new Set(["assetspaces/kitelev/exoas-x/x/A.md"]),
    );

    expect(filtered.violations.length).toBeGreaterThan(0);
    expect(filtered.conforms).toBe(true);
  });
});

/**
 * ORDERING axis. The three axes above drive `filterReportToStagedFocusNodes`
 * directly, so they cannot see WHERE the collisions are folded in — a mutant that
 * moves the append back after the filters leaves them green. `assembleShapesReport`
 * exists to make that ordering observable.
 */
describe("assembleShapesReport ordering", () => {
  const REQ3 = "@req:00e8079e-fb36-4ce3-b33f-abb18c212143";
  const OWL = "http://www.w3.org/2002/07/owl#sameAs";

  it(`${REQ3} collisions go THROUGH the staged filter, not around it`, async () => {
    const { assembleShapesReport } =
      await import("../../../src/commands/validate-schema.js");
    const triples = [labelledWithIri("A", OWL), labelledWithIri("B", OWL)];
    const empty = { conforms: true, violations: [] };

    // canary: without a staged filter both emitters are reported
    const unfiltered = assembleShapesReport(empty, triples, null);
    expect(
      unfiltered.violations.filter(
        (v: Violation) => v.constraint === "term-iri-collision",
      ),
    ).toHaveLength(2);

    // with only A staged, exactly A survives — proving the append happens BEFORE
    // the filter. Appending afterwards yields 2 here.
    const staged = assembleShapesReport(
      empty,
      triples,
      new Set(["assetspaces/kitelev/exoas-x/x/A.md"]),
    );
    const collisions = staged.violations.filter(
      (v: Violation) => v.constraint === "term-iri-collision",
    );
    expect(collisions).toHaveLength(1);
    expect(collisions[0]!.focusNode).toContain("A.md");
    expect(staged.conforms).toBe(true);
  });
});

/**
 * Two axes closing mutants that survived the round-2 review.
 *
 * ⛔ Both existed as CLAIMS before they existed as tests, which is the failure mode
 * this file is supposed to prevent: the docstring asserted "dropping either half has
 * its own reddening axis" while dropping `instanceof DomainIRI` reddened nothing, and
 * the ordering axis pinned only the staged filter, so moving the append BETWEEN the
 * two filters passed the whole suite while live-reproducing half the original bug.
 */
describe("guards that were asserted before they were tested", () => {
  const REQ4 = "@req:00e8079e-fb36-4ce3-b33f-abb18c212143";
  const OWL = "http://www.w3.org/2002/07/owl#sameAs";
  const LEGACY_EXCEPTION =
    "https://exocortex.my/ontology/exo#Asset_legacyValidationException";

  /**
   * `instanceof DomainIRI` is load-bearing SEPARATELY from `fromTermIRI`: a literal
   * whose TEXT happens to be a term IRI must not be reported — a literal never
   * participates in a "predicate → definition" join. Live exposure is zero today
   * (no IRI-shaped literal labels in either vault), which is exactly why it needs a
   * fixture rather than a live measurement.
   */
  it(`${REQ4} does NOT report LITERAL labels whose text looks like a term IRI`, () => {
    const found = detectTermIriCollisions([
      labelledWithLiteral("p", "https://exocortex.my/ontology/lit#WebPage_url"),
      labelledWithLiteral("q", "https://exocortex.my/ontology/lit#WebPage_url"),
    ]);

    expect(found).toEqual([]);
  });

  /**
   * The ordering axis above pins the STAGED filter only. Moving the append to sit
   * between the two filters keeps collisions flowing into the staged filter and so
   * stays green there — while a legacy-exempted asset starts being reported again.
   * Verified live by review: that one-line move yields 2 emitters where HEAD yields 1.
   */
  it(`${REQ4} collisions go THROUGH the legacy-exception filter too`, async () => {
    const { assembleShapesReport } =
      await import("../../../src/commands/validate-schema.js");
    const triples = [
      labelledWithIri("A", OWL),
      labelledWithIri("B", OWL),
      // A is grandfathered — its findings, collisions included, must be dropped
      new Triple(asset("A"), new IRI(LEGACY_EXCEPTION), new Literal("true")),
    ];

    const assembled = assembleShapesReport(
      { conforms: true, violations: [] },
      triples,
      null,
    );
    const collisions = assembled.violations.filter(
      (v: Violation) => v.constraint === "term-iri-collision",
    );

    // canary: without the exemption both emitters are reported
    const both = detectTermIriCollisions([
      labelledWithIri("A", OWL),
      labelledWithIri("B", OWL),
    ]);
    expect(both).toHaveLength(2);

    expect(collisions).toHaveLength(1);
    expect(collisions[0]!.focusNode).toContain("B.md");
  });
});
