import { flushPromises } from "./helpers/testHelpers";
import { ShiftDayForwardCommand } from "../../src/application/commands/ShiftDayForwardCommand";
import { TFile, Notice } from "obsidian";
import { TaskStatusService, CommandVisibilityContext, LoggingService } from "exocortex";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Notice: jest.fn(),
}));
jest.mock("exocortex", () => ({
  ...jest.requireActual("exocortex"),
  canShiftDayForward: jest.fn(),
  LoggingService: {
    error: jest.fn(),
  },
}));

describe("ShiftDayForwardCommand", () => {
  let command: ShiftDayForwardCommand;
  let mockTaskStatusService: jest.Mocked<TaskStatusService>;
  let mockFile: jest.Mocked<TFile>;
  let mockContext: CommandVisibilityContext;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock task status service
    mockTaskStatusService = {
      shiftDayForward: jest.fn(),
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
    command = new ShiftDayForwardCommand(mockTaskStatusService);
  });

  describe("id and name", () => {
    it("should have correct id and name", () => {
      expect(command.id).toBe("shift-day-forward");
      expect(command.name).toBe("Shift day forward");
    });
  });

  describe("checkCallback", () => {
    const mockCanShiftDayForward = require("exocortex").canShiftDayForward;

    it("should return false when context is null", () => {
      const result = command.checkCallback(true, mockFile, null);
      expect(result).toBe(false);
      expect(mockTaskStatusService.shiftDayForward).not.toHaveBeenCalled();
    });

    it("should return false when canShiftDayForward returns false", () => {
      mockCanShiftDayForward.mockReturnValue(false);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(false);
      expect(mockTaskStatusService.shiftDayForward).not.toHaveBeenCalled();
    });

    it("should return true when canShiftDayForward returns true and checking is true", () => {
      mockCanShiftDayForward.mockReturnValue(true);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(true);
      expect(mockTaskStatusService.shiftDayForward).not.toHaveBeenCalled();
    });

    it("should execute command when checking is false and canShiftDayForward returns true", async () => {
      mockCanShiftDayForward.mockReturnValue(true);
      mockTaskStatusService.shiftDayForward.mockResolvedValue();

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.shiftDayForward).toHaveBeenCalledWith(mockFile);
      expect(Notice).toHaveBeenCalledWith("Day shifted forward: test-file");
    });

    it("should handle errors and show notice", async () => {
      mockCanShiftDayForward.mockReturnValue(true);
      const error = new Error("Failed to shift");
      mockTaskStatusService.shiftDayForward.mockRejectedValue(error);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.shiftDayForward).toHaveBeenCalledWith(mockFile);
      expect(LoggingService.error).toHaveBeenCalledWith("Shift day forward error", error);
      expect(Notice).toHaveBeenCalledWith("Failed to shift day forward: Failed to shift");
    });

    it("should handle files with special characters", async () => {
      mockCanShiftDayForward.mockReturnValue(true);
      mockTaskStatusService.shiftDayForward.mockResolvedValue();

      const specialFile = {
        path: "path/to/[DATE] Task (2024-12-31).md",
        basename: "[DATE] Task (2024-12-31)",
      } as TFile;

      const result = command.checkCallback(false, specialFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.shiftDayForward).toHaveBeenCalledWith(specialFile);
      expect(Notice).toHaveBeenCalledWith("Day shifted forward: [DATE] Task (2024-12-31)");
    });

    it("should handle date boundary errors", async () => {
      mockCanShiftDayForward.mockReturnValue(true);
      const boundaryError = new Error("Cannot shift beyond maximum date");
      mockTaskStatusService.shiftDayForward.mockRejectedValue(boundaryError);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.shiftDayForward).toHaveBeenCalledWith(mockFile);
      expect(LoggingService.error).toHaveBeenCalledWith("Shift day forward error", boundaryError);
      expect(Notice).toHaveBeenCalledWith("Failed to shift day forward: Cannot shift beyond maximum date");
    });

    it("should handle invalid date format errors", async () => {
      mockCanShiftDayForward.mockReturnValue(true);
      const formatError = new Error("Invalid date format in file");
      mockTaskStatusService.shiftDayForward.mockRejectedValue(formatError);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.shiftDayForward).toHaveBeenCalledWith(mockFile);
      expect(LoggingService.error).toHaveBeenCalledWith("Shift day forward error", formatError);
      expect(Notice).toHaveBeenCalledWith("Failed to shift day forward: Invalid date format in file");
    });

    it("should handle multiple concurrent shift operations", async () => {
      mockCanShiftDayForward.mockReturnValue(true);
      mockTaskStatusService.shiftDayForward.mockResolvedValue();

      const files = [
        { path: "file1.md", basename: "file1" } as TFile,
        { path: "file2.md", basename: "file2" } as TFile,
        { path: "file3.md", basename: "file3" } as TFile,
      ];

      // Execute shift operations concurrently
      files.forEach(file => command.checkCallback(false, file, mockContext));

      // Wait for all async executions
      await flushPromises();

      expect(mockTaskStatusService.shiftDayForward).toHaveBeenCalledTimes(3);
      files.forEach((file, index) => {
        expect(mockTaskStatusService.shiftDayForward).toHaveBeenNthCalledWith(index + 1, file);
        expect(Notice).toHaveBeenCalledWith(`Day shifted forward: ${file.basename}`);
      });
    });

    it("should handle file system errors", async () => {
      mockCanShiftDayForward.mockReturnValue(true);
      const fsError = new Error("File locked");
      mockTaskStatusService.shiftDayForward.mockRejectedValue(fsError);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.shiftDayForward).toHaveBeenCalledWith(mockFile);
      expect(LoggingService.error).toHaveBeenCalledWith("Shift day forward error", fsError);
      expect(Notice).toHaveBeenCalledWith("Failed to shift day forward: File locked");
    });

    it("should handle leap year boundary", async () => {
      mockCanShiftDayForward.mockReturnValue(true);
      mockTaskStatusService.shiftDayForward.mockResolvedValue();

      const leapYearFile = {
        path: "leap-year-task-2024-02-29.md",
        basename: "leap-year-task-2024-02-29",
      } as TFile;

      const result = command.checkCallback(false, leapYearFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.shiftDayForward).toHaveBeenCalledWith(leapYearFile);
      expect(Notice).toHaveBeenCalledWith("Day shifted forward: leap-year-task-2024-02-29");
    });
  });
});