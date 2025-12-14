import { flushPromises } from "./helpers/testHelpers";
import { ShiftDayBackwardCommand } from "../../src/application/commands/ShiftDayBackwardCommand";
import { TFile, Notice } from "obsidian";
import { TaskStatusService, CommandVisibilityContext, LoggingService } from "exocortex";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Notice: jest.fn(),
}));
jest.mock("exocortex", () => ({
  ...jest.requireActual("exocortex"),
  canShiftDayBackward: jest.fn(),
  LoggingService: {
    error: jest.fn(),
  },
}));

describe("ShiftDayBackwardCommand", () => {
  let command: ShiftDayBackwardCommand;
  let mockTaskStatusService: jest.Mocked<TaskStatusService>;
  let mockFile: jest.Mocked<TFile>;
  let mockContext: CommandVisibilityContext;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock task status service
    mockTaskStatusService = {
      shiftDayBackward: jest.fn(),
    } as unknown as jest.Mocked<TaskStatusService>;

    // Create mock file
    mockFile = {
      path: "test-file.md",
      basename: "test-file",
    } as jest.Mocked<TFile>;

    // Create mock context
    mockContext = {
      instanceClass: "Task",
      status: "Active",
      archived: false,
      isDraft: false,
    };

    // Create command instance
    command = new ShiftDayBackwardCommand(mockTaskStatusService);
  });

  describe("id and name", () => {
    it("should have correct id and name", () => {
      expect(command.id).toBe("shift-day-backward");
      expect(command.name).toBe("Shift day backward");
    });
  });

  describe("checkCallback", () => {
    const mockCanShiftDayBackward = require("exocortex").canShiftDayBackward;

    it("should return false when context is null", () => {
      const result = command.checkCallback(true, mockFile, null);
      expect(result).toBe(false);
      expect(mockTaskStatusService.shiftDayBackward).not.toHaveBeenCalled();
    });

    it("should return false when canShiftDayBackward returns false", () => {
      mockCanShiftDayBackward.mockReturnValue(false);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(false);
      expect(mockTaskStatusService.shiftDayBackward).not.toHaveBeenCalled();
    });

    it("should return true when canShiftDayBackward returns true and checking is true", () => {
      mockCanShiftDayBackward.mockReturnValue(true);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(true);
      expect(mockTaskStatusService.shiftDayBackward).not.toHaveBeenCalled();
    });

    it("should execute command when checking is false and canShiftDayBackward returns true", async () => {
      mockCanShiftDayBackward.mockReturnValue(true);
      mockTaskStatusService.shiftDayBackward.mockResolvedValue();

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.shiftDayBackward).toHaveBeenCalledWith(mockFile);
      expect(Notice).toHaveBeenCalledWith("Day shifted backward: test-file");
    });

    it("should handle errors and show notice", async () => {
      mockCanShiftDayBackward.mockReturnValue(true);
      const error = new Error("Failed to shift");
      mockTaskStatusService.shiftDayBackward.mockRejectedValue(error);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.shiftDayBackward).toHaveBeenCalledWith(mockFile);
      expect(LoggingService.error).toHaveBeenCalledWith("Shift day backward error", error);
      expect(Notice).toHaveBeenCalledWith("Failed to shift day backward: Failed to shift");
    });

    it("should handle files with special characters", async () => {
      mockCanShiftDayBackward.mockReturnValue(true);
      mockTaskStatusService.shiftDayBackward.mockResolvedValue();

      const specialFile = {
        path: "path/to/[DATE] Task (2024-01-01).md",
        basename: "[DATE] Task (2024-01-01)",
      } as TFile;

      const result = command.checkCallback(false, specialFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.shiftDayBackward).toHaveBeenCalledWith(specialFile);
      expect(Notice).toHaveBeenCalledWith("Day shifted backward: [DATE] Task (2024-01-01)");
    });

    it("should handle date boundary errors", async () => {
      mockCanShiftDayBackward.mockReturnValue(true);
      const boundaryError = new Error("Cannot shift before minimum date");
      mockTaskStatusService.shiftDayBackward.mockRejectedValue(boundaryError);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.shiftDayBackward).toHaveBeenCalledWith(mockFile);
      expect(LoggingService.error).toHaveBeenCalledWith("Shift day backward error", boundaryError);
      expect(Notice).toHaveBeenCalledWith("Failed to shift day backward: Cannot shift before minimum date");
    });

    it("should handle invalid date format errors", async () => {
      mockCanShiftDayBackward.mockReturnValue(true);
      const formatError = new Error("Invalid date format in file");
      mockTaskStatusService.shiftDayBackward.mockRejectedValue(formatError);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.shiftDayBackward).toHaveBeenCalledWith(mockFile);
      expect(LoggingService.error).toHaveBeenCalledWith("Shift day backward error", formatError);
      expect(Notice).toHaveBeenCalledWith("Failed to shift day backward: Invalid date format in file");
    });

    it("should handle multiple concurrent shift operations", async () => {
      mockCanShiftDayBackward.mockReturnValue(true);
      mockTaskStatusService.shiftDayBackward.mockResolvedValue();

      const files = [
        { path: "file1.md", basename: "file1" } as TFile,
        { path: "file2.md", basename: "file2" } as TFile,
        { path: "file3.md", basename: "file3" } as TFile,
      ];

      // Execute shift operations concurrently
      files.forEach(file => command.checkCallback(false, file, mockContext));

      // Wait for all async executions
      await flushPromises();

      expect(mockTaskStatusService.shiftDayBackward).toHaveBeenCalledTimes(3);
      files.forEach((file, index) => {
        expect(mockTaskStatusService.shiftDayBackward).toHaveBeenNthCalledWith(index + 1, file);
        expect(Notice).toHaveBeenCalledWith(`Day shifted backward: ${file.basename}`);
      });
    });

    it("should handle file system errors", async () => {
      mockCanShiftDayBackward.mockReturnValue(true);
      const fsError = new Error("File locked");
      mockTaskStatusService.shiftDayBackward.mockRejectedValue(fsError);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.shiftDayBackward).toHaveBeenCalledWith(mockFile);
      expect(LoggingService.error).toHaveBeenCalledWith("Shift day backward error", fsError);
      expect(Notice).toHaveBeenCalledWith("Failed to shift day backward: File locked");
    });
  });
});