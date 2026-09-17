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
import * as yaml from "js-yaml";

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
        appendExpression: "$target.exo__Asset_label",
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
        appendExpression: "$target.exo__Asset_label",
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
        appendExpression: "$target.exo__Asset_label",
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
        appendExpression: "$target.exo__Asset_label",
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
        appendExpression: "$target.exo__Asset_label",
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
        appendExpression: "$target.exo__Asset_label",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/targetProperty/i);
    });

    it("returns failure when appendExpression is missing", async () => {
      const { executor } = makeExecutor(
        '---\nexo__Asset_label: "Foo"\n---\nBody',
      );

      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_APPEND,
        targetProperty: "aliases",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(false);
      // RFC 918a2b65 Phase 2 — error message now references appendExpression
      // (the new canonical predicate) instead of legacy targetValue.
      expect(result.error).toMatch(/appendExpression/i);
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Ticket 4f226028 — the appended alias is written by the SAME YAML escaper as
// the label (`quoteYamlString`), not a hand-built `"${value}"` wrap. Each axis
// parses the written frontmatter with the REAL js-yaml (the parser Obsidian's
// metadataCache and the CLI adapters use): an interior `"` / `\` left
// unescaped makes the whole block unparseable (the incident: req 27fbe40b's
// aliases broke `requirements-trace` on every PR), a swallowed `\` silently
// diverges alias from label.
//
// @req:f7790000-3779-4bbb-8bbb-000000000002
// ────────────────────────────────────────────────────────────────────────────
describe("ticket 4f226028 — aliases entry goes through the YAML escaper (@req:f7790000-3779-4bbb-8bbb-000000000002)", () => {
  const INPUT_APPEND = makeGrounding({
    type: GroundingType.PROPERTY_APPEND,
    targetProperty: "aliases",
    appendExpression: "$input.label", // the real set-label step b36996d5
  });
  const TARGET_APPEND = makeGrounding({
    type: GroundingType.PROPERTY_APPEND,
    targetProperty: "aliases",
    appendExpression: "$target.exo__Asset_label", // Copy Label to Aliases a85668fa
  });

  /** Frontmatter of the written file, parsed by the real js-yaml. */
  function loadWritten(writer: ReturnType<typeof createMockWriter>): {
    written: string;
    fm: Record<string, unknown>;
  } {
    const written = writer.updateFile.mock.calls[0][1] as string;
    const m = /^---\n([\s\S]*?)\n---/.exec(written);
    expect(m).not.toBeNull();
    return {
      written,
      fm: yaml.load((m as RegExpExecArray)[1]) as Record<string, unknown>,
    };
  }

  it.each([
    ["U1 interior double quotes", 'Label with "inner" quotes'],
    ["U2 colon-space + quoted wikilink", 'Key: value (x: "[[y]]", z)'],
    ["U3 hash + backslash", "Note #42 about \\ backslash"],
  ])(
    "%s — $input.label is escaped, the file parses and aliases[0] === label byte-for-byte",
    async (_axis, label) => {
      const { executor, writer } = makeExecutor(
        "---\nexo__Asset_label: Old\n---\nBody",
      );

      const result = await executor.execute(INPUT_APPEND, TARGET_IRI, FILE_PATH, {
        label,
      });

      expect(result.success).toBe(true);
      const { fm } = loadWritten(writer);
      expect(fm.aliases).toEqual([label]);
    },
  );

  it("U1 writes the escaped double-quoted form on the list line", async () => {
    const { executor, writer } = makeExecutor(
      "---\nexo__Asset_label: Old\n---\nBody",
    );

    await executor.execute(INPUT_APPEND, TARGET_IRI, FILE_PATH, {
      label: 'Label with "inner" quotes',
    });

    const { written } = loadWritten(writer);
    expect(written).toContain('  - "Label with \\"inner\\" quotes"');
  });

  it("U4 $target.exo__Asset_label stored ESCAPED on disk round-trips: no double escaping, alias === label", async () => {
    // As `property_set` / the create path write it (serializeYamlScalar).
    const { executor, writer } = makeExecutor(
      '---\nexo__Asset_label: "Key: \\"x\\" \\\\ y"\n---\nBody',
    );

    const result = await executor.execute(TARGET_APPEND, TARGET_IRI, FILE_PATH);

    expect(result.success).toBe(true);
    const { fm } = loadWritten(writer);
    expect(fm.exo__Asset_label).toBe('Key: "x" \\ y');
    expect(fm.aliases).toEqual([fm.exo__Asset_label]);
  });

  it("U5 dedup compares DECODED forms: an escaped stored alias is not appended twice", async () => {
    const { executor, writer } = makeExecutor(
      '---\nexo__Asset_label: "Say \\"hi\\""\naliases:\n  - "Say \\"hi\\""\n---\nBody',
    );

    const result = await executor.execute(TARGET_APPEND, TARGET_IRI, FILE_PATH);

    expect(result.success).toBe(true);
    const { fm } = loadWritten(writer);
    expect(fm.aliases).toEqual(['Say "hi"']);
  });

  it("U6 a $target.<ref-prop> reference keeps its QUOTED wikilink form (never a bare flow sequence)", async () => {
    // Regression guard for the decode change: a stored `"[[uid]]"` decodes to
    // `[[uid]]` and is re-quoted by the escaper — the graph still reads a link.
    const { executor, writer } = makeExecutor(
      '---\nems__Effort_parent: "[[99999999-4f22-4000-8000-000000000009]]"\n---\nBody',
    );
    const grounding = makeGrounding({
      type: GroundingType.PROPERTY_APPEND,
      targetProperty: "exo__Asset_relates",
      appendExpression: "$target.ems__Effort_parent",
    });

    const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

    expect(result.success).toBe(true);
    const { written, fm } = loadWritten(writer);
    expect(written).toContain('  - "[[99999999-4f22-4000-8000-000000000009]]"');
    expect(fm.exo__Asset_relates).toEqual([
      "[[99999999-4f22-4000-8000-000000000009]]",
    ]);
  });

  it("U7 create_instance labelTemplate `$target.exo__Asset_label` over an ESCAPED stored label: the created label parses equal (no double escaping)", async () => {
    // The other production consumer of the `$target.<prop>` decode (9 exocmd
    // groundings carry `labelTemplate: $target.exo__Asset_label …`).
    const { executor, writer } = makeExecutor(
      '---\nexo__Asset_uid: proto-4f22\nexo__Asset_label: "Key: \\"x\\" \\\\ y"\n---\nBody',
    );
    const grounding = makeGrounding({
      type: GroundingType.CREATE_INSTANCE,
      targetClass: "ems__Action",
      targetFolder: "/vault/actions",
      labelTemplate: "$target.exo__Asset_label",
    });

    const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

    expect(result.success).toBe(true);
    const created = writer.createFile.mock.calls[0][1] as string;
    const m = /^---\n([\s\S]*?)\n---/.exec(created);
    expect(m).not.toBeNull();
    const fm = yaml.load((m as RegExpExecArray)[1]) as Record<string, unknown>;
    expect(fm.exo__Asset_label).toBe('Key: "x" \\ y');
  });

  it("U6b property_set with $target.<prop> still fails loud (no frontmatter context) — unchanged by the decode", async () => {
    const { executor, writer } = makeExecutor(
      '---\nems__Effort_parent: "[[99999999-4f22-4000-8000-000000000009]]"\n---\nBody',
    );
    const grounding = makeGrounding({
      type: GroundingType.PROPERTY_SET,
      targetProperty: "exo__Asset_relates",
      targetValueLiteral: "$target.ems__Effort_parent",
    });

    const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/requires target frontmatter context/);
    expect(writer.updateFile).not.toHaveBeenCalled();
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
