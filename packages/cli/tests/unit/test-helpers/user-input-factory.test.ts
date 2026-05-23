/**
 * Unit tests for the integration-layer `user-input-factory.ts` helper.
 *
 * RFC v4 §7.1a "5 field types" coverage: a dedicated describe block asserts
 * every conceptual type (text / multiline / date / enum / assetRef) is
 * classified and synthesised correctly.
 */
import { describe, it, expect } from "@jest/globals";
import {
  DEFAULT_DATE,
  DEFAULT_MULTILINE_PREFIX,
  DEFAULT_TEXT_PREFIX,
  buildUserInputForGroundingFrontmatter,
  buildUserInputForSchema,
  classifyField,
  parseInputSchemaFromGroundingRaw,
  synthesiseFieldValue,
} from "../../integration/commands/test-helpers/user-input-factory.js";

// ---------------------------------------------------------------------------
// classifyField — five conceptual field types
// ---------------------------------------------------------------------------

describe("classifyField — 5 field type coverage (RFC §7.1a)", () => {
  it.each<[object, string]>([
    [{ type: "string" }, "text"],
    [{ type: "string", title: "Project name" }, "text"],
    [{ type: "string", format: "date" }, "date"],
    [{ type: "string", format: "date-time" }, "date"],
    [{ type: "string", format: "asset-reference" }, "assetRef"],
    [{ type: "string", format: "assetRef" }, "assetRef"],
    [{ type: "string", format: "textarea" }, "multiline"],
    [{ type: "string", multiline: true }, "multiline"],
    [{ type: "string", enum: ["a", "b"] }, "enum"],
  ])("%j → %s", (field, expected) => {
    expect(classifyField(field)).toBe(expected);
  });

  it("defaults to `text` for undefined field", () => {
    expect(classifyField(undefined)).toBe("text");
  });

  it("empty enum array is NOT classified as enum", () => {
    expect(classifyField({ enum: [] })).toBe("text");
  });
});

// ---------------------------------------------------------------------------
// synthesiseFieldValue — deterministic, seeded
// ---------------------------------------------------------------------------

