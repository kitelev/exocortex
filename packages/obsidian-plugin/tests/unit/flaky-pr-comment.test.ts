/**
 * Unit tests for scripts/flaky-pr-comment.ts (RFC Phase 3.4 / T4.3).
 *
 * Coverage focuses on the pure helpers — argument parsing, PR-number
 * extraction, trend formatting, and the markdown body renderer. Network /
 * filesystem paths (collectWindows, runPRCommentCli) are exercised separately
 * via the workflow itself; isolating pure logic here keeps the test fast and
 * deterministic.
 */
import {
  STICKY_MARKER,
  extractPullNumberFromCommit,
  formatTrendDelta,
  parsePRCommentArgs,
  renderPRComment,
} from "../../scripts/flaky-pr-comment";
import type { AggregateOutput } from "../../scripts/flaky-aggregate";

function aggOutput(overrides: Partial<AggregateOutput> = {}): AggregateOutput {
  return {
    generatedAt: "2026-04-30T12:00:00.000Z",
    schemaVersion: 1,
    rollingWindow: { requestedSize: 30, actualSize: 30, runIds: [] },
    summary: {
      totalRuns: 30,
      runsWithFlaky: 6,
      totalFlakyOccurrences: 9,
      averageFlakyPerRun: 0.3,
      rerunRatePercent: 20,
    },
    perSpec: [],
    perShard: {},
    perRun: [],
    ...overrides,
  };
}

describe("flaky-pr-comment / extractPullNumberFromCommit", () => {
  it("extracts trailing (#N) from a squash-merge subject", () => {
    expect(
      extractPullNumberFromCommit("feat(rfc-024): T7.2 file explorer (#2972)"),
    ).toBe(2972);
  });

  it("returns last (#N) when multiple appear", () => {
    expect(
      extractPullNumberFromCommit("revert (#100), supersedes (#42) (#999)"),
    ).toBe(999);
  });

  it("returns null when no PR token present", () => {
    expect(extractPullNumberFromCommit("hotfix: ad-hoc commit")).toBeNull();
  });

  it("ignores hash-without-paren tokens like #1234", () => {
    expect(extractPullNumberFromCommit("fix #1234 — manual commit")).toBeNull();
  });

  it("tolerates empty input", () => {
    expect(extractPullNumberFromCommit("")).toBeNull();
  });
});

describe("flaky-pr-comment / formatTrendDelta", () => {
  it("flags worsening (current > prior + 0.5)", () => {
    expect(formatTrendDelta(25, 20)).toEqual({
      delta: 5,
      arrow: "↑",
      label: "worse",
    });
  });

  it("flags improvement (current < prior − 0.5)", () => {
    expect(formatTrendDelta(8.5, 20)).toEqual({
      delta: -11.5,
      arrow: "↓",
      label: "better",
    });
  });

  it("treats sub-0.5 pp differences as flat", () => {
    expect(formatTrendDelta(20.3, 20.0)).toMatchObject({
      arrow: "→",
      label: "flat",
    });
  });

  it("rounds delta to 2 decimals", () => {
    expect(formatTrendDelta(20.123, 18.111).delta).toBe(2.01);
  });
});

describe("flaky-pr-comment / parsePRCommentArgs", () => {
  it("returns defaults", () => {
    const opts = parsePRCommentArgs([]);
    expect(opts.repo).toBe("kitelev/exocortex");
    expect(opts.window).toBe(30);
    expect(opts.topN).toBe(3);
    expect(opts.pullNumber).toBeNull();
    expect(opts.dryRun).toBe(false);
  });

  it("parses all flags", () => {
    const opts = parsePRCommentArgs([
      "--repo",
      "foo/bar",
      "--window",
      "15",
      "--top",
      "5",
      "--pr",
      "1234",
      "--sha",
      "abc",
      "--commit-message",
      "hello (#42)",
      "--output",
      "/tmp/body.md",
      "--input-current",
      "/tmp/cur.json",
      "--input-prior",
      "/tmp/prior.json",
      "--dry-run",
    ]);
    expect(opts).toMatchObject({
      repo: "foo/bar",
      window: 15,
      topN: 5,
      pullNumber: 1234,
      commitSha: "abc",
      commitMessage: "hello (#42)",
      output: "/tmp/body.md",
      inputCurrent: "/tmp/cur.json",
      inputPrior: "/tmp/prior.json",
      dryRun: true,
    });
  });

  it("rejects non-positive --window", () => {
    expect(() => parsePRCommentArgs(["--window", "0"])).toThrow(
      /positive integer/,
    );
  });

  it("rejects non-positive --top", () => {
    expect(() => parsePRCommentArgs(["--top", "-1"])).toThrow(
      /positive integer/,
    );
  });

  it("rejects unknown flags", () => {
    expect(() => parsePRCommentArgs(["--bogus"])).toThrow(/Unknown flag/);
  });
});

