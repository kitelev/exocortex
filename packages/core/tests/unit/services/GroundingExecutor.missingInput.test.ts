/**
 * Issue #4298 — the missing-input verdict, and the pre-flight that reuses it.
 *
 * Before this change the verdict lived inline in `executeStep` and was reachable
 * only by RUNNING the grounding, so `apply --dry-run` could bless an `--input`
 * the real run refuses (rc=0 vs rc=5). The logic is now one exported function
 * that both paths call.
 *
 * ⛔ The executing path had NO test at all (`grep "references an input that was
 * not provided" tests/` → 0 hits before this file), so the refactor would have
 * been unguarded. The `executeStep` cases below lock the behaviour that already
 * shipped; the `findMissingInput` cases lock the new pre-flight.
 */
import {
  GroundingExecutor,
  ServiceRegistry,
  missingInputHint,
  missingInputError,
  findMissingInput,
} from "../../../src/services/GroundingExecutor";
import { GroundingType } from "../../../src/domain/constants/GroundingType";
import { GroundingDefinition } from "../../../src/domain/models/CommandDefinition";

function createMockReader(content: string) {
  return {
    readFile: jest.fn().mockResolvedValue(content),
    fileExists: jest.fn().mockResolvedValue(true),
    getMarkdownFiles: jest.fn().mockResolvedValue([]),
  };
}

function createMockWriter() {
  return {
    createFile: jest.fn().mockResolvedValue(""),
    updateFile: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
    deleteFile: jest.fn().mockResolvedValue(undefined),
    renameFile: jest.fn().mockResolvedValue(undefined),
  };
}

function makeGrounding(overrides: Record<string, unknown>): GroundingDefinition {
  return {
    id: "gnd-missing-input",
    label: "Missing Input",
    ...overrides,
  } as unknown as GroundingDefinition;
}

function makeExecutor(content: string) {
  const reader = createMockReader(content);
  const writer = createMockWriter();
  return {
    executor: new GroundingExecutor(reader, writer, new ServiceRegistry()),
    writer,
  };
}

const TARGET_IRI = "https://exocortex.my/assets/test-asset-123";
const FILE_PATH = "/vault/test-asset.md";
const ASSET = '---\nexo__Asset_label: "Foo"\n---\nBody';

describe("missingInputHint (Issue #4298)", () => {
  it("names the NAMED key a template references but the caller did not provide", () => {
    expect(missingInputHint("$input.label", {})).toBe(
      `--input '{"label":...}'`,
    );
    expect(missingInputHint("$input.label", { other: "x" })).toBe(
      `--input '{"label":...}'`,
    );
  });

  it("falls back to the anonymous `value` key for $input / $value templates", () => {
    expect(missingInputHint("$value", {})).toBe(`--input '{"value":...}'`);
    expect(missingInputHint("$input", {})).toBe(`--input '{"value":...}'`);
  });

  it("returns null once the referenced key is provided", () => {
    expect(missingInputHint("$input.label", { label: "New" })).toBeNull();
    expect(missingInputHint("$value", { value: "2026-09-20" })).toBeNull();
  });

  it("treats an empty string as PROVIDED (only undefined/null are missing)", () => {
    // The executing path used `v !== undefined && v !== null`; an author may
    // legitimately want to write an empty value. Locked so the refactor cannot
    // silently tighten it into a truthiness check.
    expect(missingInputHint("$input.label", { label: "" })).toBeNull();
  });

  it("does not flag free text that merely CONTAINS $input — #3779 review MEDIUM", () => {
    // The check reads the TEMPLATE, and here the template is a literal that
    // happens to mention the token; there is no substitution to satisfy.
    expect(missingInputHint("Fix handling", {})).toBeNull();
  });

  it("reports the FIRST missing named key when several are referenced", () => {
    expect(missingInputHint("$input.parent/$input.blocker", { parent: "p" })).toBe(
      `--input '{"blocker":...}'`,
    );
  });
});

