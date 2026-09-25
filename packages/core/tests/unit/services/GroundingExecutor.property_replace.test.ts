/**
 * `property_replace` — swap EXACTLY ONE value of an array-typed frontmatter
 * property.
 *
 * ⛔ One measured qualification the enum docstring carries in full, named here so
 * this file is not read as proving more than it does:
 *   - R4 shows the list SHRINKING by one when `to` is already present — set
 *     semantics, so count is not preserved even though order is.
 *
 * ⛤ A second qualification ("co-values survive for the TWO-SPACE list-item shape
 * only — a block-scalar item makes `FrontmatterService.parseObject` drop every
 * item after it") was true when this file was written and is **lifted** by issue
 * #4314. The shapes it named are covered by
 * `tests/unit/utilities/FrontmatterService.list-continuation-4314.test.ts`,
 * which drives THIS executor on each of them; the axes below stay on the
 * two-space shape and say nothing about the others.
 *
 * Requirement `02de55a4-0a07-4347-b434-bb4a48eb0163` (issue #4308).
 *
 * Why the type exists at all: the three pre-existing list primitives operate on
 * the property as a WHOLE — `property_set` replaces the value, `property_delete`
 * removes the property, `property_append` only adds — so there was no sanctioned
 * way to swap one element. Measured 2026-09-20: 103 of 644 property definitions
 * across the three canonical vaults (15 %) carry two or more classes in
 * `exo__Instance_class`, so a whole-value replace would silently drop their
 * co-classes.
 */
import {
  GroundingExecutor,
  ServiceRegistry,
} from "../../../src/services/GroundingExecutor";
import { GroundingType } from "../../../src/domain/constants/GroundingType";
import { GroundingDefinition } from "../../../src/domain/models/CommandDefinition";
import * as yaml from "js-yaml";

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
    id: "gnd-property-replace",
    label: "Property Replace",
    type: GroundingType.PROPERTY_REPLACE,
    ...overrides,
  } as unknown as GroundingDefinition;
}

const TARGET_IRI = "https://exocortex.my/assets/test-asset-123";
const FILE_PATH = "/vault/test-asset.md";

function makeExecutor(content: string): {
  executor: GroundingExecutor;
  writer: ReturnType<typeof createMockWriter>;
} {
  const reader = createMockReader(content);
  const writer = createMockWriter();
  const executor = new GroundingExecutor(reader, writer, new ServiceRegistry());
  return { executor, writer };
}

/** Parse the frontmatter of what was actually written to disk. */
function writtenList(
  writer: ReturnType<typeof createMockWriter>,
  property: string,
): unknown {
  const written = writer.updateFile.mock.calls[0][1] as string;
  const fm = /^---\n([\s\S]*?)\n---/.exec(written);
  const parsed = yaml.load(fm![1]) as Record<string, unknown>;
  return parsed[property];
}

const OBJECT_PROPERTY = "[[9a1cf31c-9d41-4ef3-9023-584a8d087d16]]";
const DATATYPE_PROPERTY = "[[ae56ca4c-b610-42a4-a25d-058c23673296]]";
const NON_INHERITABLE = "[[a1f9bca8-6580-458c-bfdb-08579fe357e0]]";

