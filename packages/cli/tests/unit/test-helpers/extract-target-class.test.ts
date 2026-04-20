/**
 * Unit tests for the integration-layer `extract-target-class.ts` helper.
 *
 * Covers the 5-strategy ladder (RFC v4 §7.1a) with in-memory fixtures so the
 * test suite runs without touching the starter-kit submodule. The companion
 * integration self-test (TBD) asserts the aggregate distribution against the
 * real 44-Command catalog.
 */
import { describe, it, expect } from "@jest/globals";
import type { CommandCatalogEntry } from "../../integration/starter-kit/test-helpers/command-catalog.js";
import {
  extractClassFromSparql,
  extractTargetClassFromCommand,
  loadStarterKitContext,
  type StarterKitContext,
  type PreconditionData,
  type GroundingData,
} from "../../integration/starter-kit/test-helpers/extract-target-class.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function ctx(
  overrides: Partial<{
    preconditions: Iterable<readonly [string, PreconditionData]>;
    groundings: Iterable<readonly [string, GroundingData]>;
    classLabelByUuid: Iterable<readonly [string, string]>;
  }> = {},
): StarterKitContext {
  return {
    preconditions: new Map(overrides.preconditions ?? []),
    groundings: new Map(overrides.groundings ?? []),
    classLabelByUuid: new Map(overrides.classLabelByUuid ?? []),
  };
}

function cmd(overrides: Partial<CommandCatalogEntry>): CommandCatalogEntry {
  return {
    uid: overrides.uid ?? "00000000-0000-0000-0000-000000000000",
    label: overrides.label ?? "Test Command",
    path: overrides.path ?? "/fixtures/cmd.md",
    classUuid: overrides.classUuid ?? "790e5b16-251d-4556-96ac-e5c7f1429b2e",
    icon: overrides.icon,
    category: overrides.category,
    grounding: overrides.grounding,
    precondition: overrides.precondition,
    targetClass: overrides.targetClass,
    raw: overrides.raw ?? {},
  };
}

function grounding(overrides: Partial<GroundingData>): GroundingData {
  return {
    uid: overrides.uid ?? "g-1",
    label: overrides.label ?? "g",
    type: overrides.type,
    targetProperty: overrides.targetProperty,
    targetValue: overrides.targetValue,
    serviceId: overrides.serviceId,
    inputSchema: overrides.inputSchema,
    targetClass: overrides.targetClass,
    steps: overrides.steps,
    raw: overrides.raw ?? {},
  };
}

// ---------------------------------------------------------------------------
// extractClassFromSparql — Strategy 2 helper
// ---------------------------------------------------------------------------

describe("extractClassFromSparql", () => {
  it("detects $target rdf:type <ns#Class>", () => {
    const hit = extractClassFromSparql(
      "ASK { $target rdf:type <https://exocortex.my/ontology/ems#Task> . }",
    );
    expect(hit?.class).toBe("Task");
    expect(hit?.reason).toMatch(/rdf:type/);
  });

  it("detects $target a <ns#Class> (shorthand)", () => {
    const hit = extractClassFromSparql(
      "ASK { $target a <https://exocortex.my/ontology/ems#Task> }",
    );
    expect(hit?.class).toBe("Task");
  });

  it("extracts ns__Class from a single property-prefix pattern", () => {
    const hit = extractClassFromSparql(
      "ASK { FILTER NOT EXISTS { $target ems:Effort_status ?x . } }",
    );
    expect(hit?.class).toBe("ems__Effort");
    expect(hit?.reason).toMatch(/property-prefix/);
  });

  it("ignores exo:Instance_class (belongs to S4 pivot)", () => {
    const hit = extractClassFromSparql(
      "ASK { $target exo:Instance_class ?x }",
    );
    expect(hit).toBeUndefined();
  });

  it("returns undefined when multiple distinct classes are mentioned", () => {
    const hit = extractClassFromSparql(
      "ASK { $target ems:Task_zone ?z . $target ems:Effort_status ?s . }",
    );
    expect(hit).toBeUndefined();
  });

  it("detects Task_zone (criticality family)", () => {
    const hit = extractClassFromSparql(
      "ASK { FILTER NOT EXISTS { $target ems:Task_zone ?z . } }",
    );
    expect(hit?.class).toBe("ems__Task");
  });
});

// ---------------------------------------------------------------------------
// Strategy 1 — explicit exocmd__Command_targetClass
// ---------------------------------------------------------------------------

