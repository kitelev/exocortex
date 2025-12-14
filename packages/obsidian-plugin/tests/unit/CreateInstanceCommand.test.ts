import { flushPromises, waitForCondition } from "./helpers/testHelpers";
import { CreateInstanceCommand } from "../../src/application/commands/CreateInstanceCommand";
import { App, TFile, Notice, WorkspaceLeaf } from "obsidian";
import {
  TaskCreationService,
  CommandVisibilityContext,
  LoggingService,
  WikiLinkHelpers,
  AssetClass
} from "exocortex";
import { LabelInputModal } from "../../src/presentation/modals/LabelInputModal";
import { DynamicAssetCreationModal } from "../../src/presentation/modals/DynamicAssetCreationModal";
import { ObsidianVaultAdapter } from "../../src/adapters/ObsidianVaultAdapter";
import { ExocortexPluginInterface } from "../../src/types";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Notice: jest.fn(),
}));
jest.mock("../../src/presentation/modals/LabelInputModal");
jest.mock("../../src/presentation/modals/DynamicAssetCreationModal");
jest.mock("exocortex", () => ({
  ...jest.requireActual("exocortex"),
  canCreateInstance: jest.fn(),
  LoggingService: {
    error: jest.fn(),
  },
  WikiLinkHelpers: {
    normalize: jest.fn(),
  },
  AssetClass: {
    MEETING_PROTOTYPE: "MeetingPrototype",
  },
}));

