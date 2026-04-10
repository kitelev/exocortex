import { CreateAreaCommand } from "../../src/application/commands/CreateAreaCommand";
import { App, TFile, Notice, WorkspaceLeaf } from "obsidian";
import {
  AreaCreationService,
  CommandVisibilityContext,
  LoggingService,
} from "exocortex";
import { showLabelInputModal } from "../../src/presentation/modals/modalSchemas";
import { ObsidianVaultAdapter } from "../../src/adapters/ObsidianVaultAdapter";
import { flushPromises, waitForCondition } from "./helpers/testHelpers";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Notice: jest.fn(),
}));
jest.mock("../../src/presentation/modals/modalSchemas");

const mockShowLabelInputModal = showLabelInputModal as jest.MockedFunction<typeof showLabelInputModal>;
jest.mock("exocortex", () => ({
  ...jest.requireActual("exocortex"),
  canCreateChildArea: jest.fn(),
  LoggingService: {
    error: jest.fn(),
  },
}));

describe("CreateAreaCommand", () => {
  let command: CreateAreaCommand;
  let mockNotifier: any;
  let mockApp: jest.Mocked<App>;
  let mockAreaCreationService: jest.Mocked<AreaCreationService>;
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
      path: "new-area.md",
      basename: "new-area",
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
          frontmatter: { exo__Instance_class: ["[[ems__Area]]"] },
        }),
      },
    } as unknown as jest.Mocked<App>;

    // Create mock services
    mockAreaCreationService = {
      createChildArea: jest.fn(),
    } as unknown as jest.Mocked<AreaCreationService>;

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
      instanceClass: "ems__Area",
      status: "Active",
      archived: false,
      isDraft: false,
    };

    // Create command instance
    mockNotifier = { info: jest.fn(), success: jest.fn(), error: jest.fn(), warn: jest.fn(), confirm: jest.fn() };
    command = new CreateAreaCommand(mockApp, mockAreaCreationService, mockVaultAdapter, mockNotifier);
  });

  describe("id and name", () => {
    it("should have correct id and name", () => {
      expect(command.id).toBe("create-area");
      expect(command.name).toBe("Create area");
    });
  });

  describe("checkCallback", () => {
    const mockCanCreateChildArea = require("exocortex").canCreateChildArea;

    it("should return false when context is null", () => {
      const result = command.checkCallback(true, mockFile, null);
      expect(result).toBe(false);
      expect(mockAreaCreationService.createChildArea).not.toHaveBeenCalled();
    });

    it("should return false when canCreateChildArea returns false", () => {
      mockCanCreateChildArea.mockReturnValue(false);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(false);
      expect(mockAreaCreationService.createChildArea).not.toHaveBeenCalled();
    });

    it("should return true when canCreateChildArea returns true and checking is true", () => {
      mockCanCreateChildArea.mockReturnValue(true);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(true);
      expect(mockAreaCreationService.createChildArea).not.toHaveBeenCalled();
    });

    it("should execute command when checking is false and canCreateChildArea returns true", async () => {
      mockCanCreateChildArea.mockReturnValue(true);
      const createdFile = { basename: "new-area", path: "new-area.md" };
      mockAreaCreationService.createChildArea.mockResolvedValue(createdFile as any);

      // Mock modal to return label
      mockShowLabelInputModal.mockResolvedValue({ label: "Test Area", taskSize: null, openInNewTab: false });

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      expect(mockShowLabelInputModal).toHaveBeenCalledWith(mockApp);
      expect(mockAreaCreationService.createChildArea).toHaveBeenCalledWith(
        mockFile,
        { exo__Instance_class: ["[[ems__Area]]"] },
        "Test Area"
      );
      expect(mockVaultAdapter.toTFile).toHaveBeenCalledWith(createdFile);
      expect(mockLeaf.openFile).toHaveBeenCalledWith(mockTFile);
      expect(mockApp.workspace.setActiveLeaf).toHaveBeenCalledWith(mockLeaf, { focus: true });
      expect(mockNotifier.success).toHaveBeenCalledWith("Area created: new-area");
    });

    it("should handle modal cancellation", async () => {
      mockCanCreateChildArea.mockReturnValue(true);

      // Mock modal to return null (cancelled)
      mockShowLabelInputModal.mockResolvedValue({ label: null, taskSize: null, openInNewTab: false });

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      expect(mockShowLabelInputModal).toHaveBeenCalled();
      expect(mockAreaCreationService.createChildArea).not.toHaveBeenCalled();
      expect(mockNotifier.success).not.toHaveBeenCalled();
    });

    it("should handle service error and show error notice", async () => {
      mockCanCreateChildArea.mockReturnValue(true);
      const error = new Error("Failed to create area");
      mockAreaCreationService.createChildArea.mockRejectedValue(error);

      mockShowLabelInputModal.mockResolvedValue({ label: "Test Area", taskSize: null, openInNewTab: false });

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      expect(mockAreaCreationService.createChildArea).toHaveBeenCalled();
      expect(LoggingService.error).toHaveBeenCalledWith("Create area error", error);
      expect(mockNotifier.error).toHaveBeenCalledWith("Failed to create area: Failed to create area");
    });

    it("should wait for file to become active", async () => {
      mockCanCreateChildArea.mockReturnValue(true);
      const createdFile = { basename: "new-area", path: "new-area.md" };
      mockAreaCreationService.createChildArea.mockResolvedValue(createdFile as any);

      mockShowLabelInputModal.mockResolvedValue({ label: "Test", taskSize: null, openInNewTab: false });

      // Simulate file becoming active after 3 attempts
      let attempts = 0;
      mockApp.workspace.getActiveFile = jest.fn(() => {
        attempts++;
        return attempts >= 3 ? mockTFile : null;
      });

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await waitForCondition(() => (mockApp.workspace.getActiveFile as jest.Mock).mock.calls.length >= 3);

      expect(mockApp.workspace.getActiveFile).toHaveBeenCalledTimes(3);
      expect(mockNotifier.success).toHaveBeenCalledWith("Area created: new-area");
    });

    it("should handle missing frontmatter metadata", async () => {
      mockCanCreateChildArea.mockReturnValue(true);
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({});
      const createdFile = { basename: "new-area", path: "new-area.md" };
      mockAreaCreationService.createChildArea.mockResolvedValue(createdFile as any);

      mockShowLabelInputModal.mockResolvedValue({ label: "Test", taskSize: null, openInNewTab: false });

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      expect(mockAreaCreationService.createChildArea).toHaveBeenCalledWith(
        mockFile,
        {}, // Empty metadata
        "Test"
      );
      expect(mockNotifier.success).toHaveBeenCalledWith("Area created: new-area");
    });

    it("should handle null cache from metadataCache", async () => {
      mockCanCreateChildArea.mockReturnValue(true);
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue(null);
      const createdFile = { basename: "new-area", path: "new-area.md" };
      mockAreaCreationService.createChildArea.mockResolvedValue(createdFile as any);

      mockShowLabelInputModal.mockResolvedValue({ label: "Test", taskSize: null, openInNewTab: false });

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      expect(mockAreaCreationService.createChildArea).toHaveBeenCalledWith(
        mockFile,
        {}, // Empty metadata
        "Test"
      );
      expect(mockNotifier.success).toHaveBeenCalledWith("Area created: new-area");
    });

    it("should timeout after max attempts waiting for file", async () => {
      mockCanCreateChildArea.mockReturnValue(true);
      const createdFile = { basename: "new-area", path: "new-area.md" };
      mockAreaCreationService.createChildArea.mockResolvedValue(createdFile as any);

      mockShowLabelInputModal.mockResolvedValue({ label: "Test", taskSize: null, openInNewTab: false });

      // File never becomes active
      mockApp.workspace.getActiveFile = jest.fn().mockReturnValue(null);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for polling loop to complete (20 attempts × 100ms = 2000ms + buffer)
      await waitForCondition(
        () => mockNotifier.success.mock.calls.length > 0,
        { timeout: 5000, interval: 100 }
      );

      // Should still complete successfully even if file doesn't become active
      expect(mockApp.workspace.getActiveFile).toHaveBeenCalledTimes(20); // max attempts
      expect(mockNotifier.success).toHaveBeenCalledWith("Area created: new-area");
    });

    it("should open file in new tab when openInNewTab is true", async () => {
      mockCanCreateChildArea.mockReturnValue(true);
      const createdFile = { basename: "new-area", path: "new-area.md" };
      mockAreaCreationService.createChildArea.mockResolvedValue(createdFile as any);

      // Mock modal to return label with openInNewTab true
      mockShowLabelInputModal.mockResolvedValue({ label: "Test Area", openInNewTab: true, taskSize: null });

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      expect(mockApp.workspace.getLeaf).toHaveBeenCalledWith("tab");
      expect(mockNotifier.success).toHaveBeenCalledWith("Area created: new-area");
    });

    it("should open file in current tab when openInNewTab is false", async () => {
      mockCanCreateChildArea.mockReturnValue(true);
      const createdFile = { basename: "new-area", path: "new-area.md" };
      mockAreaCreationService.createChildArea.mockResolvedValue(createdFile as any);

      // Mock modal to return label with openInNewTab false
      mockShowLabelInputModal.mockResolvedValue({ label: "Test Area", openInNewTab: false, taskSize: null });

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      expect(mockApp.workspace.getLeaf).toHaveBeenCalledWith(false);
      expect(mockNotifier.success).toHaveBeenCalledWith("Area created: new-area");
    });
  });
});
