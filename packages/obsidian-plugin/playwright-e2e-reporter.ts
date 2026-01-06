import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
  TestStep,
} from "@playwright/test/reporter";

/**
 * ANSI color codes for terminal output.
 */
const Colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  bold: "\x1b[1m",
};

/**
 * Custom Playwright reporter for E2E tests with improved readability.
 *
 * Features:
 * - Hierarchical test phases (Suite → Test → Steps)
 * - Color-coded status indicators
 * - Execution time tracking
 * - Failure context with file:line location
 * - Summary with pass/fail counts
 */
class E2EReporter implements Reporter {
  private startTime: number = 0;
  private totalTests = 0;
  private passedTests = 0;
  private failedTests = 0;
  private skippedTests = 0;
  private currentSuite: string | null = null;

  onBegin(config: FullConfig, suite: Suite) {
    this.startTime = Date.now();
    this.totalTests = suite.allTests().length;

    console.log(
      `\n${Colors.cyan}${Colors.bold}═══════════════════════════════════════════════════════════════${Colors.reset}`,
    );
    console.log(
      `${Colors.cyan}${Colors.bold}  E2E Test Suite${Colors.reset}`,
    );
    console.log(
      `${Colors.cyan}${Colors.bold}═══════════════════════════════════════════════════════════════${Colors.reset}\n`,
    );
    console.log(
      `${Colors.gray}Running ${this.totalTests} test(s) in ${config.projects.length} project(s)${Colors.reset}`,
    );
    console.log(
      `${Colors.gray}Workers: ${config.workers}, Retries: ${config.projects[0]?.retries || 0}${Colors.reset}\n`,
    );
  }

  onTestBegin(test: TestCase, _result: TestResult) {
    const suiteName = test.parent.title;

    // Print suite header if it changed
    if (this.currentSuite !== suiteName) {
      this.currentSuite = suiteName;
      console.log(
        `\n${Colors.blue}┌─ ${suiteName} ${"─".repeat(Math.max(0, 50 - suiteName.length))}${Colors.reset}`,
      );
    }

    console.log(`${Colors.gray}│  → ${test.title}${Colors.reset}`);
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const duration = result.duration;
    const durationStr = this.formatDuration(duration);
    const location = `${test.location.file.split("/").pop()}:${test.location.line}`;

    let statusIcon: string;
    let statusColor: string;

    switch (result.status) {
      case "passed":
        statusIcon = "✓";
        statusColor = Colors.green;
        this.passedTests++;
        break;
      case "failed":
        statusIcon = "✗";
        statusColor = Colors.red;
        this.failedTests++;
        break;
      case "skipped":
        statusIcon = "○";
        statusColor = Colors.yellow;
        this.skippedTests++;
        break;
      case "timedOut":
        statusIcon = "⏱";
        statusColor = Colors.red;
        this.failedTests++;
        break;
      default:
        statusIcon = "?";
        statusColor = Colors.gray;
    }

    // Move cursor up and overwrite the "→" line
    console.log(
      `\x1b[1A${Colors.gray}│${Colors.reset}  ${statusColor}${statusIcon}${Colors.reset} ${test.title} ${Colors.gray}(${durationStr}) ${location}${Colors.reset}`,
    );

    // Print steps if any were recorded
    const steps = this.getSignificantSteps(result.steps);
    if (steps.length > 0) {
      for (const step of steps) {
        const stepDuration = this.formatDuration(step.duration);
        const stepStatus =
          step.error === undefined
            ? `${Colors.green}✓${Colors.reset}`
            : `${Colors.red}✗${Colors.reset}`;
        console.log(
          `${Colors.gray}│     ${stepStatus} ${step.title} (${stepDuration})${Colors.reset}`,
        );
      }
    }

    // Print error details for failed tests
    if (result.status === "failed" && result.errors.length > 0) {
      console.log(`${Colors.gray}│${Colors.reset}`);
      console.log(
        `${Colors.gray}│${Colors.reset}  ${Colors.red}${Colors.bold}Error:${Colors.reset}`,
      );
      for (const error of result.errors) {
        const message = error.message?.split("\n")[0] || "Unknown error";
        console.log(
          `${Colors.gray}│${Colors.reset}  ${Colors.red}${message}${Colors.reset}`,
        );
        if (error.location) {
          console.log(
            `${Colors.gray}│${Colors.reset}  ${Colors.gray}at ${error.location.file}:${error.location.line}${Colors.reset}`,
          );
        }
      }
    }
  }

  onEnd(result: FullResult) {
    const totalDuration = Date.now() - this.startTime;
    const durationStr = this.formatDuration(totalDuration);

    console.log(
      `\n${Colors.blue}└${"─".repeat(60)}${Colors.reset}`,
    );

    console.log(
      `\n${Colors.cyan}${Colors.bold}═══════════════════════════════════════════════════════════════${Colors.reset}`,
    );
    console.log(
      `${Colors.cyan}${Colors.bold}  Summary${Colors.reset}`,
    );
    console.log(
      `${Colors.cyan}${Colors.bold}═══════════════════════════════════════════════════════════════${Colors.reset}\n`,
    );

    console.log(`  ${Colors.green}${Colors.bold}Passed:${Colors.reset}  ${this.passedTests}`);
    console.log(`  ${Colors.red}${Colors.bold}Failed:${Colors.reset}  ${this.failedTests}`);
    if (this.skippedTests > 0) {
      console.log(`  ${Colors.yellow}${Colors.bold}Skipped:${Colors.reset} ${this.skippedTests}`);
    }
    console.log(`  ${Colors.gray}Total:${Colors.reset}   ${this.totalTests}`);
    console.log(`  ${Colors.gray}Time:${Colors.reset}    ${durationStr}`);

    const statusIcon = result.status === "passed" ? "✓" : "✗";
    const statusColor =
      result.status === "passed" ? Colors.green : Colors.red;
    console.log(
      `\n  ${statusColor}${Colors.bold}${statusIcon} ${result.status.toUpperCase()}${Colors.reset}\n`,
    );
  }

  /**
   * Filters steps to only show significant ones (test.step() calls, not internal actions).
   */
  private getSignificantSteps(steps: TestStep[]): TestStep[] {
    return steps.filter((step) => {
      // Include test.step() calls
      if (step.category === "test.step") {
        return true;
      }
      // Include hook steps
      if (step.category === "hook") {
        return true;
      }
      return false;
    });
  }

  /**
   * Formats duration in human-readable format.
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`;
    } else if (ms < 60000) {
      return `${(ms / 1000).toFixed(1)}s`;
    } else {
      const minutes = Math.floor(ms / 60000);
      const seconds = ((ms % 60000) / 1000).toFixed(0);
      return `${minutes}m ${seconds}s`;
    }
  }

  printsToStdio() {
    return true;
  }
}

export default E2EReporter;