describe("flaky-pr-comment / renderPRComment", () => {
  it("starts with the sticky marker", () => {
    const body = renderPRComment({
      current: aggOutput(),
      prior: aggOutput(),
      pullNumber: 100,
      topN: 3,
    });
    expect(body.split("\n")[0]).toBe(STICKY_MARKER);
  });

  it("renders empty-offenders cohort with success line", () => {
    const body = renderPRComment({
      current: aggOutput({
        summary: {
          totalRuns: 30,
          runsWithFlaky: 0,
          totalFlakyOccurrences: 0,
          averageFlakyPerRun: 0,
          rerunRatePercent: 0,
        },
        perSpec: [],
      }),
      prior: aggOutput({
        summary: {
          totalRuns: 30,
          runsWithFlaky: 6,
          totalFlakyOccurrences: 9,
          averageFlakyPerRun: 0.3,
          rerunRatePercent: 20,
        },
      }),
      pullNumber: 200,
      topN: 3,
    });
    expect(body).toContain("✅ **No flaky offenders in current window.**");
    expect(body).toContain("PR #200");
    expect(body).toContain("0% | 20% | ↓ -20 pp (better)");
  });

  it("renders top-N offenders table", () => {
    const body = renderPRComment({
      current: aggOutput({
        summary: {
          totalRuns: 30,
          runsWithFlaky: 12,
          totalFlakyOccurrences: 14,
          averageFlakyPerRun: 0.47,
          rerunRatePercent: 40,
        },
        perSpec: [
          {
            file: "tests/e2e/login.spec.ts",
            title: "logs in successfully",
            occurrences: 5,
            rerunRate: 16.67,
            sources: ["flaky-shard-1"],
          },
          {
            file: "tests/e2e/dashboard.spec.ts",
            title: "renders chart | with pipe",
            occurrences: 3,
            rerunRate: 10,
            sources: ["flaky-shard-2"],
          },
          {
            file: "tests/e2e/profile.spec.ts",
            title: "saves avatar",
            occurrences: 2,
            rerunRate: 6.67,
            sources: ["flaky-shard-3"],
          },
          {
            file: "tests/e2e/settings.spec.ts",
            title: "fourth — must be excluded",
            occurrences: 1,
            rerunRate: 3.33,
            sources: ["flaky-shard-4"],
          },
        ],
      }),
      prior: aggOutput({
        summary: {
          totalRuns: 30,
          runsWithFlaky: 6,
          totalFlakyOccurrences: 9,
          averageFlakyPerRun: 0.3,
          rerunRatePercent: 30,
        },
      }),
      pullNumber: 300,
      topN: 3,
    });
    expect(body).toContain("Top-3 offenders");
    expect(body).toContain("`tests/e2e/login.spec.ts`");
    expect(body).toContain("renders chart \\| with pipe");
    expect(body).toContain("`tests/e2e/profile.spec.ts`");
    expect(body).not.toContain("fourth — must be excluded");
    expect(body).toContain("↑ +10 pp (worse)");
  });

  it("flat-trend label fires when delta is within ±0.5 pp", () => {
    const body = renderPRComment({
      current: aggOutput({
        summary: {
          totalRuns: 30,
          runsWithFlaky: 6,
          totalFlakyOccurrences: 9,
          averageFlakyPerRun: 0.3,
          rerunRatePercent: 20.3,
        },
      }),
      prior: aggOutput({
        summary: {
          totalRuns: 30,
          runsWithFlaky: 6,
          totalFlakyOccurrences: 9,
          averageFlakyPerRun: 0.3,
          rerunRatePercent: 20,
        },
      }),
      pullNumber: 400,
      topN: 3,
    });
    expect(body).toContain("→ +0.3 pp (flat)");
  });

  it("escapes pipe characters in titles AND filenames", () => {
    const body = renderPRComment({
      current: aggOutput({
        perSpec: [
          {
            file: "weird|file.spec.ts",
            title: "weird|title",
            occurrences: 1,
            rerunRate: 3.33,
            sources: [],
          },
        ],
      }),
      prior: aggOutput(),
      pullNumber: 500,
      topN: 1,
    });
    expect(body).toContain("weird\\|file.spec.ts");
    expect(body).toContain("weird\\|title");
  });

  it("includes RFC Phase 3.4 / T4.3 attribution", () => {
    const body = renderPRComment({
      current: aggOutput(),
      prior: aggOutput(),
      pullNumber: 1,
      topN: 3,
    });
    expect(body).toMatch(/RFC §3\.4 \/ T4\.3/);
  });
});
