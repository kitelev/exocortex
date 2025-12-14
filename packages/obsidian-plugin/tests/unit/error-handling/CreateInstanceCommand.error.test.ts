/**
 * CreateInstanceCommand Error Handling Tests
 *
 * Tests error scenarios for:
 * - Modal failures and cancellations
 * - Task creation service failures
 * - File conversion errors
 * - Workspace operation errors
 * - Non-Error throwable handling
 *
 * Issue: #788 - Add negative tests for error handling
 */

import { flushPromises } from "../helpers/testHelpers";
import { CreateInstanceCommand } from "../../../src/application/commands/CreateInstanceCommand";
import { App, TFile, Notice, WorkspaceLeaf } from "obsidian";
import {
  TaskCreationService,
  CommandVisibilityContext,
  LoggingService,
  WikiLinkHelpers,
  AssetClass,
} from "exocortex";
import { LabelInputModal } from "../../../src/presentation/modals/LabelInputModal";
import { DynamicAssetCreationModal } from "../../../src/presentation/modals/DynamicAssetCreationModal";
import { ObsidianVaultAdapter } from "../../../src/adapters/ObsidianVaultAdapter";
import { ExocortexPluginInterface } from "../../../src/types";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Notice: jest.fn(),
}));
jest.mock("../../../src/presentation/modals/LabelInputModal");
jest.mock("../../../src/presentation/modals/DynamicAssetCreationModal");
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

