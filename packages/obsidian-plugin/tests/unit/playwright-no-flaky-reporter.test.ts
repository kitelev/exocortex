import type {
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import NoFlakyReporter from "../../playwright-no-flaky-reporter";

// Issue #3350 — guard that the reporter:
// 1. Still fails CI when an untagged spec passes only on retry (existing
//    strict-flake-surfacing contract).
// 2. Ignores retries on @flaky-track-tagged specs, so the per-project
//    `retries: 1` policy from `playwright-e2e.config.ts` /
//    `playwright-shard-config-factory.ts` is not neutralized.
// Empirically verifies revert→fail / restore→pass: drop the
// `test.tags?.includes(...)` short-circuit and Case 2 expectation flips.

type TestCaseLike = Pick<TestCase, "title" | "location" | "tags">;
type TestResultLike = Pick<TestResult, "status" | "retry">;

function makeTestCase(overrides: Partial<TestCaseLike>): TestCase {
  return {
    title: "sample test",
    location: { file: "sample.spec.ts", line: 1, column: 1 },
    tags: [],
    ...overrides,
  } as unknown as TestCase;
}

function makeResult(overrides: Partial<TestResultLike>): TestResult {
  return {
    status: "passed",
    retry: 0,
    ...overrides,
  } as unknown as TestResult;
}

describe("NoFlakyReporter", () => {
  let originalExitCode: typeof process.exitCode;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    process.exitCode = originalExitCode;
  });

  it("flags untagged spec that passed only after retry (strict contract)", () => {
    const reporter = new NoFlakyReporter();
    const test = makeTestCase({
      title: "untagged flaky",
      tags: [],
    });
    const result = makeResult({ status: "passed", retry: 1 });

    reporter.onTestEnd(test, result);
    reporter.onEnd({ status: "passed" } as never);

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("does NOT flag @flaky-track-tagged spec on retry (Issue #3350)", () => {
    const reporter = new NoFlakyReporter();
    const test = makeTestCase({
      title: "tagged tolerant",
      tags: ["@flaky-track"],
    });
    const result = makeResult({ status: "passed", retry: 1 });

    reporter.onTestEnd(test, result);
    reporter.onEnd({ status: "passed" } as never);

    expect(process.exitCode).not.toBe(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("does NOT flag untagged spec that passed on first attempt", () => {
    const reporter = new NoFlakyReporter();
    const test = makeTestCase({ title: "clean pass", tags: [] });
    const result = makeResult({ status: "passed", retry: 0 });

    reporter.onTestEnd(test, result);
    reporter.onEnd({ status: "passed" } as never);

    expect(process.exitCode).not.toBe(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("ignores @flaky-track presence when retry is 0 (no false positives)", () => {
    const reporter = new NoFlakyReporter();
    const test = makeTestCase({
      title: "tagged clean pass",
      tags: ["@flaky-track"],
    });
    const result = makeResult({ status: "passed", retry: 0 });

    reporter.onTestEnd(test, result);
    reporter.onEnd({ status: "passed" } as never);

    expect(process.exitCode).not.toBe(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("stays passive on @flaky-track spec that genuinely failed after retry (locks short-circuit position)", () => {
    const reporter = new NoFlakyReporter();
    const test = makeTestCase({
      title: "tagged hard fail",
      tags: ["@flaky-track"],
    });
    const result = makeResult({ status: "failed", retry: 1 });

    reporter.onTestEnd(test, result);
    reporter.onEnd({ status: "failed" } as never);

    expect(process.exitCode).not.toBe(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("flags untagged spec when tagged-and-untagged retries coexist (per-test isolation)", () => {
    const reporter = new NoFlakyReporter();
    reporter.onTestEnd(
      makeTestCase({ title: "tagged", tags: ["@flaky-track"] }),
      makeResult({ status: "passed", retry: 1 }),
    );
    reporter.onTestEnd(
      makeTestCase({ title: "untagged", tags: [] }),
      makeResult({ status: "passed", retry: 1 }),
    );
    reporter.onEnd({ status: "passed" } as never);

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalled();
  });
});
