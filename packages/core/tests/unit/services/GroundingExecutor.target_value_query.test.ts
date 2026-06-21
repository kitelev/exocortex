/**
 * Unit tests for the property_set `targetValueQuery` value-source
 * (RFC 78c2b7d0 C4 — read-side computes a write-input, the CQRS bridge).
 *
 * Covers:
 *   • IRI scalar → wikilink-form value written
 *   • literal scalar → value written as-is
 *   • $currentAsset auto-injected (= target IRI) into runScalar context
 *   • 4-way cardinality: targetValueQuery + another typed value-source → fail
 *   • fail-loud when no NamedQueryRunner wired
 *   • fail-loud when the query yields no scalar (null)
 *   • fail-loud (with message) when the runner throws
 */

import {
  GroundingExecutor,
  ServiceRegistry,
} from "../../../src/services/GroundingExecutor";
import type {
  NamedQueryRunnerPort,
  NamedQueryScalar,
  NamedQueryContext,
} from "../../../src/services/NamedQueryRunner";
import { GroundingType } from "../../../src/domain/constants/GroundingType";
import { GroundingDefinition } from "../../../src/domain/models/CommandDefinition";

function createMockReader(content?: string) {
  const defaultContent = content || "---\nfoo: bar\n---\nBody";
  return {
    readFile: jest.fn().mockResolvedValue(defaultContent),
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
    id: "gnd-test",
    label: "Test Grounding",
    ...overrides,
  } as unknown as GroundingDefinition;
}

/** Spy runner: records the (uid, context) it was called with, returns a fixed scalar. */
function fakeRunner(
  scalar: NamedQueryScalar | null,
  capture?: { uid?: string; ctx?: NamedQueryContext },
): NamedQueryRunnerPort {
  return {
    async runScalar(queryUid, context) {
      if (capture) {
        capture.uid = queryUid;
        capture.ctx = context;
      }
      return scalar;
    },
  };
}

describe("GroundingExecutor property_set targetValueQuery (C4)", () => {
  const TARGET_IRI = "obsidian://vault/assets/asset-1.md";
  const FILE_PATH = "/vault/assets/asset-1.md";
  let reader: ReturnType<typeof createMockReader>;
  let writer: ReturnType<typeof createMockWriter>;
  let registry: ServiceRegistry;

  beforeEach(() => {
    reader = createMockReader("---\nexo__Asset_isDefinedBy: \"[[src-onto]]\"\n---\nBody");
    writer = createMockWriter();
    registry = new ServiceRegistry();
  });

  it("writes an IRI scalar as a wikilink-form value", async () => {
    const capture: { uid?: string; ctx?: NamedQueryContext } = {};
    const executor = new GroundingExecutor(reader, writer, registry, undefined, {
      namedQueryRunner: fakeRunner(
        { value: "9f1c0b2a-archive", kind: "iri" },
        capture,
      ),
    });
    const grounding = makeGrounding({
      type: GroundingType.PROPERTY_SET,
      targetProperty: "exo__Asset_isDefinedBy",
      targetValueQuery: "namedquery-uid-1",
    });

    const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

    expect(result.success).toBe(true);
    const written = writer.updateFile.mock.calls[0][1];
    expect(written).toContain(
      'exo__Asset_isDefinedBy: "[[9f1c0b2a-archive]]"',
    );
    // $currentAsset auto-injected = the target IRI
    expect(capture.uid).toBe("namedquery-uid-1");
    expect(capture.ctx?.currentAsset).toBe(TARGET_IRI);
  });

  it("writes a literal scalar as-is", async () => {
    reader.readFile.mockResolvedValue("---\nems__Effort_notes: old\n---\nBody");
    const executor = new GroundingExecutor(reader, writer, registry, undefined, {
      namedQueryRunner: fakeRunner({ value: "computed-text", kind: "literal" }),
    });
    const grounding = makeGrounding({
      type: GroundingType.PROPERTY_SET,
      targetProperty: "ems__Effort_notes",
      targetValueQuery: "q-literal",
    });

    const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

    expect(result.success).toBe(true);
    expect(writer.updateFile.mock.calls[0][1]).toContain(
      "ems__Effort_notes: computed-text",
    );
  });

  it("fails on 4-way cardinality (targetValueQuery + targetValueRef)", async () => {
    const executor = new GroundingExecutor(reader, writer, registry, undefined, {
      namedQueryRunner: fakeRunner({ value: "x", kind: "iri" }),
    });
    const grounding = makeGrounding({
      type: GroundingType.PROPERTY_SET,
      targetProperty: "p",
      targetValueQuery: "q",
      targetValueRef: "some-uid",
    });

    const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

    expect(result.success).toBe(false);
    expect(result.error).toContain("more than one");
    expect(result.error).toContain("targetValueQuery");
    expect(writer.updateFile).not.toHaveBeenCalled();
  });

  it("fails loud when no NamedQueryRunner is wired", async () => {
    const executor = new GroundingExecutor(reader, writer, registry); // no options
    const grounding = makeGrounding({
      type: GroundingType.PROPERTY_SET,
      targetProperty: "p",
      targetValueQuery: "q",
    });

    const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

    expect(result.success).toBe(false);
    expect(result.error).toContain("NamedQueryRunner injection");
    expect(writer.updateFile).not.toHaveBeenCalled();
  });

  it("fails loud when the query yields no scalar", async () => {
    const executor = new GroundingExecutor(reader, writer, registry, undefined, {
      namedQueryRunner: fakeRunner(null),
    });
    const grounding = makeGrounding({
      type: GroundingType.PROPERTY_SET,
      targetProperty: "p",
      targetValueQuery: "q-empty",
    });

    const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

    expect(result.success).toBe(false);
    expect(result.error).toContain("no scalar value");
    expect(writer.updateFile).not.toHaveBeenCalled();
  });

  it("fails loud (surfacing the message) when the runner throws", async () => {
    const throwingRunner: NamedQueryRunnerPort = {
      async runScalar() {
        throw new Error("body forbidden: UPDATE rejected");
      },
    };
    const executor = new GroundingExecutor(reader, writer, registry, undefined, {
      namedQueryRunner: throwingRunner,
    });
    const grounding = makeGrounding({
      type: GroundingType.PROPERTY_SET,
      targetProperty: "p",
      targetValueQuery: "q-throws",
    });

    const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

    expect(result.success).toBe(false);
    expect(result.error).toContain("UPDATE rejected");
    expect(writer.updateFile).not.toHaveBeenCalled();
  });
});