describe("GroundingExecutor.property_replace (@req:02de55a4-0a07-4347-b434-bb4a48eb0163)", () => {
  it('R1 co-values survive: the named element is swapped, the rest keep value AND order', async () => {
    // The carrying case — the 15 % of property definitions with a co-class.
    const { executor, writer } = makeExecutor(
      `---\nexo__Instance_class:\n  - "${OBJECT_PROPERTY}"\n  - "${NON_INHERITABLE}"\n---\nBody`,
    );

    const result = await executor.execute(
      makeGrounding({
        targetProperty: "exo__Instance_class",
        replaceFromExpression: `"${OBJECT_PROPERTY}"`,
        replaceToExpression: `"${DATATYPE_PROPERTY}"`,
      }),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(result.success).toBe(true);
    expect(writtenList(writer, "exo__Instance_class")).toEqual([
      DATATYPE_PROPERTY,
      NON_INHERITABLE,
    ]);
  });

  it("R2 single-element list: result matches what a whole-value set would produce", async () => {
    const { executor, writer } = makeExecutor(
      `---\nexo__Instance_class:\n  - "${OBJECT_PROPERTY}"\n---\nBody`,
    );

    const result = await executor.execute(
      makeGrounding({
        targetProperty: "exo__Instance_class",
        replaceFromExpression: `"${OBJECT_PROPERTY}"`,
        replaceToExpression: `"${DATATYPE_PROPERTY}"`,
      }),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(result.success).toBe(true);
    expect(writtenList(writer, "exo__Instance_class")).toEqual([
      DATATYPE_PROPERTY,
    ]);
  });

  it("R3 absent `from` is a REFUSAL, not an append — and nothing is written", async () => {
    // ⛔ Load-bearing: without this guard the type degenerates into
    // property_append on every miss and silently produces the contradictory
    // two-value state it exists to prevent.
    const { executor, writer } = makeExecutor(
      `---\nexo__Instance_class:\n  - "${NON_INHERITABLE}"\n---\nBody`,
    );

    const result = await executor.execute(
      makeGrounding({
        targetProperty: "exo__Instance_class",
        replaceFromExpression: `"${OBJECT_PROPERTY}"`,
        replaceToExpression: `"${DATATYPE_PROPERTY}"`,
      }),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("exo__Instance_class");
    expect(result.error).toContain(OBJECT_PROPERTY);
    expect(writer.updateFile).not.toHaveBeenCalled();
  });

  it("R4 `to` already present elsewhere: the value is not duplicated", async () => {
    const { executor, writer } = makeExecutor(
      `---\nexo__Instance_class:\n  - "${OBJECT_PROPERTY}"\n  - "${DATATYPE_PROPERTY}"\n---\nBody`,
    );

    const result = await executor.execute(
      makeGrounding({
        targetProperty: "exo__Instance_class",
        replaceFromExpression: `"${OBJECT_PROPERTY}"`,
        replaceToExpression: `"${DATATYPE_PROPERTY}"`,
      }),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(result.success).toBe(true);
    expect(writtenList(writer, "exo__Instance_class")).toEqual([
      DATATYPE_PROPERTY,
    ]);
  });

  it("R5 a scalar value is refused, naming property_set — the YAML shape is not silently changed", async () => {
    const { executor, writer } = makeExecutor(
      `---\nexo__Asset_label: "Foo"\n---\nBody`,
    );

    const result = await executor.execute(
      makeGrounding({
        targetProperty: "exo__Asset_label",
        replaceFromExpression: '"Foo"',
        replaceToExpression: '"Bar"',
      }),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("property_set");
    expect(writer.updateFile).not.toHaveBeenCalled();
  });

  it("R6 missing replaceFromExpression is refused", async () => {
    const { executor, writer } = makeExecutor(
      `---\nexo__Instance_class:\n  - "${OBJECT_PROPERTY}"\n---\nBody`,
    );

    const result = await executor.execute(
      makeGrounding({
        targetProperty: "exo__Instance_class",
        replaceToExpression: `"${DATATYPE_PROPERTY}"`,
      }),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("replaceFromExpression");
    expect(writer.updateFile).not.toHaveBeenCalled();
  });

  it("R7 missing replaceToExpression is refused", async () => {
    const { executor, writer } = makeExecutor(
      `---\nexo__Instance_class:\n  - "${OBJECT_PROPERTY}"\n---\nBody`,
    );

    const result = await executor.execute(
      makeGrounding({
        targetProperty: "exo__Instance_class",
        replaceFromExpression: `"${OBJECT_PROPERTY}"`,
      }),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("replaceToExpression");
    expect(writer.updateFile).not.toHaveBeenCalled();
  });

  it("R9 missing targetProperty is refused by name, not by the list-shape check", async () => {
    // Without its own guard this input still fails — but through the
    // "not a list" branch, which tells the author to use property_set on a
    // grounding that names no property at all.
    const { executor, writer } = makeExecutor(
      `---\nexo__Instance_class:\n  - "${OBJECT_PROPERTY}"\n---\nBody`,
    );

    const result = await executor.execute(
      makeGrounding({
        replaceFromExpression: `"${OBJECT_PROPERTY}"`,
        replaceToExpression: `"${DATATYPE_PROPERTY}"`,
      }),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("targetProperty");
    expect(writer.updateFile).not.toHaveBeenCalled();
  });

  it("R8 control — the neighbouring property_append branch is untouched", async () => {
    // Stays GREEN under every mutant of this diff: it proves the new branch did
    // not disturb the primitive it sits next to.
    const { executor, writer } = makeExecutor(
      '---\nexo__Asset_label: "Foo"\naliases:\n  - "Bar"\n---\nBody',
    );

    const result = await executor.execute(
      makeGrounding({
        type: GroundingType.PROPERTY_APPEND,
        targetProperty: "aliases",
        appendExpression: "$target.exo__Asset_label",
      }),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(result.success).toBe(true);
    expect(writtenList(writer, "aliases")).toEqual(["Bar", "Foo"]);
  });
});