describe("missingInputError (Issue #4298)", () => {
  it("is the one wording both paths print", () => {
    expect(missingInputError(`--input '{"label":...}'`)).toBe(
      `property_set: value template references an input that was not provided (--input '{"label":...}' required)`,
    );
  });
});

describe("GroundingExecutor property_set missing input — EXECUTING path", () => {
  it("refuses with the shared wording and writes nothing", async () => {
    const { executor, writer } = makeExecutor(ASSET);

    const result = await executor.execute(
      makeGrounding({
        type: GroundingType.PROPERTY_SET,
        targetProperty: "exo__Asset_label",
        targetValueSubstitution: "$input.label",
      }),
      TARGET_IRI,
      FILE_PATH,
      {},
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe(missingInputError(`--input '{"label":...}'`));
    expect(writer.updateFile).not.toHaveBeenCalled();
  });

  it("proceeds when the input IS provided (the refusal is not unconditional)", async () => {
    const { executor, writer } = makeExecutor(ASSET);

    const result = await executor.execute(
      makeGrounding({
        type: GroundingType.PROPERTY_SET,
        targetProperty: "exo__Asset_label",
        targetValueSubstitution: "$input.label",
      }),
      TARGET_IRI,
      FILE_PATH,
      { label: "New label" },
    );

    expect(result.success).toBe(true);
    expect(writer.updateFile).toHaveBeenCalled();
  });
});

describe("findMissingInput — PRE-FLIGHT path (Issue #4298)", () => {
  it("sees a substitution template on a direct grounding", () => {
    const g = makeGrounding({
      type: GroundingType.PROPERTY_SET,
      targetProperty: "exo__Asset_label",
      targetValueSubstitution: "$input.label",
    });
    expect(findMissingInput(g, {})).toBe(`--input '{"label":...}'`);
    expect(findMissingInput(g, { label: "New" })).toBeNull();
  });

  it("sees a literal template and a ref template too", () => {
    expect(
      findMissingInput(
        makeGrounding({
          type: GroundingType.PROPERTY_SET,
          targetProperty: "p",
          targetValueLiteral: "$value",
        }),
        {},
      ),
    ).toBe(`--input '{"value":...}'`);
    expect(
      findMissingInput(
        makeGrounding({
          type: GroundingType.PROPERTY_SET,
          targetProperty: "ems__Effort_parent",
          targetValueRef: "$input.parent",
        }),
        {},
      ),
    ).toBe(`--input '{"parent":...}'`);
  });

  it("walks a COMPOSITE and reports the first step that is missing an input", () => {
    // Shape of the real "Set label composite (#3779)": several steps, only one
    // of which consumes the user's input.
    const composite = makeGrounding({
      type: GroundingType.COMPOSITE,
      steps: [
        makeGrounding({
          type: GroundingType.PROPERTY_SET,
          targetProperty: "exo__Asset_label",
          targetValueSubstitution: "$input.label",
        }),
        makeGrounding({
          type: GroundingType.PROPERTY_SET,
          targetProperty: "exo__Asset_updatedAt",
          targetValueSubstitution: "$nowLocal",
        }),
      ],
    });

    expect(findMissingInput(composite, {})).toBe(`--input '{"label":...}'`);
    expect(findMissingInput(composite, { label: "New" })).toBeNull();
  });

  it("stays SILENT about targetValueQuery — its template does not exist yet", () => {
    // The template is produced by running a query, so a pre-flight cannot know
    // what it references. Guessing would refuse calls that succeed — worse than
    // the false-green this issue fixes.
    expect(
      findMissingInput(
        makeGrounding({
          type: GroundingType.PROPERTY_SET,
          targetProperty: "p",
          targetValueQuery: "some-named-query-uid",
        }),
        {},
      ),
    ).toBeNull();
  });

  it("says nothing about a grounding that consumes no input at all", () => {
    expect(
      findMissingInput(
        makeGrounding({
          type: GroundingType.PROPERTY_SET,
          targetProperty: "ems__Effort_status",
          targetValueLiteral: "[[753a44d5]]",
        }),
        undefined,
      ),
    ).toBeNull();
  });
});
