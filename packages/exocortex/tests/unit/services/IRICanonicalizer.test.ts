import { IRICanonicalizer } from "../../../src/services/IRICanonicalizer";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { BlankNode } from "../../../src/domain/models/rdf/BlankNode";
import { Triple } from "../../../src/domain/models/rdf/Triple";

describe("IRICanonicalizer (Issue #3286)", () => {
  const UID = "fb3d12b2-9552-4866-a31e-2b5f65ea433c";
  const SYNTH_A = `obsidian://vault/${UID}.md`;
  const CANONICAL = `obsidian://vault/assetspaces/shared-identities/${UID}.md`;
  const ALT_CANONICAL = `obsidian://vault/03%20Knowledge/${UID}.md`;

  const PROTOTYPE_PREDICATE = new IRI(
    "https://exocortex.my/ontology/exo#Asset_prototype",
  );
  const LABEL_PREDICATE = new IRI(
    "https://exocortex.my/ontology/exo#Asset_label",
  );

  describe("SYNTH_A_IRI_PATTERN detection", () => {
    it("matches a synth-A IRI (basename only, no subdirectory)", () => {
      expect(IRICanonicalizer.SYNTH_A_IRI_PATTERN.test(SYNTH_A)).toBe(true);
    });

    it("does NOT match a full-path IRI (has subdirectory)", () => {
      expect(IRICanonicalizer.SYNTH_A_IRI_PATTERN.test(CANONICAL)).toBe(false);
    });

    it("does NOT match an IRI with leading subdirectory segment", () => {
      expect(
        IRICanonicalizer.SYNTH_A_IRI_PATTERN.test(
          `obsidian://vault/foo/${UID}.md`,
        ),
      ).toBe(false);
    });

    it("does NOT match an IRI missing the .md suffix", () => {
      expect(
        IRICanonicalizer.SYNTH_A_IRI_PATTERN.test(`obsidian://vault/${UID}`),
      ).toBe(false);
    });

    it("is case-insensitive on the UUID hex but extracts lowercased UID", () => {
      const mixedCase = `obsidian://vault/${UID.toUpperCase()}.md`;
      expect(IRICanonicalizer.extractSynthAUid(mixedCase)).toBe(UID);
    });

    it("extractSynthAUid returns null for non-synth-A IRIs", () => {
      expect(IRICanonicalizer.extractSynthAUid(CANONICAL)).toBeNull();
      expect(
        IRICanonicalizer.extractSynthAUid("https://example.com/foo"),
      ).toBeNull();
    });
  });

  describe("canonicalize — remap behaviour", () => {
    it("remaps synth-A IRI subject to canonical full-path IRI", () => {
      const triples = [
        new Triple(
          new IRI(SYNTH_A),
          LABEL_PREDICATE,
          new Literal("Test prototype"),
        ),
      ];
      const map = new Map([[UID, CANONICAL]]);

      const result = IRICanonicalizer.canonicalize(triples, map);

      expect(result.remapCount).toBe(1);
      expect(result.uniqueRemapCount).toBe(1);
      expect(result.triples).toHaveLength(1);
      const subject = result.triples[0].subject;
      expect(subject).toBeInstanceOf(IRI);
      expect((subject as IRI).value).toBe(CANONICAL);
    });

    it("remaps synth-A IRI object to canonical full-path IRI", () => {
      const taskIri = new IRI(
        `obsidian://vault/assetspaces/ems/some-task-${UID}.md`,
      );
      const triples = [
        new Triple(taskIri, PROTOTYPE_PREDICATE, new IRI(SYNTH_A)),
      ];
      const map = new Map([[UID, CANONICAL]]);

      const result = IRICanonicalizer.canonicalize(triples, map);

      expect(result.remapCount).toBe(1);
      const obj = result.triples[0].object;
      expect(obj).toBeInstanceOf(IRI);
      expect((obj as IRI).value).toBe(CANONICAL);
    });

    it("remaps both subject and object when both are synth-A and counts as one triple", () => {
      const otherUid = "11111111-2222-3333-4444-555555555555";
      const otherSynth = `obsidian://vault/${otherUid}.md`;
      const otherCanonical = `obsidian://vault/assetspaces/ims/${otherUid}.md`;

      const triples = [
        new Triple(
          new IRI(SYNTH_A),
          PROTOTYPE_PREDICATE,
          new IRI(otherSynth),
        ),
      ];
      const map = new Map([
        [UID, CANONICAL],
        [otherUid, otherCanonical],
      ]);

      const result = IRICanonicalizer.canonicalize(triples, map);

      expect(result.remapCount).toBe(1);
      expect(result.uniqueRemapCount).toBe(2);
      expect((result.triples[0].subject as IRI).value).toBe(CANONICAL);
      expect((result.triples[0].object as IRI).value).toBe(otherCanonical);
    });

    it("returns input array unchanged when UID is not in the map", () => {
      const triples = [
        new Triple(
          new IRI(SYNTH_A),
          LABEL_PREDICATE,
          new Literal("orphan synth-A"),
        ),
      ];
      const emptyMap = new Map<string, string>();

      const result = IRICanonicalizer.canonicalize(triples, emptyMap);

      expect(result.remapCount).toBe(0);
      expect(result.uniqueRemapCount).toBe(0);
      expect(result.triples).toBe(triples); // identity short-circuit
    });

    it("no-op when triples contain only canonical full-path IRIs", () => {
      const triples = [
        new Triple(
          new IRI(CANONICAL),
          LABEL_PREDICATE,
          new Literal("canonical only"),
        ),
      ];
      const map = new Map([[UID, CANONICAL]]);

      const result = IRICanonicalizer.canonicalize(triples, map);

      expect(result.remapCount).toBe(0);
      // Triples reference must be preserved for unchanged rows.
      expect(result.triples[0]).toBe(triples[0]);
    });

    it("never remaps Literal objects (bare-UUID dual-storage from Issue #3353)", () => {
      // The bare literal form of the same UID is emitted by NoteToRDFConverter
      // alongside the IRI form; it is a join key for #3353, not a file reference.
      const triples = [
        new Triple(
          new IRI(`obsidian://vault/some/task-${UID}.md`),
          PROTOTYPE_PREDICATE,
          new Literal(UID),
        ),
      ];
      const map = new Map([[UID, CANONICAL]]);

      const result = IRICanonicalizer.canonicalize(triples, map);

      expect(result.remapCount).toBe(0);
      expect(result.triples[0].object).toBeInstanceOf(Literal);
      expect((result.triples[0].object as Literal).value).toBe(UID);
    });

    it("never remaps BlankNode atoms", () => {
      const bnode = new BlankNode("b0");
      const triples = [
        new Triple(bnode, LABEL_PREDICATE, new Literal("anonymous")),
      ];
      const map = new Map([[UID, CANONICAL]]);

      const result = IRICanonicalizer.canonicalize(triples, map);

      expect(result.remapCount).toBe(0);
      expect(result.triples[0].subject).toBe(bnode);
    });

    it("never remaps predicates even when a synth-A-shaped IRI is supplied", () => {
      // Predicates are namespace IRIs in practice — the SPARQL prefixes are
      // http(s) schemes, so synth-A predicates never occur. This test pins
      // the API contract: predicates are pass-through by design.
      const triples = [
        new Triple(
          new IRI(SYNTH_A),
          LABEL_PREDICATE,
          new Literal("subject only"),
        ),
      ];
      const map = new Map([[UID, CANONICAL]]);

      const result = IRICanonicalizer.canonicalize(triples, map);

      expect(result.triples[0].predicate).toBe(LABEL_PREDICATE);
    });

    it("preserves identity for triples that don't need remapping (efficient pass-through)", () => {
      const unchanged = new Triple(
        new IRI(CANONICAL),
        LABEL_PREDICATE,
        new Literal("untouched"),
      );
      const changed = new Triple(
        new IRI(SYNTH_A),
        LABEL_PREDICATE,
        new Literal("touched"),
      );
      const triples = [unchanged, changed];
      const map = new Map([[UID, CANONICAL]]);

      const result = IRICanonicalizer.canonicalize(triples, map);

      expect(result.remapCount).toBe(1);
      expect(result.triples[0]).toBe(unchanged); // unchanged ref kept
      expect(result.triples[1]).not.toBe(changed); // changed = new Triple
    });

    it("memoises new IRI instances per canonical value", () => {
      // Both triples reference the same synth-A IRI; the canonicalizer
      // should allocate one new IRI instance and reuse it.
      const t1 = new Triple(
        new IRI(SYNTH_A),
        LABEL_PREDICATE,
        new Literal("first"),
      );
      const t2 = new Triple(
        new IRI(SYNTH_A),
        LABEL_PREDICATE,
        new Literal("second"),
      );
      const map = new Map([[UID, CANONICAL]]);

      const result = IRICanonicalizer.canonicalize([t1, t2], map);

      expect(result.remapCount).toBe(2);
      expect(result.uniqueRemapCount).toBe(1);
      // Same IRI object reused across both remapped triples.
      expect(result.triples[0].subject).toBe(result.triples[1].subject);
    });

    it("no-op fast-path when the lookup map is empty", () => {
      const triples = [
        new Triple(
          new IRI(SYNTH_A),
          LABEL_PREDICATE,
          new Literal("would-have-been-remapped"),
        ),
      ];
      const result = IRICanonicalizer.canonicalize(
        triples,
        new Map<string, string>(),
      );

      expect(result.remapCount).toBe(0);
      expect(result.triples).toBe(triples);
    });

    it("documents primary-first precedence: caller-controlled map already encodes the choice", () => {
      // The canonicalizer is map-driven; if the caller's map encodes the
      // primary-first precedence (e.g. primary's full-path wins over
      // an archive sibling), the canonicalizer uses whatever was stored.
      // This test pins behaviour: only the map value matters.
      const triples = [
        new Triple(new IRI(SYNTH_A), LABEL_PREDICATE, new Literal("x")),
      ];

      // Map records the alt canonical (e.g. archive vault's path).
      const map = new Map([[UID, ALT_CANONICAL]]);

      const result = IRICanonicalizer.canonicalize(triples, map);

      expect((result.triples[0].subject as IRI).value).toBe(ALT_CANONICAL);
    });
  });
});
