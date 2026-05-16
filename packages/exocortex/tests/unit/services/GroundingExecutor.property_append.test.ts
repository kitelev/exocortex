/**
 * Tests for the declarative `property_append` grounding type and the
 * `$target.<propertyName>` substitution introduced in Issue #3132.
 *
 * These cases port the behavior expectations from the (still-extant) palette
 * service `LabelToAliasService` to the new declarative executor branch.
 * Once Path B (sparql_update) lands, the palette command itself may be
 * deprecated; the executor-layer coverage here is the new source of truth for
 * "copy label to aliases" semantics in the grounding pipeline.
 *
 * AC reference (Issue #3132):
 * - asset with label "Foo" + no aliases     → aliases: ["Foo"]
 * - asset with label "Foo" + aliases [Bar]  → aliases: [Bar, "Foo"]
 * - asset with label "Foo" + aliases [Foo]  → aliases: [Foo] (no duplicate)
 * - asset without exo__Asset_label          → executor returns success:false
 *   with informative message
 */
import {
  GroundingExecutor,
  ServiceRegistry,
} from "../../../src/services/GroundingExecutor";
import { GroundingType } from "../../../src/domain/constants/GroundingType";
import { GroundingDefinition } from "../../../src/domain/models/CommandDefinition";

// -- Mocks --

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
    id: "gnd-property-append",
    label: "Property Append",
    ...overrides,
  } as unknown as GroundingDefinition;
}

const TARGET_IRI = "https://exocortex.my/assets/test-asset-123";
const FILE_PATH = "/vault/test-asset.md";

function makeExecutor(content: string): {
  executor: GroundingExecutor;
  reader: ReturnType<typeof createMockReader>;
  writer: ReturnType<typeof createMockWriter>;
} {
  const reader = createMockReader(content);
  const writer = createMockWriter();
  const registry = new ServiceRegistry();
  const executor = new GroundingExecutor(reader, writer, registry);
  return { executor, reader, writer };
}

describe("GroundingExecutor.property_append (Issue #3132)", () => {
  describe("happy path", () => {
    it("appends $target.exo__Asset_label to empty aliases", async () => {
      const { executor, writer } = makeExecutor(
        '---\nexo__Asset_label: "Foo"\n---\nBody',
      );

      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_APPEND,
        targetProperty: "aliases",
        targetValue: "$target.exo__Asset_label",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
      const written = writer.updateFile.mock.calls[0][1] as string;
      expect(written).toContain("aliases:");
      expect(written).toContain('  - "Foo"');
    });

    it("appends to existing aliases array without removing prior items", async () => {
      const { executor, writer } = makeExecutor(
        '---\nexo__Asset_label: "Foo"\naliases:\n  - "Bar"\n---\nBody',
      );

      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_APPEND,
        targetProperty: "aliases",
        targetValue: "$target.exo__Asset_label",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
      const written = writer.updateFile.mock.calls[0][1] as string;
      expect(written).toContain('  - "Bar"');
      expect(written).toContain('  - "Foo"');
    });

    it("is idempotent — does not duplicate value already in array", async () => {
      const { executor, writer } = makeExecutor(
        '---\nexo__Asset_label: "Foo"\naliases:\n  - "Foo"\n---\nBody',
      );

      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_APPEND,
        targetProperty: "aliases",
        targetValue: "$target.exo__Asset_label",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
      const written = writer.updateFile.mock.calls[0][1] as string;
      const fooCount = (written.match(/- "Foo"/g) ?? []).length;
      expect(fooCount).toBe(1);
    });
  });

  describe("$target.<prop> substitution", () => {
    it("resolves $target.<prop> from target frontmatter scalar value", async () => {
      const { executor, writer } = makeExecutor(
        '---\nexo__Asset_label: "Hello"\n---\nBody',
      );

      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_APPEND,
        targetProperty: "aliases",
        targetValue: "$target.exo__Asset_label",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
      const written = writer.updateFile.mock.calls[0][1] as string;
      expect(written).toContain('  - "Hello"');
    });

    it("returns failure with informative message when $target.<prop> is undefined on target", async () => {
      const { executor, writer } = makeExecutor(
        "---\nfoo: bar\n---\nBody",
      );

      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_APPEND,
        targetProperty: "aliases",
        targetValue: "$target.exo__Asset_label",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(false);
      expect(result.error).toContain("exo__Asset_label");
      expect(result.error).toContain(TARGET_IRI);
      expect(writer.updateFile).not.toHaveBeenCalled();
    });
  });

  describe("error paths", () => {
    it("returns failure when targetProperty is missing", async () => {
      const { executor } = makeExecutor(
        '---\nexo__Asset_label: "Foo"\n---\nBody',
      );

      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_APPEND,
        targetValue: "$target.exo__Asset_label",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/targetProperty/i);
    });

    it("returns failure when targetValue is missing", async () => {
      const { executor } = makeExecutor(
        '---\nexo__Asset_label: "Foo"\n---\nBody',
      );

      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_APPEND,
        targetProperty: "aliases",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/targetValue/i);
    });
  });
});

describe("GroundingExecutor.substituteVariables — $target.<prop> (Issue #3132)", () => {
  function makeBareExecutor(): GroundingExecutor {
    const reader = createMockReader("");
    const writer = createMockWriter();
    return new GroundingExecutor(reader, writer, new ServiceRegistry());
  }

  it("resolves dotted-property access ahead of bare $target", () => {
    const executor = makeBareExecutor();
    const result = executor.substituteVariables(
      "$target.exo__Asset_label",
      TARGET_IRI,
      undefined,
      { exo__Asset_label: '"Foo"' },
    );
    // Quotes are stripped during scalar substitution.
    expect(result).toBe("Foo");
  });

  it("still substitutes bare $target after extraction", () => {
    const executor = makeBareExecutor();
    const result = executor.substituteVariables(
      "see $target for context",
      TARGET_IRI,
      undefined,
      {},
    );
    expect(result).toBe(`see ${TARGET_IRI} for context`);
  });

  it("throws when $target.<prop> resolves to undefined", () => {
    const executor = makeBareExecutor();
    expect(() =>
      executor.substituteVariables(
        "$target.nonexistentProp",
        TARGET_IRI,
        undefined,
        { exo__Asset_label: "Foo" },
      ),
    ).toThrow(/nonexistentProp/);
  });

  it("throws when $target.<prop> resolves to an array", () => {
    const executor = makeBareExecutor();
    expect(() =>
      executor.substituteVariables(
        "$target.aliases",
        TARGET_IRI,
        undefined,
        { aliases: ["a", "b"] },
      ),
    ).toThrow(/array/);
  });

  it("throws when $target.<prop> is used without frontmatter context", () => {
    const executor = makeBareExecutor();
    expect(() =>
      executor.substituteVariables(
        "$target.someProp",
        TARGET_IRI,
        undefined,
      ),
    ).toThrow(/someProp/);
  });
});
