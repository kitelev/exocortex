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

  it("A3 @req:656bd2d9-458d-4b81-8ec3-49318b134e40 ACCEPTS a property key the schema does not declare — the supported extra-property workflow", () => {
    // ⛔ The first round of this requirement refused an undeclared key. That was
    // a regression of a live, documented workflow: the `executive-assistant`
    // skill §5.2 states "Доп. property проходят через `--input` напрямую (любой
    // ключ кроме `label` → frontmatter): `ems__Effort_blocker`,
    // `ems__Effort_priority`" and ships a `create-task` call carrying
    // `ems__Effort_blocker`, while that command's grounding declares only
    // `label`. 95 / 17 / 50 assets carry the property in vault-exodev / vault-my
    // / vault-tbank (canaries 1749 / 717 / 1061), so the refusal would have hit
    // the founder's task capture on every use.
    const g = makeGrounding({ inputSchema: CREATE_TASK_SCHEMA });

    expect(
      findInputSchemaViolation(g, {
        label: "Fix the parser",
        ems__Effort_blocker: "[[some-uid]]",
        ems__Effort_priority: "high",
      }),
    ).toBeNull();
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

  it("A12 @req:656bd2d9-458d-4b81-8ec3-49318b134e40 accepts the engine-reserved inputs alongside the declared key", () => {
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

  it("A15 @req:656bd2d9-458d-4b81-8ec3-49318b134e40 still refuses the ticket's own call — via the REQUIRED clause, not an undeclared-key one", () => {
    // `apply create-task <project> --yes --input '{"value":"…"}'` — the call
    // from ticket eb9d6d2c. `value` is simply carried through as a property;
    // what stops the Untitled asset is that no `label` was supplied and
    // create-task declares no defaultValue / labelTemplate / omitLabel.
    const g = makeGrounding({ inputSchema: CREATE_TASK_SCHEMA });
    expect(findInputSchemaViolation(g, { value: "Fix the parser" })).toBe(
      missingRequiredInputError("label"),
    );
  });

  it("A17 @req:656bd2d9-458d-4b81-8ec3-49318b134e40 applies to a NON-create_instance grounding too — the contract is the command's, not the type's", () => {
    // Review MEDIUM-3: every other fixture here rides makeGrounding's
    // CREATE_INSTANCE default, so the clause's SCOPE was locked by nothing. A
    // declared inputSchema is the command author's contract however the
    // grounding spends the value — property_set reads it through a template,
    // service_call hands it to a service.
    const pset = makeGrounding({
      type: GroundingType.PROPERTY_SET,
      targetProperty: "ems__Effort_parent",
      inputSchema: [field("parent", { required: true })],
    });
    expect(findInputSchemaViolation(pset, {})).toBe(
      missingRequiredInputError("parent"),
    );
    expect(findInputSchemaViolation(pset, { parent: "uid" })).toBeNull();

    const svc = makeGrounding({
      type: GroundingType.SERVICE_CALL,
      inputSchema: [field("value", { required: true })],
    });
    expect(findInputSchemaViolation(svc, {})).toBe(
      missingRequiredInputError("value"),
    );
  });

  it("A18 @req:656bd2d9-458d-4b81-8ec3-49318b134e40 collects declared FIELDS over the tree, not just off the root", () => {
    // Review MEDIUM-2: sources were walked transitively while the declared
    // fields were read off the root only — an asymmetry that silently skipped
    // the contract of a composite declaring its schema on a step.
    const composite = makeGrounding({
      type: GroundingType.COMPOSITE,
      steps: [
        makeGrounding({
          id: "step-with-schema",
          inputSchema: [field("parent", { required: true })],
        }),
      ],
    });
    expect(findInputSchemaViolation(composite, {})).toBe(
      missingRequiredInputError("parent"),
    );
    expect(findInputSchemaViolation(composite, { parent: "uid" })).toBeNull();
  });

  it("A19 @req:656bd2d9-458d-4b81-8ec3-49318b134e40 counts serviceCallPayload and a standalone isDefinedBy as declared sources", () => {
    // Review MEDIUM-1: `executeServiceCall` merges the payload's keys into
    // userInput as defaults and injects `isDefinedBy` the same way, so a
    // required key they carry IS supplied by the time the service runs. Listing
    // them makes the enumerated source set match the executor rather than most
    // of it. 0 live groundings declare such a key as required today.
    const payload = makeGrounding({
      type: GroundingType.SERVICE_CALL,
      inputSchema: [field("property", { required: true })],
      serviceCallPayload: '{"property":"ems__Effort_plannedStartTimestamp"}',
    });
    expect(findInputSchemaViolation(payload, {})).toBeNull();

    const anchored = makeGrounding({
      type: GroundingType.SERVICE_CALL,
      inputSchema: [field("isDefinedBy", { required: true })],
      isDefinedBy: "[[some-anchor-uid]]",
    });
    expect(findInputSchemaViolation(anchored, {})).toBeNull();

    // A payload that does not parse supplies nothing — guessing there would
    // refuse a call on the strength of a malformed field we do not own.
    const broken = makeGrounding({
      type: GroundingType.SERVICE_CALL,
      inputSchema: [field("property", { required: true })],
      serviceCallPayload: "{not json",
    });
    expect(findInputSchemaViolation(broken, {})).toBe(
      missingRequiredInputError("property"),
    );
  });

  it("A20 @req:656bd2d9-458d-4b81-8ec3-49318b134e40 does NOT accept a BLANK defaultValue as a source", () => {
    // Review LOW-1: `isSupplied` treats a blank string as absent, so a blank
    // defaultValue excusing the same key was an asymmetry — it prefills nothing
    // and the call still lands on the degraded fallback.
    const blank = makeGrounding({
      inputSchema: [field("label", { required: true, defaultValue: "   " })],
    });
    expect(findInputSchemaViolation(blank, {})).toBe(
      missingRequiredInputError("label"),
    );

    const real = makeGrounding({
      inputSchema: [field("label", { required: true, defaultValue: "Task" })],
    });
    expect(findInputSchemaViolation(real, {})).toBeNull();
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
