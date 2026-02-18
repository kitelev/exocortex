import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";

// Mock ora - must be before importing ProgressIndicator
const mockOraInstance = {
  start: jest.fn().mockReturnThis(),
  stop: jest.fn().mockReturnThis(),
  succeed: jest.fn().mockReturnThis(),
  fail: jest.fn().mockReturnThis(),
  text: "",
};

const mockOra = jest.fn().mockReturnValue(mockOraInstance);

jest.unstable_mockModule("ora", () => ({
  default: mockOra,
}));

// Import after mocking
const { ProgressIndicator } = await import("../../../src/utils/ProgressIndicator.js");

describe("ProgressIndicator", () => {
  let originalIsTTY: boolean | undefined;
  let setTimeoutSpy: jest.SpiedFunction<typeof setTimeout>;
  let clearTimeoutSpy: jest.SpiedFunction<typeof clearTimeout>;
  let setIntervalSpy: jest.SpiedFunction<typeof setInterval>;
  let clearIntervalSpy: jest.SpiedFunction<typeof clearInterval>;

  beforeEach(() => {
    jest.clearAllMocks();
    originalIsTTY = process.stdout.isTTY;

    // Mock timers
    jest.useFakeTimers();
    setTimeoutSpy = jest.spyOn(global, "setTimeout");
    clearTimeoutSpy = jest.spyOn(global, "clearTimeout");
    setIntervalSpy = jest.spyOn(global, "setInterval");
    clearIntervalSpy = jest.spyOn(global, "clearInterval");

    // Reset mock instance
    mockOraInstance.start.mockClear();
    mockOraInstance.stop.mockClear();
    mockOraInstance.succeed.mockClear();
    mockOraInstance.fail.mockClear();
  });

  afterEach(() => {
    process.stdout.isTTY = originalIsTTY;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create indicator with default delay of 2000ms", () => {
      const indicator = new ProgressIndicator("Testing");
      expect(indicator).toBeDefined();
    });

    it("should create indicator with custom delay", () => {
      const indicator = new ProgressIndicator("Testing", { delayMs: 5000 });
      expect(indicator).toBeDefined();
    });
  });

  describe("start", () => {
    it("should NOT show spinner immediately for fast operations", () => {
      process.stdout.isTTY = true;
      const indicator = new ProgressIndicator("Loading");

      indicator.start();

      // Spinner should not be started immediately
      expect(mockOraInstance.start).not.toHaveBeenCalled();
    });

    it("should show spinner after 2000ms delay (default)", () => {
      process.stdout.isTTY = true;
      const indicator = new ProgressIndicator("Loading");

      indicator.start();

      // Advance time by 1999ms - should not show spinner
      jest.advanceTimersByTime(1999);
      expect(mockOraInstance.start).not.toHaveBeenCalled();

      // Advance by 1 more ms (total 2000ms) - should show spinner
      jest.advanceTimersByTime(1);
      expect(mockOraInstance.start).toHaveBeenCalled();
    });

    it("should show spinner after custom delay", () => {
      process.stdout.isTTY = true;
      const indicator = new ProgressIndicator("Loading", { delayMs: 3000 });

      indicator.start();

      jest.advanceTimersByTime(2999);
      expect(mockOraInstance.start).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(mockOraInstance.start).toHaveBeenCalled();
    });

    it("should NOT show spinner in non-TTY mode", () => {
      process.stdout.isTTY = false;
      const indicator = new ProgressIndicator("Loading");

      indicator.start();

      // Even after delay, should not show spinner
      jest.advanceTimersByTime(5000);
      expect(mockOraInstance.start).not.toHaveBeenCalled();
    });
  });

  describe("stop with success", () => {
    it("should stop spinner cleanly if it was shown", () => {
      process.stdout.isTTY = true;
      const indicator = new ProgressIndicator("Loading");

      indicator.start();
      jest.advanceTimersByTime(2000); // Trigger spinner display

      indicator.succeed("Done!");

      expect(mockOraInstance.succeed).toHaveBeenCalledWith("Done!");
    });

    it("should NOT show any spinner output for fast operations (<2s)", () => {
      process.stdout.isTTY = true;
      const indicator = new ProgressIndicator("Loading");

      indicator.start();
      jest.advanceTimersByTime(1500); // Less than 2s

      indicator.succeed("Done!");

      // Spinner was never started, so succeed should not be called
      expect(mockOraInstance.start).not.toHaveBeenCalled();
      expect(mockOraInstance.succeed).not.toHaveBeenCalled();
    });

    it("should clear pending timeout when stopped early", () => {
      process.stdout.isTTY = true;
      const indicator = new ProgressIndicator("Loading");

      indicator.start();
      indicator.succeed("Done!");

      expect(clearTimeoutSpy).toHaveBeenCalled();
    });
  });

  describe("stop with failure", () => {
    it("should stop spinner with error message if shown", () => {
      process.stdout.isTTY = true;
      const indicator = new ProgressIndicator("Loading");

      indicator.start();
      jest.advanceTimersByTime(2000);

      indicator.fail("Error occurred");

      expect(mockOraInstance.fail).toHaveBeenCalledWith("Error occurred");
    });

    it("should NOT show any spinner output for fast failing operations (<2s)", () => {
      process.stdout.isTTY = true;
      const indicator = new ProgressIndicator("Loading");

      indicator.start();
      jest.advanceTimersByTime(500);

      indicator.fail("Error");

      expect(mockOraInstance.start).not.toHaveBeenCalled();
      expect(mockOraInstance.fail).not.toHaveBeenCalled();
    });
  });

  describe("elapsed time display", () => {
    it("should update spinner text with elapsed time while running", () => {
      process.stdout.isTTY = true;
      const indicator = new ProgressIndicator("Loading");

      indicator.start();

      // Trigger spinner to show
      jest.advanceTimersByTime(2000);
      expect(mockOraInstance.start).toHaveBeenCalled();

      // Advance 1 more second - should update text with elapsed time
      jest.advanceTimersByTime(1000);

      // Check that text was updated (the indicator should show elapsed time)
      // The text update happens via interval or direct property assignment
      expect(mockOraInstance.text).toContain("3s");
    });

    it("should format elapsed time correctly", () => {
      process.stdout.isTTY = true;
      const indicator = new ProgressIndicator("Processing");

      indicator.start();
      jest.advanceTimersByTime(2000); // Show spinner

      // Advance to 65 seconds (1m 5s)
      jest.advanceTimersByTime(63000);

      // Text should show minutes and seconds
      expect(mockOraInstance.text).toMatch(/1m 5s/);
    });
  });

  describe("wrap async operation", () => {
    it("should provide wrap method for easy async operation progress", async () => {
      process.stdout.isTTY = true;
      const indicator = new ProgressIndicator("Loading data");

      const mockAsyncOp = jest.fn<() => Promise<string>>().mockImplementation(
        () => new Promise(resolve => {
          // This simulates a slow operation
          setTimeout(() => resolve("result"), 3000);
        })
      );

      const resultPromise = indicator.wrap(mockAsyncOp);

      // Operation started but spinner not yet visible
      expect(mockOraInstance.start).not.toHaveBeenCalled();

      // Advance past delay threshold
      jest.advanceTimersByTime(2000);
      expect(mockOraInstance.start).toHaveBeenCalled();

      // Complete the operation
      jest.advanceTimersByTime(1000);

      const result = await resultPromise;
      expect(result).toBe("result");
      expect(mockOraInstance.succeed).toHaveBeenCalled();
    });

    it("should handle errors in wrapped async operations", async () => {
      process.stdout.isTTY = true;
      const indicator = new ProgressIndicator("Loading");

      const mockFailingOp = jest.fn<() => Promise<never>>().mockImplementation(
        () => new Promise((_, reject) => {
          setTimeout(() => reject(new Error("Failed")), 3000);
        })
      );

      const resultPromise = indicator.wrap(mockFailingOp);

      // Advance past delay and operation duration
      jest.advanceTimersByTime(3000);

      await expect(resultPromise).rejects.toThrow("Failed");
      expect(mockOraInstance.fail).toHaveBeenCalled();
    });
  });

  describe("TTY detection", () => {
    it("should detect non-TTY environment (piped output)", () => {
      process.stdout.isTTY = undefined;
      const indicator = new ProgressIndicator("Loading");

      indicator.start();
      jest.advanceTimersByTime(5000);

      // No spinner in non-TTY mode
      expect(mockOraInstance.start).not.toHaveBeenCalled();
    });

    it("should detect TTY environment", () => {
      process.stdout.isTTY = true;
      const indicator = new ProgressIndicator("Loading");

      indicator.start();
      jest.advanceTimersByTime(2000);

      expect(mockOraInstance.start).toHaveBeenCalled();
    });
  });
});
