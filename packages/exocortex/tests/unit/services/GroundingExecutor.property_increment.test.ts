/**
 * Tests for the declarative `property_increment` grounding type introduced
 * in Issue #3134 (RFC `18407cb2-9554-4897-9213-17321f9dd434`, Path B).
 *
 * Port of `EffortVotingService.incrementEffortVotes` semantics into the
 * declarative executor branch — counter bump on `ems__Effort_votes` and
 * other integer properties without `service_call` dispatch.
 *
 * AC reference (Issue #3134):
 * - empty (no property)                 → writes integer `delta` (default 1)
 * - existing `votes: 5`, default delta  → writes `votes: 6`
 * - existing `votes: 5`, delta 3        → writes `votes: 8`
 * - existing `votes: 5`, delta -1       → writes `votes: 4`
 * - existing `votes: "abc"`             → success:false with informative error
 */
import {
  GroundingExecutor,
  ServiceRegistry,
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
    id: "gnd-property-increment",
    label: "Property Increment",
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

describe("GroundingExecutor.property_increment (Issue #3134)", () => {
  describe("happy path", () => {
    it("writes default delta when property is absent", async () => {
      const { executor, writer } = makeExecutor(
        "---\nexo__Asset_uid: x\n---\nBody",
      );

      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_INCREMENT,
        targetProperty: "ems__Effort_votes",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
      const written = writer.updateFile.mock.calls[0][1] as string;
      // Default delta 1 + 0 (missing) → 1, emitted as bare YAML int.
      expect(written).toMatch(/ems__Effort_votes:\s*1\b/);
    });

    it("increments existing int by default delta of 1", async () => {
      const { executor, writer } = makeExecutor(
        "---\nems__Effort_votes: 5\n---\nBody",
      );

      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_INCREMENT,
        targetProperty: "ems__Effort_votes",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
      const written = writer.updateFile.mock.calls[0][1] as string;
      expect(written).toMatch(/ems__Effort_votes:\s*6\b/);
    });

    it("applies explicit positive incrementBy delta", async () => {
      const { executor, writer } = makeExecutor(
        "---\nems__Effort_votes: 5\n---\nBody",
      );

      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_INCREMENT,
        targetProperty: "ems__Effort_votes",
        incrementBy: 3,
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
      const written = writer.updateFile.mock.calls[0][1] as string;
      expect(written).toMatch(/ems__Effort_votes:\s*8\b/);
    });

    it("supports negative incrementBy delta (decrement)", async () => {
      const { executor, writer } = makeExecutor(
        "---\nems__Effort_votes: 5\n---\nBody",
      );

      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_INCREMENT,
        targetProperty: "ems__Effort_votes",
        incrementBy: -1,
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
      const written = writer.updateFile.mock.calls[0][1] as string;
      expect(written).toMatch(/ems__Effort_votes:\s*4\b/);
    });

    it("coerces YAML-quoted int string to integer (ontology range invariant)", async () => {
      // RFC R1 mitigation: when source quoting is ambiguous, default to int.
      const { executor, writer } = makeExecutor(
        '---\nems__Effort_votes: "5"\n---\nBody',
      );

      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_INCREMENT,
        targetProperty: "ems__Effort_votes",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
      const written = writer.updateFile.mock.calls[0][1] as string;
      // Output is always bare int — no preserved quoting.
      expect(written).toMatch(/ems__Effort_votes:\s*6\b/);
      expect(written).not.toMatch(/ems__Effort_votes:\s*"6"/);
    });
  });

  describe("error paths", () => {
    it("returns failure when targetProperty is missing", async () => {
      const { executor, writer } = makeExecutor(
        "---\nems__Effort_votes: 5\n---\nBody",
      );

      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_INCREMENT,
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/targetProperty/i);
      expect(writer.updateFile).not.toHaveBeenCalled();
    });

    it("fails fast on non-integer current value", async () => {
      const { executor, writer } = makeExecutor(
        "---\nems__Effort_votes: abc\n---\nBody",
      );

      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_INCREMENT,
        targetProperty: "ems__Effort_votes",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not a valid integer/i);
      expect(result.error).toContain("ems__Effort_votes");
      expect(writer.updateFile).not.toHaveBeenCalled();
    });

    it("fails fast on fractional current value (strict integer literal)", async () => {
      const { executor, writer } = makeExecutor(
        "---\nems__Effort_votes: 1.5\n---\nBody",
      );

      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_INCREMENT,
        targetProperty: "ems__Effort_votes",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not a valid integer/i);
      expect(writer.updateFile).not.toHaveBeenCalled();
    });
  });
});
