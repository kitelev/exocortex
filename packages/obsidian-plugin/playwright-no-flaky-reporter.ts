import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

// Issue #3350: tests carrying the `@flaky-track` tag are explicitly
// permitted retries by the matching Playwright project (see
// `playwright-e2e.config.ts` / `playwright-shard-config-factory.ts`).
// The reporter must NOT fail CI for those — otherwise the project-level
// `retries: 1` policy is neutralized. Untagged specs keep the strict
// 0-retry contract; removing the tag automatically reinstates strict
// surfacing through this reporter (no silent masking).
const FLAKY_TRACK_TAG = "@flaky-track";

class NoFlakyReporter implements Reporter {
  private hasFlaky = false;

  onTestEnd(test: TestCase, result: TestResult) {
    if (test.tags?.includes(FLAKY_TRACK_TAG)) {
      return;
    }
    // Flaky test = passed only after retries
    if (result.status === "passed" && result.retry > 0) {
      this.hasFlaky = true;
      console.error(
        `\n❌ FLAKY TEST DETECTED (will fail CI): ${test.title}\n` +
          `   Location: ${test.location.file}:${test.location.line}\n` +
          `   This test passed after ${result.retry} retries.\n` +
          `   Flaky tests are NOT acceptable - they must be fixed!\n`,
      );
    }
  }

  onEnd(_result: FullResult) {
    if (this.hasFlaky) {
      console.error(
        "\n❌ CI FAILURE: Flaky tests detected!\n" +
          "   Flaky tests indicate race conditions or timing issues.\n" +
          "   All tests must pass consistently on first attempt.\n" +
          "   Please fix the flaky tests before merging.\n",
      );
      process.exitCode = 1;
    }
  }

  printsToStdio() {
    return false;
  }
}

export default NoFlakyReporter;
