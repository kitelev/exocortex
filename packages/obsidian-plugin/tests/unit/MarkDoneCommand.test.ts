import { flushPromises, waitForCondition } from "./helpers/testHelpers";
import { MarkDoneCommand } from "../../src/application/commands/MarkDoneCommand";
import { TFile, Notice } from "obsidian";
import { TaskStatusService, CommandVisibilityContext, LoggingService } from "exocortex";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Notice: jest.fn(),
}));
jest.mock("exocortex", () => ({
  ...jest.requireActual("exocortex"),
  canMarkDone: jest.fn(),
  LoggingService: {
    error: jest.fn(),
  },
}));

describe("MarkDoneCommand", () => {
  let command: MarkDoneCommand;
  let mockTaskStatusService: jest.Mocked<TaskStatusService>;
  let mockFile: jest.Mocked<TFile>;
  let mockContext: CommandVisibilityContext;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock task status service
    mockTaskStatusService = {
      markTaskAsDone: jest.fn(),
    } as unknown as jest.Mocked<TaskStatusService>;

    // Create mock file
    mockFile = {
      path: "test-task.md",
      basename: "test-task",
    } as jest.Mocked<TFile>;

    // Create mock context
    mockContext = {
      instanceClass: "Task",
      status: "InProgress",
      archived: false,
      isDraft: false,
    };

    // Create command instance
    command = new MarkDoneCommand(mockTaskStatusService);
  });

  describe("id and name", () => {
    it("should have correct id and name", () => {
      expect(command.id).toBe("mark-done");
      expect(command.name).toBe("Mark as done");
    });
  });

  describe("checkCallback", () => {
    const mockCanMarkDone = require("exocortex").canMarkDone;

    it("should return false when context is null", () => {
      const result = command.checkCallback(true, mockFile, null);
      expect(result).toBe(false);
      expect(mockTaskStatusService.markTaskAsDone).not.toHaveBeenCalled();
    });

    it("should return false when canMarkDone returns false", () => {
      mockCanMarkDone.mockReturnValue(false);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(false);
      expect(mockTaskStatusService.markTaskAsDone).not.toHaveBeenCalled();
    });

    it("should return true when canMarkDone returns true and checking is true", () => {
      mockCanMarkDone.mockReturnValue(true);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(true);
      expect(mockTaskStatusService.markTaskAsDone).not.toHaveBeenCalled();
    });

    it("should execute command when checking is false and canMarkDone returns true", async () => {
      mockCanMarkDone.mockReturnValue(true);
      mockTaskStatusService.markTaskAsDone.mockResolvedValue();

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.markTaskAsDone).toHaveBeenCalledWith(mockFile);
      expect(Notice).toHaveBeenCalledWith("Marked as done: test-task");
    });

    it("should handle errors and show notice", async () => {
      mockCanMarkDone.mockReturnValue(true);
      const error = new Error("Failed to mark done");
      mockTaskStatusService.markTaskAsDone.mockRejectedValue(error);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.markTaskAsDone).toHaveBeenCalledWith(mockFile);
      expect(LoggingService.error).toHaveBeenCalledWith("Mark done error", error);
      expect(Notice).toHaveBeenCalledWith("Failed to mark as done: Failed to mark done");
    });

    it("should handle different context statuses", () => {
      mockCanMarkDone.mockReturnValue(true);

      // Test with ToDo status
      const todoContext = { ...mockContext, status: "ToDo" };
      const result1 = command.checkCallback(true, mockFile, todoContext);
      expect(result1).toBe(true);

      // Test with Analysis status
      const analysisContext = { ...mockContext, status: "Analysis" };
      const result2 = command.checkCallback(true, mockFile, analysisContext);
      expect(result2).toBe(true);

      // Test with Done status (should typically return false from canMarkDone)
      mockCanMarkDone.mockReturnValue(false);
      const doneContext = { ...mockContext, status: "Done" };
      const result3 = command.checkCallback(true, mockFile, doneContext);
      expect(result3).toBe(false);
    });

    it("should handle files with special characters in basename", async () => {
      mockCanMarkDone.mockReturnValue(true);
      mockTaskStatusService.markTaskAsDone.mockResolvedValue();

      const specialFile = {
        path: "path/to/task-with-special-chars!@#$.md",
        basename: "task-with-special-chars!@#$",
      } as TFile;

      const result = command.checkCallback(false, specialFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.markTaskAsDone).toHaveBeenCalledWith(specialFile);
      expect(Notice).toHaveBeenCalledWith("Marked as done: task-with-special-chars!@#$");
    });

    it("should handle concurrent executions", async () => {
      mockCanMarkDone.mockReturnValue(true);

      // Create multiple files
      const file1 = { path: "task1.md", basename: "task1" } as TFile;
      const file2 = { path: "task2.md", basename: "task2" } as TFile;
      const file3 = { path: "task3.md", basename: "task3" } as TFile;

      // Mock service to resolve immediately
      mockTaskStatusService.markTaskAsDone.mockResolvedValue(undefined);

      // Execute commands concurrently
      command.checkCallback(false, file1, mockContext);
      command.checkCallback(false, file2, mockContext);
      command.checkCallback(false, file3, mockContext);

      // Wait for all async executions
      await waitForCondition(() => (Notice as jest.Mock).mock.calls.length >= 3);

      expect(mockTaskStatusService.markTaskAsDone).toHaveBeenCalledTimes(3);
      expect(mockTaskStatusService.markTaskAsDone).toHaveBeenCalledWith(file1);
      expect(mockTaskStatusService.markTaskAsDone).toHaveBeenCalledWith(file2);
      expect(mockTaskStatusService.markTaskAsDone).toHaveBeenCalledWith(file3);
      expect(Notice).toHaveBeenCalledWith("Marked as done: task1");
      expect(Notice).toHaveBeenCalledWith("Marked as done: task2");
      expect(Notice).toHaveBeenCalledWith("Marked as done: task3");
    });

    it("should handle service returning undefined", async () => {
      mockCanMarkDone.mockReturnValue(true);
      mockTaskStatusService.markTaskAsDone.mockResolvedValue(undefined);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.markTaskAsDone).toHaveBeenCalledWith(mockFile);
      expect(Notice).toHaveBeenCalledWith("Marked as done: test-task");
      expect(LoggingService.error).not.toHaveBeenCalled();
    });

    it("should handle error without message property", async () => {
      mockCanMarkDone.mockReturnValue(true);
      const error = { toString: () => "Custom error" };
      mockTaskStatusService.markTaskAsDone.mockRejectedValue(error);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.markTaskAsDone).toHaveBeenCalledWith(mockFile);
      // Since error is not an Error instance, undefined is passed to LoggingService.error
      expect(LoggingService.error).toHaveBeenCalledWith("Mark done error", undefined);
      // Since error is not an Error instance, String(error) is used which calls toString()
      expect(Notice).toHaveBeenCalledWith("Failed to mark as done: Custom error");
    });
  });
});