describe("CreateInstanceCommand", () => {
  let command: CreateInstanceCommand;
  let mockApp: jest.Mocked<App>;
  let mockTaskCreationService: jest.Mocked<TaskCreationService>;
  let mockVaultAdapter: jest.Mocked<ObsidianVaultAdapter>;
  let mockPlugin: jest.Mocked<ExocortexPluginInterface>;
  let mockFile: jest.Mocked<TFile>;
  let mockContext: CommandVisibilityContext;
  let mockLeaf: jest.Mocked<WorkspaceLeaf>;
  let mockTFile: jest.Mocked<TFile>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup WikiLinkHelpers mock
    const { WikiLinkHelpers } = require("exocortex");
    WikiLinkHelpers.normalize.mockImplementation((str: string) => str);

    // Create mock leaf
    mockLeaf = {
      openFile: jest.fn(),
    } as unknown as jest.Mocked<WorkspaceLeaf>;

    // Create mock TFile for created file
    mockTFile = {
      path: "new-instance.md",
      basename: "new-instance",
    } as jest.Mocked<TFile>;

    // Create mock app
    mockApp = {
      workspace: {
        getLeaf: jest.fn().mockReturnValue(mockLeaf),
        setActiveLeaf: jest.fn(),
        getActiveFile: jest.fn().mockReturnValue(mockTFile),
        on: jest.fn().mockReturnValue({ id: "mock-event-ref" }),
        offref: jest.fn(),
      },
      metadataCache: {
        getFileCache: jest.fn().mockReturnValue({
          frontmatter: { key: "value" },
        }),
      },
    } as unknown as jest.Mocked<App>;

    // Create mock services
    mockTaskCreationService = {
      createTask: jest.fn(),
    } as unknown as jest.Mocked<TaskCreationService>;

    mockVaultAdapter = {
      toTFile: jest.fn().mockReturnValue(mockTFile),
    } as unknown as jest.Mocked<ObsidianVaultAdapter>;

    // Create mock plugin with settings (toggle OFF by default)
    mockPlugin = {
      settings: {
        useDynamicPropertyFields: false,
      },
    } as unknown as jest.Mocked<ExocortexPluginInterface>;

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
    command = new CreateInstanceCommand(mockApp, mockTaskCreationService, mockVaultAdapter, mockPlugin);
  });

  describe("id and name", () => {
    it("should have correct id and name", () => {
      expect(command.id).toBe("create-instance");
      expect(command.name).toBe("Create instance");
    });
  });

  describe("checkCallback", () => {
    const mockCanCreateInstance = require("exocortex").canCreateInstance;

    it("should return false when context is null", () => {
      const result = command.checkCallback(true, mockFile, null);
      expect(result).toBe(false);
      expect(mockTaskCreationService.createTask).not.toHaveBeenCalled();
    });

    it("should return false when canCreateInstance returns false", () => {
      mockCanCreateInstance.mockReturnValue(false);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(false);
      expect(mockTaskCreationService.createTask).not.toHaveBeenCalled();
    });

    it("should return true when canCreateInstance returns true and checking is true", () => {
      mockCanCreateInstance.mockReturnValue(true);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(true);
      expect(mockTaskCreationService.createTask).not.toHaveBeenCalled();
    });

    it("should execute command when checking is false and canCreateInstance returns true", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const createdFile = { basename: "new-instance", path: "new-instance.md" };
      mockTaskCreationService.createTask.mockResolvedValue(createdFile as any);

      // Mock modal to return label and task size
      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test Instance", taskSize: "medium" }), 0);
        }),
      }));

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(LabelInputModal).toHaveBeenCalledWith(
        mockApp,
        expect.any(Function),
        "",
        true
      );
      expect(mockTaskCreationService.createTask).toHaveBeenCalledWith(
        mockFile,
        { key: "value" },
        "Task",
        "Test Instance",
        "medium"
      );
      expect(mockVaultAdapter.toTFile).toHaveBeenCalledWith(createdFile);
      expect(mockLeaf.openFile).toHaveBeenCalledWith(mockTFile);
      expect(mockApp.workspace.setActiveLeaf).toHaveBeenCalledWith(mockLeaf, { focus: true });
      expect(Notice).toHaveBeenCalledWith("Instance created: new-instance");
    });

    it("should handle modal cancellation", async () => {
      mockCanCreateInstance.mockReturnValue(true);

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
      expect(mockTaskCreationService.createTask).not.toHaveBeenCalled();
      expect(Notice).not.toHaveBeenCalled();
    });

    it("should handle service error and show error notice", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const error = new Error("Failed to create task");
      mockTaskCreationService.createTask.mockRejectedValue(error);

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test", taskSize: "small" }), 0);
        }),
      }));

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskCreationService.createTask).toHaveBeenCalled();
      expect(LoggingService.error).toHaveBeenCalledWith("Create instance error", error);
      expect(Notice).toHaveBeenCalledWith("Failed to create instance: Failed to create task");
    });

    it("should handle array instanceClass", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const arrayContext = {
        ...mockContext,
        instanceClass: ["Task", "Project"],
      };
      const createdFile = { basename: "new-task", path: "new-task.md" };
      mockTaskCreationService.createTask.mockResolvedValue(createdFile as any);

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "My Task", taskSize: "large" }), 0);
        }),
      }));

      const result = command.checkCallback(false, mockFile, arrayContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskCreationService.createTask).toHaveBeenCalledWith(
        mockFile,
        { key: "value" },
        "Task", // First class in array
        "My Task",
        "large"
      );
      expect(Notice).toHaveBeenCalledWith("Instance created: new-task");
    });

    it("should not show task size for MeetingPrototype", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const meetingContext = {
        ...mockContext,
        instanceClass: AssetClass.MEETING_PROTOTYPE,
      };
      const createdFile = { basename: "new-meeting", path: "new-meeting.md" };
      mockTaskCreationService.createTask.mockResolvedValue(createdFile as any);

      (LabelInputModal as jest.Mock).mockImplementation((app, callback, title, showTaskSize) => ({
        open: jest.fn(() => {
          // Verify showTaskSize is false
          expect(showTaskSize).toBe(false);
          setTimeout(() => callback({ label: "Meeting", taskSize: undefined }), 0);
        }),
      }));

      const result = command.checkCallback(false, mockFile, meetingContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(LabelInputModal).toHaveBeenCalledWith(
        mockApp,
        expect.any(Function),
        "",
        false // showTaskSize should be false for MeetingPrototype
      );
    });

    it("should wait for file to become active using event listener", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const createdFile = { basename: "new-instance", path: "new-instance.md" };
      mockTaskCreationService.createTask.mockResolvedValue(createdFile as any);

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test", taskSize: "small" }), 0);
        }),
      }));

      // File not immediately active
      mockApp.workspace.getActiveFile = jest.fn().mockReturnValue(null);

      // Mock workspace.on to capture the event handler and call it
      let fileOpenHandler: ((file: TFile | null) => void) | null = null;
      (mockApp.workspace.on as jest.Mock).mockImplementation((event: string, handler: (file: TFile | null) => void) => {
        if (event === "file-open") {
          fileOpenHandler = handler;
          // Simulate the file-open event firing after a short delay
          setTimeout(() => handler(mockTFile), 50);
        }
        return { id: "mock-event-ref" };
      });

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockApp.workspace.on).toHaveBeenCalledWith("file-open", expect.any(Function));
      expect(mockApp.workspace.offref).toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith("Instance created: new-instance");
    });

    it("should handle missing frontmatter metadata", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({});
      const createdFile = { basename: "new-instance", path: "new-instance.md" };
      mockTaskCreationService.createTask.mockResolvedValue(createdFile as any);

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test", taskSize: "medium" }), 0);
        }),
      }));

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskCreationService.createTask).toHaveBeenCalledWith(
        mockFile,
        {}, // Empty metadata
        "Task", // sourceClass still comes from context.instanceClass
        "Test",
        "medium"
      );
      expect(Notice).toHaveBeenCalledWith("Instance created: new-instance");
    });

    it("should handle null cache from metadataCache", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue(null);
      const createdFile = { basename: "new-instance", path: "new-instance.md" };
      mockTaskCreationService.createTask.mockResolvedValue(createdFile as any);

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test", taskSize: "small" }), 0);
        }),
      }));

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockTaskCreationService.createTask).toHaveBeenCalledWith(
        mockFile,
        {}, // Empty metadata
        "Task", // sourceClass still comes from context.instanceClass
        "Test",
        "small"
      );
      expect(Notice).toHaveBeenCalledWith("Instance created: new-instance");
    });

    it("should use DynamicAssetCreationModal when useDynamicPropertyFields is true", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      // Enable dynamic property fields
      mockPlugin.settings.useDynamicPropertyFields = true;

      const createdFile = { basename: "new-instance", path: "new-instance.md" };
      mockTaskCreationService.createTask.mockResolvedValue(createdFile as any);

      // Mock DynamicAssetCreationModal to return label and propertyValues
      (DynamicAssetCreationModal as jest.Mock).mockImplementation((app, className, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({
            label: "Dynamic Instance",
            taskSize: "medium",
            openInNewTab: false,
            propertyValues: { exo__Asset_label: "Dynamic Instance" }
          }), 0);
        }),
      }));

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      // Verify DynamicAssetCreationModal was used with correct class name
      expect(DynamicAssetCreationModal).toHaveBeenCalledWith(
        mockApp,
        "Task",
        expect.any(Function),
        undefined, // schemaService (optional)
      );
      expect(LabelInputModal).not.toHaveBeenCalled();

      expect(mockTaskCreationService.createTask).toHaveBeenCalledWith(
        mockFile,
        { key: "value" },
        "Task",
        "Dynamic Instance",
        "medium"
      );
      expect(Notice).toHaveBeenCalledWith("Instance created: new-instance");
    });

    it("should use LabelInputModal when useDynamicPropertyFields is false", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      // Disable dynamic property fields (default)
      mockPlugin.settings.useDynamicPropertyFields = false;

      const createdFile = { basename: "new-instance", path: "new-instance.md" };
      mockTaskCreationService.createTask.mockResolvedValue(createdFile as any);

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Static Instance", taskSize: "small" }), 0);
        }),
      }));

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(LabelInputModal).toHaveBeenCalled();
      expect(DynamicAssetCreationModal).not.toHaveBeenCalled();
      expect(mockTaskCreationService.createTask).toHaveBeenCalled();
    });

    it("should use DynamicAssetCreationModal for ems__Effort class when toggle ON", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      mockPlugin.settings.useDynamicPropertyFields = true;

      // Use ems__Effort as the instance class
      const effortContext = {
        ...mockContext,
        instanceClass: "ems__Effort",
      };

      const createdFile = { basename: "new-effort", path: "new-effort.md" };
      mockTaskCreationService.createTask.mockResolvedValue(createdFile as any);

      (DynamicAssetCreationModal as jest.Mock).mockImplementation((app, className, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({
            label: "My Effort",
            taskSize: null,
            openInNewTab: false,
            propertyValues: {}
          }), 0);
        }),
      }));

      const result = command.checkCallback(false, mockFile, effortContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      // Verify DynamicAssetCreationModal was used with ems__Effort class name
      expect(DynamicAssetCreationModal).toHaveBeenCalledWith(
        mockApp,
        "ems__Effort",
        expect.any(Function),
        undefined, // schemaService (optional)
      );

      expect(mockTaskCreationService.createTask).toHaveBeenCalledWith(
        mockFile,
        { key: "value" },
        "ems__Effort",
        "My Effort",
        null
      );
      expect(Notice).toHaveBeenCalledWith("Instance created: new-effort");
    });

    it("should handle DynamicAssetCreationModal cancellation", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      mockPlugin.settings.useDynamicPropertyFields = true;

      // Mock modal to return null (cancelled)
      (DynamicAssetCreationModal as jest.Mock).mockImplementation((app, className, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({
            label: null,
            taskSize: null,
            openInNewTab: false,
            propertyValues: {}
          }), 0);
        }),
      }));

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(DynamicAssetCreationModal).toHaveBeenCalled();
      expect(mockTaskCreationService.createTask).not.toHaveBeenCalled();
      expect(Notice).not.toHaveBeenCalled();
    });
  });
});