/**
 * MergeShaclGate — open-world / mounted-scope SHACL merge-gate
 * (RFC 4e4dc453 A2). Reuses ShaclLiteValidator; mounted scope = input
 * filtering + violation post-filtering, never new validation semantics.
 */

import type { Triple } from "../../../../src/infrastructure/sparql/algebra/AlgebraOperation";
import { ShapeRegistry } from "../../../../src/services/ShaclLiteValidator";
import { MergeShaclGate } from "../../../../src/services/sync/MergeShaclGate";

const EXO = "https://exocortex.my/ontology/exo#";
const EMS = "https://exocortex.my/ontology/ems#";
const TYPE = `${EXO}Instance_class`;

const iri = (value: string): { type: "iri"; value: string } => ({
  type: "iri",
  value,
});
const lit = (value: string, datatype?: string): { type: "literal"; value: string; datatype?: string } => ({
  type: "literal",
  value,
  ...(datatype ? { datatype } : {}),
});
const t = (s: string, p: string, o: ReturnType<typeof iri> | ReturnType<typeof lit>): Triple => ({
  subject: iri(s),
  predicate: iri(p),
  object: o,
});

const TASK_CLASS = `${EMS}Task`;
const PROJECT_CLASS = `${EMS}Project`;
const SUBJ = "obsidian://vault/assets/11111111-1111-1111-1111-111111111111.md";

const flatHierarchy = { isSubClassOf: (c: string, p: string): boolean => c === p };

function gateWith(opts: {
  candidate: Triple[];
  context?: Triple[];
  shapes?: ConstructorParameters<typeof ShapeRegistry>[0];
  isMountedRef?: (i: string) => boolean;
}): MergeShaclGate {
  return new MergeShaclGate({
    registry: new ShapeRegistry(opts.shapes ?? [], TYPE),
    hierarchy: flatHierarchy,
    triplesFor: async () => opts.candidate,
    contextTriples: opts.context,
    ...(opts.isMountedRef ? { isMountedRef: opts.isMountedRef } : {}),
  });
}

describe("MergeShaclGate — intrinsic constraints always gate", () => {
  it("minCount violation on the merged asset fails the gate", async () => {
    const gate = gateWith({
      candidate: [t(SUBJ, TYPE, iri(TASK_CLASS))],
      shapes: [
        {
          propertyIRI: `${EMS}Effort_status`,
          domain: [TASK_CLASS],
          minCount: 1,
          severity: "sh:Violation",
        },
      ],
    });
    const verdict = await gate.checkMergedAsset("a.md", "irrelevant");
    expect(verdict.ok).toBe(false);
    expect(verdict.violations[0]).toMatchObject({ constraint: "minCount" });
  });

  it("maxCount (cardinality Single) violation fails the gate", async () => {
    const gate = gateWith({
      candidate: [
        t(SUBJ, TYPE, iri(TASK_CLASS)),
        t(SUBJ, `${EXO}Asset_label`, lit("one")),
        t(SUBJ, `${EXO}Asset_label`, lit("two")),
      ],
      shapes: [
        {
          propertyIRI: `${EXO}Asset_label`,
          domain: [],
          cardinality: "Single",
          severity: "sh:Violation",
        },
      ],
    });
    const verdict = await gate.checkMergedAsset("a.md", "x");
    expect(verdict.ok).toBe(false);
    expect(verdict.violations[0]).toMatchObject({ constraint: "maxCount" });
  });

  it("datatype violation fails the gate (open-world does not apply to literals)", async () => {
    const gate = gateWith({
      candidate: [
        t(SUBJ, TYPE, iri(TASK_CLASS)),
        t(SUBJ, `${EMS}Effort_votes`, lit("not-a-number", "http://www.w3.org/2001/XMLSchema#string")),
      ],
      shapes: [
        {
          propertyIRI: `${EMS}Effort_votes`,
          domain: [],
          range: ["http://www.w3.org/2001/XMLSchema#integer"],
          severity: "sh:Violation",
        },
      ],
    });
    const verdict = await gate.checkMergedAsset("a.md", "x");
    expect(verdict.ok).toBe(false);
    expect(verdict.violations[0]).toMatchObject({ constraint: "datatype" });
  });
});

