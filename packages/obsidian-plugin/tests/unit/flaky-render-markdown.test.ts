/**
 * Unit tests for scripts/flaky-render-markdown.ts (RFC Phase 3.4 / T4.2).
 */
import {
  parseRenderArgs,
  renderMarkdown,
  sparkline,
  type RenderInput,
} from "../../scripts/flaky-render-markdown";

const SAMPLE: RenderInput = {
  generatedAt: "2026-04-30T12:00:00.000Z",
  schemaVersion: 1,
  rollingWindow: { requestedSize: 30, actualSize: 3, runIds: [3, 2, 1] },
  summary: {
    totalRuns: 3,
    runsWithFlaky: 2,
    totalFlakyOccurrences: 4,
    averageFlakyPerRun: 1.33,
    rerunRatePercent: 66.67,
  },
  perSpec: [
    {
      file: "tests/e2e/login.spec.ts",
      title: "logs in successfully",
      occurrences: 3,
      rerunRate: 100,
      sources: ["flaky-shard-1"],
    },
    {
      file: "tests/e2e/dashboard.spec.ts",
      title: "renders chart | with pipe",
      occurrences: 1,
      rerunRate: 33.33,
      sources: ["flaky-shard-2"],
    },
  ],
  perShard: {
    "shard-1": { runs: 2, flaky: 3 },
    "shard-2": { runs: 1, flaky: 1 },
  },
  perRun: [
    {
      runId: 3,
      createdAt: "2026-04-30T11:00:00.000Z",
      conclusion: "success",
      headSha: "abcdef1234567890",
      totalFlaky: 2,
      sources: ["flaky-shard-1", "flaky-shard-2"],
    },
    {
      runId: 2,
      createdAt: "2026-04-29T11:00:00.000Z",
      conclusion: "success",
      headSha: "1234567890abcdef",
      totalFlaky: 0,
      sources: [],
    },
    {
      runId: 1,
      createdAt: "2026-04-28T11:00:00.000Z",
      conclusion: "success",
      headSha: "fedcba9876543210",
      totalFlaky: 2,
      sources: ["flaky-shard-1"],
    },
  ],
};

describe("flaky-render-markdown / parseRenderArgs", () => {
  it("returns defaults with empty argv", () => {
    expect(parseRenderArgs([])).toEqual({
      input: "packages/obsidian-plugin/docs/FLAKY_DASHBOARD.json",
      output: "packages/obsidian-plugin/docs/FLAKY_DASHBOARD.md",
      topN: 10,
      repo: "kitelev/exocortex",
    });
  });

  it("overrides values from flags", () => {
    const opts = parseRenderArgs([
      "-i",
      "/tmp/in.json",
      "-o",
      "/tmp/out.md",
      "--top",
      "5",
      "--repo",
      "foo/bar",
    ]);
    expect(opts).toEqual({
      input: "/tmp/in.json",
      output: "/tmp/out.md",
      topN: 5,
      repo: "foo/bar",
    });
  });

  it("rejects non-positive --top", () => {
    expect(() => parseRenderArgs(["--top", "0"])).toThrow(/positive integer/);
    expect(() => parseRenderArgs(["--top", "abc"])).toThrow(/positive integer/);
  });

  it("rejects unknown flags", () => {
    expect(() => parseRenderArgs(["--bogus"])).toThrow(/Unknown flag/);
  });
});

describe("flaky-render-markdown / sparkline", () => {
  it("returns empty string for no values", () => {
    expect(sparkline([])).toBe("");
  });

  it("renders all-zero series with the lowest block", () => {
    expect(sparkline([0, 0, 0])).toBe("▁▁▁");
  });

  it("scales values across the block range", () => {
    const out = sparkline([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(out).toHaveLength(8);
    expect(out[0]).toBe("▁");
    expect(out[7]).toBe("█");
  });
});

describe("flaky-render-markdown / renderMarkdown", () => {
  const opts = {
    input: "in.json",
    output: "out.md",
    topN: 10,
    repo: "kitelev/exocortex",
  };

  it("includes snapshot summary fields", () => {
    const md = renderMarkdown(SAMPLE, opts);
    expect(md).toMatch(/# Flaky Test Dashboard/);
    expect(md).toMatch(/Auto-generated/);
    expect(md).toMatch(/Rolling window:\*\* 3 \/ 30 runs/);
    expect(md).toMatch(/Total runs analyzed:\*\* 3/);
    expect(md).toMatch(/66\.67% rerun rate/);
    expect(md).toMatch(/Average flaky\/run:\*\* 1\.33/);
  });

  it("renders trend sparkline in chronological order", () => {
    const md = renderMarkdown(SAMPLE, opts);
    expect(md).toMatch(/## Trend/);
    // Chronological order is 1,2,3 → totalFlaky 2,0,2.
    // First and last values should equal max → "█", middle (0) → "▁".
    expect(md).toMatch(/flaky\/run\s+█▁█/);
    expect(md).toMatch(/min=0  max=2  n=3/);
  });

  it("renders top-N offenders sorted by occurrences with escaped pipes", () => {
    const md = renderMarkdown(SAMPLE, opts);
    expect(md).toMatch(/## Top-10 Offenders/);
    const loginIdx = md.indexOf("login.spec.ts");
    const dashboardIdx = md.indexOf("dashboard.spec.ts");
    expect(loginIdx).toBeGreaterThan(0);
    expect(dashboardIdx).toBeGreaterThan(loginIdx);
    // Pipe in title must be escaped to keep the table valid.
    expect(md).toMatch(/renders chart \\\| with pipe/);
  });

  it("respects --top to limit offender rows", () => {
    const md = renderMarkdown(SAMPLE, { ...opts, topN: 1 });
    expect(md).toMatch(/login\.spec\.ts/);
    expect(md).not.toMatch(/dashboard\.spec\.ts/);
  });

  it("renders per-shard table", () => {
    const md = renderMarkdown(SAMPLE, opts);
    expect(md).toMatch(/## Per-Shard Breakdown/);
    expect(md).toMatch(/\| shard-1 \| 2 \| 3 \|/);
    expect(md).toMatch(/\| shard-2 \| 1 \| 1 \|/);
  });

  it("renders run timeline with run links and short SHA", () => {
    const md = renderMarkdown(SAMPLE, opts);
    expect(md).toMatch(/## Run Timeline \(last 3\)/);
    expect(md).toMatch(
      /\[3\]\(https:\/\/github\.com\/kitelev\/exocortex\/actions\/runs\/3\)/,
    );
    expect(md).toMatch(/`abcdef1`/);
    expect(md).toMatch(/`1234567`/);
  });

  it("handles empty perSpec, perShard, perRun gracefully", () => {
    const empty: RenderInput = {
      ...SAMPLE,
      summary: {
        totalRuns: 0,
        runsWithFlaky: 0,
        totalFlakyOccurrences: 0,
        averageFlakyPerRun: 0,
        rerunRatePercent: 0,
      },
      rollingWindow: { requestedSize: 30, actualSize: 0, runIds: [] },
      perSpec: [],
      perShard: {},
      perRun: [],
    };
    const md = renderMarkdown(empty, opts);
    expect(md).toMatch(/_No runs in window\._/);
    expect(md).toMatch(/_No flaky specs in window\._/);
    expect(md).toMatch(/_No shard-tagged sources in window\._/);
    expect(md).toMatch(/_No runs available\._/);
  });

  it("ends with a trailing newline", () => {
    const md = renderMarkdown(SAMPLE, opts);
    expect(md.endsWith("\n")).toBe(true);
  });
});