describe("extractTargetClassFromCommand — Strategy 1 (explicit targetClass)", () => {
  it("returns the class for a literal wikilink", () => {
    const result = extractTargetClassFromCommand(
      cmd({ targetClass: "[[ems__Project]]" }),
      ctx(),
    );
    expect(result.strategy).toBe("S1");
    expect(result.targetClass).toBe("ems__Project");
    expect(result.dispatchOnly).toBe(false);
  });

  it("resolves a UUID-form wikilink via classLabelByUuid", () => {
    const CLS_UUID = "11111111-1111-4111-8111-111111111111";
    const result = extractTargetClassFromCommand(
      cmd({ targetClass: `[[${CLS_UUID}|ems__Project]]` }),
      ctx({ classLabelByUuid: [[CLS_UUID, "ems__Project"]] }),
    );
    expect(result.strategy).toBe("S1");
    expect(result.targetClass).toBe("ems__Project");
  });

  it("falls through to later strategies when targetClass UUID is unknown", () => {
    const result = extractTargetClassFromCommand(
      cmd({ targetClass: "[[22222222-2222-4222-8222-222222222222]]" }),
      ctx(), // no reverse index entry
    );
    // No precondition/grounding → S5 fallback.
    expect(result.strategy).toBe("S5");
  });
});

// ---------------------------------------------------------------------------
// Strategy 2 — precondition SPARQL inspection
// ---------------------------------------------------------------------------

describe("extractTargetClassFromCommand — Strategy 2 (precondition SPARQL)", () => {
  it("extracts class from Effort_status precondition", () => {
    const P_UID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const result = extractTargetClassFromCommand(
      cmd({ precondition: `[[${P_UID}|Not in Doing]]` }),
      ctx({
        preconditions: [
          [
            P_UID,
            {
              uid: P_UID,
              label: "Not in Doing",
              sparqlAsk:
                "ASK { FILTER NOT EXISTS { $target ems:Effort_status ?x } }",
            },
          ],
        ],
      }),
    );
    expect(result.strategy).toBe("S2");
    expect(result.targetClass).toBe("ems__Effort");
  });

  it("falls through when precondition has no sparqlAsk (host function)", () => {
    const P_UID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const result = extractTargetClassFromCommand(
      cmd({ precondition: `[[${P_UID}]]` }),
      ctx({
        preconditions: [
          [
            P_UID,
            {
              uid: P_UID,
              label: "Rename",
              hostFunction: "hasNonUidFilename",
            },
          ],
        ],
      }),
    );
    expect(result.strategy).toBe("S5");
  });
});

// ---------------------------------------------------------------------------
// Strategy 3 — grounding targetProperty domain heuristic
// ---------------------------------------------------------------------------

describe("extractTargetClassFromCommand — Strategy 3 (targetProperty domain)", () => {
  it("infers ems__Effort from `ems__Effort_plannedStartTimestamp` grounding", () => {
    const G_UID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const result = extractTargetClassFromCommand(
      cmd({ grounding: `[[${G_UID}]]` }),
      ctx({
        groundings: [
          [
            G_UID,
            grounding({
              uid: G_UID,
              type: "service_call",
              targetProperty: "updateProperty",
              targetValue:
                '{"property":"ems__Effort_plannedStartTimestamp"}',
            }),
          ],
        ],
      }),
    );
    expect(result.strategy).toBe("S3");
    expect(result.targetClass).toBe("ems__Effort");
  });

  it("infers from composite steps targetProperty pool", () => {
    const G_UID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const result = extractTargetClassFromCommand(
      cmd({ grounding: `[[${G_UID}]]` }),
      ctx({
        groundings: [
          [
            G_UID,
            grounding({
              uid: G_UID,
              type: "composite",
              steps: [
                grounding({
                  uid: "s-1",
                  type: "property_set",
                  targetProperty: "ems__Effort_scheduledDate",
                }),
                grounding({
                  uid: "s-2",
                  type: "property_set",
                  targetProperty: "ems__Effort_status",
                }),
              ],
            }),
          ],
        ],
      }),
    );
    expect(result.strategy).toBe("S3");
    expect(result.targetClass).toBe("ems__Effort");
  });

  it("returns undefined when composite spans multiple classes (falls through)", () => {
    const G_UID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const result = extractTargetClassFromCommand(
      cmd({ grounding: `[[${G_UID}]]` }),
      ctx({
        groundings: [
          [
            G_UID,
            grounding({
              uid: G_UID,
              type: "composite",
              steps: [
                grounding({
                  uid: "s-1",
                  type: "property_set",
                  targetProperty: "ems__Effort_status",
                }),
                grounding({
                  uid: "s-2",
                  type: "property_set",
                  targetProperty: "exo__Asset_uid",
                }),
              ],
            }),
          ],
        ],
      }),
    );
    expect(result.strategy).toBe("S5");
  });
});

