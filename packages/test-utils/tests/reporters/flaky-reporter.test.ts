/**
 * Tests for FlakyReporter
 */

import FlakyReporter, {
  type FlakyReporterOptions,
} from "../../src/reporters/flaky-reporter";
import * as fs from "fs";

// Mock fs module
jest.mock("fs");
const mockFs = jest.mocked(fs);

describe("FlakyReporter", () => {
  let reporter: FlakyReporter;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.writeFileSync.mockImplementation(() => undefined);

    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation();
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  const createReporter = (options?: FlakyReporterOptions) => {
    return new FlakyReporter({}, options);
  };

  const createMockTestResult = (overrides: Partial<{
    testFilePath: string;
    testResults: Array<{
      title: string;
      ancestorTitles: string[];
      status: string;
      invocations?: number;
      duration?: number;
      failureMessages: string[];
    }>;
  }> = {}) => ({
    testFilePath: overrides.testFilePath ?? "/path/to/test.ts",
    testResults: overrides.testResults ?? [
      {
        title: "should work",
        ancestorTitles: ["TestSuite"],
        status: "passed",
        invocations: 1,
        duration: 100,
        failureMessages: [],
      },
    ],
  });

  describe("constructor", () => {
    it("should use default options when none provided", () => {
      reporter = createReporter();
      expect(reporter).toBeDefined();
    });

    it("should accept custom options", () => {
      reporter = createReporter({
        outputFile: "custom-report.json",
        failOnFlaky: true,
        verbose: false,
      });
      expect(reporter).toBeDefined();
    });
  });

  describe("onTestResult", () => {
    it("should count total tests", () => {
      reporter = createReporter({ verbose: false });
      reporter.onRunStart({} as any, {} as any);

      reporter.onTestResult(
        {} as any,
        createMockTestResult({
          testResults: [
            { title: "test1", ancestorTitles: [], status: "passed", invocations: 1, duration: 100, failureMessages: [] },
            { title: "test2", ancestorTitles: [], status: "passed", invocations: 1, duration: 100, failureMessages: [] },
          ],
        }) as any,
        {} as any,
      );

      reporter.onRunComplete(new Set(), {} as any);

      // Check report was written with correct total
      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const report = JSON.parse(writeCall[1] as string);
      expect(report.summary.totalTests).toBe(2);
    });

    it("should detect flaky test when invocations > 1 and status is passed", () => {
      reporter = createReporter({ verbose: true });
      reporter.onRunStart({} as any, {} as any);

      reporter.onTestResult(
        {} as any,
        createMockTestResult({
          testFilePath: "/path/to/flaky.test.ts",
          testResults: [
            {
              title: "flaky test",
              ancestorTitles: ["FlakySpec"],
              status: "passed",
              invocations: 2, // Passed after retry
              duration: 150,
              failureMessages: ["First attempt failed"],
            },
          ],
        }) as any,
        {} as any,
      );

      reporter.onRunComplete(new Set(), {} as any);

      // Should have logged warning
      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(consoleWarnSpy.mock.calls[0][0]).toContain("FLAKY TEST");
      expect(consoleWarnSpy.mock.calls[0][0]).toContain("flaky test");

      // Check report
      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const report = JSON.parse(writeCall[1] as string);
      expect(report.totalFlaky).toBe(1);
      expect(report.tests[0].name).toBe("flaky test");
      expect(report.tests[0].retryCount).toBe(1);
    });

    it("should not mark test as flaky when invocations is 1", () => {
      reporter = createReporter({ verbose: false });
      reporter.onRunStart({} as any, {} as any);

      reporter.onTestResult(
        {} as any,
        createMockTestResult({
          testResults: [
            {
              title: "stable test",
              ancestorTitles: [],
              status: "passed",
              invocations: 1,
              duration: 100,
              failureMessages: [],
            },
          ],
        }) as any,
        {} as any,
      );

      reporter.onRunComplete(new Set(), {} as any);

      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const report = JSON.parse(writeCall[1] as string);
      expect(report.totalFlaky).toBe(0);
    });

    it("should not mark test as flaky when status is failed", () => {
      reporter = createReporter({ verbose: false });
      reporter.onRunStart({} as any, {} as any);

      reporter.onTestResult(
        {} as any,
        createMockTestResult({
          testResults: [
            {
              title: "failing test",
              ancestorTitles: [],
              status: "failed",
              invocations: 3, // Failed even after retries
              duration: 100,
              failureMessages: ["Still failing"],
            },
          ],
        }) as any,
        {} as any,
      );

      reporter.onRunComplete(new Set(), {} as any);

      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const report = JSON.parse(writeCall[1] as string);
      expect(report.totalFlaky).toBe(0);
    });
  });

  describe("onRunComplete", () => {
    it("should write report to file", () => {
      reporter = createReporter({
        outputFile: "test-flaky-report.json",
        verbose: false,
      });
      reporter.onRunStart({} as any, {} as any);
      reporter.onRunComplete(new Set(), {} as any);

      expect(mockFs.writeFileSync).toHaveBeenCalled();
      const outputPath = mockFs.writeFileSync.mock.calls[0][0] as string;
      expect(outputPath).toContain("test-flaky-report.json");
    });

    it("should include timestamp in report", () => {
      reporter = createReporter({ verbose: false });
      reporter.onRunStart({} as any, {} as any);
      reporter.onRunComplete(new Set(), {} as any);

      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const report = JSON.parse(writeCall[1] as string);
      expect(report.timestamp).toBeDefined();
      expect(new Date(report.timestamp)).toBeInstanceOf(Date);
    });

    it("should set exit code when failOnFlaky is true and flaky tests exist", () => {
      const originalExitCode = process.exitCode;
      reporter = createReporter({ failOnFlaky: true, verbose: false });
      reporter.onRunStart({} as any, {} as any);

      reporter.onTestResult(
        {} as any,
        createMockTestResult({
          testResults: [
            {
              title: "flaky test",
              ancestorTitles: [],
              status: "passed",
              invocations: 2,
              duration: 100,
              failureMessages: [],
            },
          ],
        }) as any,
        {} as any,
      );

      reporter.onRunComplete(new Set(), {} as any);

      expect(process.exitCode).toBe(1);
      process.exitCode = originalExitCode;
    });

    it("should not set exit code when failOnFlaky is false", () => {
      const originalExitCode = process.exitCode;
      process.exitCode = undefined;

      reporter = createReporter({ failOnFlaky: false, verbose: false });
      reporter.onRunStart({} as any, {} as any);

      reporter.onTestResult(
        {} as any,
        createMockTestResult({
          testResults: [
            {
              title: "flaky test",
              ancestorTitles: [],
              status: "passed",
              invocations: 2,
              duration: 100,
              failureMessages: [],
            },
          ],
        }) as any,
        {} as any,
      );

      reporter.onRunComplete(new Set(), {} as any);

      expect(process.exitCode).toBeUndefined();
      process.exitCode = originalExitCode;
    });

    it("should calculate flaky percentage correctly", () => {
      reporter = createReporter({ verbose: false });
      reporter.onRunStart({} as any, {} as any);

      // Add 4 stable tests and 1 flaky test = 20% flaky
      reporter.onTestResult(
        {} as any,
        createMockTestResult({
          testResults: [
            { title: "stable1", ancestorTitles: [], status: "passed", invocations: 1, duration: 100, failureMessages: [] },
            { title: "stable2", ancestorTitles: [], status: "passed", invocations: 1, duration: 100, failureMessages: [] },
            { title: "stable3", ancestorTitles: [], status: "passed", invocations: 1, duration: 100, failureMessages: [] },
            { title: "stable4", ancestorTitles: [], status: "passed", invocations: 1, duration: 100, failureMessages: [] },
            { title: "flaky", ancestorTitles: [], status: "passed", invocations: 2, duration: 100, failureMessages: [] },
          ],
        }) as any,
        {} as any,
      );

      reporter.onRunComplete(new Set(), {} as any);

      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const report = JSON.parse(writeCall[1] as string);
      expect(report.summary.flakyPercentage).toBe(20);
    });
  });

  describe("getLastError", () => {
    it("should return undefined", () => {
      reporter = createReporter();
      expect(reporter.getLastError()).toBeUndefined();
    });
  });
});
