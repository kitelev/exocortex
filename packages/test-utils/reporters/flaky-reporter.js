/**
 * Jest Custom Reporter for Flaky Test Detection
 *
 * This reporter tracks tests that pass only after retries (flaky tests)
 * and generates a JSON report for CI integration and tracking.
 *
 * @example
 * // In jest.config.js
 * module.exports = {
 *   reporters: [
 *     'default',
 *     ['@kitelev/exocortex-test-utils/reporters/flaky-reporter', {
 *       outputFile: 'flaky-report.json',
 *       failOnFlaky: false, // Set to true to fail CI on flaky tests
 *     }],
 *   ],
 * };
 */

"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_OPTIONS = {
  outputFile: "flaky-report.json",
  failOnFlaky: false,
  verbose: true,
};

class FlakyReporter {
  constructor(_globalConfig, reporterOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...reporterOptions };
    this.flakyTests = [];
    this.totalTests = 0;
    this.totalSuites = 0;
    this.rootDir = process.cwd();
  }

  onRunStart(_results, _options) {
    this.flakyTests = [];
    this.totalTests = 0;
    this.totalSuites = 0;
  }

  onTestStart(_test) {
    // No-op: We process results in onTestResult
  }

  onTestResult(_test, testResult, _aggregatedResult) {
    this.totalSuites++;

    for (const result of testResult.testResults) {
      this.totalTests++;

      // A test is flaky if it passed but had invocations > 1
      // Jest records invocations when retry is enabled
      // Status "passed" with multiple invocations means it failed then passed
      if (result.status === "passed" && (result.invocations ?? 1) > 1) {
        const flakyInfo = {
          file: testResult.testFilePath,
          name: result.title,
          ancestorTitles: result.ancestorTitles,
          retryCount: (result.invocations ?? 1) - 1,
          duration: result.duration ?? 0,
          failureMessages:
            result.failureMessages.length > 0
              ? result.failureMessages
              : undefined,
        };

        this.flakyTests.push(flakyInfo);

        if (this.options.verbose) {
          const fullName = [...result.ancestorTitles, result.title].join(" > ");
          console.warn(
            `\n⚠️  FLAKY TEST: ${fullName}\n` +
              `   File: ${testResult.testFilePath}\n` +
              `   Retries: ${flakyInfo.retryCount}\n`,
          );
        }
      }
    }
  }

  onRunComplete(_contexts, _results) {
    const report = this.generateReport();
    this.writeReport(report);

    if (this.flakyTests.length > 0) {
      this.printSummary(report);

      if (this.options.failOnFlaky) {
        console.error(
          "\n❌ CI FAILURE: Flaky tests detected!\n" +
            "   Flaky tests indicate race conditions or timing issues.\n" +
            "   Please fix the flaky tests or add them to quarantine.\n",
        );
        process.exitCode = 1;
      }
    }
  }

  getLastError() {
    // No-op: We handle errors via process.exitCode
    return undefined;
  }

  generateReport() {
    const flakyPercentage =
      this.totalTests > 0
        ? Number(((this.flakyTests.length / this.totalTests) * 100).toFixed(2))
        : 0;

    return {
      timestamp: new Date().toISOString(),
      totalFlaky: this.flakyTests.length,
      tests: this.flakyTests,
      summary: {
        totalTests: this.totalTests,
        totalSuites: this.totalSuites,
        flakyPercentage,
      },
    };
  }

  writeReport(report) {
    const outputPath = path.isAbsolute(this.options.outputFile)
      ? this.options.outputFile
      : path.join(this.rootDir, this.options.outputFile);

    try {
      // Ensure directory exists
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf-8");

      if (this.options.verbose && this.flakyTests.length > 0) {
        console.log(`\n📊 Flaky test report written to: ${outputPath}`);
      }
    } catch (error) {
      console.error(`Failed to write flaky report to ${outputPath}:`, error);
    }
  }

  printSummary(report) {
    console.log("\n" + "=".repeat(60));
    console.log("⚠️  FLAKY TEST SUMMARY");
    console.log("=".repeat(60));
    console.log(`Total flaky tests: ${report.totalFlaky}`);
    console.log(
      `Flaky percentage: ${report.summary.flakyPercentage}% of ${report.summary.totalTests} tests`,
    );
    console.log("");

    for (const test of report.tests) {
      const fullName = [...test.ancestorTitles, test.name].join(" > ");
      console.log(`  - ${fullName}`);
      console.log(`    File: ${test.file}`);
      console.log(`    Retries: ${test.retryCount}`);
    }

    console.log("=".repeat(60) + "\n");
  }
}

module.exports = FlakyReporter;