// ---------------------------------------------------------------------------
// Strategy 4 — class-flip pivot (Convert commands)
// ---------------------------------------------------------------------------

describe("extractTargetClassFromCommand — Strategy 4 (class-flip)", () => {
  it("Convert to Task → fixture pre-flip is ems__Project", () => {
    const G_UID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const result = extractTargetClassFromCommand(
      cmd({ grounding: `[[${G_UID}]]` }),
      ctx({
        groundings: [
          [
            G_UID,
            grounding({
              uid: G_UID,
              type: "service_call",
              targetProperty: "updateProperty",
              targetValue: `"[[ems__Task]]"`,
            }),
          ],
        ],
      }),
    );
    expect(result.strategy).toBe("S4");
    expect(result.targetClass).toBe("ems__Project");
  });

  it("Convert to Project → fixture pre-flip is ems__Task", () => {
    const G_UID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const result = extractTargetClassFromCommand(
      cmd({ grounding: `[[${G_UID}]]` }),
      ctx({
        groundings: [
          [
            G_UID,
            grounding({
              uid: G_UID,
              type: "service_call",
              targetProperty: "updateProperty",
              targetValue: `"[[ems__Project]]"`,
            }),
          ],
        ],
      }),
    );
    expect(result.strategy).toBe("S4");
    expect(result.targetClass).toBe("ems__Task");
  });

  it("resolves UUID-wikilink targetValue via classLabelByUuid", () => {
    const G_UID = "11111111-2222-4333-8444-555555555555";
    const TASK_UID = "df7e579d-02d4-4f3a-971f-3d1d785b689b";
    const result = extractTargetClassFromCommand(
      cmd({ grounding: `[[${G_UID}]]` }),
      ctx({
        groundings: [
          [
            G_UID,
            grounding({
              uid: G_UID,
              type: "service_call",
              targetProperty: "updateProperty",
              targetValue: `[[${TASK_UID}]]`,
            }),
          ],
        ],
        classLabelByUuid: [[TASK_UID, "ems__Task"]],
      }),
    );
    expect(result.strategy).toBe("S4");
    expect(result.targetClass).toBe("ems__Project");
  });

  it("other-class flip falls back to ems__Effort (broadest pre-flip)", () => {
    const G_UID = "22222222-3333-4444-8555-666666666666";
    const result = extractTargetClassFromCommand(
      cmd({ grounding: `[[${G_UID}]]` }),
      ctx({
        groundings: [
          [
            G_UID,
            grounding({
              uid: G_UID,
              type: "service_call",
              targetProperty: "updateProperty",
              targetValue: `"[[ems__Area]]"`,
            }),
          ],
        ],
      }),
    );
    expect(result.strategy).toBe("S4");
    expect(result.targetClass).toBe("ems__Effort");
  });
});

// ---------------------------------------------------------------------------
// Strategy 5 — fallback
// ---------------------------------------------------------------------------

