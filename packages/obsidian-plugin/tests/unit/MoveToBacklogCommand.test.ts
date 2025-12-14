import { flushPromises } from "./helpers/testHelpers";
import { MoveToBacklogCommand } from "../../src/application/commands/MoveToBacklogCommand";
import { TFile, Notice } from "obsidian";
import { TaskStatusService, CommandVisibilityContext, LoggingService } from "exocortex";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Notice: jest.fn(),
}));
jest.mock("exocortex", () => ({
  ...jest.requireActual("exocortex"),
  canMoveToBacklog: jest.fn(),
  LoggingService: {
    error: jest.fn(),
  },
}));

describe("MoveToBacklogCommand", () => {
  let command: MoveToBacklogCommand;
  let mockTaskStatusService: jest.Mocked<TaskStatusService>;
  let mockFile: jest.Mocked<TFile>;
  let mockContext: CommandVisibilityContext;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock task status service
    mockTaskStatusService = {
      moveToBacklog: jest.fn(),
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
    command = new MoveToBacklogCommand(mockTaskStatusService);
  });

  describe("id and name", () => {
    it("should have correct id and name", () => {
      expect(command.id).toBe("move-to-backlog");
      expect(command.name).toBe("Move to backlog");
    });
  });

  describe("checkCallback", () => {
    const mockCanMoveToBacklog = require("exocortex").canMoveToBacklog;

    it("should return false when context is null", () => {
      const result = command.checkCallback(true, mockFile, null);
      expect(result).toBe(false);
      expect(mockTaskStatusService.moveToBacklog).not.toHaveBeenCalled();
    });

    it("should return false when canMoveToBacklog returns false", () => {
      mockCanMoveToBacklog.mockReturnValue(false);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(false);
      expect(mockTaskStatusService.moveToBacklog).not.toHaveBeenCalled();
    });

    it("should return true when canMoveToBacklog returns true and checking is true", () => {
      mockCanMoveToBacklog.mockReturnValue(true);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(true);
      expect(mockTaskStatusService.moveToBacklog).not.toHaveBeenCalled();
    });

    it("should execute command when checking is false and canMoveToBacklog returns true", async () => {
      mockCanMoveToBacklog.mockReturnValue(true);
      mockTaskStatusService.moveToBacklog.mockResolvedValue();

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.moveToBacklog).toHaveBeenCalledWith(mockFile);
      expect(Notice).toHaveBeenCalledWith("Moved to Backlog: test-task");
    });

    it("should handle errors and show notice", async () => {
      mockCanMoveToBacklog.mockReturnValue(true);
      const error = new Error("Failed to move");
      mockTaskStatusService.moveToBacklog.mockRejectedValue(error);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.moveToBacklog).toHaveBeenCalledWith(mockFile);
      expect(LoggingService.error).toHaveBeenCalledWith("Move to backlog error", error);
      expect(Notice).toHaveBeenCalledWith("Failed to move to backlog: Failed to move");
    });

    it("should handle Backlog status context", () => {
      mockCanMoveToBacklog.mockReturnValue(false);
      const backlogContext = { ...mockContext, status: "Backlog" };
      const result = command.checkCallback(true, mockFile, backlogContext);
      expect(result).toBe(false);
    });

    it("should handle files with dashes in basename", async () => {
      mockCanMoveToBacklog.mockReturnValue(true);
      mockTaskStatusService.moveToBacklog.mockResolvedValue();

      const dashedFile = {
        path: "path/to/my-important-task.md",
        basename: "my-important-task",
      } as TFile;

      const result = command.checkCallback(false, dashedFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.moveToBacklog).toHaveBeenCalledWith(dashedFile);
      expect(Notice).toHaveBeenCalledWith("Moved to Backlog: my-important-task");
    });
  });
});