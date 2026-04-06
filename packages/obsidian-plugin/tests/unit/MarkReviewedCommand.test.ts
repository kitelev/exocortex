import { flushPromises, waitForCondition } from "./helpers/testHelpers";
import { MarkReviewedCommand } from "../../src/application/commands/MarkReviewedCommand";
import { TFile, Notice } from "obsidian";
import { TaskStatusService, CommandVisibilityContext, LoggingService } from "exocortex";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Notice: jest.fn(),
}));
jest.mock("exocortex", () => ({
  ...jest.requireActual("exocortex"),
  canMarkReviewed: jest.fn(),
  LoggingService: {
    error: jest.fn(),
  },
}));

describe("MarkReviewedCommand", () => {
  let command: MarkReviewedCommand;
  let mockTaskStatusService: jest.Mocked<TaskStatusService>;
  let mockFile: jest.Mocked<TFile>;
  let mockContext: CommandVisibilityContext;
  let mockNotifier: { info: jest.Mock; success: jest.Mock; error: jest.Mock; warn: jest.Mock; confirm: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock task status service
    mockTaskStatusService = {
      markAsReviewed: jest.fn(),
    } as unknown as jest.Mocked<TaskStatusService>;

    // Create mock file
    mockFile = {
      path: "test-task.md",
      basename: "test-task",
    } as jest.Mocked<TFile>;

    // Create mock context for a Task
    mockContext = {
      instanceClass: "ems__Task",
      status: "InProgress",
      archived: false,
      isDraft: false,
    };

    // Create command instance
    mockNotifier = { info: jest.fn(), success: jest.fn(), error: jest.fn(), warn: jest.fn(), confirm: jest.fn() };
    command = new MarkReviewedCommand(mockTaskStatusService, mockNotifier);
  });

  describe("id and name", () => {
    it("should have correct id and name", () => {
      expect(command.id).toBe("mark-reviewed");
      expect(command.name).toBe("Mark as reviewed");
    });
  });

  describe("checkCallback", () => {
    const mockCanMarkReviewed = require("exocortex").canMarkReviewed;

    it("should return false when context is null", () => {
      const result = command.checkCallback(true, mockFile, null);
      expect(result).toBe(false);
      expect(mockTaskStatusService.markAsReviewed).not.toHaveBeenCalled();
    });

    it("should return false when canMarkReviewed returns false", () => {
      mockCanMarkReviewed.mockReturnValue(false);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(false);
      expect(mockTaskStatusService.markAsReviewed).not.toHaveBeenCalled();
    });

    it("should return true when canMarkReviewed returns true and checking is true", () => {
      mockCanMarkReviewed.mockReturnValue(true);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(true);
      expect(mockTaskStatusService.markAsReviewed).not.toHaveBeenCalled();
    });

    it("should execute command when checking is false and canMarkReviewed returns true", async () => {
      mockCanMarkReviewed.mockReturnValue(true);
      mockTaskStatusService.markAsReviewed.mockResolvedValue();

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.markAsReviewed).toHaveBeenCalledWith(mockFile);
      expect(mockNotifier.success).toHaveBeenCalledWith("Marked as reviewed: test-task");
    });

    it("should handle errors and show notice", async () => {
      mockCanMarkReviewed.mockReturnValue(true);
      const error = new Error("Failed to mark reviewed");
      mockTaskStatusService.markAsReviewed.mockRejectedValue(error);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.markAsReviewed).toHaveBeenCalledWith(mockFile);
      expect(LoggingService.error).toHaveBeenCalledWith("Mark reviewed error", error);
      expect(mockNotifier.error).toHaveBeenCalledWith("Failed to mark as reviewed: Failed to mark reviewed");
    });

    it("should work with Project class", () => {
      mockCanMarkReviewed.mockReturnValue(true);

      const projectContext = { ...mockContext, instanceClass: "ems__Project" };
      const result = command.checkCallback(true, mockFile, projectContext);
      expect(result).toBe(true);
    });

    it("should handle files with special characters in basename", async () => {
      mockCanMarkReviewed.mockReturnValue(true);
      mockTaskStatusService.markAsReviewed.mockResolvedValue();

      const specialFile = {
        path: "path/to/task-with-special-chars!@#$.md",
        basename: "task-with-special-chars!@#$",
      } as TFile;

      const result = command.checkCallback(false, specialFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.markAsReviewed).toHaveBeenCalledWith(specialFile);
      expect(mockNotifier.success).toHaveBeenCalledWith("Marked as reviewed: task-with-special-chars!@#$");
    });

    it("should handle concurrent executions", async () => {
      mockCanMarkReviewed.mockReturnValue(true);

      // Create multiple files
      const file1 = { path: "task1.md", basename: "task1" } as TFile;
      const file2 = { path: "task2.md", basename: "task2" } as TFile;
      const file3 = { path: "task3.md", basename: "task3" } as TFile;

      // Mock service to resolve immediately
      mockTaskStatusService.markAsReviewed.mockResolvedValue(undefined);

      // Execute commands concurrently
      command.checkCallback(false, file1, mockContext);
      command.checkCallback(false, file2, mockContext);
      command.checkCallback(false, file3, mockContext);

      // Wait for all async executions
      await waitForCondition(() => mockNotifier.success.mock.calls.length >= 3);

      expect(mockTaskStatusService.markAsReviewed).toHaveBeenCalledTimes(3);
      expect(mockTaskStatusService.markAsReviewed).toHaveBeenCalledWith(file1);
      expect(mockTaskStatusService.markAsReviewed).toHaveBeenCalledWith(file2);
      expect(mockTaskStatusService.markAsReviewed).toHaveBeenCalledWith(file3);
      expect(mockNotifier.success).toHaveBeenCalledWith("Marked as reviewed: task1");
      expect(mockNotifier.success).toHaveBeenCalledWith("Marked as reviewed: task2");
      expect(mockNotifier.success).toHaveBeenCalledWith("Marked as reviewed: task3");
    });

    it("should handle service returning undefined", async () => {
      mockCanMarkReviewed.mockReturnValue(true);
      mockTaskStatusService.markAsReviewed.mockResolvedValue(undefined);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.markAsReviewed).toHaveBeenCalledWith(mockFile);
      expect(mockNotifier.success).toHaveBeenCalledWith("Marked as reviewed: test-task");
      expect(LoggingService.error).not.toHaveBeenCalled();
    });

    it("should handle error without message property", async () => {
      mockCanMarkReviewed.mockReturnValue(true);
      const error = { toString: () => "Custom error" };
      mockTaskStatusService.markAsReviewed.mockRejectedValue(error);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.markAsReviewed).toHaveBeenCalledWith(mockFile);
      // Since error is not an Error instance, undefined is passed to LoggingService.error
      expect(LoggingService.error).toHaveBeenCalledWith("Mark reviewed error", undefined);
      // Since error is not an Error instance, String(error) is used which calls toString()
      expect(mockNotifier.error).toHaveBeenCalledWith("Failed to mark as reviewed: Custom error");
    });
  });
});
