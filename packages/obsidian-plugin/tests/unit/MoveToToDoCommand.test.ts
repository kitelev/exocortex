import { flushPromises } from "./helpers/testHelpers";
import { MoveToToDoCommand } from "../../src/application/commands/MoveToToDoCommand";
import { TFile, Notice } from "obsidian";
import { TaskStatusService, CommandVisibilityContext, LoggingService } from "exocortex";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Notice: jest.fn(),
}));
jest.mock("exocortex", () => ({
  ...jest.requireActual("exocortex"),
  canMoveToToDo: jest.fn(),
  LoggingService: {
    error: jest.fn(),
  },
}));

describe("MoveToToDoCommand", () => {
  let command: MoveToToDoCommand;
  let mockTaskStatusService: jest.Mocked<TaskStatusService>;
  let mockFile: jest.Mocked<TFile>;
  let mockContext: CommandVisibilityContext;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock task status service
    mockTaskStatusService = {
      moveToToDo: jest.fn(),
    } as unknown as jest.Mocked<TaskStatusService>;

    // Create mock file
    mockFile = {
      path: "test-task.md",
      basename: "test-task",
    } as jest.Mocked<TFile>;

    // Create mock context
    mockContext = {
      instanceClass: "Task",
      status: "Backlog",
      archived: false,
      isDraft: false,
    };

    // Create command instance
    command = new MoveToToDoCommand(mockTaskStatusService);
  });

  describe("id and name", () => {
    it("should have correct id and name", () => {
      expect(command.id).toBe("move-to-todo");
      expect(command.name).toBe("Move to to-do");
    });
  });

  describe("checkCallback", () => {
    const mockCanMoveToToDo = require("exocortex").canMoveToToDo;

    it("should return false when context is null", () => {
      const result = command.checkCallback(true, mockFile, null);
      expect(result).toBe(false);
      expect(mockTaskStatusService.moveToToDo).not.toHaveBeenCalled();
    });

    it("should return false when canMoveToToDo returns false", () => {
      mockCanMoveToToDo.mockReturnValue(false);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(false);
      expect(mockTaskStatusService.moveToToDo).not.toHaveBeenCalled();
    });

    it("should return true when canMoveToToDo returns true and checking is true", () => {
      mockCanMoveToToDo.mockReturnValue(true);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(true);
      expect(mockTaskStatusService.moveToToDo).not.toHaveBeenCalled();
    });

    it("should execute command when checking is false and canMoveToToDo returns true", async () => {
      mockCanMoveToToDo.mockReturnValue(true);
      mockTaskStatusService.moveToToDo.mockResolvedValue();

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.moveToToDo).toHaveBeenCalledWith(mockFile);
      expect(Notice).toHaveBeenCalledWith("Moved to ToDo: test-task");
    });

    it("should handle errors and show notice", async () => {
      mockCanMoveToToDo.mockReturnValue(true);
      const error = new Error("Failed to move to todo");
      mockTaskStatusService.moveToToDo.mockRejectedValue(error);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.moveToToDo).toHaveBeenCalledWith(mockFile);
      expect(LoggingService.error).toHaveBeenCalledWith("Move to todo error", error);
      expect(Notice).toHaveBeenCalledWith("Failed to move to todo: Failed to move to todo");
    });

    it("should handle ToDo status context", () => {
      mockCanMoveToToDo.mockReturnValue(false);
      const todoContext = { ...mockContext, status: "ToDo" };
      const result = command.checkCallback(true, mockFile, todoContext);
      expect(result).toBe(false);
    });

    it("should handle files with numbers in basename", async () => {
      mockCanMoveToToDo.mockReturnValue(true);
      mockTaskStatusService.moveToToDo.mockResolvedValue();

      const numberedFile = {
        path: "path/to/task-123.md",
        basename: "task-123",
      } as TFile;

      const result = command.checkCallback(false, numberedFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.moveToToDo).toHaveBeenCalledWith(numberedFile);
      expect(Notice).toHaveBeenCalledWith("Moved to ToDo: task-123");
    });

    it("should handle permission errors", async () => {
      mockCanMoveToToDo.mockReturnValue(true);
      const permissionError = new Error("Permission denied");
      mockTaskStatusService.moveToToDo.mockRejectedValue(permissionError);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.moveToToDo).toHaveBeenCalledWith(mockFile);
      expect(LoggingService.error).toHaveBeenCalledWith("Move to todo error", permissionError);
      expect(Notice).toHaveBeenCalledWith("Failed to move to todo: Permission denied");
    });
  });
});