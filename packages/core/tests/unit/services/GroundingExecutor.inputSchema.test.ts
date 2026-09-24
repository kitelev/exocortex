/**
 * req 656bd2d9 — `apply` pre-flights the command's OWN declared input contract
 * (`exocmd__Grounding_inputSchema`).
 *
 * Before this change the declared schema was read by NOTHING on the executing
 * path: `CommandResolver` projected it into form-field descriptors for the
 * plugin modal, and the CLI never consulted it. So
 * `apply create-task <project> --yes --input '{"value":"…"}'` succeeded, wrote
 * the caller's text into the new asset's frontmatter as an orphan `value:`
 * property, and fell back to the label `"Untitled"` while logging an
 * unhealthy-vault warning.
 *
 * ⛔ These axes lock a SECOND pre-flight that is independent of
 * `findMissingInput`: that one reads a value TEMPLATE and is deliberately
 * gated to `property_set`; this one reads the DECLARED SCHEMA. The sibling
 * suite `GroundingExecutor.missingInput.test.ts` — which asserts that a
 * non-`property_set` grounding (CREATE_INSTANCE included) is NOT refused for a
 * missing input — must stay green with no edit, and the mutant that removes
 * that type-gate must redden it. Both are pinned in the mutant spec.
 *
 * ⚠ Assetspace boundaries are NOT observable here by construction: this
 * function walks an ALREADY-RESOLVED definition, whose steps were fetched by
 * `CommandResolver.loadCompositeSteps` through wikilink resolution. The live
 * composite `bab33aac` has its three steps in three different assetspaces
 * (exoas-my / exoas-public / exoas-exocmd); what the axes below lock is that
 * the walk reaches a step AT ALL, and transitively.
 */
import {
  findInputSchemaViolation,
  unknownInputKeyError,
  missingRequiredInputError,
} from "../../../src/services/GroundingExecutor";
import { GroundingType } from "../../../src/domain/constants/GroundingType";
import type {
  GroundingDefinition,
  InputSchemaField,
} from "../../../src/domain/models/CommandDefinition";

function makeGrounding(
  overrides: Partial<GroundingDefinition> &
    Record<string, unknown> = {},
): GroundingDefinition {
  return {
    id: "gnd-input-schema",
    label: "Input Schema",
    type: GroundingType.CREATE_INSTANCE,
    targetFolder: "tasks",
    ...overrides,
  } as GroundingDefinition;
}

/** The real shape CommandResolver projects from the JSON-Schema literal. */
function field(
  name: string,
  overrides: Partial<InputSchemaField> = {},
): InputSchemaField {
  return { name, type: "text", label: name, required: false, ...overrides };
}

/** `create-task`'s real contract: one required `label`, nothing else. */
const CREATE_TASK_SCHEMA: readonly InputSchemaField[] = [
  field("label", { label: "Task name", required: true }),
];

