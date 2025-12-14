import { flushPromises, waitForCondition } from "./helpers/testHelpers";
import { ArchiveTaskCommand } from "../../src/application/commands/ArchiveTaskCommand";
import { TFile, Notice } from "obsidian";
import { TaskStatusService, CommandVisibilityContext, LoggingService } from "exocortex";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Notice: jest.fn(),
}));
jest.mock("exocortex", () => ({
  ...jest.requireActual("exocortex"),
  canArchiveTask: jest.fn(),
  LoggingService: {
    error: jest.fn(),
  },
}));

describe("ArchiveTaskCommand", () => {
  let command: ArchiveTaskCommand;
  let mockTaskStatusService: jest.Mocked<TaskStatusService>;
  let mockFile: jest.Mocked<TFile>;
  let mockContext: CommandVisibilityContext;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock task status service
    mockTaskStatusService = {
      archiveTask: jest.fn(),
    } as unknown as jest.Mocked<TaskStatusService>;

    // Create mock file
    mockFile = {
      path: "test-task.md",
      basename: "test-task",
    } as jest.Mocked<TFile>;

    // Create mock context
    mockContext = {
      instanceClass: "Task",
      status: "Done",
      archived: false,
      isDraft: false,
    };

    // Create command instance
    command = new ArchiveTaskCommand(mockTaskStatusService);
  });

  describe("id and name", () => {
    it("should have correct id and name", () => {
      expect(command.id).toBe("archive-task");
      expect(command.name).toBe("Archive task");
    });
  });

  describe("checkCallback", () => {
    const mockCanArchiveTask = require("exocortex").canArchiveTask;

    it("should return false when context is null", () => {
      const result = command.checkCallback(true, mockFile, null);
      expect(result).toBe(false);
      expect(mockTaskStatusService.archiveTask).not.toHaveBeenCalled();
    });

    it("should return false when canArchiveTask returns false", () => {
      mockCanArchiveTask.mockReturnValue(false);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(false);
      expect(mockTaskStatusService.archiveTask).not.toHaveBeenCalled();
    });

    it("should return true when canArchiveTask returns true and checking is true", () => {
      mockCanArchiveTask.mockReturnValue(true);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(true);
      expect(mockTaskStatusService.archiveTask).not.toHaveBeenCalled();
    });

    it("should execute command when checking is false and canArchiveTask returns true", async () => {
      mockCanArchiveTask.mockReturnValue(true);
      mockTaskStatusService.archiveTask.mockResolvedValue();

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.archiveTask).toHaveBeenCalledWith(mockFile);
      expect(Notice).toHaveBeenCalledWith("Archived: test-task");
    });

    it("should handle errors and show notice", async () => {
      mockCanArchiveTask.mockReturnValue(true);
      const error = new Error("Failed to archive");
      mockTaskStatusService.archiveTask.mockRejectedValue(error);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.archiveTask).toHaveBeenCalledWith(mockFile);
      expect(LoggingService.error).toHaveBeenCalledWith("Archive task error", error);
      expect(Notice).toHaveBeenCalledWith("Failed to archive task: Failed to archive");
    });

    it("should handle already archived context", () => {
      mockCanArchiveTask.mockReturnValue(false);
      const archivedContext = { ...mockContext, archived: true };
      const result = command.checkCallback(true, mockFile, archivedContext);
      expect(result).toBe(false);
    });

    it("should handle files with long basenames", async () => {
      mockCanArchiveTask.mockReturnValue(true);
      mockTaskStatusService.archiveTask.mockResolvedValue();

      const longFile = {
        path: "path/to/very-long-task-name-that-exceeds-normal-length-expectations.md",
        basename: "very-long-task-name-that-exceeds-normal-length-expectations",
      } as TFile;

      const result = command.checkCallback(false, longFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.archiveTask).toHaveBeenCalledWith(longFile);
      expect(Notice).toHaveBeenCalledWith(
        "Archived: very-long-task-name-that-exceeds-normal-length-expectations"
      );
    });

    it("should handle different task statuses", () => {
      mockCanArchiveTask.mockReturnValue(true);

      // Test with Done status
      const doneContext = { ...mockContext, status: "Done" };
      const result1 = command.checkCallback(true, mockFile, doneContext);
      expect(result1).toBe(true);

      // Test with Cancelled status
      const cancelledContext = { ...mockContext, status: "Cancelled" };
      const result2 = command.checkCallback(true, mockFile, cancelledContext);
      expect(result2).toBe(true);

      // Test with InProgress status (should typically return false from canArchiveTask)
      mockCanArchiveTask.mockReturnValue(false);
      const inProgressContext = { ...mockContext, status: "InProgress" };
      const result3 = command.checkCallback(true, mockFile, inProgressContext);
      expect(result3).toBe(false);
    });

    it("should handle error with custom toString method", async () => {
      mockCanArchiveTask.mockReturnValue(true);
      const customError = {
        toString: () => "Custom error string",
        message: undefined,
      };
      mockTaskStatusService.archiveTask.mockRejectedValue(customError);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.archiveTask).toHaveBeenCalledWith(mockFile);
      // Since error is not an Error instance, undefined is passed to LoggingService.error
      expect(LoggingService.error).toHaveBeenCalledWith("Archive task error", undefined);
      // Since error is not an Error instance, String(error) is used which calls toString()
      expect(Notice).toHaveBeenCalledWith("Failed to archive task: Custom error string");
    });

    it("should handle multiple concurrent archive operations", async () => {
      mockCanArchiveTask.mockReturnValue(true);

      // Create multiple files
      const files = [
        { path: "task1.md", basename: "task1" } as TFile,
        { path: "task2.md", basename: "task2" } as TFile,
        { path: "task3.md", basename: "task3" } as TFile,
      ];

      // Mock service to resolve immediately
      mockTaskStatusService.archiveTask.mockResolvedValue(undefined);

      // Execute commands concurrently
      files.forEach(file => command.checkCallback(false, file, mockContext));

      // Wait for all async executions
      await waitForCondition(() => (Notice as jest.Mock).mock.calls.length >= 3);

      expect(mockTaskStatusService.archiveTask).toHaveBeenCalledTimes(3);
      files.forEach((file, index) => {
        expect(mockTaskStatusService.archiveTask).toHaveBeenNthCalledWith(index + 1, file);
        expect(Notice).toHaveBeenCalledWith(`Archived: ${file.basename}`);
      });
    });
  });
});