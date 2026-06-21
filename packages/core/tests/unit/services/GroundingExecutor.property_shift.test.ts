/**
 * Tests for the declarative `property_shift` grounding type introduced in
 * Issue #3134 (RFC `18407cb2-9554-4897-9213-17321f9dd434`, Path B).
 *
 * Port of `TaskStatusService.shiftDay{Forward,Backward}` semantics into the
 * declarative executor branch — date arithmetic on
 * `ems__Effort_plannedStartTimestamp` and similar dateTime properties
 * without `service_call` dispatch.
 *
 * AC reference (Issue #3134):
 * - `P1D` forward                       → +1 day
 * - `-PT2H` backward                    → −2 hours
 * - `P1M` month forward                 → +1 month (JS setMonth semantics)
 * - non-datetime current value          → success:false
 * - invalid duration literal            → success:false
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
    id: "gnd-property-shift",
    label: "Property Shift",
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

describe("GroundingExecutor.property_shift (Issue #3134)", () => {
  describe("happy path — day-time durations", () => {
    it("shifts forward by P1D (one day)", async () => {
      const { executor, writer } = makeExecutor(
        "---\nems__Effort_plannedStartTimestamp: 2026-05-17T10:00:00\n---\nBody",
      );

      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_SHIFT,
        targetProperty: "ems__Effort_plannedStartTimestamp",
        shiftDelta: "P1D",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
      const written = writer.updateFile.mock.calls[0][1] as string;
      // Local timestamp form — no Z suffix.
      expect(written).toMatch(
        /ems__Effort_plannedStartTimestamp:\s*2026-05-18T10:00:00\b/,
      );
      expect(written).not.toContain("2026-05-18T10:00:00Z");
    });

    it("shifts backward by -PT2H (two hours)", async () => {
      const { executor, writer } = makeExecutor(
        "---\nems__Effort_plannedStartTimestamp: 2026-05-17T10:00:00\n---\nBody",
      );

      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_SHIFT,
        targetProperty: "ems__Effort_plannedStartTimestamp",
        shiftDelta: "-PT2H",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
      const written = writer.updateFile.mock.calls[0][1] as string;
      expect(written).toMatch(
        /ems__Effort_plannedStartTimestamp:\s*2026-05-17T08:00:00\b/,
      );
    });

    it("supports backward P1D as -P1D", async () => {
      const { executor, writer } = makeExecutor(
        "---\nems__Effort_plannedStartTimestamp: 2026-05-17T00:00:00\n---\nBody",
      );

      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_SHIFT,
        targetProperty: "ems__Effort_plannedStartTimestamp",
        shiftDelta: "-P1D",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
      const written = writer.updateFile.mock.calls[0][1] as string;
      expect(written).toMatch(
        /ems__Effort_plannedStartTimestamp:\s*2026-05-16T00:00:00\b/,
      );
    });
  });

  describe("happy path — year-month durations", () => {
    it("shifts forward by P1M (one month)", async () => {
      const { executor, writer } = makeExecutor(
        "---\nems__Effort_plannedStartTimestamp: 2026-05-15T10:00:00\n---\nBody",
      );

      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_SHIFT,
        targetProperty: "ems__Effort_plannedStartTimestamp",
        shiftDelta: "P1M",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
      const written = writer.updateFile.mock.calls[0][1] as string;
      expect(written).toMatch(
        /ems__Effort_plannedStartTimestamp:\s*2026-06-15T10:00:00\b/,
      );
    });

    it("Jan 31 + P1M overflows into March per JS Date.setMonth semantics", async () => {
      // Documented behaviour (RFC R2 mitigation): we inherit JS Date contract,
      // do not invent leap-year compensation. Jan 31 → setMonth(+1) lands on
      // Mar 03 in non-leap years (Feb has 28 days, 31 % 28 = 3).
      const { executor, writer } = makeExecutor(
        "---\nems__Effort_plannedStartTimestamp: 2027-01-31T00:00:00\n---\nBody",
      );

      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_SHIFT,
        targetProperty: "ems__Effort_plannedStartTimestamp",
        shiftDelta: "P1M",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
      const written = writer.updateFile.mock.calls[0][1] as string;
      // 2027 is not a leap year — Feb has 28 days, Jan 31 + 1 month → Mar 03.
      expect(written).toMatch(
        /ems__Effort_plannedStartTimestamp:\s*2027-03-03T00:00:00\b/,
      );
    });
  });

  describe("error paths", () => {
    it("returns failure when targetProperty is missing", async () => {
      const { executor, writer } = makeExecutor(
        "---\nems__Effort_plannedStartTimestamp: 2026-05-17T10:00:00\n---\nBody",
      );

      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_SHIFT,
        shiftDelta: "P1D",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/targetProperty/i);
      expect(writer.updateFile).not.toHaveBeenCalled();
    });

    it("returns failure when shiftDelta is missing", async () => {
      const { executor, writer } = makeExecutor(
        "---\nems__Effort_plannedStartTimestamp: 2026-05-17T10:00:00\n---\nBody",
      );

      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_SHIFT,
        targetProperty: "ems__Effort_plannedStartTimestamp",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/shiftDelta/i);
      expect(writer.updateFile).not.toHaveBeenCalled();
    });

    it("fails fast when target property is absent on asset", async () => {
      const { executor, writer } = makeExecutor("---\nfoo: bar\n---\nBody");

      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_SHIFT,
        targetProperty: "ems__Effort_plannedStartTimestamp",
        shiftDelta: "P1D",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not set/i);
      expect(writer.updateFile).not.toHaveBeenCalled();
    });

    it("fails fast on non-datetime current value", async () => {
      const { executor, writer } = makeExecutor(
        "---\nems__Effort_plannedStartTimestamp: not-a-date\n---\nBody",
      );

      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_SHIFT,
        targetProperty: "ems__Effort_plannedStartTimestamp",
        shiftDelta: "P1D",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not a valid datetime/i);
      expect(writer.updateFile).not.toHaveBeenCalled();
    });

    it("fails fast on invalid ISO-8601 duration literal", async () => {
      const { executor, writer } = makeExecutor(
        "---\nems__Effort_plannedStartTimestamp: 2026-05-17T10:00:00\n---\nBody",
      );

      const grounding = makeGrounding({
        type: GroundingType.PROPERTY_SHIFT,
        targetProperty: "ems__Effort_plannedStartTimestamp",
        shiftDelta: "1day",
      });

      const result = await executor.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/invalid shiftDelta/i);
      expect(writer.updateFile).not.toHaveBeenCalled();
    });
  });
});
