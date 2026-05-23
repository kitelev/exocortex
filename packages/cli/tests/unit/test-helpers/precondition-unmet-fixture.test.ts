/**
 * Unit tests for the integration-layer `precondition-unmet-fixture.ts`
 * classifier + triple synthesiser.
 *
 * RFC v4 §12 PR-readiness gate: every helper under
 * `tests/integration/**\/test-helpers/` MUST have a matching unit test. This
 * pair covers `tests/integration/commands/test-helpers/precondition-unmet-fixture.ts`.
 *
 * Strategy: drive the classifier with the *literal SPARQL bodies* observed in
 * the 23 active-command preconditions in the starter-kit submodule, plus a
 * handful of negative / edge cases. The integration suite depends on the
 * classifier covering every shape the submodule emits — silent mis-classification
 * would leave preconditions unasserted, which §12 calls out explicitly as the
 * "silent-zero" failure mode we defend against.
 */
import { describe, it, expect } from "@jest/globals";
import {
  classifyPreconditionUnmet,
  expandToken,
} from "../../integration/commands/test-helpers/precondition-unmet-fixture.js";

// ---------------------------------------------------------------------------
// expandToken — prefix expansion primitive
// ---------------------------------------------------------------------------

describe("expandToken", () => {
  const prefixes = new Map([
    ["ems", "https://exocortex.my/ontology/ems#"],
    ["exo", "https://exocortex.my/ontology/exo#"],
  ]);

  it("expands prefix:local to absolute IRI", () => {
    expect(expandToken("ems:Effort_status", prefixes)).toBe(
      "https://exocortex.my/ontology/ems#Effort_status",
    );
  });

  it("unwraps angle-bracketed absolute IRIs", () => {
    expect(
      expandToken("<https://exocortex.my/ontology/ems#EffortStatusToDo>", prefixes),
    ).toBe("https://exocortex.my/ontology/ems#EffortStatusToDo");
  });

  it("returns undefined for SPARQL variables", () => {
    expect(expandToken("?v", prefixes)).toBeUndefined();
    expect(expandToken("$target", prefixes)).toBeUndefined();
  });

  it("returns undefined for unknown prefix", () => {
    expect(expandToken("unknown:Thing", prefixes)).toBeUndefined();
  });

  it("returns undefined for bare local name", () => {
    expect(expandToken("Effort_status", prefixes)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Shape 1 — always-met
// ---------------------------------------------------------------------------

describe("classifyPreconditionUnmet — shape 1 (always-met)", () => {
  it("recognises ASK { } as always-met (no unmet state)", () => {
    const result = classifyPreconditionUnmet("ASK { }");
    expect(result.kind).toBe("always-met");
    expect(result.materialiseTriples).toBeUndefined();
  });

  it("recognises multi-line ASK { } (starter-kit literal form)", () => {
    const result = classifyPreconditionUnmet(`ASK {
}`);
    expect(result.kind).toBe("always-met");
  });
});

// ---------------------------------------------------------------------------
// Shape 2 — empty-store (EXISTS property binding)
// ---------------------------------------------------------------------------

describe("classifyPreconditionUnmet — shape 2 (exists-bgp → empty-store)", () => {
  it("handles $target <P> ?v shape (Has start timestamp)", () => {
    const ask = `
      PREFIX ems: <https://exocortex.my/ontology/ems#>
      ASK {
        $target ems:Effort_startTimestamp ?ts .
      }
    `;
    const result = classifyPreconditionUnmet(ask);
    expect(result.kind).toBe("empty-store");
    expect(result.materialiseTriples).toBeUndefined();
  });

  it("handles $target <P> ?v with FILTER (Is not a project)", () => {
    const ask = `
      PREFIX exo: <https://exocortex.my/ontology/exo#>
      PREFIX ems: <https://exocortex.my/ontology/ems#>
      ASK {
        $target exo:Instance_class ?c .
        FILTER(?c != ems:Project)
      }
    `;
    const result = classifyPreconditionUnmet(ask);
    expect(result.kind).toBe("empty-store");
  });

  it("handles zone-filter shape (Set Criticality High)", () => {
    const ask = `
      PREFIX ems: <https://exocortex.my/ontology/ems#>
      ASK {
        $target ems:Task_zone ?z .
        FILTER(?z != <https://exocortex.my/ontology/ems#e266a2e9-9eb0-431d-b1fe-b95b9d3e9a3f>)
      }
    `;
    const result = classifyPreconditionUnmet(ask);
    expect(result.kind).toBe("empty-store");
  });
});

// ---------------------------------------------------------------------------
// Shape 3 — empty-store (exact-match EXISTS)
// ---------------------------------------------------------------------------

describe("classifyPreconditionUnmet — shape 3 (exists-triple → empty-store)", () => {
  it("handles literal-object BGP (Is in Done status)", () => {
    const ask = `
      PREFIX ems: <https://exocortex.my/ontology/ems#>
      ASK {
        $target ems:Effort_status <https://exocortex.my/ontology/ems#EffortStatusDone> .
      }
    `;
    const result = classifyPreconditionUnmet(ask);
    expect(result.kind).toBe("empty-store");
  });
});

// ---------------------------------------------------------------------------
// Shape 4 — add-triple (FILTER NOT EXISTS)
// ---------------------------------------------------------------------------

describe("classifyPreconditionUnmet — shape 4 (filter-not-exists → add-triple)", () => {
  it("parses Not-in-ToDo-status shape", () => {
    const ask = `
      PREFIX ems: <https://exocortex.my/ontology/ems#>
      ASK {
        FILTER NOT EXISTS {
          $target ems:Effort_status <https://exocortex.my/ontology/ems#EffortStatusToDo> .
        }
      }
    `;
    const result = classifyPreconditionUnmet(ask);
    expect(result.kind).toBe("add-triple");
    expect(result.materialiseTriples).toBeDefined();
    const triples = result.materialiseTriples!("obsidian://vault/test-unmet");
    expect(triples).toHaveLength(1);
    const [t] = triples;
    expect(t.subject.value).toBe("obsidian://vault/test-unmet");
    expect(t.predicate.value).toBe("https://exocortex.my/ontology/ems#Effort_status");
    expect(t.object.value).toBe("https://exocortex.my/ontology/ems#EffortStatusToDo");
  });

  it("parses Not-in-Done-status shape (symmetric status family)", () => {
    const ask = `
      PREFIX ems: <https://exocortex.my/ontology/ems#>
      ASK {
        FILTER NOT EXISTS {
          $target ems:Effort_status <https://exocortex.my/ontology/ems#EffortStatusDone> .
        }
      }
    `;
    const result = classifyPreconditionUnmet(ask);
    expect(result.kind).toBe("add-triple");
    const triples = result.materialiseTriples!("obsidian://vault/target");
    expect(triples).toHaveLength(1);
    expect(triples[0].object.value).toBe(
      "https://exocortex.my/ontology/ems#EffortStatusDone",
    );
  });
});

// ---------------------------------------------------------------------------
// Shape 5 — mixed-bgp-filter-not-exists — empty-store works because outer
// BGP fails to bind before the nested FILTER runs.
// ---------------------------------------------------------------------------

describe("classifyPreconditionUnmet — shape 5 (mixed → empty-store)", () => {
  it("handles Missing-label shape ($target has uid, FILTER NOT EXISTS label)", () => {
    const ask = `
      PREFIX exo: <https://exocortex.my/ontology/exo#>
      ASK {
        $target exo:Asset_uid ?u .
        FILTER NOT EXISTS { $target exo:Asset_label ?l }
      }
    `;
    const result = classifyPreconditionUnmet(ask);
    // Outer $target BGP binds before FILTER — empty store has no binding →
    // ASK=false even though the FILTER would be trivially true.
    expect(result.kind).toBe("empty-store");
  });
});

// ---------------------------------------------------------------------------
// Negative / unknown shapes
// ---------------------------------------------------------------------------

describe("classifyPreconditionUnmet — unknown fallback", () => {
  it("flags malformed ASK (no body)", () => {
    const result = classifyPreconditionUnmet("ASK");
    expect(result.kind).toBe("unknown");
  });

  it("flags ASK without $target mention", () => {
    const ask = `
      PREFIX ems: <https://exocortex.my/ontology/ems#>
      ASK {
        ?s ems:Foo ?v .
      }
    `;
    const result = classifyPreconditionUnmet(ask);
    expect(result.kind).toBe("unknown");
  });

  it("flags filter-not-exists shape with unresolvable prefix", () => {
    const ask = `
      ASK {
        FILTER NOT EXISTS {
          $target unknown:Thing <https://other/#X> .
        }
      }
    `;
    const result = classifyPreconditionUnmet(ask);
    expect(result.kind).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// Aggregate coverage — every literal SPARQL body in the starter-kit submodule
// must resolve to one of the non-unknown kinds. This is the silent-zero
// defence: if the submodule adds a new shape the classifier does not yet
// know, this test fires instead of the integration suite silently skipping.
// ---------------------------------------------------------------------------

describe("classifyPreconditionUnmet — starter-kit corpus coverage", () => {
  // 23 SPARQL ASKs copied verbatim from exocmd/**/*.md at submodule SHA
  // 41fa19bd (Phase 1 submodule pin). The dataset is inlined so the unit
  // test does not fan out into filesystem reads — the integration suite
  // already validates filesystem access via the Phase 2 parametrized run.
  const CORPUS: ReadonlyArray<{ label: string; ask: string; expected: string }> = [
    {
      label: "Always visible",
      ask: "ASK { }",
      expected: "always-met",
    },
    {
      label: "Has start timestamp",
      ask: "PREFIX ems: <https://exocortex.my/ontology/ems#>\nASK { $target ems:Effort_startTimestamp ?ts . }",
      expected: "empty-store",
    },
    {
      label: "Has end timestamp",
      ask: "PREFIX ems: <https://exocortex.my/ontology/ems#>\nASK { $target ems:Effort_endTimestamp ?ts . }",
      expected: "empty-store",
    },
    {
      label: "Has scheduled date",
      ask: "PREFIX ems: <https://exocortex.my/ontology/ems#>\nASK { $target ems:Effort_scheduledDate ?v . }",
      expected: "empty-store",
    },
    {
      label: "Is in Done status",
      ask: "PREFIX ems: <https://exocortex.my/ontology/ems#>\nASK { $target ems:Effort_status <https://exocortex.my/ontology/ems#EffortStatusDone> . }",
      expected: "empty-store",
    },
    {
      label: "Is not a project",
      ask: "PREFIX exo: <https://exocortex.my/ontology/exo#>\nPREFIX ems: <https://exocortex.my/ontology/ems#>\nASK { $target exo:Instance_class ?c . FILTER(?c != ems:Project) }",
      expected: "empty-store",
    },
    {
      label: "Is not a task",
      ask: "PREFIX exo: <https://exocortex.my/ontology/exo#>\nPREFIX ems: <https://exocortex.my/ontology/ems#>\nASK { $target exo:Instance_class ?c . FILTER(?c != ems:Task) }",
      expected: "empty-store",
    },
    {
      label: "Missing label",
      ask: "PREFIX exo: <https://exocortex.my/ontology/exo#>\nASK { $target exo:Asset_uid ?u . FILTER NOT EXISTS { $target exo:Asset_label ?l } }",
      expected: "empty-store",
    },
    {
      label: "Not in Criticality zone High",
      ask: "PREFIX ems: <https://exocortex.my/ontology/ems#>\nASK { $target ems:Task_zone ?z . FILTER(?z != <https://exocortex.my/ontology/ems#e266a2e9-9eb0-431d-b1fe-b95b9d3e9a3f>) }",
      expected: "empty-store",
    },
    {
      label: "Not in Criticality zone Medium",
      ask: "PREFIX ems: <https://exocortex.my/ontology/ems#>\nASK { $target ems:Task_zone ?z . FILTER(?z != <https://exocortex.my/ontology/ems#6968a0fc-7a41-4393-82b1-17d767c7ad7c>) }",
      expected: "empty-store",
    },
    {
      label: "Not in Criticality zone Low",
      ask: "PREFIX ems: <https://exocortex.my/ontology/ems#>\nASK { $target ems:Task_zone ?z . FILTER(?z != <https://exocortex.my/ontology/ems#c7f1a968-0959-4ac7-ac82-31b0cdc2aba7>) }",
      expected: "empty-store",
    },
    // FILTER NOT EXISTS family — 10 "Move to <Status>" preconditions.
    {
      label: "Not in ToDo status",
      ask: "PREFIX ems: <https://exocortex.my/ontology/ems#>\nASK { FILTER NOT EXISTS { $target ems:Effort_status <https://exocortex.my/ontology/ems#EffortStatusToDo> . } }",
      expected: "add-triple",
    },
    {
      label: "Not in Doing status",
      ask: "PREFIX ems: <https://exocortex.my/ontology/ems#>\nASK { FILTER NOT EXISTS { $target ems:Effort_status <https://exocortex.my/ontology/ems#EffortStatusDoing> . } }",
      expected: "add-triple",
    },
    {
      label: "Not in Done status",
      ask: "PREFIX ems: <https://exocortex.my/ontology/ems#>\nASK { FILTER NOT EXISTS { $target ems:Effort_status <https://exocortex.my/ontology/ems#EffortStatusDone> . } }",
      expected: "add-triple",
    },
    {
      label: "Not in Backlog status",
      ask: "PREFIX ems: <https://exocortex.my/ontology/ems#>\nASK { FILTER NOT EXISTS { $target ems:Effort_status <https://exocortex.my/ontology/ems#EffortStatusBacklog> . } }",
      expected: "add-triple",
    },
    {
      label: "Not in Waiting status",
      ask: "PREFIX ems: <https://exocortex.my/ontology/ems#>\nASK { FILTER NOT EXISTS { $target ems:Effort_status <https://exocortex.my/ontology/ems#EffortStatusWaiting> . } }",
      expected: "add-triple",
    },
    {
      label: "Not in Blocked status",
      ask: "PREFIX ems: <https://exocortex.my/ontology/ems#>\nASK { FILTER NOT EXISTS { $target ems:Effort_status <https://exocortex.my/ontology/ems#EffortStatusBlocked> . } }",
      expected: "add-triple",
    },
    {
      label: "Not in Draft status",
      ask: "PREFIX ems: <https://exocortex.my/ontology/ems#>\nASK { FILTER NOT EXISTS { $target ems:Effort_status <https://exocortex.my/ontology/ems#EffortStatusDraft> . } }",
      expected: "add-triple",
    },
    {
      label: "Not in Analysis status",
      ask: "PREFIX ems: <https://exocortex.my/ontology/ems#>\nASK { FILTER NOT EXISTS { $target ems:Effort_status <https://exocortex.my/ontology/ems#EffortStatusAnalysis> . } }",
      expected: "add-triple",
    },
    {
      label: "Not in Review status",
      ask: "PREFIX ems: <https://exocortex.my/ontology/ems#>\nASK { FILTER NOT EXISTS { $target ems:Effort_status <https://exocortex.my/ontology/ems#EffortStatusReview> . } }",
      expected: "add-triple",
    },
    {
      label: "Not in Cancelled status",
      ask: "PREFIX ems: <https://exocortex.my/ontology/ems#>\nASK { FILTER NOT EXISTS { $target ems:Effort_status <https://exocortex.my/ontology/ems#EffortStatusCancelled> . } }",
      expected: "add-triple",
    },
  ];

  for (const entry of CORPUS) {
    it(`${entry.label} → ${entry.expected}`, () => {
      const result = classifyPreconditionUnmet(entry.ask);
      expect(result.kind).toBe(entry.expected);
      if (result.kind === "add-triple") {
        const triples = result.materialiseTriples!("obsidian://vault/x");
        expect(triples.length).toBeGreaterThan(0);
      }
    });
  }

  it("every corpus entry classifies to a non-unknown kind", () => {
    for (const entry of CORPUS) {
      const result = classifyPreconditionUnmet(entry.ask);
      if (result.kind === "unknown") {
        throw new Error(
          `Classifier returned "unknown" for "${entry.label}" — ${result.reason}`,
        );
      }
    }
  });
});