describe("synthesiseFieldValue — deterministic per field type", () => {
  it("text → prefixed seed", () => {
    expect(synthesiseFieldValue("text", undefined, "abc")).toBe(
      `${DEFAULT_TEXT_PREFIX}abc`,
    );
  });

  it("multiline → prefixed seed (distinct from text prefix)", () => {
    const value = synthesiseFieldValue("multiline", undefined, "xyz");
    expect(value).toBe(`${DEFAULT_MULTILINE_PREFIX}xyz`);
    expect(value).not.toBe(synthesiseFieldValue("text", undefined, "xyz"));
  });

  it("date → fixed DEFAULT_DATE (2026-04-20)", () => {
    expect(synthesiseFieldValue("date", undefined, "ignored")).toBe(
      DEFAULT_DATE,
    );
  });

  it("enum → first option from schema", () => {
    expect(
      synthesiseFieldValue("enum", { enum: ["Red", "Green"] }, "seed"),
    ).toBe("Red");
  });

  it("enum without options throws", () => {
    expect(() => synthesiseFieldValue("enum", {}, "seed")).toThrow(
      /no options/,
    );
  });

  it("assetRef → [[<seed-uuid>]]", () => {
    expect(
      synthesiseFieldValue(
        "assetRef",
        {},
        "any-seed",
        "00000000-0000-4000-8000-000000000000",
      ),
    ).toBe(`[[00000000-0000-4000-8000-000000000000]]`);
  });

  it("assetRef without seed UUID throws", () => {
    expect(() => synthesiseFieldValue("assetRef", {}, "seed")).toThrow(
      /assetRef field requires/,
    );
  });

  it("text value is reproducible for same seed", () => {
    const a = synthesiseFieldValue("text", undefined, "same");
    const b = synthesiseFieldValue("text", undefined, "same");
    expect(a).toBe(b);
  });

  it("text values differ across seeds", () => {
    const a = synthesiseFieldValue("text", undefined, "alpha");
    const b = synthesiseFieldValue("text", undefined, "beta");
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// buildUserInputForSchema — end-to-end
// ---------------------------------------------------------------------------

describe("buildUserInputForSchema — $value substitution contract", () => {
  it("emits {value: ...} for text schema with property name `value`", () => {
    const result = buildUserInputForSchema(
      {
        type: "object",
        properties: { value: { type: "string", title: "Result" } },
        required: ["value"],
      },
      { seed: "set-result" },
    );
    expect(result).toEqual({
      payload: { value: `${DEFAULT_TEXT_PREFIX}set-result` },
      fieldName: "value",
      fieldType: "text",
    });
  });

  it("emits {label: ...} for schemas that drive create_instance", () => {
    const result = buildUserInputForSchema(
      {
        type: "object",
        properties: { label: { type: "string", title: "Task name" } },
        required: ["label"],
      },
      { seed: "create-task" },
    );
    expect(result?.fieldName).toBe("label");
    expect(result?.payload).toEqual({
      label: `${DEFAULT_TEXT_PREFIX}create-task`,
    });
  });

  it("emits {value: DEFAULT_DATE} for date fields", () => {
    const result = buildUserInputForSchema(
      {
        type: "object",
        properties: {
          value: { type: "string", title: "Scheduled date", format: "date" },
        },
      },
      { seed: "scheduled-date" },
    );
    expect(result?.payload.value).toBe(DEFAULT_DATE);
    expect(result?.fieldType).toBe("date");
  });

  it("emits {value: [[<uuid>]]} for asset-reference fields", () => {
    const seedUuid = "cafebabe-1111-4222-8333-dead00000000";
    const result = buildUserInputForSchema(
      {
        type: "object",
        properties: {
          value: {
            type: "string",
            title: "Parent",
            format: "asset-reference",
          },
        },
      },
      { seed: "link-parent", assetRefSeedUuid: seedUuid },
    );
    expect(result?.fieldType).toBe("assetRef");
    expect(result?.payload.value).toBe(`[[${seedUuid}]]`);
  });

  it("picks the first enum option", () => {
    const result = buildUserInputForSchema(
      {
        type: "object",
        properties: {
          value: {
            type: "string",
            title: "Priority",
            enum: ["High", "Medium", "Low"],
          },
        },
      },
      { seed: "priority" },
    );
    expect(result?.fieldType).toBe("enum");
    expect(result?.payload.value).toBe("High");
  });

  it("returns undefined when the schema has no properties", () => {
    expect(
      buildUserInputForSchema({ type: "object", properties: {} }, {
        seed: "x",
      }),
    ).toBeUndefined();
    expect(buildUserInputForSchema(undefined, { seed: "x" })).toBeUndefined();
  });

  it("throws on unsupported multi-field schemas", () => {
    expect(() =>
      buildUserInputForSchema(
        {
          type: "object",
          properties: {
            value: { type: "string" },
            extra: { type: "string" },
          },
        },
        { seed: "multi" },
      ),
    ).toThrow(/multi-field schemas unsupported/);
  });

  it("throws on unsupported field names (not `value` or `label`)", () => {
    expect(() =>
      buildUserInputForSchema(
        {
          type: "object",
          properties: { notValue: { type: "string" } },
        },
        { seed: "wrong-name" },
      ),
    ).toThrow(/unsupported field name/);
  });
});

// ---------------------------------------------------------------------------
// parseInputSchemaFromGroundingRaw — inline JSON tolerance
// ---------------------------------------------------------------------------

describe("parseInputSchemaFromGroundingRaw", () => {
  it("parses starter-kit inline JSON shape", () => {
    const raw =
      '{"type":"object","properties":{"value":{"type":"string","title":"Planned start (date)"}},"required":["value"]}';
    const schema = parseInputSchemaFromGroundingRaw(raw);
    expect(schema?.properties?.value?.title).toBe("Planned start (date)");
  });

  it("returns undefined for missing / non-string input", () => {
    expect(parseInputSchemaFromGroundingRaw(undefined)).toBeUndefined();
    expect(parseInputSchemaFromGroundingRaw(42)).toBeUndefined();
    expect(parseInputSchemaFromGroundingRaw("")).toBeUndefined();
  });

  it("returns undefined for malformed JSON (no throw)", () => {
    expect(parseInputSchemaFromGroundingRaw("{not json")).toBeUndefined();
  });

  it("rejects array / primitive JSON roots (must be object)", () => {
    expect(parseInputSchemaFromGroundingRaw("[1,2,3]")).toBeUndefined();
    expect(parseInputSchemaFromGroundingRaw('"scalar"')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildUserInputForGroundingFrontmatter — production entrypoint
// ---------------------------------------------------------------------------

describe("buildUserInputForGroundingFrontmatter", () => {
  it("resolves inputSchema from grounding frontmatter and synthesises payload", () => {
    const fm = {
      exocmd__Grounding_type: "service_call",
      exocmd__Grounding_serviceId: "updateProperty",
      exocmd__Grounding_inputSchema:
        '{"type":"object","properties":{"value":{"type":"string","title":"Result"}},"required":["value"]}',
    };
    const result = buildUserInputForGroundingFrontmatter(fm, {
      seed: "set-result",
    });
    expect(result?.payload).toEqual({
      value: `${DEFAULT_TEXT_PREFIX}set-result`,
    });
  });

  it("returns undefined when grounding has no inputSchema", () => {
    const fm = {
      exocmd__Grounding_type: "property_set",
      exocmd__Grounding_targetProperty: "ems__Effort_status",
    };
    const result = buildUserInputForGroundingFrontmatter(fm, {
      seed: "set-status",
    });
    expect(result).toBeUndefined();
  });

  it("returns undefined for undefined grounding frontmatter (command without grounding)", () => {
    expect(
      buildUserInputForGroundingFrontmatter(undefined, { seed: "x" }),
    ).toBeUndefined();
  });
});
