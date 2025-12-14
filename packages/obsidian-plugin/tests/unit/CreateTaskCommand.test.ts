import { flushPromises, waitForCondition } from "./helpers/testHelpers";
import { CreateTaskCommand } from "../../src/application/commands/CreateTaskCommand";
import { App, TFile, Notice, MetadataCache, Workspace, WorkspaceLeaf } from "obsidian";
import { TaskCreationService, CommandVisibilityContext, LoggingService } from "exocortex";
import { ObsidianVaultAdapter } from "../../src/adapters/ObsidianVaultAdapter";
import { LabelInputModal } from "../../src/presentation/modals/LabelInputModal";
import { ExocortexPluginInterface } from "../../src/types";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Notice: jest.fn(),
}));
jest.mock("../../src/presentation/modals/LabelInputModal");
jest.mock("exocortex", () => ({
  ...jest.requireActual("exocortex"),
  canCreateTask: jest.fn(),
  LoggingService: {
    error: jest.fn(),
  },
}));

describe("CreateTaskCommand", () => {
  let command: CreateTaskCommand;
  let mockApp: jest.Mocked<App>;
  let mockTaskCreationService: jest.Mocked<TaskCreationService>;
  let mockVaultAdapter: jest.Mocked<ObsidianVaultAdapter>;
  let mockPlugin: jest.Mocked<ExocortexPluginInterface>;
  let mockFile: jest.Mocked<TFile>;
  let mockContext: CommandVisibilityContext;
  let mockWorkspace: jest.Mocked<Workspace>;
  let mockLeaf: jest.Mocked<WorkspaceLeaf>;
  let mockMetadataCache: jest.Mocked<MetadataCache>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock leaf
    mockLeaf = {
      openFile: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<WorkspaceLeaf>;

    // Create mock workspace
    mockWorkspace = {
      getLeaf: jest.fn().mockReturnValue(mockLeaf),
      setActiveLeaf: jest.fn(),
      getActiveFile: jest.fn(),
    } as unknown as jest.Mocked<Workspace>;

    // Create mock metadata cache
    mockMetadataCache = {
      getFileCache: jest.fn().mockReturnValue({
        frontmatter: { class: "Task", status: "ToDo" },
      }),
    } as unknown as jest.Mocked<MetadataCache>;

    // Create mock app
    mockApp = {
      workspace: mockWorkspace,
      metadataCache: mockMetadataCache,
    } as unknown as jest.Mocked<App>;

    // Create mock task creation service
    mockTaskCreationService = {
      createTask: jest.fn(),
    } as unknown as jest.Mocked<TaskCreationService>;

    // Create mock vault adapter
    mockVaultAdapter = {
      toTFile: jest.fn(),
    } as unknown as jest.Mocked<ObsidianVaultAdapter>;

    // Create mock plugin with default settings (useDynamicPropertyFields = false)
    mockPlugin = {
      settings: {
        useDynamicPropertyFields: false,
      },
      saveSettings: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ExocortexPluginInterface>;

    // Create mock file
    mockFile = {
      path: "test.md",
      basename: "test",
    } as jest.Mocked<TFile>;

    // Create mock context
    mockContext = {
      instanceClass: "Epic",
      status: "ToDo",
      archived: false,
      isDraft: false,
    };

    // Create command instance
    command = new CreateTaskCommand(mockApp, mockTaskCreationService, mockVaultAdapter, mockPlugin);
  });

  describe("id and name", () => {
    it("should have correct id and name", () => {
      expect(command.id).toBe("create-task");
      expect(command.name).toBe("Create task");
    });
  });

  describe("checkCallback", () => {
    const mockCanCreateTask = require("exocortex").canCreateTask;

    it("should return false when context is null", () => {
      const result = command.checkCallback(true, mockFile, null);
      expect(result).toBe(false);
    });

    it("should return false when canCreateTask returns false", () => {
      mockCanCreateTask.mockReturnValue(false);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(false);
    });

    it("should return true when canCreateTask returns true and checking is true", () => {
      mockCanCreateTask.mockReturnValue(true);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(true);
    });

    it("should execute command when checking is false and canCreateTask returns true", async () => {
      mockCanCreateTask.mockReturnValue(true);

      // Mock modal result
      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => {
        setTimeout(() => callback({ label: "Test Task", taskSize: "M" }), 0);
        return { open: jest.fn() };
      });

      // Mock task creation
      const createdFile = {
        path: "Tasks/test-task.md",
        basename: "test-task",
      };
      mockTaskCreationService.createTask.mockResolvedValue(createdFile);

      const createdTFile = {
        path: "Tasks/test-task.md",
      } as TFile;
      mockVaultAdapter.toTFile.mockReturnValue(createdTFile);

      // Mock active file check
      mockWorkspace.getActiveFile.mockReturnValue(createdTFile);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskCreationService.createTask).toHaveBeenCalledWith(
        mockFile,
        { class: "Task", status: "ToDo" },
        "Epic",
        "Test Task",
        "M"
      );
      expect(mockLeaf.openFile).toHaveBeenCalledWith(createdTFile);
      expect(mockWorkspace.setActiveLeaf).toHaveBeenCalledWith(mockLeaf, { focus: true });
    });

    it("should handle modal cancellation", async () => {
      mockCanCreateTask.mockReturnValue(true);

      // Mock modal result with null label (cancelled)
      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => {
        setTimeout(() => callback({ label: null, taskSize: null }), 0);
        return { open: jest.fn() };
      });

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskCreationService.createTask).not.toHaveBeenCalled();
      expect(mockLeaf.openFile).not.toHaveBeenCalled();
    });

    it("should handle errors and show notice", async () => {
      mockCanCreateTask.mockReturnValue(true);

      // Mock modal result
      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => {
        setTimeout(() => callback({ label: "Test Task", taskSize: "M" }), 0);
        return { open: jest.fn() };
      });

      // Mock task creation to throw error
      const error = new Error("Creation failed");
      mockTaskCreationService.createTask.mockRejectedValue(error);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(LoggingService.error).toHaveBeenCalledWith("Create task error", error);
      expect(Notice).toHaveBeenCalledWith("Failed to create task: Creation failed");
    });

    it("should handle array instance class", async () => {
      mockCanCreateTask.mockReturnValue(true);

      // Mock modal result
      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => {
        setTimeout(() => callback({ label: "Test Task", taskSize: "S" }), 0);
        return { open: jest.fn() };
      });

      // Mock context with array instance class
      const arrayContext = {
        ...mockContext,
        instanceClass: ["Epic", "Feature"],
      };

      // Mock task creation
      const createdFile = {
        path: "Tasks/test-task.md",
        basename: "test-task",
      };
      mockTaskCreationService.createTask.mockResolvedValue(createdFile);

      const createdTFile = {
        path: "Tasks/test-task.md",
      } as TFile;
      mockVaultAdapter.toTFile.mockReturnValue(createdTFile);

      // Mock active file check
      mockWorkspace.getActiveFile.mockReturnValue(createdTFile);

      const result = command.checkCallback(false, mockFile, arrayContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskCreationService.createTask).toHaveBeenCalledWith(
        mockFile,
        { class: "Task", status: "ToDo" },
        "Epic",
        "Test Task",
        "S"
      );
    });

    it("should handle empty instance class", async () => {
      mockCanCreateTask.mockReturnValue(true);

      // Mock modal result
      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => {
        setTimeout(() => callback({ label: "Test Task", taskSize: "L" }), 0);
        return { open: jest.fn() };
      });

      // Mock context with empty instance class
      const emptyContext = {
        ...mockContext,
        instanceClass: [],
      };

      // Mock task creation
      const createdFile = {
        path: "Tasks/test-task.md",
        basename: "test-task",
      };
      mockTaskCreationService.createTask.mockResolvedValue(createdFile);

      const createdTFile = {
        path: "Tasks/test-task.md",
      } as TFile;
      mockVaultAdapter.toTFile.mockReturnValue(createdTFile);

      // Mock active file check
      mockWorkspace.getActiveFile.mockReturnValue(createdTFile);

      const result = command.checkCallback(false, mockFile, emptyContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskCreationService.createTask).toHaveBeenCalledWith(
        mockFile,
        { class: "Task", status: "ToDo" },
        "",
        "Test Task",
        "L"
      );
    });

    it("should handle missing frontmatter", async () => {
      mockCanCreateTask.mockReturnValue(true);

      // Mock no cache
      mockMetadataCache.getFileCache.mockReturnValue(null);

      // Mock modal result
      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => {
        setTimeout(() => callback({ label: "Test Task", taskSize: "XL" }), 0);
        return { open: jest.fn() };
      });

      // Mock task creation
      const createdFile = {
        path: "Tasks/test-task.md",
        basename: "test-task",
      };
      mockTaskCreationService.createTask.mockResolvedValue(createdFile);

      const createdTFile = {
        path: "Tasks/test-task.md",
      } as TFile;
      mockVaultAdapter.toTFile.mockReturnValue(createdTFile);

      // Mock active file check
      mockWorkspace.getActiveFile.mockReturnValue(createdTFile);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskCreationService.createTask).toHaveBeenCalledWith(
        mockFile,
        {},
        "Epic",
        "Test Task",
        "XL"
      );
    });

    it("should wait for active file to be set", async () => {
      mockCanCreateTask.mockReturnValue(true);

      // Mock modal result
      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => {
        setTimeout(() => callback({ label: "Test Task", taskSize: "M" }), 0);
        return { open: jest.fn() };
      });

      // Mock task creation
      const createdFile = {
        path: "Tasks/test-task.md",
        basename: "test-task",
      };
      mockTaskCreationService.createTask.mockResolvedValue(createdFile);

      const createdTFile = {
        path: "Tasks/test-task.md",
      } as TFile;
      mockVaultAdapter.toTFile.mockReturnValue(createdTFile);

      // Mock active file check - return null first, then the correct file
      let callCount = 0;
      mockWorkspace.getActiveFile.mockImplementation(() => {
        callCount++;
        return callCount <= 3 ? null : createdTFile;
      });

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for retry loop to complete
      await waitForCondition(
        () => (Notice as jest.Mock).mock.calls.some(call => call[0] === "Task created: test-task"),
        { timeout: 2000 }
      );

      expect(mockWorkspace.getActiveFile).toHaveBeenCalledTimes(4);
      expect(Notice).toHaveBeenCalledWith("Task created: test-task");
    });

    it("should timeout waiting for active file", async () => {
      mockCanCreateTask.mockReturnValue(true);

      // Mock modal result
      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => {
        setTimeout(() => callback({ label: "Test Task", taskSize: "M" }), 0);
        return { open: jest.fn() };
      });

      // Mock task creation
      const createdFile = {
        path: "Tasks/test-task.md",
        basename: "test-task",
      };
      mockTaskCreationService.createTask.mockResolvedValue(createdFile);

      const createdTFile = {
        path: "Tasks/test-task.md",
      } as TFile;
      mockVaultAdapter.toTFile.mockReturnValue(createdTFile);

      // Mock active file check - always return null
      mockWorkspace.getActiveFile.mockReturnValue(null);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution (should timeout after 20 attempts * 100ms = 2 seconds)
      await waitForCondition(() => (Notice as jest.Mock).mock.calls.length > 0, { timeout: 5000, interval: 100 });

      expect(mockWorkspace.getActiveFile).toHaveBeenCalledTimes(20);
      expect(Notice).toHaveBeenCalledWith("Task created: test-task");
    });
  });
});