/**
 * Unit tests for scripts/flaky-aggregate.ts (RFC Phase 3.4 / T4.1).
 *
 * The script has two surfaces: pure data functions (parseArgs, normalizeTest,
 * aggregate, readReportsFromDir) and gh-CLI bound collectors. Tests cover the
 * pure surface with synthetic input — no network, no gh dependency.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  aggregate,
  normalizeTest,
  parseArgs,
  readReportsFromDir,
  type AggregateInput,
  type RawFlakyReport,
} from "../../scripts/flaky-aggregate";

describe("flaky-aggregate / parseArgs", () => {
  it("returns defaults with empty argv", () => {
    const opts = parseArgs([]);
    expect(opts).toEqual({
      repo: "kitelev/exocortex",
      workflow: "ci.yml",
      branch: "main",
      limit: 30,
      output: "packages/obsidian-plugin/docs/FLAKY_DASHBOARD.json",
      dryRun: false,
    });
  });

  it("overrides values from flags", () => {
    const opts = parseArgs([
      "--repo",
      "foo/bar",
      "--limit",
      "10",
      "--output",
      "/tmp/out.json",
      "--dry-run",
    ]);
    expect(opts.repo).toBe("foo/bar");
    expect(opts.limit).toBe(10);
    expect(opts.output).toBe("/tmp/out.json");
    expect(opts.dryRun).toBe(true);
  });

  it("rejects non-positive --limit", () => {
    expect(() => parseArgs(["--limit", "0"])).toThrow(/positive integer/);
    expect(() => parseArgs(["--limit", "abc"])).toThrow(/positive integer/);
  });

  it("rejects unknown flags", () => {
    expect(() => parseArgs(["--bogus"])).toThrow(/Unknown flag/);
  });
});

describe("flaky-aggregate / normalizeTest", () => {
  it("handles jest-style fields (name)", () => {
    const t = normalizeTest(
      { file: "a.test.ts", name: "should X", retryCount: 2, duration: 100 },
      "flaky-report-shard-3/flaky-report-shard-3",
    );
    expect(t).toMatchObject({
      file: "a.test.ts",
      title: "should X",
      retryCount: 2,
      duration: 100,
      shard: "shard-3",
    });
  });

  it("handles playwright-style fields (title, project)", () => {
    const t = normalizeTest(
      {
        file: "smoke.spec.ts",
        title: "renders",
        retryCount: 1,
        duration: 5000,
        project: "obsidian-electron",
      },
      "flaky-test-report-component/flaky-report-playwright",
    );
    expect(t.title).toBe("renders");
    expect(t.project).toBe("obsidian-electron");
    expect(t.shard).toBeUndefined();
  });

  it("coerces bad numerics to 0", () => {
    const t = normalizeTest(
      { file: "x", title: "y", retryCount: "nan" as unknown as number },
      "src",
    );
    expect(t.retryCount).toBe(0);
    expect(t.duration).toBe(0);
  });
});

describe("flaky-aggregate / aggregate", () => {
  const baseReport = (count: number, file = "spec.test.ts"): RawFlakyReport => ({
    timestamp: "2026-04-30T00:00:00Z",
    totalFlaky: count,
    tests: Array.from({ length: count }, (_, i) => ({
      file,
      name: `case ${i}`,
      retryCount: 1,
      duration: 10,
    })),
    summary: { totalTests: 100, flakyPercentage: count },
  });

  it("returns empty-shaped output for empty input", () => {
    const out = aggregate({ runs: [] }, 30);
    expect(out.summary).toEqual({
      totalRuns: 0,
      runsWithFlaky: 0,
      totalFlakyOccurrences: 0,
      averageFlakyPerRun: 0,
      rerunRatePercent: 0,
    });
    expect(out.perSpec).toEqual([]);
    expect(out.perShard).toEqual({});
    expect(out.rollingWindow.requestedSize).toBe(30);
    expect(out.rollingWindow.actualSize).toBe(0);
  });

  it("aggregates across runs and computes rerunRate", () => {
    const input: AggregateInput = {
      runs: [
        {
          meta: {
            runId: 100,
            createdAt: "2026-04-30T01:00:00Z",
            conclusion: "success",
            headSha: "a1",
          },
          reports: [
            { source: "flaky-report-shard-1/flaky-report-shard-1", report: baseReport(2) },
          ],
        },
        {
          meta: {
            runId: 101,
            createdAt: "2026-04-30T02:00:00Z",
            conclusion: "success",
            headSha: "a2",
          },
          reports: [
            { source: "flaky-report-shard-1/flaky-report-shard-1", report: baseReport(1) },
          ],
        },
        {
          meta: {
            runId: 102,
            createdAt: "2026-04-30T03:00:00Z",
            conclusion: "success",
            headSha: "a3",
          },
          reports: [
            { source: "flaky-report-shard-2/flaky-report-shard-2", report: baseReport(0) },
          ],
        },
      ],
    };

    const out = aggregate(input, 30);
    expect(out.summary.totalRuns).toBe(3);
    expect(out.summary.runsWithFlaky).toBe(2);
    expect(out.summary.totalFlakyOccurrences).toBe(3);
    expect(out.summary.rerunRatePercent).toBeCloseTo(66.67, 1);
    expect(out.summary.averageFlakyPerRun).toBe(1);

    expect(out.perShard["shard-1"]).toEqual({ runs: 2, flaky: 3 });
    expect(out.perShard["shard-2"]).toEqual({ runs: 1, flaky: 0 });

    // run 100 contributes case 0 + case 1; run 101 contributes case 0; run 102 has no tests
    expect(out.perSpec).toHaveLength(2);
    expect(out.perSpec[0].occurrences).toBe(2); // "case 0" appears in 2 runs
    expect(out.perSpec[1].occurrences).toBe(1); // "case 1" appears once

    expect(out.perRun.map((r) => r.runId)).toEqual([102, 101, 100]);
    expect(out.rollingWindow.runIds).toContain(100);
  });

  it("groups same (file,title) across runs into single perSpec entry", () => {
    const same = {
      file: "a.test.ts",
      name: "shared",
      retryCount: 1,
      duration: 1,
    };
    const report: RawFlakyReport = {
      tests: [same],
      totalFlaky: 1,
      summary: { totalTests: 10, flakyPercentage: 10 },
    };
    const input: AggregateInput = {
      runs: [
        {
          meta: { runId: 1, createdAt: "x", conclusion: "success", headSha: "h" },
          reports: [{ source: "flaky-report-shard-1/x", report }],
        },
        {
          meta: { runId: 2, createdAt: "y", conclusion: "success", headSha: "h" },
          reports: [{ source: "flaky-report-shard-1/x", report }],
        },
      ],
    };
    const out = aggregate(input, 30);
    expect(out.perSpec).toHaveLength(1);
    expect(out.perSpec[0]).toMatchObject({
      file: "a.test.ts",
      title: "shared",
      occurrences: 2,
      rerunRate: 100,
    });
  });
});

describe("flaky-aggregate / readReportsFromDir", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "flaky-agg-test-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns empty array for missing directory", () => {
    expect(readReportsFromDir(path.join(tmp, "nope"))).toEqual([]);
  });

  it("skips non-flaky-named JSON files", () => {
    fs.writeFileSync(path.join(tmp, "other.json"), "{}");
    expect(readReportsFromDir(tmp)).toEqual([]);
  });

  it("loads matching report files recursively", () => {
    const sub = path.join(tmp, "flaky-report-shard-1");
    fs.mkdirSync(sub);
    fs.writeFileSync(
      path.join(sub, "flaky-report-shard-1.json"),
      JSON.stringify({ totalFlaky: 0, tests: [] }),
    );
    fs.writeFileSync(
      path.join(tmp, "flaky-report-playwright.json"),
      JSON.stringify({ totalFlaky: 1, tests: [{ file: "x", title: "y" }] }),
    );
    const reports = readReportsFromDir(tmp);
    expect(reports).toHaveLength(2);
    const sources = reports.map((r) => r.source).sort();
    expect(sources[0]).toMatch(/flaky-report-playwright/);
    expect(sources[1]).toMatch(/flaky-report-shard-1/);
  });

  it("skips unreadable JSON without throwing", () => {
    fs.writeFileSync(path.join(tmp, "flaky-report.json"), "not-json{");
    expect(() => readReportsFromDir(tmp)).not.toThrow();
    expect(readReportsFromDir(tmp)).toEqual([]);
  });
});
