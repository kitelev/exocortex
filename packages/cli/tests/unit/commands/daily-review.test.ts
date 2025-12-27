import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";

// Mock DI container and services
const mockPractices = [
  {
    uid: "practice-1",
    label: "Morning Routine",
    path: "03 Knowledge/kitelev/practice-1.md",
    recurringRule: "daily",
    estimatedDuration: 30,
    doneToday: false,
    inProgressToday: false,
    todayInstancePath: null,
  },
  {
    uid: "practice-2",
    label: "Evening Review",
    path: "03 Knowledge/kitelev/practice-2.md",
    recurringRule: "daily",
    estimatedDuration: 15,
    doneToday: true,
    inProgressToday: false,
    todayInstancePath: "03 Knowledge/kitelev/evening-review-2025-12-27.md",
  },
];

const mockSummary = {
  date: "2025-12-27",
  plannedCount: 5,
  completedCount: 2,
  inProgressCount: 1,
  practicesDue: mockPractices.filter(p => !p.doneToday),
  completionPercentage: 40,
  totalTimeMinutes: 120,
};

const mockQuickCaptureResult = {
  path: "03 Knowledge/kitelev/test-task.md",
  uid: "test-uid-123",
  label: "Test Activity",
  started: true,
};

const mockDailyReviewService = {
  getPractices: jest.fn(),
  getDailyReviewSummary: jest.fn(),
  quickCapture: jest.fn(),
  createFromPractice: jest.fn(),
  markPracticeDone: jest.fn(),
};

// Mock tsyringe container
jest.unstable_mockModule("tsyringe", () => ({
  container: {
    register: jest.fn(),
    resolve: jest.fn(() => mockDailyReviewService),
  },
}));

// Mock exocortex
jest.unstable_mockModule("exocortex", () => ({
  DI_TOKENS: {
    IVaultAdapter: Symbol("IVaultAdapter"),
  },
  DailyReviewService: jest.fn(),
}));

// Mock FileSystemVaultAdapter
jest.unstable_mockModule("../../../src/adapters/FileSystemVaultAdapter.js", () => ({
  FileSystemVaultAdapter: jest.fn(),
}));

// Mock CLIContainer
jest.unstable_mockModule("../../../src/infrastructure/di/CLIContainer.js", () => ({
  CLIContainer: {
    setup: jest.fn(),
  },
}));

// Mock fs
jest.unstable_mockModule("fs", () => ({
  existsSync: jest.fn(() => true),
}));

const { dailyReviewCommand } = await import("../../../src/commands/daily-review.js");

