import { flushPromises } from "./helpers/testHelpers";
import { PlanOnTodayCommand } from "../../src/application/commands/PlanOnTodayCommand";
import { TFile, Notice } from "obsidian";
import { TaskStatusService, CommandVisibilityContext, LoggingService } from "exocortex";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Notice: jest.fn(),
}));
jest.mock("exocortex", () => ({
  ...jest.requireActual("exocortex"),
  canPlanOnToday: jest.fn(),
  LoggingService: {
    error: jest.fn(),
  },
}));

describe("PlanOnTodayCommand", () => {
  let command: PlanOnTodayCommand;
  let mockTaskStatusService: jest.Mocked<TaskStatusService>;
  let mockFile: jest.Mocked<TFile>;
  let mockContext: CommandVisibilityContext;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock task status service
    mockTaskStatusService = {
      planOnToday: jest.fn(),
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
    command = new PlanOnTodayCommand(mockTaskStatusService);
  });

  describe("id and name", () => {
    it("should have correct id and name", () => {
      expect(command.id).toBe("plan-on-today");
      expect(command.name).toBe("Plan on today");
    });
  });

  describe("checkCallback", () => {
    const mockCanPlanOnToday = require("exocortex").canPlanOnToday;

    it("should return false when context is null", () => {
      const result = command.checkCallback(true, mockFile, null);
      expect(result).toBe(false);
      expect(mockTaskStatusService.planOnToday).not.toHaveBeenCalled();
    });

    it("should return false when canPlanOnToday returns false", () => {
      mockCanPlanOnToday.mockReturnValue(false);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(false);
      expect(mockTaskStatusService.planOnToday).not.toHaveBeenCalled();
    });

    it("should return true when canPlanOnToday returns true and checking is true", () => {
      mockCanPlanOnToday.mockReturnValue(true);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(true);
      expect(mockTaskStatusService.planOnToday).not.toHaveBeenCalled();
    });

    it("should execute command when checking is false and canPlanOnToday returns true", async () => {
      mockCanPlanOnToday.mockReturnValue(true);
      mockTaskStatusService.planOnToday.mockResolvedValue();

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.planOnToday).toHaveBeenCalledWith(mockFile);
      expect(Notice).toHaveBeenCalledWith("Planned on today: test-file");
    });

    it("should handle errors and show notice", async () => {
      mockCanPlanOnToday.mockReturnValue(true);
      const error = new Error("Failed to plan");
      mockTaskStatusService.planOnToday.mockRejectedValue(error);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.planOnToday).toHaveBeenCalledWith(mockFile);
      expect(LoggingService.error).toHaveBeenCalledWith("Plan on today error", error);
      expect(Notice).toHaveBeenCalledWith("Failed to plan on today: Failed to plan");
    });

    it("should handle files with special characters", async () => {
      mockCanPlanOnToday.mockReturnValue(true);
      mockTaskStatusService.planOnToday.mockResolvedValue();

      const specialFile = {
        path: "path/to/[TODAY] Task (2024).md",
        basename: "[TODAY] Task (2024)",
      } as TFile;

      const result = command.checkCallback(false, specialFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.planOnToday).toHaveBeenCalledWith(specialFile);
      expect(Notice).toHaveBeenCalledWith("Planned on today: [TODAY] Task (2024)");
    });

    it("should handle file system errors", async () => {
      mockCanPlanOnToday.mockReturnValue(true);
      const fsError = new Error("File locked");
      mockTaskStatusService.planOnToday.mockRejectedValue(fsError);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.planOnToday).toHaveBeenCalledWith(mockFile);
      expect(LoggingService.error).toHaveBeenCalledWith("Plan on today error", fsError);
      expect(Notice).toHaveBeenCalledWith("Failed to plan on today: File locked");
    });

    it("should handle permission denied error", async () => {
      mockCanPlanOnToday.mockReturnValue(true);
      const permError = new Error("Permission denied: cannot write to file");
      mockTaskStatusService.planOnToday.mockRejectedValue(permError);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.planOnToday).toHaveBeenCalledWith(mockFile);
      expect(LoggingService.error).toHaveBeenCalledWith("Plan on today error", permError);
      expect(Notice).toHaveBeenCalledWith("Failed to plan on today: Permission denied: cannot write to file");
    });

    it("should handle multiple concurrent planning operations", async () => {
      mockCanPlanOnToday.mockReturnValue(true);
      mockTaskStatusService.planOnToday.mockResolvedValue();

      const files = [
        { path: "file1.md", basename: "file1" } as TFile,
        { path: "file2.md", basename: "file2" } as TFile,
        { path: "file3.md", basename: "file3" } as TFile,
      ];

      // Execute planning operations concurrently
      files.forEach(file => command.checkCallback(false, file, mockContext));

      // Wait for all async executions
      await flushPromises();

      expect(mockTaskStatusService.planOnToday).toHaveBeenCalledTimes(3);
      files.forEach((file, index) => {
        expect(mockTaskStatusService.planOnToday).toHaveBeenNthCalledWith(index + 1, file);
        expect(Notice).toHaveBeenCalledWith(`Planned on today: ${file.basename}`);
      });
    });

    it("should handle tasks already planned for today", async () => {
      mockCanPlanOnToday.mockReturnValue(true);
      const alreadyPlannedError = new Error("Task already planned for today");
      mockTaskStatusService.planOnToday.mockRejectedValue(alreadyPlannedError);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.planOnToday).toHaveBeenCalledWith(mockFile);
      expect(LoggingService.error).toHaveBeenCalledWith("Plan on today error", alreadyPlannedError);
      expect(Notice).toHaveBeenCalledWith("Failed to plan on today: Task already planned for today");
    });
  });
});