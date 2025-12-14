import { flushPromises } from "./helpers/testHelpers";
import { StartEffortCommand } from "../../src/application/commands/StartEffortCommand";
import { TFile, Notice } from "obsidian";
import { TaskStatusService, CommandVisibilityContext, LoggingService } from "exocortex";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Notice: jest.fn(),
}));
jest.mock("exocortex", () => ({
  ...jest.requireActual("exocortex"),
  canStartEffort: jest.fn(),
  LoggingService: {
    error: jest.fn(),
  },
}));

describe("StartEffortCommand", () => {
  let command: StartEffortCommand;
  let mockTaskStatusService: jest.Mocked<TaskStatusService>;
  let mockFile: jest.Mocked<TFile>;
  let mockContext: CommandVisibilityContext;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock task status service
    mockTaskStatusService = {
      startEffort: jest.fn(),
    } as unknown as jest.Mocked<TaskStatusService>;

    // Create mock file
    mockFile = {
      path: "test-effort.md",
      basename: "test-effort",
    } as jest.Mocked<TFile>;

    // Create mock context
    mockContext = {
      instanceClass: "Effort",
      status: "ToDo",
      archived: false,
      isDraft: false,
    };

    // Create command instance
    command = new StartEffortCommand(mockTaskStatusService);
  });

  describe("id and name", () => {
    it("should have correct id and name", () => {
      expect(command.id).toBe("start-effort");
      expect(command.name).toBe("Start effort");
    });
  });

  describe("checkCallback", () => {
    const mockCanStartEffort = require("exocortex").canStartEffort;

    it("should return false when context is null", () => {
      const result = command.checkCallback(true, mockFile, null);
      expect(result).toBe(false);
      expect(mockTaskStatusService.startEffort).not.toHaveBeenCalled();
    });

    it("should return false when canStartEffort returns false", () => {
      mockCanStartEffort.mockReturnValue(false);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(false);
      expect(mockTaskStatusService.startEffort).not.toHaveBeenCalled();
    });

    it("should return true when canStartEffort returns true and checking is true", () => {
      mockCanStartEffort.mockReturnValue(true);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(true);
      expect(mockTaskStatusService.startEffort).not.toHaveBeenCalled();
    });

    it("should execute command when checking is false and canStartEffort returns true", async () => {
      mockCanStartEffort.mockReturnValue(true);
      mockTaskStatusService.startEffort.mockResolvedValue();

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.startEffort).toHaveBeenCalledWith(mockFile);
      expect(Notice).toHaveBeenCalledWith("Started effort: test-effort");
    });

    it("should handle errors and show notice", async () => {
      mockCanStartEffort.mockReturnValue(true);
      const error = new Error("Failed to start");
      mockTaskStatusService.startEffort.mockRejectedValue(error);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.startEffort).toHaveBeenCalledWith(mockFile);
      expect(LoggingService.error).toHaveBeenCalledWith("Start effort error", error);
      expect(Notice).toHaveBeenCalledWith("Failed to start effort: Failed to start");
    });

    it("should handle already started effort", () => {
      mockCanStartEffort.mockReturnValue(false);
      const inProgressContext = { ...mockContext, status: "InProgress" };
      const result = command.checkCallback(true, mockFile, inProgressContext);
      expect(result).toBe(false);
    });

    it("should handle effort with Unicode characters in basename", async () => {
      mockCanStartEffort.mockReturnValue(true);
      mockTaskStatusService.startEffort.mockResolvedValue();

      const unicodeFile = {
        path: "path/to/努力-测试.md",
        basename: "努力-测试",
      } as TFile;

      const result = command.checkCallback(false, unicodeFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.startEffort).toHaveBeenCalledWith(unicodeFile);
      expect(Notice).toHaveBeenCalledWith("Started effort: 努力-测试");
    });
  });
});