describe("dailyReviewCommand", () => {
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;
  let processExitSpy: jest.SpiedFunction<typeof process.exit>;

  beforeEach(() => {
    jest.clearAllMocks();

    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    processExitSpy = jest.spyOn(process, "exit").mockImplementation((() => {}) as never);

    // Reset mock return values
    mockDailyReviewService.getPractices.mockResolvedValue(mockPractices);
    mockDailyReviewService.getDailyReviewSummary.mockResolvedValue(mockSummary);
    mockDailyReviewService.quickCapture.mockResolvedValue(mockQuickCaptureResult);
    mockDailyReviewService.createFromPractice.mockResolvedValue(mockQuickCaptureResult);
    mockDailyReviewService.markPracticeDone.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("command setup", () => {
    it("should create command with correct name", () => {
      const cmd = dailyReviewCommand();
      expect(cmd.name()).toBe("daily");
    });

    it("should have correct description", () => {
      const cmd = dailyReviewCommand();
      expect(cmd.description()).toBe("Daily review operations for mobile-friendly workflow");
    });

    it("should have subcommands", () => {
      const cmd = dailyReviewCommand();
      const subcommands = cmd.commands.map(c => c.name());
      expect(subcommands).toContain("practices");
      expect(subcommands).toContain("summary");
      expect(subcommands).toContain("log");
      expect(subcommands).toContain("start");
      expect(subcommands).toContain("done");
    });
  });

  describe("practices subcommand", () => {
    it("should list practices in text format", async () => {
      const cmd = dailyReviewCommand();
      await cmd.parseAsync(["node", "test", "practices", "--vault", "/test/vault"]);

      expect(mockDailyReviewService.getPractices).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it("should list practices in json format", async () => {
      const cmd = dailyReviewCommand();
      await cmd.parseAsync(["node", "test", "practices", "--vault", "/test/vault", "--format", "json"]);

      expect(mockDailyReviewService.getPractices).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("practices"));
    });
  });

  describe("summary subcommand", () => {
    it("should show summary in text format", async () => {
      const cmd = dailyReviewCommand();
      await cmd.parseAsync(["node", "test", "summary", "--vault", "/test/vault"]);

      expect(mockDailyReviewService.getDailyReviewSummary).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it("should show summary in json format", async () => {
      const cmd = dailyReviewCommand();
      await cmd.parseAsync(["node", "test", "summary", "--vault", "/test/vault", "--format", "json"]);

      expect(mockDailyReviewService.getDailyReviewSummary).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("date"));
    });

    it("should accept date option", async () => {
      const cmd = dailyReviewCommand();
      await cmd.parseAsync(["node", "test", "summary", "--vault", "/test/vault", "--date", "2025-12-25"]);

      expect(mockDailyReviewService.getDailyReviewSummary).toHaveBeenCalledWith(expect.any(Date));
    });
  });

  describe("log subcommand", () => {
    it("should quick capture activity", async () => {
      const cmd = dailyReviewCommand();
      await cmd.parseAsync(["node", "test", "log", "Test Activity", "--vault", "/test/vault"]);

      expect(mockDailyReviewService.quickCapture).toHaveBeenCalledWith("Test Activity", true);
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it("should quick capture without starting when --no-start is passed", async () => {
      const cmd = dailyReviewCommand();
      await cmd.parseAsync(["node", "test", "log", "Test Activity", "--vault", "/test/vault", "--no-start"]);

      expect(mockDailyReviewService.quickCapture).toHaveBeenCalledWith("Test Activity", false);
    });

    it("should output json format", async () => {
      const cmd = dailyReviewCommand();
      await cmd.parseAsync(["node", "test", "log", "Test Activity", "--vault", "/test/vault", "--format", "json"]);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("path"));
    });
  });

  describe("start subcommand", () => {
    it("should start a practice", async () => {
      const cmd = dailyReviewCommand();
      await cmd.parseAsync(["node", "test", "start", "practice-1", "--vault", "/test/vault"]);

      expect(mockDailyReviewService.createFromPractice).toHaveBeenCalledWith({
        prototypeUid: "practice-1",
        startImmediately: true,
      });
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it("should output json format", async () => {
      const cmd = dailyReviewCommand();
      await cmd.parseAsync(["node", "test", "start", "practice-1", "--vault", "/test/vault", "--format", "json"]);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("path"));
    });
  });

  describe("done subcommand", () => {
    it("should mark practice as done", async () => {
      const cmd = dailyReviewCommand();
      await cmd.parseAsync(["node", "test", "done", "practice-1", "--vault", "/test/vault"]);

      expect(mockDailyReviewService.markPracticeDone).toHaveBeenCalledWith("practice-1");
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it("should output json format", async () => {
      const cmd = dailyReviewCommand();
      await cmd.parseAsync(["node", "test", "done", "practice-1", "--vault", "/test/vault", "--format", "json"]);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("prototypeUid"));
    });
  });

  describe("error handling", () => {
    it("should handle service errors gracefully", async () => {
      mockDailyReviewService.getPractices.mockRejectedValue(new Error("Service error"));

      const cmd = dailyReviewCommand();
      await cmd.parseAsync(["node", "test", "practices", "--vault", "/test/vault"]);

      // ErrorHandler should catch and report
      expect(processExitSpy).toHaveBeenCalled();
    });
  });
});