describe("findInputSchemaViolation — req 656bd2d9", () => {
  it("A1 @req:656bd2d9-458d-4b81-8ec3-49318b134e40 refuses a required key that no declared source supplies, naming it", () => {
    const g = makeGrounding({ inputSchema: CREATE_TASK_SCHEMA });

    expect(findInputSchemaViolation(g, {})).toBe(
      missingRequiredInputError("label"),
    );
    // The wording carries the key in copy-pasteable form.
    expect(findInputSchemaViolation(g, {})).toContain(`--input '{"label":...}'`);
  });

  it("A2 @req:656bd2d9-458d-4b81-8ec3-49318b134e40 says nothing when the declared key is supplied", () => {
    const g = makeGrounding({ inputSchema: CREATE_TASK_SCHEMA });
    expect(findInputSchemaViolation(g, { label: "Fix the parser" })).toBeNull();
  });

  it("A3 @req:656bd2d9-458d-4b81-8ec3-49318b134e40 refuses a key the schema does not declare, naming it AND the accepted keys", () => {
    const g = makeGrounding({ inputSchema: CREATE_TASK_SCHEMA });

    // The exact call from the ticket: the caller passed the label under the
    // wrong key, and today that text lands in the frontmatter as `value:`.
    const verdict = findInputSchemaViolation(g, { value: "Fix the parser" });
    expect(verdict).toBe(unknownInputKeyError("value", ["label"]));
    expect(verdict).toContain(`"value"`);
    expect(verdict).toContain(`accepted: "label"`);
  });

  it("A4 @req:656bd2d9-458d-4b81-8ec3-49318b134e40 stays SILENT for a grounding that declares no schema at all", () => {
    // No declared contract → nothing to enforce; behaviour is byte-identical
    // to before this requirement for every such command.
    const g = makeGrounding({});
    expect(findInputSchemaViolation(g, { anything: "at all" })).toBeNull();
    expect(findInputSchemaViolation(g, {})).toBeNull();

    // An empty descriptor list is the same case (schema JSON with no properties).
    const empty = makeGrounding({ inputSchema: [] });
    expect(findInputSchemaViolation(empty, { anything: "at all" })).toBeNull();
  });

  it("A5 @req:656bd2d9-458d-4b81-8ec3-49318b134e40 does NOT refuse a required label that the grounding's own labelTemplate supplies", () => {
    // 4 live commands are shaped exactly like this (2f8db9d5, adc73790,
    // e01b025b, a6ef8fda): required ["label"] AND a labelTemplate that
    // completes the label on a one-click / no-input call.
    const g = makeGrounding({
      inputSchema: CREATE_TASK_SCHEMA,
      labelTemplate: "$target.exo__Asset_label $today",
    });
    expect(findInputSchemaViolation(g, {})).toBeNull();
  });

  it("A6 @req:656bd2d9-458d-4b81-8ec3-49318b134e40 does NOT refuse when the labelTemplate lives on a composite STEP rather than the composite itself", () => {
    // The live composite `bab33aac`: it declares required ["label"] on ITSELF
    // while the labelTemplate that completes the label sits on its FIRST step
    // (`a6ef8fda`). A source lookup limited to the top node would refuse it.
    const composite = makeGrounding({
      type: GroundingType.COMPOSITE,
      inputSchema: CREATE_TASK_SCHEMA,
      steps: [
        makeGrounding({
          id: "step-create",
          labelTemplate: "$target.exo__Asset_label $today",
        }),
        makeGrounding({ id: "step-status", type: GroundingType.PROPERTY_SET }),
        makeGrounding({ id: "step-bump", type: GroundingType.PROPERTY_SET }),
      ],
    });
    expect(findInputSchemaViolation(composite, {})).toBeNull();
  });

  it("A7 @req:656bd2d9-458d-4b81-8ec3-49318b134e40 walks the step tree TRANSITIVELY, not one level", () => {
    // 0 live commands nest a composite under a composite today (measured
    // 2026-09-24 over the 35 schema-carrying groundings of the three canonical
    // vaults). The engine supports it — `loadCompositeSteps` recurses with
    // `depth + 1` — and the 7f HIGH lived on exactly a nested composite, so the
    // walk is locked at depth 2 rather than assumed.
    const nested = makeGrounding({
      type: GroundingType.COMPOSITE,
      inputSchema: CREATE_TASK_SCHEMA,
      steps: [
        makeGrounding({
          id: "outer-step",
          type: GroundingType.COMPOSITE,
          steps: [
            makeGrounding({
              id: "inner-step",
              labelTemplate: "$target.exo__Asset_label $today",
            }),
          ],
        }),
      ],
    });
    expect(findInputSchemaViolation(nested, {})).toBeNull();
  });

  it("A8 @req:656bd2d9-458d-4b81-8ec3-49318b134e40 does NOT refuse a required label that omitLabel deliberately drops", () => {
    const g = makeGrounding({
      inputSchema: CREATE_TASK_SCHEMA,
      omitLabel: true,
    });
    expect(findInputSchemaViolation(g, {})).toBeNull();
  });

  it("A9 @req:656bd2d9-458d-4b81-8ec3-49318b134e40 does NOT refuse a required key the schema itself defaults", () => {
    const g = makeGrounding({
      inputSchema: [
        field("plannedDate", { required: true, defaultValue: "$today" }),
        field("label", { required: true }),
      ],
      labelTemplate: "auto",
    });
    expect(findInputSchemaViolation(g, {})).toBeNull();
  });

  it("A10 @req:656bd2d9-458d-4b81-8ec3-49318b134e40 does NOT refuse a required key a propertyDefault writes", () => {
    const g = makeGrounding({
      inputSchema: [field("ems__Effort_parent", { required: true })],
      propertyDefault: [
        { propertyName: "ems__Effort_parent", value: "[[some-uid]]" },
      ],
    });
    expect(findInputSchemaViolation(g, {})).toBeNull();
  });

  it("A11 @req:656bd2d9-458d-4b81-8ec3-49318b134e40 does NOT refuse a required key an inheritanceRule writes", () => {
    const g = makeGrounding({
      inputSchema: [field("ems__Effort_parent", { required: true })],
      inheritanceRule: [
        {
          sourcePropertyName: "exo__Asset_uid",
          targetPropertyName: "ems__Effort_parent",
          targetClassCondition: "ems__Project",
          targetClassConditionUid: "proj-uid",
          targetClassExclusion: [],
          targetClassExclusionUids: [],
          priority: 1,
        },
      ],
    });
    expect(findInputSchemaViolation(g, {})).toBeNull();
  });

  it("A12 @req:656bd2d9-458d-4b81-8ec3-49318b134e40 never treats the engine-reserved inputs as unknown", () => {
    // `label` / `body` / `plannedDate` are consumed BY NAME by
    // executeCreateInstance and `continue` before the frontmatter write, so
    // they are engine inputs, not property keys — even when the schema is
    // silent about them.
    const g = makeGrounding({ inputSchema: CREATE_TASK_SCHEMA });
    expect(
      findInputSchemaViolation(g, {
        label: "X",
        body: "some text",
        plannedDate: "2026-09-24",
      }),
    ).toBeNull();
  });

  it("A13 @req:656bd2d9-458d-4b81-8ec3-49318b134e40 treats a BLANK required value as absent", () => {
    // A whitespace-only label would otherwise satisfy the contract and still
    // land on the "Untitled" fallback — the exact degradation being removed.
    const g = makeGrounding({ inputSchema: CREATE_TASK_SCHEMA });
    expect(findInputSchemaViolation(g, { label: "   " })).toBe(
      missingRequiredInputError("label"),
    );
    expect(findInputSchemaViolation(g, { label: "" })).toBe(
      missingRequiredInputError("label"),
    );
    expect(findInputSchemaViolation(g, { label: null })).toBe(
      missingRequiredInputError("label"),
    );
  });

  it("A14 @req:656bd2d9-458d-4b81-8ec3-49318b134e40 does NOT let a propertyDefault on exo__Asset_label excuse the required `label` INPUT", () => {
    // The Universal Default Template's entry for exo__Asset_label substitutes
    // `$userInputLabel` — it FORWARDS the very input being checked and supplies
    // nothing of its own. Accepting it as a source would make the refusal
    // unreachable for every create_instance in the vault, since that default is
    // parser-merged into essentially all of them.
    const g = makeGrounding({
      inputSchema: CREATE_TASK_SCHEMA,
      propertyDefault: [
        { propertyName: "exo__Asset_label", value: "$userInputLabel" },
      ],
    });
    expect(findInputSchemaViolation(g, {})).toBe(
      missingRequiredInputError("label"),
    );
  });

  it("A15 @req:656bd2d9-458d-4b81-8ec3-49318b134e40 reports the UNDECLARED key first when a call violates both clauses", () => {
    // The ticket's own call is exactly this: `--input '{"value":"…"}'` is both
    // an undeclared key and a missing required `label`. Naming the undeclared
    // key first is what tells the caller WHY the required one looks missing.
    const g = makeGrounding({ inputSchema: CREATE_TASK_SCHEMA });
    expect(findInputSchemaViolation(g, { value: "Fix the parser" })).toBe(
      unknownInputKeyError("value", ["label"]),
    );
  });

  it("A16 @req:656bd2d9-458d-4b81-8ec3-49318b134e40 ignores a non-required declared key that is absent", () => {
    // `definition` on "Create Narrower Concept" is declared but not required;
    // omitting it must stay a normal call.
    const g = makeGrounding({
      inputSchema: [
        field("label", { required: true }),
        field("definition", { required: false }),
      ],
    });
    expect(findInputSchemaViolation(g, { label: "Concept" })).toBeNull();
  });
});
