import { flushPromises } from "./helpers/testHelpers";
import { PlanForEveningCommand } from "../../src/application/commands/PlanForEveningCommand";
import { TFile, Notice } from "obsidian";
import { TaskStatusService, CommandVisibilityContext, LoggingService } from "exocortex";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Notice: jest.fn(),
}));
jest.mock("exocortex", () => ({
  ...jest.requireActual("exocortex"),
  canPlanForEvening: jest.fn(),
  LoggingService: {
    error: jest.fn(),
  },
}));

describe("PlanForEveningCommand", () => {
  let command: PlanForEveningCommand;
  let mockTaskStatusService: jest.Mocked<TaskStatusService>;
  let mockFile: jest.Mocked<TFile>;
  let mockContext: CommandVisibilityContext;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock task status service
    mockTaskStatusService = {
      planForEvening: jest.fn(),
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
    command = new PlanForEveningCommand(mockTaskStatusService);
  });

  describe("id and name", () => {
    it("should have correct id and name", () => {
      expect(command.id).toBe("plan-for-evening");
      expect(command.name).toBe("Plan for evening (19:00)");
    });
  });

  describe("checkCallback", () => {
    const mockCanPlanForEvening = require("exocortex").canPlanForEvening;

    it("should return false when context is null", () => {
      const result = command.checkCallback(true, mockFile, null);
      expect(result).toBe(false);
      expect(mockTaskStatusService.planForEvening).not.toHaveBeenCalled();
    });

    it("should return false when canPlanForEvening returns false", () => {
      mockCanPlanForEvening.mockReturnValue(false);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(false);
      expect(mockTaskStatusService.planForEvening).not.toHaveBeenCalled();
    });

    it("should return true when canPlanForEvening returns true and checking is true", () => {
      mockCanPlanForEvening.mockReturnValue(true);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(true);
      expect(mockTaskStatusService.planForEvening).not.toHaveBeenCalled();
    });

    it("should execute command when checking is false and canPlanForEvening returns true", async () => {
      mockCanPlanForEvening.mockReturnValue(true);
      mockTaskStatusService.planForEvening.mockResolvedValue();

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.planForEvening).toHaveBeenCalledWith(mockFile);
      expect(Notice).toHaveBeenCalledWith("Planned for evening (19:00): test-file");
    });

    it("should handle errors and show notice", async () => {
      mockCanPlanForEvening.mockReturnValue(true);
      const error = new Error("Failed to plan");
      mockTaskStatusService.planForEvening.mockRejectedValue(error);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.planForEvening).toHaveBeenCalledWith(mockFile);
      expect(LoggingService.error).toHaveBeenCalledWith("Plan for evening error", error);
      expect(Notice).toHaveBeenCalledWith("Failed to plan for evening: Failed to plan");
    });

    it("should handle files with special characters", async () => {
      mockCanPlanForEvening.mockReturnValue(true);
      mockTaskStatusService.planForEvening.mockResolvedValue();

      const specialFile = {
        path: "path/to/[EVENING] Task (2024).md",
        basename: "[EVENING] Task (2024)",
      } as TFile;

      const result = command.checkCallback(false, specialFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.planForEvening).toHaveBeenCalledWith(specialFile);
      expect(Notice).toHaveBeenCalledWith("Planned for evening (19:00): [EVENING] Task (2024)");
    });

    it("should handle file system errors", async () => {
      mockCanPlanForEvening.mockReturnValue(true);
      const fsError = new Error("File locked");
      mockTaskStatusService.planForEvening.mockRejectedValue(fsError);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.planForEvening).toHaveBeenCalledWith(mockFile);
      expect(LoggingService.error).toHaveBeenCalledWith("Plan for evening error", fsError);
      expect(Notice).toHaveBeenCalledWith("Failed to plan for evening: File locked");
    });

    it("should handle permission denied error", async () => {
      mockCanPlanForEvening.mockReturnValue(true);
      const permError = new Error("Permission denied: cannot write to file");
      mockTaskStatusService.planForEvening.mockRejectedValue(permError);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskStatusService.planForEvening).toHaveBeenCalledWith(mockFile);
      expect(LoggingService.error).toHaveBeenCalledWith("Plan for evening error", permError);
      expect(Notice).toHaveBeenCalledWith("Failed to plan for evening: Permission denied: cannot write to file");
    });

    it("should handle multiple concurrent planning operations", async () => {
      mockCanPlanForEvening.mockReturnValue(true);
      mockTaskStatusService.planForEvening.mockResolvedValue();

      const files = [
        { path: "file1.md", basename: "file1" } as TFile,
        { path: "file2.md", basename: "file2" } as TFile,
        { path: "file3.md", basename: "file3" } as TFile,
      ];

      // Execute planning operations concurrently
      files.forEach(file => command.checkCallback(false, file, mockContext));

      // Wait for all async executions
      await flushPromises();

      expect(mockTaskStatusService.planForEvening).toHaveBeenCalledTimes(3);
      files.forEach((file, index) => {
        expect(mockTaskStatusService.planForEvening).toHaveBeenNthCalledWith(index + 1, file);
        expect(Notice).toHaveBeenCalledWith(`Planned for evening (19:00): ${file.basename}`);
      });
    });
  });
});