describe("CreateInstanceCommand Error Handling", () => {
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

    const { WikiLinkHelpers } = require("exocortex");
    WikiLinkHelpers.normalize.mockImplementation((str: string) => str);

    mockLeaf = {
      openFile: jest.fn(),
    } as unknown as jest.Mocked<WorkspaceLeaf>;

    mockTFile = {
      path: "new-instance.md",
      basename: "new-instance",
    } as jest.Mocked<TFile>;

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

    mockTaskCreationService = {
      createTask: jest.fn(),
    } as unknown as jest.Mocked<TaskCreationService>;

    mockVaultAdapter = {
      toTFile: jest.fn().mockReturnValue(mockTFile),
    } as unknown as jest.Mocked<ObsidianVaultAdapter>;

    mockPlugin = {
      settings: {
        useDynamicPropertyFields: false,
      },
    } as unknown as jest.Mocked<ExocortexPluginInterface>;

    mockFile = {
      path: "test-file.md",
      basename: "test-file",
    } as jest.Mocked<TFile>;

    mockContext = {
      instanceClass: "Task",
      status: "Active",
      archived: false,
      isDraft: false,
    };

    command = new CreateInstanceCommand(
      mockApp,
      mockTaskCreationService,
      mockVaultAdapter,
      mockPlugin
    );
  });

  describe("Modal Error Handling", () => {
    const mockCanCreateInstance = require("exocortex").canCreateInstance;

    it("should handle modal throwing an error during open", async () => {
      mockCanCreateInstance.mockReturnValue(true);

      // Mock modal to throw an error
      (LabelInputModal as jest.Mock).mockImplementation(() => ({
        open: jest.fn(() => {
          throw new Error("Modal initialization failed");
        }),
      }));

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      expect(LoggingService.error).toHaveBeenCalledWith(
        "Create instance error",
        expect.any(Error)
      );
      expect(Notice).toHaveBeenCalledWith(
        "Failed to create instance: Modal initialization failed"
      );
    });

    it("should handle modal callback never being called (modal hangs)", async () => {
      mockCanCreateInstance.mockReturnValue(true);

      // Mock modal that opens but never calls callback (simulating hung modal)
      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          // Modal opens but never resolves - simulates a hung/stuck modal
          // Callback is never invoked
        }),
      }));

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      // Modal never called callback, so createTask should not be called
      expect(mockTaskCreationService.createTask).not.toHaveBeenCalled();
    });

    it("should handle DynamicAssetCreationModal throwing error", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      mockPlugin.settings.useDynamicPropertyFields = true;

      (DynamicAssetCreationModal as jest.Mock).mockImplementation(() => ({
        open: jest.fn(() => {
          throw new Error("Dynamic modal failed to load schema");
        }),
      }));

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      expect(LoggingService.error).toHaveBeenCalledWith(
        "Create instance error",
        expect.any(Error)
      );
      expect(Notice).toHaveBeenCalledWith(
        "Failed to create instance: Dynamic modal failed to load schema"
      );
    });
  });

  describe("Task Creation Service Error Handling", () => {
    const mockCanCreateInstance = require("exocortex").canCreateInstance;

    it("should handle network error during task creation", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const networkError = new Error("Network request failed: ETIMEDOUT");
      mockTaskCreationService.createTask.mockRejectedValue(networkError);

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test", taskSize: "small" }), 0);
        }),
      }));

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(Notice).toHaveBeenCalledWith(
        "Failed to create instance: Network request failed: ETIMEDOUT"
      );
      expect(LoggingService.error).toHaveBeenCalledWith(
        "Create instance error",
        networkError
      );
    });

    it("should handle permission denied error during task creation", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const permissionError = new Error("EACCES: permission denied");
      mockTaskCreationService.createTask.mockRejectedValue(permissionError);

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test", taskSize: "small" }), 0);
        }),
      }));

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(Notice).toHaveBeenCalledWith(
        "Failed to create instance: EACCES: permission denied"
      );
    });

    it("should handle disk full error during task creation", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const diskFullError = new Error("ENOSPC: no space left on device");
      mockTaskCreationService.createTask.mockRejectedValue(diskFullError);

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test", taskSize: "small" }), 0);
        }),
      }));

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(Notice).toHaveBeenCalledWith(
        "Failed to create instance: ENOSPC: no space left on device"
      );
    });

    it("should handle file already exists error", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const existsError = new Error("File already exists: task.md");
      mockTaskCreationService.createTask.mockRejectedValue(existsError);

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test", taskSize: "small" }), 0);
        }),
      }));

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(Notice).toHaveBeenCalledWith(
        "Failed to create instance: File already exists: task.md"
      );
    });

    it("should handle undefined error object", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      mockTaskCreationService.createTask.mockRejectedValue(undefined);

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test", taskSize: "small" }), 0);
        }),
      }));

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(Notice).toHaveBeenCalledWith(
        "Failed to create instance: undefined"
      );
    });

    it("should handle non-Error throwable (string)", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      mockTaskCreationService.createTask.mockRejectedValue(
        "String error message"
      );

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test", taskSize: "small" }), 0);
        }),
      }));

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(Notice).toHaveBeenCalledWith(
        "Failed to create instance: String error message"
      );
    });

    it("should handle non-Error throwable (number)", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      mockTaskCreationService.createTask.mockRejectedValue(404);

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test", taskSize: "small" }), 0);
        }),
      }));

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(Notice).toHaveBeenCalledWith("Failed to create instance: 404");
    });
  });

  describe("File Conversion Error Handling", () => {
    const mockCanCreateInstance = require("exocortex").canCreateInstance;

    it("should throw error when toTFile returns null", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const createdFile = { basename: "new-instance", path: "new-instance.md" };
      mockTaskCreationService.createTask.mockResolvedValue(createdFile as any);
      mockVaultAdapter.toTFile.mockReturnValue(null as any);

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test", taskSize: "small" }), 0);
        }),
      }));

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("Failed to create instance:")
      );
    });

    it("should handle toTFile throwing an error", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const createdFile = { basename: "new-instance", path: "new-instance.md" };
      mockTaskCreationService.createTask.mockResolvedValue(createdFile as any);
      mockVaultAdapter.toTFile.mockImplementation(() => {
        throw new Error("File not found in vault cache");
      });

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test", taskSize: "small" }), 0);
        }),
      }));

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(Notice).toHaveBeenCalledWith(
        "Failed to create instance: File not found in vault cache"
      );
    });
  });

  describe("Workspace Operation Error Handling", () => {
    const mockCanCreateInstance = require("exocortex").canCreateInstance;

    it("should handle openFile failure", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const createdFile = { basename: "new-instance", path: "new-instance.md" };
      mockTaskCreationService.createTask.mockResolvedValue(createdFile as any);
      mockLeaf.openFile.mockRejectedValue(new Error("Cannot open file"));

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test", taskSize: "small" }), 0);
        }),
      }));

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(Notice).toHaveBeenCalledWith(
        "Failed to create instance: Cannot open file"
      );
    });

    it("should handle getLeaf returning null", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const createdFile = { basename: "new-instance", path: "new-instance.md" };
      mockTaskCreationService.createTask.mockResolvedValue(createdFile as any);
      (mockApp.workspace.getLeaf as jest.Mock).mockReturnValue(null);

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test", taskSize: "small" }), 0);
        }),
      }));

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      // Should fail when trying to call openFile on null leaf
      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("Failed to create instance:")
      );
    });

    it("should handle setActiveLeaf error", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const createdFile = { basename: "new-instance", path: "new-instance.md" };
      mockTaskCreationService.createTask.mockResolvedValue(createdFile as any);
      (mockApp.workspace.setActiveLeaf as jest.Mock).mockImplementation(() => {
        throw new Error("Workspace state invalid");
      });

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test", taskSize: "small" }), 0);
        }),
      }));

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(Notice).toHaveBeenCalledWith(
        "Failed to create instance: Workspace state invalid"
      );
    });
  });

  describe("Context and Input Validation Errors", () => {
    const mockCanCreateInstance = require("exocortex").canCreateInstance;

    it("should handle empty instanceClass array", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const emptyContext = {
        ...mockContext,
        instanceClass: [],
      };
      const createdFile = { basename: "new-instance", path: "new-instance.md" };
      mockTaskCreationService.createTask.mockResolvedValue(createdFile as any);

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test", taskSize: "small" }), 0);
        }),
      }));

      command.checkCallback(false, mockFile, emptyContext);
      await flushPromises();

      // Should call createTask with empty string for sourceClass
      expect(mockTaskCreationService.createTask).toHaveBeenCalledWith(
        mockFile,
        { key: "value" },
        "",
        "Test",
        "small"
      );
    });

    it("should handle undefined instanceClass", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const undefinedContext = {
        ...mockContext,
        instanceClass: undefined as any,
      };
      const createdFile = { basename: "new-instance", path: "new-instance.md" };
      mockTaskCreationService.createTask.mockResolvedValue(createdFile as any);

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test", taskSize: "small" }), 0);
        }),
      }));

      command.checkCallback(false, mockFile, undefinedContext);
      await flushPromises();

      // Should handle undefined gracefully
      expect(mockTaskCreationService.createTask).toHaveBeenCalledWith(
        mockFile,
        { key: "value" },
        "",
        "Test",
        "small"
      );
    });

    it("should handle useDynamicPropertyFields being undefined", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      // Settings exists but useDynamicPropertyFields is undefined
      mockPlugin.settings = {} as any;
      const createdFile = { basename: "new-instance", path: "new-instance.md" };
      mockTaskCreationService.createTask.mockResolvedValue(createdFile as any);

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test", taskSize: "small" }), 0);
        }),
      }));

      // Should use nullish coalescing for useDynamicPropertyFields
      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      // Should fall back to LabelInputModal (dynamic fields false by default)
      expect(LabelInputModal).toHaveBeenCalled();
    });
  });

  describe("Timeout and Long-Running Operation Handling", () => {
    const mockCanCreateInstance = require("exocortex").canCreateInstance;

    it("should handle file never becoming active (timeout scenario)", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const createdFile = { basename: "new-instance", path: "new-instance.md" };
      mockTaskCreationService.createTask.mockResolvedValue(createdFile as any);

      // File never becomes active (returns different file)
      const differentFile = {
        path: "different-file.md",
        basename: "different-file",
      } as jest.Mocked<TFile>;
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        differentFile
      );

      // Event listener is registered but never fires for the right file
      (mockApp.workspace.on as jest.Mock).mockReturnValue({ id: "mock-event-ref" });

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test", taskSize: "small" }), 0);
        }),
      }));

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      // Wait for timeout to complete (default 2000ms)
      await new Promise((resolve) => setTimeout(resolve, 2100));

      // Should still show success notice even if file didn't become active
      expect(Notice).toHaveBeenCalledWith("Instance created: new-instance");
      expect(mockApp.workspace.offref).toHaveBeenCalled();
    });

    it("should handle getActiveFile returning null consistently", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const createdFile = { basename: "new-instance", path: "new-instance.md" };
      mockTaskCreationService.createTask.mockResolvedValue(createdFile as any);

      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(null);
      // Event listener is registered but never fires
      (mockApp.workspace.on as jest.Mock).mockReturnValue({ id: "mock-event-ref" });

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test", taskSize: "small" }), 0);
        }),
      }));

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      // Wait for timeout to complete (default 2000ms)
      await new Promise((resolve) => setTimeout(resolve, 2100));

      expect(Notice).toHaveBeenCalledWith("Instance created: new-instance");
      expect(mockApp.workspace.on).toHaveBeenCalledWith("file-open", expect.any(Function));
    });
  });

  describe("Open in New Tab Option Error Handling", () => {
    const mockCanCreateInstance = require("exocortex").canCreateInstance;

    it("should handle error when opening in new tab", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const createdFile = { basename: "new-instance", path: "new-instance.md" };
      mockTaskCreationService.createTask.mockResolvedValue(createdFile as any);

      // Make getLeaf("tab") fail
      (mockApp.workspace.getLeaf as jest.Mock).mockImplementation(
        (option: string | boolean) => {
          if (option === "tab") {
            throw new Error("Cannot create new tab");
          }
          return mockLeaf;
        }
      );

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(
            () => callback({ label: "Test", taskSize: "small", openInNewTab: true }),
            0
          );
        }),
      }));

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(Notice).toHaveBeenCalledWith(
        "Failed to create instance: Cannot create new tab"
      );
    });
  });
});
