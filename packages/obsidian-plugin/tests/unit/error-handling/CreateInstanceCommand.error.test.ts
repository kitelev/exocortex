import { flushPromises } from "../helpers/testHelpers";
import { CreateInstanceCommand } from "../../../src/application/commands/CreateInstanceCommand";
import { App, TFile, Notice, WorkspaceLeaf } from "obsidian";
import {
  GenericAssetCreationService,
  CommandVisibilityContext,
  LoggingService,
  type InstantiationRuleResolver,
} from "exocortex";
import { showLabelInputModal } from "../../../src/presentation/modals/modalSchemas";
import { ObsidianVaultAdapter } from "../../../src/adapters/ObsidianVaultAdapter";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Notice: jest.fn(),
}));
jest.mock("../../../src/presentation/modals/modalSchemas");

const mockShowLabelInputModal = showLabelInputModal as jest.MockedFunction<typeof showLabelInputModal>;
jest.mock("exocortex", () => ({
  ...jest.requireActual("exocortex"),
  canCreateInstance: jest.fn(),
  LoggingService: {
    error: jest.fn(),
  },
  WikiLinkHelpers: {
    normalize: jest.fn(),
  },
}));

describe("CreateInstanceCommand Error Handling", () => {
  let command: CreateInstanceCommand;
  let mockApp: jest.Mocked<App>;
  let mockRuleResolver: jest.Mocked<InstantiationRuleResolver>;
  let mockGenericAssetCreationService: jest.Mocked<GenericAssetCreationService>;
  let mockVaultAdapter: jest.Mocked<ObsidianVaultAdapter>;
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

    mockRuleResolver = {
      getRule: jest.fn().mockResolvedValue(null),
      invalidateCache: jest.fn(),
    } as unknown as jest.Mocked<InstantiationRuleResolver>;

    mockGenericAssetCreationService = {
      createAsset: jest.fn(),
    } as unknown as jest.Mocked<GenericAssetCreationService>;

    mockVaultAdapter = {
      toTFile: jest.fn().mockReturnValue(mockTFile),
    } as unknown as jest.Mocked<ObsidianVaultAdapter>;

    mockFile = {
      path: "test-file.md",
      basename: "test-file",
      name: "test-file.md",
      parent: { path: "parent-folder", name: "parent-folder" },
    } as unknown as jest.Mocked<TFile>;

    mockContext = {
      instanceClass: "Task",
      status: "Active",
      archived: false,
      isDraft: false,
    };

    command = new CreateInstanceCommand(
      mockApp,
      mockRuleResolver,
      mockGenericAssetCreationService,
      mockVaultAdapter,
    );
  });

  describe("Modal Error Handling", () => {
    const mockCanCreateInstance = require("exocortex").canCreateInstance;

    it("should handle modal throwing an error during open", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      mockShowLabelInputModal.mockRejectedValue(new Error("Modal initialization failed"));

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      expect(LoggingService.error).toHaveBeenCalledWith(
        "Create instance error",
        expect.any(Error),
      );
      expect(Notice).toHaveBeenCalledWith(
        "Failed to create instance: Modal initialization failed",
      );
    });

    it("should handle modal callback never being called (modal hangs)", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      mockShowLabelInputModal.mockReturnValue(new Promise(() => {}));

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      expect(mockGenericAssetCreationService.createAsset).not.toHaveBeenCalled();
    });
  });

  describe("Asset Creation Service Error Handling", () => {
    const mockCanCreateInstance = require("exocortex").canCreateInstance;

    it("should handle network error during asset creation", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const networkError = new Error("Network request failed: ETIMEDOUT");
      mockGenericAssetCreationService.createAsset.mockRejectedValue(networkError);

      mockShowLabelInputModal.mockResolvedValue({ label: "Test", taskSize: null, openInNewTab: false });

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(Notice).toHaveBeenCalledWith(
        "Failed to create instance: Network request failed: ETIMEDOUT",
      );
      expect(LoggingService.error).toHaveBeenCalledWith(
        "Create instance error",
        networkError,
      );
    });

    it("should handle permission denied error during asset creation", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const permissionError = new Error("EACCES: permission denied");
      mockGenericAssetCreationService.createAsset.mockRejectedValue(permissionError);

      mockShowLabelInputModal.mockResolvedValue({ label: "Test", taskSize: null, openInNewTab: false });

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(Notice).toHaveBeenCalledWith(
        "Failed to create instance: EACCES: permission denied",
      );
    });

    it("should handle disk full error during asset creation", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const diskFullError = new Error("ENOSPC: no space left on device");
      mockGenericAssetCreationService.createAsset.mockRejectedValue(diskFullError);

      mockShowLabelInputModal.mockResolvedValue({ label: "Test", taskSize: null, openInNewTab: false });

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(Notice).toHaveBeenCalledWith(
        "Failed to create instance: ENOSPC: no space left on device",
      );
    });

    it("should handle file already exists error", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const existsError = new Error("File already exists: task.md");
      mockGenericAssetCreationService.createAsset.mockRejectedValue(existsError);

      mockShowLabelInputModal.mockResolvedValue({ label: "Test", taskSize: null, openInNewTab: false });

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(Notice).toHaveBeenCalledWith(
        "Failed to create instance: File already exists: task.md",
      );
    });

    it("should handle undefined error object", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      mockGenericAssetCreationService.createAsset.mockRejectedValue(undefined);

      mockShowLabelInputModal.mockResolvedValue({ label: "Test", taskSize: null, openInNewTab: false });

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(Notice).toHaveBeenCalledWith(
        "Failed to create instance: undefined",
      );
    });

    it("should handle non-Error throwable (string)", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      mockGenericAssetCreationService.createAsset.mockRejectedValue("String error message");

      mockShowLabelInputModal.mockResolvedValue({ label: "Test", taskSize: null, openInNewTab: false });

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(Notice).toHaveBeenCalledWith(
        "Failed to create instance: String error message",
      );
    });

    it("should handle non-Error throwable (number)", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      mockGenericAssetCreationService.createAsset.mockRejectedValue(404);

      mockShowLabelInputModal.mockResolvedValue({ label: "Test", taskSize: null, openInNewTab: false });

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
      mockGenericAssetCreationService.createAsset.mockResolvedValue(createdFile as any);
      mockVaultAdapter.toTFile.mockReturnValue(null as any);

      mockShowLabelInputModal.mockResolvedValue({ label: "Test", taskSize: null, openInNewTab: false });

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("Failed to create instance:"),
      );
    });

    it("should handle toTFile throwing an error", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const createdFile = { basename: "new-instance", path: "new-instance.md" };
      mockGenericAssetCreationService.createAsset.mockResolvedValue(createdFile as any);
      mockVaultAdapter.toTFile.mockImplementation(() => {
        throw new Error("File not found in vault cache");
      });

      mockShowLabelInputModal.mockResolvedValue({ label: "Test", taskSize: null, openInNewTab: false });

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(Notice).toHaveBeenCalledWith(
        "Failed to create instance: File not found in vault cache",
      );
    });
  });

  describe("Workspace Operation Error Handling", () => {
    const mockCanCreateInstance = require("exocortex").canCreateInstance;

    it("should handle openFile failure", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const createdFile = { basename: "new-instance", path: "new-instance.md" };
      mockGenericAssetCreationService.createAsset.mockResolvedValue(createdFile as any);
      mockLeaf.openFile.mockRejectedValue(new Error("Cannot open file"));

      mockShowLabelInputModal.mockResolvedValue({ label: "Test", taskSize: null, openInNewTab: false });

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(Notice).toHaveBeenCalledWith(
        "Failed to create instance: Cannot open file",
      );
    });

    it("should handle getLeaf returning null", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const createdFile = { basename: "new-instance", path: "new-instance.md" };
      mockGenericAssetCreationService.createAsset.mockResolvedValue(createdFile as any);
      (mockApp.workspace.getLeaf as jest.Mock).mockReturnValue(null);

      mockShowLabelInputModal.mockResolvedValue({ label: "Test", taskSize: null, openInNewTab: false });

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("Failed to create instance:"),
      );
    });

    it("should handle setActiveLeaf error", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const createdFile = { basename: "new-instance", path: "new-instance.md" };
      mockGenericAssetCreationService.createAsset.mockResolvedValue(createdFile as any);
      (mockApp.workspace.setActiveLeaf as jest.Mock).mockImplementation(() => {
        throw new Error("Workspace state invalid");
      });

      mockShowLabelInputModal.mockResolvedValue({ label: "Test", taskSize: null, openInNewTab: false });

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(Notice).toHaveBeenCalledWith(
        "Failed to create instance: Workspace state invalid",
      );
    });
  });

  describe("Open in New Tab Option Error Handling", () => {
    const mockCanCreateInstance = require("exocortex").canCreateInstance;

    it("should handle error when opening in new tab", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const createdFile = { basename: "new-instance", path: "new-instance.md" };
      mockGenericAssetCreationService.createAsset.mockResolvedValue(createdFile as any);

      (mockApp.workspace.getLeaf as jest.Mock).mockImplementation(
        (option: string | boolean) => {
          if (option === "tab") {
            throw new Error("Cannot create new tab");
          }
          return mockLeaf;
        },
      );

      mockShowLabelInputModal.mockResolvedValue({ label: "Test", taskSize: null, openInNewTab: true });

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(Notice).toHaveBeenCalledWith(
        "Failed to create instance: Cannot create new tab",
      );
    });
  });

  describe("Timeout and Long-Running Operation Handling", () => {
    const mockCanCreateInstance = require("exocortex").canCreateInstance;

    it("should handle file never becoming active (timeout scenario)", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const createdFile = { basename: "new-instance", path: "new-instance.md" };
      mockGenericAssetCreationService.createAsset.mockResolvedValue(createdFile as any);

      const differentFile = {
        path: "different-file.md",
        basename: "different-file",
      } as jest.Mocked<TFile>;
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(differentFile);

      mockShowLabelInputModal.mockResolvedValue({ label: "Test", taskSize: null, openInNewTab: false });

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      await new Promise((resolve) => setTimeout(resolve, 2500));

      expect(Notice).toHaveBeenCalledWith("Instance created: new-instance");
    });

    it("should handle getActiveFile returning null consistently", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const createdFile = { basename: "new-instance", path: "new-instance.md" };
      mockGenericAssetCreationService.createAsset.mockResolvedValue(createdFile as any);

      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(null);

      mockShowLabelInputModal.mockResolvedValue({ label: "Test", taskSize: null, openInNewTab: false });

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      await new Promise((resolve) => setTimeout(resolve, 2500));

      expect(Notice).toHaveBeenCalledWith("Instance created: new-instance");
      expect(mockApp.workspace.getActiveFile).toHaveBeenCalled();
    });
  });
});
