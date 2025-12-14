import { flushPromises } from "./helpers/testHelpers";
import { MoveToAnalysisCommand } from "../../src/application/commands/MoveToAnalysisCommand";
import { TFile, Notice } from "obsidian";
import { TaskStatusService, CommandVisibilityContext, LoggingService } from "exocortex";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Notice: jest.fn(),
}));
jest.mock("exocortex", () => ({
  ...jest.requireActual("exocortex"),
  canMoveToAnalysis: jest.fn(),
  LoggingService: {
    error: jest.fn(),
  },
}));

describe("MoveToAnalysisCommand", () => {
  let command: MoveToAnalysisCommand;
  let mockTaskStatusService: jest.Mocked<TaskStatusService>;
  let mockFile: jest.Mocked<TFile>;
  let mockContext: CommandVisibilityContext;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock task status service
    mockTaskStatusService = {
      moveToAnalysis: jest.fn(),
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
    command = new MoveToAnalysisCommand(mockTaskStatusService);
  });

  describe("id and name", () => {
    it("should have correct id and name", () => {
      expect(command.id).toBe("move-to-analysis");
      expect(command.name).toBe("Move to analysis");
    });
  });

  describe("checkCallback", () => {
    const mockCanMoveToAnalysis = require("exocortex").canMoveToAnalysis;

    it("should return false when context is null", () => {
      const result = command.checkCallback(true, mockFile, null);
      expect(result).toBe(false);
      expect(mockTaskStatusService.moveToAnalysis).not.toHaveBeenCalled();
    });

    it("should return false when canMoveToAnalysis returns false", () => {
      mockCanMoveToAnalysis.mockReturnValue(false);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(false);
      expect(mockTaskStatusService.moveToAnalysis).not.toHaveBeenCalled();
    });

    it("should return true when canMoveToAnalysis returns true and checking is true", () => {
      mockCanMoveToAnalysis.mockReturnValue(true);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(true);
      expect(mockTaskStatusService.moveToAnalysis).not.toHaveBeenCalled();
    });

    it("should execute command when checking is false and canMoveToAnalysis returns true", async () => {
      mockCanMoveToAnalysis.mockReturnValue(true);
      mockTaskStatusService.moveToAnalysis.mockResolvedValue();

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.moveToAnalysis).toHaveBeenCalledWith(mockFile);
      expect(Notice).toHaveBeenCalledWith("Moved to Analysis: test-task");
    });

    it("should handle errors and show notice", async () => {
      mockCanMoveToAnalysis.mockReturnValue(true);
      const error = new Error("Failed to move to analysis");
      mockTaskStatusService.moveToAnalysis.mockRejectedValue(error);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.moveToAnalysis).toHaveBeenCalledWith(mockFile);
      expect(LoggingService.error).toHaveBeenCalledWith("Move to analysis error", error);
      expect(Notice).toHaveBeenCalledWith("Failed to move to analysis: Failed to move to analysis");
    });

    it("should handle Analysis status context", () => {
      mockCanMoveToAnalysis.mockReturnValue(false);
      const analysisContext = { ...mockContext, status: "Analysis" };
      const result = command.checkCallback(true, mockFile, analysisContext);
      expect(result).toBe(false);
    });

    it("should handle files with underscores in basename", async () => {
      mockCanMoveToAnalysis.mockReturnValue(true);
      mockTaskStatusService.moveToAnalysis.mockResolvedValue();

      const underscoreFile = {
        path: "path/to/important_analysis_task.md",
        basename: "important_analysis_task",
      } as TFile;

      const result = command.checkCallback(false, underscoreFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.moveToAnalysis).toHaveBeenCalledWith(underscoreFile);
      expect(Notice).toHaveBeenCalledWith("Moved to Analysis: important_analysis_task");
    });

    it("should handle database errors", async () => {
      mockCanMoveToAnalysis.mockReturnValue(true);
      const dbError = new Error("Database connection failed");
      mockTaskStatusService.moveToAnalysis.mockRejectedValue(dbError);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.moveToAnalysis).toHaveBeenCalledWith(mockFile);
      expect(LoggingService.error).toHaveBeenCalledWith("Move to analysis error", dbError);
      expect(Notice).toHaveBeenCalledWith("Failed to move to analysis: Database connection failed");
    });

    it("should handle archived context", () => {
      mockCanMoveToAnalysis.mockReturnValue(false);
      const archivedContext = { ...mockContext, archived: true };
      const result = command.checkCallback(true, mockFile, archivedContext);
      expect(result).toBe(false);
    });
  });
});