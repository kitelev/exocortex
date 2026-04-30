/**
 * Playwright Retry Summary Reporter (RFC Phase 3 — T2.2).
 *
 * Surfaces per-shard retry counts to the GitHub Actions job summary so that
 * "this PR's e2e was retried: <count>" is visible without diving into raw
 * logs. Visibility prevents stealthy retry masking once T2.1 introduced
 * per-spec `test.retry(1)` on 7 known plaintive specs.
 *
 * Outputs (relative to cwd / Playwright outputDir):
 *  - retry-summary.md  — Markdown fragment ready to append to
 *                         $GITHUB_STEP_SUMMARY by the workflow step.
 *  - retry-summary.json — Structured per-test data for cross-shard
 *                         aggregation in the e2e-tests aggregator job.
 *
 * Exit behaviour: never fails the run. Pure observability layer; the
 * pre-existing no-flaky-reporter still enforces "no flake" semantics for
 * specs without per-spec `test.retry()`.
 */

import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import * as fs from "fs";
import * as path from "path";

interface RetryEntry {
  file: string;
  line: number;
  title: string;
  status: TestResult["status"];
  retry: number;
  project: string;
}

interface RetrySummaryReport {
  shard: string;
  timestamp: string;
  totalTests: number;
  totalRetries: number;
  flakyPassed: number; // passed only after >0 retries
  failedAfterRetry: number; // exhausted retries and still failed
  entries: RetryEntry[];
}

interface ReporterOptions {
  outputDir?: string;
  shardLabel?: string;
}

class PlaywrightRetrySummaryReporter implements Reporter {
  private entries: RetryEntry[] = [];
  private totalTests = 0;
  private readonly outputDir: string;
  private readonly shardLabel: string;

  constructor(options: ReporterOptions = {}) {
    this.outputDir = options.outputDir ?? process.cwd();
    this.shardLabel =
      options.shardLabel ?? process.env.SHARD_LABEL ?? "unknown";
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.totalTests++;

    if (result.retry > 0) {
      this.entries.push({
        file: test.location.file,
        line: test.location.line,
        title: test.title,
        status: result.status,
        retry: result.retry,
        project: test.parent.project()?.name ?? "unknown",
      });
    }
  }

  onEnd(_result: FullResult): void {
    const totalRetries = this.entries.reduce((sum, e) => sum + e.retry, 0);
    const flakyPassed = this.entries.filter(
      (e) => e.status === "passed",
    ).length;
    const failedAfterRetry = this.entries.filter(
      (e) => e.status !== "passed",
    ).length;

    const report: RetrySummaryReport = {
      shard: this.shardLabel,
      timestamp: new Date().toISOString(),
      totalTests: this.totalTests,
      totalRetries,
      flakyPassed,
      failedAfterRetry,
      entries: this.entries,
    };

    this.writeJson(report);
    this.writeMarkdown(report);
    this.appendStepSummary(report);
  }

  printsToStdio(): boolean {
    return false;
  }

  private writeJson(report: RetrySummaryReport): void {
    try {
      this.ensureDir();
      const file = path.join(this.outputDir, "retry-summary.json");
      fs.writeFileSync(file, JSON.stringify(report, null, 2), "utf-8");
    } catch (err) {
      console.error("retry-summary-reporter: failed to write JSON:", err);
    }
  }

  private writeMarkdown(report: RetrySummaryReport): void {
    try {
      this.ensureDir();
      const file = path.join(this.outputDir, "retry-summary.md");
      fs.writeFileSync(file, this.renderMarkdown(report), "utf-8");
    } catch (err) {
      console.error("retry-summary-reporter: failed to write Markdown:", err);
    }
  }

  private appendStepSummary(report: RetrySummaryReport): void {
    const target = process.env.GITHUB_STEP_SUMMARY;
    if (!target) return;
    try {
      fs.appendFileSync(target, this.renderMarkdown(report), "utf-8");
    } catch (err) {
      console.error(
        "retry-summary-reporter: failed to append GITHUB_STEP_SUMMARY:",
        err,
      );
    }
  }

  private renderMarkdown(report: RetrySummaryReport): string {
    const head =
      `### E2E retry summary — shard ${report.shard}\n\n` +
      `- Total tests: **${report.totalTests}**\n` +
      `- Tests retried: **${report.entries.length}**\n` +
      `- Total retries: **${report.totalRetries}**\n` +
      `- Flaky-passed (passed after retry): **${report.flakyPassed}**\n` +
      `- Failed after retry: **${report.failedAfterRetry}**\n`;

    if (report.entries.length === 0) {
      return head + "\n_No retries this run._\n\n";
    }

    const rows = report.entries
      .map((e) => {
        const rel = path.relative(process.cwd(), e.file) || e.file;
        return `| ${e.title} | ${rel}:${e.line} | ${e.retry} | ${e.status} |`;
      })
      .join("\n");

    return (
      head +
      "\n" +
      "| Test | Location | Retries | Final status |\n" +
      "| --- | --- | ---: | --- |\n" +
      rows +
      "\n\n"
    );
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }
}

export default PlaywrightRetrySummaryReporter;
