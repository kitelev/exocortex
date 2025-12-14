import { SetDraftStatusCommand } from "../../src/application/commands/SetDraftStatusCommand";
import { TFile, Notice } from "obsidian";
import { TaskStatusService, CommandVisibilityContext, LoggingService } from "exocortex";
import { flushPromises } from "./helpers/testHelpers";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Notice: jest.fn(),
}));
jest.mock("exocortex", () => ({
  ...jest.requireActual("exocortex"),
  canSetDraftStatus: jest.fn(),
  LoggingService: {
    error: jest.fn(),
  },
}));

describe("SetDraftStatusCommand", () => {
  let command: SetDraftStatusCommand;
  let mockTaskStatusService: jest.Mocked<TaskStatusService>;
  let mockFile: jest.Mocked<TFile>;
  let mockContext: CommandVisibilityContext;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock task status service
    mockTaskStatusService = {
      setDraftStatus: jest.fn(),
    } as unknown as jest.Mocked<TaskStatusService>;

    // Create mock file
    mockFile = {
      path: "test-draft.md",
      basename: "test-draft",
    } as jest.Mocked<TFile>;

    // Create mock context
    mockContext = {
      instanceClass: "Task",
      status: "InProgress",
      archived: false,
      isDraft: false,
    };

    // Create command instance
    command = new SetDraftStatusCommand(mockTaskStatusService);
  });

  describe("id and name", () => {
    it("should have correct id and name", () => {
      expect(command.id).toBe("set-draft-status");
      expect(command.name).toBe("Set draft status");
    });
  });

  describe("checkCallback", () => {
    const mockCanSetDraftStatus = require("exocortex").canSetDraftStatus;

    it("should return false when context is null", () => {
      const result = command.checkCallback(true, mockFile, null);
      expect(result).toBe(false);
      expect(mockTaskStatusService.setDraftStatus).not.toHaveBeenCalled();
    });

    it("should return false when canSetDraftStatus returns false", () => {
      mockCanSetDraftStatus.mockReturnValue(false);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(false);
      expect(mockTaskStatusService.setDraftStatus).not.toHaveBeenCalled();
    });

    it("should return true when canSetDraftStatus returns true and checking is true", () => {
      mockCanSetDraftStatus.mockReturnValue(true);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(true);
      expect(mockTaskStatusService.setDraftStatus).not.toHaveBeenCalled();
    });

    it("should execute command when checking is false and canSetDraftStatus returns true", async () => {
      mockCanSetDraftStatus.mockReturnValue(true);
      mockTaskStatusService.setDraftStatus.mockResolvedValue();

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      expect(mockTaskStatusService.setDraftStatus).toHaveBeenCalledWith(mockFile);
      expect(Notice).toHaveBeenCalledWith("Set Draft status: test-draft");
    });

    it("should handle errors and show notice", async () => {
      mockCanSetDraftStatus.mockReturnValue(true);
      const error = new Error("Failed to set draft");
      mockTaskStatusService.setDraftStatus.mockRejectedValue(error);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      expect(mockTaskStatusService.setDraftStatus).toHaveBeenCalledWith(mockFile);
      expect(LoggingService.error).toHaveBeenCalledWith("Set draft status error", error);
      expect(Notice).toHaveBeenCalledWith("Failed to set draft status: Failed to set draft");
    });

    it("should handle already draft context", () => {
      mockCanSetDraftStatus.mockReturnValue(false);
      const draftContext = { ...mockContext, isDraft: true };
      const result = command.checkCallback(true, mockFile, draftContext);
      expect(result).toBe(false);
    });

    it("should handle files with spaces in basename", async () => {
      mockCanSetDraftStatus.mockReturnValue(true);
      mockTaskStatusService.setDraftStatus.mockResolvedValue();

      const spaceFile = {
        path: "path/to/my draft task.md",
        basename: "my draft task",
      } as TFile;

      const result = command.checkCallback(false, spaceFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      expect(mockTaskStatusService.setDraftStatus).toHaveBeenCalledWith(spaceFile);
      expect(Notice).toHaveBeenCalledWith("Set Draft status: my draft task");
    });

    it("should handle network errors", async () => {
      mockCanSetDraftStatus.mockReturnValue(true);
      const networkError = new Error("Network timeout");
      networkError.message = "Network timeout";
      mockTaskStatusService.setDraftStatus.mockRejectedValue(networkError);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      expect(mockTaskStatusService.setDraftStatus).toHaveBeenCalledWith(mockFile);
      expect(LoggingService.error).toHaveBeenCalledWith("Set draft status error", networkError);
      expect(Notice).toHaveBeenCalledWith("Failed to set draft status: Network timeout");
    });
  });
});