describe("MergeShaclGate — open-world mounted scope (AC)", () => {
  const REF_UNMOUNTED = "obsidian://vault/22222222-2222-2222-2222-222222222222.md";
  const projectShape = {
    propertyIRI: `${EMS}Effort_parent`,
    domain: [],
    range: [PROJECT_CLASS],
    severity: "sh:Violation" as const,
  };

  it("AC: ref into an unmounted space passes (skipped open-world, not a violation)", async () => {
    const gate = gateWith({
      candidate: [
        t(SUBJ, TYPE, iri(TASK_CLASS)),
        t(SUBJ, `${EMS}Effort_parent`, iri(REF_UNMOUNTED)),
      ],
      context: [], // nothing mounted besides the candidate itself
      shapes: [projectShape],
    });
    const verdict = await gate.checkMergedAsset("a.md", "x");
    expect(verdict.ok).toBe(true);
    expect(verdict.skippedOpenWorld).toBe(1);
  });

  it("mounted ref with the WRONG class fails the gate", async () => {
    const gate = gateWith({
      candidate: [
        t(SUBJ, TYPE, iri(TASK_CLASS)),
        t(SUBJ, `${EMS}Effort_parent`, iri(REF_UNMOUNTED)),
      ],
      // target IS mounted — and is a Task, not the required Project
      context: [t(REF_UNMOUNTED, TYPE, iri(TASK_CLASS))],
      shapes: [projectShape],
    });
    const verdict = await gate.checkMergedAsset("a.md", "x");
    expect(verdict.ok).toBe(false);
    expect(verdict.violations[0]).toMatchObject({
      constraint: "class",
      actualValue: REF_UNMOUNTED,
    });
    expect(verdict.skippedOpenWorld).toBe(0);
  });

  it("mounted ref with the right class passes", async () => {
    const gate = gateWith({
      candidate: [
        t(SUBJ, TYPE, iri(TASK_CLASS)),
        t(SUBJ, `${EMS}Effort_parent`, iri(REF_UNMOUNTED)),
      ],
      context: [t(REF_UNMOUNTED, TYPE, iri(PROJECT_CLASS))],
      shapes: [projectShape],
    });
    const verdict = await gate.checkMergedAsset("a.md", "x");
    expect(verdict.ok).toBe(true);
    expect(verdict.skippedOpenWorld).toBe(0);
  });

  it("uid-key fallback: synth UUID-only ref resolves against a full-path mounted subject", async () => {
    const fullPath =
      "obsidian://vault/assetspaces/ems/22222222-2222-2222-2222-222222222222.md";
    const synthRef = "obsidian://vault/22222222-2222-2222-2222-222222222222.md";
    const gate = gateWith({
      candidate: [
        t(SUBJ, TYPE, iri(TASK_CLASS)),
        t(SUBJ, `${EMS}Effort_parent`, iri(synthRef)),
      ],
      context: [t(fullPath, TYPE, iri(PROJECT_CLASS))],
      shapes: [projectShape],
    });
    const verdict = await gate.checkMergedAsset("a.md", "x");
    expect(verdict.ok).toBe(true);
    expect(verdict.skippedOpenWorld).toBe(0);
  });

  it("explicit isMountedRef override forces the check for an otherwise-unknown ref", async () => {
    const gate = gateWith({
      candidate: [
        t(SUBJ, TYPE, iri(TASK_CLASS)),
        t(SUBJ, `${EMS}Effort_parent`, iri(REF_UNMOUNTED)),
      ],
      shapes: [projectShape],
      isMountedRef: () => true, // caller says: everything is mounted
    });
    const verdict = await gate.checkMergedAsset("a.md", "x");
    expect(verdict.ok).toBe(false); // no type info → genuine violation now
  });

  it("pre-existing context violations never gate the candidate", async () => {
    const OTHER = "obsidian://vault/other/33333333-3333-3333-3333-333333333333.md";
    const gate = gateWith({
      candidate: [t(SUBJ, TYPE, iri(TASK_CLASS))],
      // context asset violates minCount — not this merge's fault
      context: [t(OTHER, TYPE, iri(TASK_CLASS))],
      shapes: [
        {
          propertyIRI: `${EMS}Effort_status`,
          domain: [TASK_CLASS],
          minCount: 1,
          severity: "sh:Violation",
        },
      ],
    });
    const verdict = await gate.checkMergedAsset("a.md", "x");
    // the candidate itself also violates minCount here — give it a status
    // via a second variant to isolate the context filtering:
    expect(verdict.violations.every((v) => v.focusNode === SUBJ)).toBe(true);
  });
});