describe("extractTargetClassFromCommand — Strategy 5 (fallback)", () => {
  it("returns ems__Task + dispatchOnly=true when nothing resolves", () => {
    const result = extractTargetClassFromCommand(cmd({}), ctx());
    expect(result.strategy).toBe("S5");
    expect(result.targetClass).toBe("ems__Task");
    expect(result.dispatchOnly).toBe(true);
  });

  it("returns fallback when grounding resolves but has no property hints", () => {
    const G_UID = "aaaabbbb-cccc-4ddd-8eee-ffff00000000";
    const result = extractTargetClassFromCommand(
      cmd({ grounding: `[[${G_UID}]]` }),
      ctx({
        groundings: [
          [
            G_UID,
            grounding({
              uid: G_UID,
              type: "service_call",
              serviceId: "cleanProperties",
            }),
          ],
        ],
      }),
    );
    expect(result.strategy).toBe("S5");
    expect(result.dispatchOnly).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// loadStarterKitContext — DI paths
// ---------------------------------------------------------------------------

describe("loadStarterKitContext", () => {
  it("returns empty maps for an empty fixture set", () => {
    const result = loadStarterKitContext({
      fixturesRoot: "/none",
      listMarkdownFiles: () => [],
      readFile: () => "",
    });
    expect(result.preconditions.size).toBe(0);
    expect(result.groundings.size).toBe(0);
    expect(result.classLabelByUuid.size).toBe(0);
  });

  it("indexes a class definition via exo__Class UUID", () => {
    const CLS_UID = "8619c4fc-64f1-4869-b17e-e34186cacca9";
    const THIS_UID = "99999999-9999-4999-8999-999999999999";
    const files = {
      "/mock/cls.md": [
        "---",
        `exo__Asset_uid: ${THIS_UID}`,
        `exo__Asset_label: "ems__Project"`,
        `exo__Instance_class:`,
        `  - "[[${CLS_UID}]]"`,
        "---",
      ].join("\n"),
    };
    const ctxOut = loadStarterKitContext({
      fixturesRoot: "/mock",
      listMarkdownFiles: () => Object.keys(files),
      readFile: (p) => files[p as keyof typeof files],
    });
    expect(ctxOut.classLabelByUuid.get(THIS_UID)).toBe("ems__Project");
  });

  it("indexes a precondition asset with sparqlAsk", () => {
    const PRE_CLS = "15d119b5-9636-431e-9e91-1f140107d059";
    const THIS_UID = "88888888-8888-4888-8888-888888888888";
    const files = {
      "/mock/pre.md": [
        "---",
        `exo__Asset_uid: ${THIS_UID}`,
        `exo__Asset_label: "Not in Done"`,
        `exo__Instance_class:`,
        `  - "[[${PRE_CLS}]]"`,
        `exocmd__Precondition_sparqlAsk: "ASK { $target ems:Effort_status ?s }"`,
        "---",
      ].join("\n"),
    };
    const ctxOut = loadStarterKitContext({
      fixturesRoot: "/mock",
      listMarkdownFiles: () => Object.keys(files),
      readFile: (p) => files[p as keyof typeof files],
    });
    const pre = ctxOut.preconditions.get(THIS_UID);
    expect(pre?.sparqlAsk).toMatch(/ems:Effort_status/);
    expect(pre?.label).toBe("Not in Done");
  });

  it("resolves composite grounding steps across files", () => {
    const G_CLS = "11579feb-2e42-491c-af59-b89b1129a539";
    const PARENT = "cafe0000-0000-4000-8000-aaaa00000000";
    const STEP_A = "cafe0000-0000-4000-8000-aaaa00000001";
    const files = {
      "/mock/parent.md": [
        "---",
        `exo__Asset_uid: ${PARENT}`,
        `exo__Asset_label: "Composite"`,
        `exo__Instance_class:`,
        `  - "[[${G_CLS}]]"`,
        `exocmd__Grounding_type: composite`,
        `exocmd__Grounding_steps:`,
        `  - "[[${STEP_A}|Step A]]"`,
        "---",
      ].join("\n"),
      "/mock/step-a.md": [
        "---",
        `exo__Asset_uid: ${STEP_A}`,
        `exo__Asset_label: "Step A"`,
        `exo__Instance_class:`,
        `  - "[[${G_CLS}]]"`,
        `exocmd__Grounding_type: property_set`,
        `exocmd__Grounding_targetProperty: "ems__Effort_status"`,
        "---",
      ].join("\n"),
    };
    const ctxOut = loadStarterKitContext({
      fixturesRoot: "/mock",
      listMarkdownFiles: () => Object.keys(files),
      readFile: (p) => files[p as keyof typeof files],
    });
    const parent = ctxOut.groundings.get(PARENT);
    expect(parent?.type).toBe("composite");
    expect(parent?.steps).toHaveLength(1);
    expect(parent?.steps?.[0]?.targetProperty).toBe("ems__Effort_status");
  });

  it("skips files that fail to read or parse without throwing", () => {
    const PRE_CLS = "15d119b5-9636-431e-9e91-1f140107d059";
    const files = {
      "/mock/broken.md": "---\nbad: yaml: here\n---",
      "/mock/ok.md": [
        "---",
        `exo__Asset_uid: 77777777-7777-4777-8777-777777777777`,
        `exo__Asset_label: "OK"`,
        `exo__Instance_class:`,
        `  - "[[${PRE_CLS}]]"`,
        `exocmd__Precondition_sparqlAsk: "ASK { $target rdf:type <http://x#Y> }"`,
        "---",
      ].join("\n"),
    };
    const ctxOut = loadStarterKitContext({
      fixturesRoot: "/mock",
      listMarkdownFiles: () => Object.keys(files),
      readFile: (p) => {
        if (!(p in files)) throw new Error("missing");
        return files[p as keyof typeof files];
      },
    });
    expect(ctxOut.preconditions.size).toBe(1);
  });
});
