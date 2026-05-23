/**
 * Unit tests for the integration-layer `predict-mutation.ts` helper.
 *
 * RFC v4 §7.1b branch-count gate: the predictor must stay within 5 per-command
 * special-case branches. A dedicated test case (`"audit: per-command branch
 * count"`) fails if a reviewer adds a 6th branch without reopening the RFC.
 */
import { describe, it, expect } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { GroundingType } from "exocortex";
import type { GroundingDefinition } from "exocortex";
import {
  extractClassFromTargetValue,
  matchMutation,
  predictMutationForGrounding,
  substituteVariables,
} from "../../integration/commands/test-helpers/predict-mutation.js";

const FIXED_NOW = new Date("2026-04-20T15:30:00.000Z");
const TARGET_IRI = "obsidian://vault/fixture-test";

function grounding(
  overrides: Partial<GroundingDefinition> & { type: GroundingType },
): GroundingDefinition {
  return {
    id: overrides.id ?? "00000000-0000-0000-0000-000000000000",
    label: overrides.label ?? "test-grounding",
    type: overrides.type,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// substituteVariables
// ---------------------------------------------------------------------------

describe("substituteVariables", () => {
  it("replaces $target with the passed IRI", () => {
    const out = substituteVariables("$target", TARGET_IRI, undefined, FIXED_NOW);
    expect(out).toBe(TARGET_IRI);
  });

  it("replaces $nowLocal with YYYY-MM-DDTHH:mm:ss (no ms, no tz)", () => {
    const out = substituteVariables("$nowLocal", TARGET_IRI, undefined, FIXED_NOW);
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(out.endsWith("Z")).toBe(false);
    expect(out.includes(".")).toBe(false);
  });

  it("replaces $now with full ISO 8601 Z timestamp", () => {
    const out = substituteVariables("$now", TARGET_IRI, undefined, FIXED_NOW);
    expect(out).toBe("2026-04-20T15:30:00.000Z");
  });

  it("replaces $today with YYYY-MM-DD", () => {
    const out = substituteVariables("$today", TARGET_IRI, undefined, FIXED_NOW);
    expect(out).toBe("2026-04-20");
  });

  it("replaces $input and $value when userInput.value is defined", () => {
    const input = substituteVariables(
      "$input",
      TARGET_IRI,
      { value: "hello" },
      FIXED_NOW,
    );
    const value = substituteVariables(
      "$value",
      TARGET_IRI,
      { value: 42 },
      FIXED_NOW,
    );
    expect(input).toBe("hello");
    expect(value).toBe("42");
  });

  it("leaves $input / $value untouched when userInput is missing", () => {
    expect(
      substituteVariables("$input", TARGET_IRI, undefined, FIXED_NOW),
    ).toBe("$input");
    expect(
      substituteVariables("$value", TARGET_IRI, { value: null }, FIXED_NOW),
    ).toBe("$value");
  });

  it("applies multiple substitutions in a single value", () => {
    const out = substituteVariables(
      "$target-$today",
      TARGET_IRI,
      undefined,
      FIXED_NOW,
    );
    expect(out).toBe(`${TARGET_IRI}-2026-04-20`);
  });
});

// ---------------------------------------------------------------------------
// extractClassFromTargetValue — Literal-vs-IRI edge case
// ---------------------------------------------------------------------------

describe("extractClassFromTargetValue", () => {
  it.each([
    [`"[[ems__Task]]"`, "ems__Task"],
    [`[[ems__Task]]`, "ems__Task"],
    [`[[ems__Task|Task alias]]`, "ems__Task"],
    [`ems__Task`, "ems__Task"],
    [undefined, undefined],
    ["", undefined],
  ])("%p → %p", (input, expected) => {
    expect(extractClassFromTargetValue(input)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// property_set / property_delete
// ---------------------------------------------------------------------------

describe("predictMutationForGrounding — property_set", () => {
  it("predicts a simple literal value", () => {
    const result = predictMutationForGrounding(
      grounding({
        type: GroundingType.PROPERTY_SET,
        targetProperty: "ems__Effort_status",
        targetValue: `"[[ems__EffortStatusDoing]]"`,
      }),
      TARGET_IRI,
      undefined,
      { now: FIXED_NOW },
    );
    expect(result.frontmatterDiff).toEqual({
      ems__Effort_status: `"[[ems__EffortStatusDoing]]"`,
    });
    expect(result.timestampRegexes).toBeUndefined();
    expect(result.unpredictable).toBeUndefined();
  });

  it("emits a timestamp regex when targetValue uses $nowLocal", () => {
    const result = predictMutationForGrounding(
      grounding({
        type: GroundingType.PROPERTY_SET,
        targetProperty: "ems__Effort_startTimestamp",
        targetValue: "$nowLocal",
      }),
      TARGET_IRI,
      undefined,
      { now: FIXED_NOW },
    );
    expect(result.timestampRegexes?.ems__Effort_startTimestamp?.test(
      "2026-04-20T20:30:00",
    )).toBe(true);
    expect(
      result.timestampRegexes?.ems__Effort_startTimestamp?.test(
        "not-a-timestamp",
      ),
    ).toBe(false);
  });

  it("substitutes $input when userInput.value provided", () => {
    const result = predictMutationForGrounding(
      grounding({
        type: GroundingType.PROPERTY_SET,
        targetProperty: "ems__Effort_result",
        targetValue: "$input",
      }),
      TARGET_IRI,
      { value: "outcome text" },
      { now: FIXED_NOW },
    );
    expect(result.frontmatterDiff.ems__Effort_result).toBe("outcome text");
  });

  it("flags unpredictable when $input placeholder present but userInput missing", () => {
    const result = predictMutationForGrounding(
      grounding({
        type: GroundingType.PROPERTY_SET,
        targetProperty: "ems__Effort_result",
        targetValue: "$input",
      }),
      TARGET_IRI,
      undefined,
      { now: FIXED_NOW },
    );
    expect(result.unpredictable).toBe(true);
    expect(result.reason).toMatch(/\$input\/\$value/);
  });

  it("flags unpredictable on missing targetProperty/targetValue", () => {
    const a = predictMutationForGrounding(
      grounding({ type: GroundingType.PROPERTY_SET, targetValue: "x" }),
      TARGET_IRI,
      undefined,
      { now: FIXED_NOW },
    );
    const b = predictMutationForGrounding(
      grounding({
        type: GroundingType.PROPERTY_SET,
        targetProperty: "ems__Effort_result",
      }),
      TARGET_IRI,
      undefined,
      { now: FIXED_NOW },
    );
    expect(a.unpredictable).toBe(true);
    expect(b.unpredictable).toBe(true);
  });
});

describe("predictMutationForGrounding — property_delete", () => {
  it("emits a __DELETE__ sentinel for property_delete", () => {
    const result = predictMutationForGrounding(
      grounding({
        type: GroundingType.PROPERTY_DELETE,
        targetProperty: "ems__Effort_startTimestamp",
      }),
      TARGET_IRI,
      undefined,
      { now: FIXED_NOW },
    );
    expect(result.frontmatterDiff.ems__Effort_startTimestamp).toBe("__DELETE__");
  });

  it("flags unpredictable on missing targetProperty", () => {
    const result = predictMutationForGrounding(
      grounding({ type: GroundingType.PROPERTY_DELETE }),
      TARGET_IRI,
      undefined,
      { now: FIXED_NOW },
    );
    expect(result.unpredictable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// composite
// ---------------------------------------------------------------------------

describe("predictMutationForGrounding — composite", () => {
  it("merges child frontmatter diffs (Set Status Doing shape)", () => {
    const result = predictMutationForGrounding(
      grounding({
        type: GroundingType.COMPOSITE,
        steps: [
          grounding({
            id: "step-1",
            type: GroundingType.PROPERTY_SET,
            targetProperty: "ems__Effort_status",
            targetValue: `"[[ems__EffortStatusDoing]]"`,
          }),
          grounding({
            id: "step-2",
            type: GroundingType.PROPERTY_SET,
            targetProperty: "ems__Effort_startTimestamp",
            targetValue: "$nowLocal",
          }),
        ],
      }),
      TARGET_IRI,
      undefined,
      { now: FIXED_NOW },
    );
    expect(result.frontmatterDiff.ems__Effort_status).toBe(
      `"[[ems__EffortStatusDoing]]"`,
    );
    expect(result.timestampRegexes?.ems__Effort_startTimestamp).toBeDefined();
    expect(result.unpredictable).toBeUndefined();
  });

  it("propagates unpredictable from any failing step", () => {
    const result = predictMutationForGrounding(
      grounding({
        type: GroundingType.COMPOSITE,
        steps: [
          grounding({
            id: "ok",
            type: GroundingType.PROPERTY_SET,
            targetProperty: "a",
            targetValue: "1",
          }),
          grounding({
            id: "bad",
            type: GroundingType.PROPERTY_SET,
            targetProperty: "b",
            // Missing targetValue
          }),
        ],
      }),
      TARGET_IRI,
      undefined,
      { now: FIXED_NOW },
    );
    expect(result.unpredictable).toBe(true);
  });

  it("handles empty composite as a no-op diff", () => {
    const result = predictMutationForGrounding(
      grounding({ type: GroundingType.COMPOSITE, steps: [] }),
      TARGET_IRI,
      undefined,
      { now: FIXED_NOW },
    );
    expect(result.frontmatterDiff).toEqual({});
    expect(result.unpredictable).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// service_call — per-command class-flip branches (RFC §7.1b gate ≤5)
// ---------------------------------------------------------------------------

describe("predictMutationForGrounding — service_call class-flip branches", () => {
  it("branch 1: serviceId=convertToTask → ems__Task class-flip", () => {
    const result = predictMutationForGrounding(
      grounding({
        type: GroundingType.SERVICE_CALL,
        targetProperty: "convertToTask",
      }),
      TARGET_IRI,
      undefined,
      { now: FIXED_NOW },
    );
    expect(result.frontmatterDiff.exo__Instance_class).toBe(
      `["[[ems__Task]]"]`,
    );
  });

  it("branch 2: serviceId=updateProperty + targetValue=ems__Task (wrapped)", () => {
    const result = predictMutationForGrounding(
      grounding({
        type: GroundingType.SERVICE_CALL,
        targetProperty: "updateProperty",
        targetValue: `"[[ems__Task]]"`,
      }),
      TARGET_IRI,
      undefined,
      { now: FIXED_NOW },
    );
    expect(result.frontmatterDiff.exo__Instance_class).toBe(
      `["[[ems__Task]]"]`,
    );
  });

  it("branch 3: serviceId=updateProperty + targetValue=ems__Project", () => {
    const result = predictMutationForGrounding(
      grounding({
        type: GroundingType.SERVICE_CALL,
        targetProperty: "updateProperty",
        targetValue: `[[ems__Project]]`,
      }),
      TARGET_IRI,
      undefined,
      { now: FIXED_NOW },
    );
    expect(result.frontmatterDiff.exo__Instance_class).toBe(
      `["[[ems__Project]]"]`,
    );
  });

  it("updateProperty + unknown class falls through to dispatch-only", () => {
    const result = predictMutationForGrounding(
      grounding({
        type: GroundingType.SERVICE_CALL,
        targetProperty: "updateProperty",
        targetValue: `"[[ems__Area]]"`,
      }),
      TARGET_IRI,
      undefined,
      { now: FIXED_NOW },
    );
    expect(result.unpredictable).toBe(true);
  });

  it("generic service_call is dispatch-only (unpredictable)", () => {
    const result = predictMutationForGrounding(
      grounding({
        type: GroundingType.SERVICE_CALL,
        targetProperty: "cleanProperties",
      }),
      TARGET_IRI,
      undefined,
      { now: FIXED_NOW },
    );
    expect(result.unpredictable).toBe(true);
  });

  it("service_call without serviceId is unpredictable", () => {
    const result = predictMutationForGrounding(
      grounding({ type: GroundingType.SERVICE_CALL }),
      TARGET_IRI,
      undefined,
      { now: FIXED_NOW },
    );
    expect(result.unpredictable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// create_instance / sparql_update
// ---------------------------------------------------------------------------

describe("predictMutationForGrounding — create_instance / sparql_update", () => {
  it("returns a fileCreation side-effect descriptor", () => {
    const result = predictMutationForGrounding(
      grounding({
        type: GroundingType.CREATE_INSTANCE,
        targetFolder: "01 Inbox",
        targetClass: "ems__Task",
        targetPrototype: "prototype-uuid",
      }),
      TARGET_IRI,
      undefined,
      { now: FIXED_NOW },
    );
    expect(result.fileCreation).toEqual({
      targetFolder: "01 Inbox",
      targetClass: "ems__Task",
      targetPrototype: "prototype-uuid",
    });
    expect(result.frontmatterDiff).toEqual({});
  });

  it("create_instance without targetFolder is unpredictable", () => {
    const result = predictMutationForGrounding(
      grounding({ type: GroundingType.CREATE_INSTANCE }),
      TARGET_IRI,
      undefined,
      { now: FIXED_NOW },
    );
    expect(result.unpredictable).toBe(true);
  });

  it("sparql_update is explicitly flagged unpredictable", () => {
    const result = predictMutationForGrounding(
      grounding({ type: GroundingType.SPARQL_UPDATE }),
      TARGET_IRI,
      undefined,
      { now: FIXED_NOW },
    );
    expect(result.unpredictable).toBe(true);
    expect(result.reason).toMatch(/sparql_update/);
  });

  it("unknown grounding types are unpredictable (not a throw)", () => {
    const result = predictMutationForGrounding(
      grounding({ type: "nonsense" as GroundingType }),
      TARGET_IRI,
      undefined,
      { now: FIXED_NOW },
    );
    expect(result.unpredictable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// matchMutation — stdout-friendly diff helper
// ---------------------------------------------------------------------------

describe("matchMutation", () => {
  it("reports matches=true when every predicted key equals the after-frontmatter", () => {
    const predicted = {
      frontmatterDiff: {
        ems__Effort_status: `"[[ems__EffortStatusDoing]]"`,
      },
    };
    const { matches, failures } = matchMutation(predicted, {
      ems__Effort_status: `"[[ems__EffortStatusDoing]]"`,
      aliases: ["unrelated"],
    });
    expect(matches).toBe(true);
    expect(failures).toEqual([]);
  });

  it("reports failures with property name + both values", () => {
    const predicted = {
      frontmatterDiff: {
        ems__Effort_status: `"[[ems__EffortStatusDoing]]"`,
      },
    };
    const { matches, failures } = matchMutation(predicted, {
      ems__Effort_status: `"[[ems__EffortStatusBacklog]]"`,
    });
    expect(matches).toBe(false);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/ems__Effort_status/);
    expect(failures[0]).toMatch(/Backlog/);
  });

  it("applies regex matchers for timestamp fields", () => {
    const predicted = {
      frontmatterDiff: { ems__Effort_startTimestamp: "ignored-base" },
      timestampRegexes: {
        ems__Effort_startTimestamp: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/,
      },
    };
    const ok = matchMutation(predicted, {
      ems__Effort_startTimestamp: "2026-04-20T15:30:00",
    });
    const bad = matchMutation(predicted, {
      ems__Effort_startTimestamp: "garbage",
    });
    expect(ok.matches).toBe(true);
    expect(bad.matches).toBe(false);
  });

  it("treats __DELETE__ expectation as 'key must be absent'", () => {
    const predicted = {
      frontmatterDiff: { ems__Effort_startTimestamp: "__DELETE__" },
    };
    const gone = matchMutation(predicted, { ems__Effort_status: "x" });
    const still = matchMutation(predicted, {
      ems__Effort_startTimestamp: "still-here",
    });
    expect(gone.matches).toBe(true);
    expect(still.matches).toBe(false);
    expect(still.failures[0]).toMatch(/expected to be deleted/);
  });
});

// ---------------------------------------------------------------------------
// Branch-count audit — RFC §7.1b gate (≤ 5 per-command branches)
// ---------------------------------------------------------------------------

describe("audit: per-command branch count (RFC §7.1b)", () => {
  it("service_call helper stays within 5 per-command special-case branches", () => {
    const HERE = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(
      path.resolve(
        HERE,
        "..",
        "..",
        "integration",
        "commands",
        "test-helpers",
        "predict-mutation.ts",
      ),
      "utf8",
    );
    // Count the 3 documented class-flip branches by matching the annotated
    // `// Branch N — ...` comments. The annotation is load-bearing: any
    // future reviewer adding a 4th/5th class-flip MUST attach the numbered
    // comment; a 6th will fail this assertion loudly.
    const branches = (source.match(/\/\/ Branch \d+ — /g) ?? []).length;
    expect(branches).toBeLessThanOrEqual(5);
    expect(branches).toBeGreaterThanOrEqual(3); // current baseline
  });
});
