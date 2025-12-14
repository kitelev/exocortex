import { flushPromises, waitForCondition } from "./helpers/testHelpers";
import { CreateRelatedTaskCommand } from "../../src/application/commands/CreateRelatedTaskCommand";
import { App, TFile, Notice, WorkspaceLeaf } from "obsidian";
import {
  TaskCreationService,
  CommandVisibilityContext,
  LoggingService,
} from "exocortex";
import { LabelInputModal } from "../../src/presentation/modals/LabelInputModal";
import { ObsidianVaultAdapter } from "../../src/adapters/ObsidianVaultAdapter";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Notice: jest.fn(),
}));
jest.mock("../../src/presentation/modals/LabelInputModal");
jest.mock("exocortex", () => ({
  ...jest.requireActual("exocortex"),
  canCreateRelatedTask: jest.fn(),
  LoggingService: {
    error: jest.fn(),
  },
}));

describe("CreateRelatedTaskCommand", () => {
  let command: CreateRelatedTaskCommand;
  let mockApp: jest.Mocked<App>;
  let mockTaskCreationService: jest.Mocked<TaskCreationService>;
  let mockVaultAdapter: jest.Mocked<ObsidianVaultAdapter>;
  let mockFile: jest.Mocked<TFile>;
  let mockContext: CommandVisibilityContext;
  let mockLeaf: jest.Mocked<WorkspaceLeaf>;
  let mockTFile: jest.Mocked<TFile>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock leaf
    mockLeaf = {
      openFile: jest.fn(),
    } as unknown as jest.Mocked<WorkspaceLeaf>;

    // Create mock TFile for created file
    mockTFile = {
      path: "new-related-task.md",
      basename: "new-related-task",
    } as jest.Mocked<TFile>;

    // Create mock app
    mockApp = {
      workspace: {
        getLeaf: jest.fn().mockReturnValue(mockLeaf),
        setActiveLeaf: jest.fn(),
        getActiveFile: jest.fn().mockReturnValue(mockTFile),
      },
      metadataCache: {
        getFileCache: jest.fn().mockReturnValue({
          frontmatter: { key: "value", exo__uid: "original-uid" },
        }),
      },
    } as unknown as jest.Mocked<App>;

    // Create mock services
    mockTaskCreationService = {
      createRelatedTask: jest.fn(),
    } as unknown as jest.Mocked<TaskCreationService>;

    mockVaultAdapter = {
      toTFile: jest.fn().mockReturnValue(mockTFile),
    } as unknown as jest.Mocked<ObsidianVaultAdapter>;

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
    command = new CreateRelatedTaskCommand(mockApp, mockTaskCreationService, mockVaultAdapter);
  });

  describe("id and name", () => {
    it("should have correct id and name", () => {
      expect(command.id).toBe("create-related-task");
      expect(command.name).toBe("Create related task");
    });
  });

  describe("checkCallback", () => {
    const mockCanCreateRelatedTask = require("exocortex").canCreateRelatedTask;

    it("should return false when context is null", () => {
      const result = command.checkCallback(true, mockFile, null);
      expect(result).toBe(false);
      expect(mockTaskCreationService.createRelatedTask).not.toHaveBeenCalled();
    });

    it("should return false when canCreateRelatedTask returns false", () => {
      mockCanCreateRelatedTask.mockReturnValue(false);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(false);
      expect(mockTaskCreationService.createRelatedTask).not.toHaveBeenCalled();
    });

    it("should return true when canCreateRelatedTask returns true and checking is true", () => {
      mockCanCreateRelatedTask.mockReturnValue(true);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(true);
      expect(mockTaskCreationService.createRelatedTask).not.toHaveBeenCalled();
    });

    it("should execute command when checking is false and canCreateRelatedTask returns true", async () => {
      mockCanCreateRelatedTask.mockReturnValue(true);
      const createdFile = { basename: "new-related-task", path: "new-related-task.md" };
      mockTaskCreationService.createRelatedTask.mockResolvedValue(createdFile as any);

      // Mock modal to return label and task size
      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Related Task", taskSize: "large" }), 0);
        }),
      }));

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(LabelInputModal).toHaveBeenCalledWith(
        mockApp,
        expect.any(Function)
      );
      expect(mockTaskCreationService.createRelatedTask).toHaveBeenCalledWith(
        mockFile,
        { key: "value", exo__uid: "original-uid" },
        "Related Task",
        "large"
      );
      expect(mockVaultAdapter.toTFile).toHaveBeenCalledWith(createdFile);
      expect(mockLeaf.openFile).toHaveBeenCalledWith(mockTFile);
      expect(mockApp.workspace.setActiveLeaf).toHaveBeenCalledWith(mockLeaf, { focus: true });
      expect(Notice).toHaveBeenCalledWith("Related task created: new-related-task");
    });

    it("should handle modal cancellation", async () => {
      mockCanCreateRelatedTask.mockReturnValue(true);

      // Mock modal to return null (cancelled)
      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: null, taskSize: null }), 0);
        }),
      }));

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(LabelInputModal).toHaveBeenCalled();
      expect(mockTaskCreationService.createRelatedTask).not.toHaveBeenCalled();
      expect(Notice).not.toHaveBeenCalled();
    });

    it("should handle service error and show error notice", async () => {
      mockCanCreateRelatedTask.mockReturnValue(true);
      const error = new Error("Failed to create task");
      mockTaskCreationService.createRelatedTask.mockRejectedValue(error);

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test", taskSize: "small" }), 0);
        }),
      }));

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskCreationService.createRelatedTask).toHaveBeenCalled();
      expect(LoggingService.error).toHaveBeenCalledWith("Create related task error", error);
      expect(Notice).toHaveBeenCalledWith("Failed to create related task: Failed to create task");
    });

    it("should handle different task sizes", async () => {
      mockCanCreateRelatedTask.mockReturnValue(true);
      const createdFile = { basename: "new-task", path: "new-task.md" };
      mockTaskCreationService.createRelatedTask.mockResolvedValue(createdFile as any);

      const taskSizes = ["small", "medium", "large", "epic"];

      for (const taskSize of taskSizes) {
        jest.clearAllMocks();
        mockCanCreateRelatedTask.mockReturnValue(true);
        mockTaskCreationService.createRelatedTask.mockResolvedValue(createdFile as any);
        mockVaultAdapter.toTFile.mockReturnValue(mockTFile);

        (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
          open: jest.fn(() => {
            setTimeout(() => callback({ label: "Task", taskSize }), 0);
          }),
        }));

        command.checkCallback(false, mockFile, mockContext);

        // Wait for async execution
        await flushPromises();

        expect(mockTaskCreationService.createRelatedTask).toHaveBeenCalledWith(
          mockFile,
          expect.any(Object),
          "Task",
          taskSize
        );
      }
    });

    it("should wait for file to become active", async () => {
      mockCanCreateRelatedTask.mockReturnValue(true);
      const createdFile = { basename: "new-related-task", path: "new-related-task.md" };
      mockTaskCreationService.createRelatedTask.mockResolvedValue(createdFile as any);

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test", taskSize: "medium" }), 0);
        }),
      }));

      // Simulate file becoming active after 3 attempts
      let attempts = 0;
      mockApp.workspace.getActiveFile = jest.fn(() => {
        attempts++;
        return attempts >= 3 ? mockTFile : null;
      });

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await waitForCondition(() => (mockApp.workspace.getActiveFile as jest.Mock).mock.calls.length >= 3);

      expect(mockApp.workspace.getActiveFile).toHaveBeenCalledTimes(3);
      expect(Notice).toHaveBeenCalledWith("Related task created: new-related-task");
    });

    it("should handle missing frontmatter metadata", async () => {
      mockCanCreateRelatedTask.mockReturnValue(true);
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({});
      const createdFile = { basename: "new-related-task", path: "new-related-task.md" };
      mockTaskCreationService.createRelatedTask.mockResolvedValue(createdFile as any);

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test", taskSize: "medium" }), 0);
        }),
      }));

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskCreationService.createRelatedTask).toHaveBeenCalledWith(
        mockFile,
        {}, // Empty metadata
        "Test",
        "medium"
      );
      expect(Notice).toHaveBeenCalledWith("Related task created: new-related-task");
    });

    it("should handle null cache from metadataCache", async () => {
      mockCanCreateRelatedTask.mockReturnValue(true);
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue(null);
      const createdFile = { basename: "new-related-task", path: "new-related-task.md" };
      mockTaskCreationService.createRelatedTask.mockResolvedValue(createdFile as any);

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test", taskSize: "small" }), 0);
        }),
      }));

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskCreationService.createRelatedTask).toHaveBeenCalledWith(
        mockFile,
        {}, // Empty metadata
        "Test",
        "small"
      );
      expect(Notice).toHaveBeenCalledWith("Related task created: new-related-task");
    });

    it("should timeout after max attempts waiting for file", async () => {
      mockCanCreateRelatedTask.mockReturnValue(true);
      const createdFile = { basename: "new-related-task", path: "new-related-task.md" };
      mockTaskCreationService.createRelatedTask.mockResolvedValue(createdFile as any);

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test", taskSize: "medium" }), 0);
        }),
      }));

      // File never becomes active
      mockApp.workspace.getActiveFile = jest.fn().mockReturnValue(null);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution (including max attempts)
      await waitForCondition(() => (Notice as jest.Mock).mock.calls.length > 0, { timeout: 5000, interval: 100 });

      // Should still complete successfully even if file doesn't become active
      expect(mockApp.workspace.getActiveFile).toHaveBeenCalledTimes(20); // max attempts
      expect(Notice).toHaveBeenCalledWith("Related task created: new-related-task");
    });

    it("should handle undefined task size", async () => {
      mockCanCreateRelatedTask.mockReturnValue(true);
      const createdFile = { basename: "new-related-task", path: "new-related-task.md" };
      mockTaskCreationService.createRelatedTask.mockResolvedValue(createdFile as any);

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Task Without Size", taskSize: undefined }), 0);
        }),
      }));

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskCreationService.createRelatedTask).toHaveBeenCalledWith(
        mockFile,
        { key: "value", exo__uid: "original-uid" },
        "Task Without Size",
        undefined
      );
      expect(Notice).toHaveBeenCalledWith("Related task created: new-related-task");
    });
  });
});