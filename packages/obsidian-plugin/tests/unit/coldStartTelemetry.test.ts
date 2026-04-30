import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  emitColdStartStep,
  percentile,
  summarizeColdStartTelemetry,
} from "../e2e/utils/coldStartTelemetry";

describe("coldStartTelemetry", () => {
  let tmpDir: string;
  let logPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-tel-"));
    logPath = path.join(tmpDir, "cold-start.jsonl");
  });

  afterEach(() => {
    delete process.env.COLD_START_TELEMETRY_LOG;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("percentile", () => {
    it("returns null for empty input", () => {
      expect(percentile([], 50)).toBeNull();
    });

    it("returns the single sample when n=1", () => {
      expect(percentile([42], 50)).toBe(42);
      expect(percentile([42], 99)).toBe(42);
    });

    it("computes P50/P95/P99 with linear interpolation", () => {
      const samples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      expect(percentile(samples, 50)).toBeCloseTo(5.5, 5);
      expect(percentile(samples, 95)).toBeCloseTo(9.55, 5);
      expect(percentile(samples, 99)).toBeCloseTo(9.91, 5);
    });

    it("rejects out-of-range p", () => {
      expect(() => percentile([1, 2], -1)).toThrow(RangeError);
      expect(() => percentile([1, 2], 101)).toThrow(RangeError);
    });
  });

  describe("emitColdStartStep + summarizeColdStartTelemetry", () => {
    it("appends JSONL records when COLD_START_TELEMETRY_LOG is set", () => {
      process.env.COLD_START_TELEMETRY_LOG = logPath;
      emitColdStartStep({
        step: "plugin_load",
        ms: 2500,
        spec: "demo.spec.ts",
        shard: "1",
        context: "node",
      });
      emitColdStartStep({
        step: "plugin_load",
        ms: 3500,
        spec: "demo.spec.ts",
        shard: "1",
        context: "node",
      });

      const raw = fs.readFileSync(logPath, "utf8").trim().split("\n");
      expect(raw).toHaveLength(2);
      const first = JSON.parse(raw[0]);
      expect(first.step).toBe("plugin_load");
      expect(first.ms).toBe(2500);
      expect(typeof first.ts).toBe("number");
    });

    it("is silent (no throw) when log path is unset", () => {
      delete process.env.COLD_START_TELEMETRY_LOG;
      expect(() =>
        emitColdStartStep({
          step: "container_start",
          ms: 100,
          context: "shell",
        }),
      ).not.toThrow();
    });

    it("aggregates per-step P50/P95/P99 from JSONL", () => {
      process.env.COLD_START_TELEMETRY_LOG = logPath;
      for (const ms of [100, 200, 300, 400, 500]) {
        emitColdStartStep({ step: "plugin_load", ms, context: "node" });
      }
      for (const ms of [10, 20, 30]) {
        emitColdStartStep({ step: "container_start", ms, context: "shell" });
      }

      const stats = summarizeColdStartTelemetry(logPath);
      expect(stats.plugin_load).toBeDefined();
      expect(stats.plugin_load!.count).toBe(5);
      expect(stats.plugin_load!.p50).toBeCloseTo(300, 5);
      expect(stats.container_start!.count).toBe(3);
      expect(stats.vault_index).toBeUndefined();
    });

    it("returns empty stats when log file is missing", () => {
      const stats = summarizeColdStartTelemetry(path.join(tmpDir, "missing.jsonl"));
      expect(stats).toEqual({});
    });

    it("skips malformed JSONL lines without throwing", () => {
      fs.writeFileSync(
        logPath,
        [
          JSON.stringify({ ts: 1, step: "plugin_load", ms: 100, context: "node" }),
          "not-json",
          JSON.stringify({ ts: 2, step: "plugin_load", ms: 200, context: "node" }),
        ].join("\n") + "\n",
        "utf8",
      );
      const stats = summarizeColdStartTelemetry(logPath);
      expect(stats.plugin_load!.count).toBe(2);
    });
  });
});
