import { flushPromises, waitForCondition } from "./helpers/testHelpers";
import { CreateInstanceCommand } from "../../src/application/commands/CreateInstanceCommand";
import { App, TFile, Notice, WorkspaceLeaf } from "obsidian";
import {
  GenericAssetCreationService,
  CommandVisibilityContext,
  LoggingService,
  DateFormatter,
  type InstantiationRuleResolver,
  type InstantiationRule,
} from "exocortex";
import { showLabelInputModal } from "../../src/presentation/modals/modalSchemas";
import { ObsidianVaultAdapter } from "../../src/adapters/ObsidianVaultAdapter";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Notice: jest.fn(),
}));
jest.mock("../../src/presentation/modals/modalSchemas");

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

describe("CreateInstanceCommand", () => {
  let command: CreateInstanceCommand;
  let mockApp: jest.Mocked<App>;
  let mockRuleResolver: jest.Mocked<InstantiationRuleResolver>;
  let mockGenericAssetCreationService: jest.Mocked<GenericAssetCreationService>;
  let mockVaultAdapter: jest.Mocked<ObsidianVaultAdapter>;
  let mockFile: jest.Mocked<TFile>;
  let mockContext: CommandVisibilityContext;
  let mockLeaf: jest.Mocked<WorkspaceLeaf>;
  let mockTFile: jest.Mocked<TFile>;
  let mockNotifier: { info: jest.Mock; success: jest.Mock; error: jest.Mock; warn: jest.Mock; confirm: jest.Mock };

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

    mockNotifier = { info: jest.fn(), success: jest.fn(), error: jest.fn(), warn: jest.fn(), confirm: jest.fn() };
    command = new CreateInstanceCommand(
      mockApp,
      mockRuleResolver,
      mockGenericAssetCreationService,
      mockVaultAdapter,
      mockNotifier,
    );
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
      expect(mockGenericAssetCreationService.createAsset).not.toHaveBeenCalled();
    });

    it("should return false when canCreateInstance returns false", () => {
      mockCanCreateInstance.mockReturnValue(false);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(false);
      expect(mockGenericAssetCreationService.createAsset).not.toHaveBeenCalled();
    });

    it("should return true when canCreateInstance returns true and checking is true", () => {
      mockCanCreateInstance.mockReturnValue(true);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(true);
      expect(mockGenericAssetCreationService.createAsset).not.toHaveBeenCalled();
    });

    it("should handle modal cancellation", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      mockShowLabelInputModal.mockResolvedValue({ label: null, taskSize: null, openInNewTab: false });

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      expect(mockShowLabelInputModal).toHaveBeenCalled();
      expect(mockGenericAssetCreationService.createAsset).not.toHaveBeenCalled();
      expect(mockNotifier.success).not.toHaveBeenCalled();
    });
  });

  describe("rule-based creation", () => {
    const mockCanCreateInstance = require("exocortex").canCreateInstance;

    it("should create asset using resolved InstantiationRule", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const rule: InstantiationRule = {
        prototypeUID: "proto-uid-123",
        defaultFolder: "02 Areas/tasks",
        propertySetRules: [
          { property: "ems__Effort_status", value: "753a44d5-846c-4b82-9196-4fd9a4d48777", valueType: "wikilink" },
        ],
      };
      mockRuleResolver.getRule.mockResolvedValue(rule);
      const createdFile = { basename: "new-instance", path: "02 Areas/tasks/new-instance.md" };
      mockGenericAssetCreationService.createAsset.mockResolvedValue(createdFile as any);

      mockShowLabelInputModal.mockResolvedValue({ label: "My Task", taskSize: null, openInNewTab: false });

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(mockRuleResolver.getRule).toHaveBeenCalledWith("Task");
      expect(mockGenericAssetCreationService.createAsset).toHaveBeenCalledWith(
        expect.objectContaining({
          className: "Task",
          label: "My Task",
          folderPath: "02 Areas/tasks",
          propertyValues: expect.objectContaining({
            "exo__Asset_prototype": '"[[proto-uid-123]]"',
            "ems__Effort_status": '"[[753a44d5-846c-4b82-9196-4fd9a4d48777]]"',
          }),
        }),
      );
      expect(mockNotifier.success).toHaveBeenCalledWith("Instance created: new-instance");
    });

    it("should include taskSize in propertyValues when provided", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const rule: InstantiationRule = {
        prototypeUID: "proto-uid-123",
        defaultFolder: "tasks",
        propertySetRules: [],
      };
      mockRuleResolver.getRule.mockResolvedValue(rule);
      const createdFile = { basename: "new-instance", path: "tasks/new-instance.md" };
      mockGenericAssetCreationService.createAsset.mockResolvedValue(createdFile as any);

      mockShowLabelInputModal.mockResolvedValue({ label: "My Task", taskSize: '"[[ems__TaskSize_S]]"', openInNewTab: false });

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(mockGenericAssetCreationService.createAsset).toHaveBeenCalledWith(
        expect.objectContaining({
          propertyValues: expect.objectContaining({
            "ems__Effort_taskSize": '"[[ems__TaskSize_S]]"',
          }),
        }),
      );
    });

    it("should handle rule with multiple propertySetRules", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const rule: InstantiationRule = {
        prototypeUID: "proto-uid",
        defaultFolder: "tasks",
        propertySetRules: [
          { property: "ems__Effort_status", value: "backlog-uid", valueType: "wikilink" },
          { property: "exo__Asset_isDefinedBy", value: "ontology-uid", valueType: "wikilink" },
          { property: "ems__Effort_priority", value: "3", valueType: "literal" },
        ],
      };
      mockRuleResolver.getRule.mockResolvedValue(rule);
      const createdFile = { basename: "new-instance", path: "tasks/new-instance.md" };
      mockGenericAssetCreationService.createAsset.mockResolvedValue(createdFile as any);

      mockShowLabelInputModal.mockResolvedValue({ label: "Task", taskSize: null, openInNewTab: false });

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(mockGenericAssetCreationService.createAsset).toHaveBeenCalledWith(
        expect.objectContaining({
          propertyValues: expect.objectContaining({
            "ems__Effort_status": '"[[backlog-uid]]"',
            "exo__Asset_isDefinedBy": '"[[ontology-uid]]"',
            "ems__Effort_priority": "3",
          }),
        }),
      );
    });

    it("should handle rule with null prototypeUID", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const rule: InstantiationRule = {
        prototypeUID: null,
        defaultFolder: "tasks",
        propertySetRules: [],
      };
      mockRuleResolver.getRule.mockResolvedValue(rule);
      const createdFile = { basename: "new-instance", path: "tasks/new-instance.md" };
      mockGenericAssetCreationService.createAsset.mockResolvedValue(createdFile as any);

      mockShowLabelInputModal.mockResolvedValue({ label: "Task", taskSize: null, openInNewTab: false });

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      const callArgs = mockGenericAssetCreationService.createAsset.mock.calls[0][0];
      expect(callArgs.propertyValues).not.toHaveProperty("exo__Asset_prototype");
    });

    it("should fall back to parent folder when rule has null defaultFolder", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const rule: InstantiationRule = {
        prototypeUID: "proto-uid",
        defaultFolder: null,
        propertySetRules: [],
      };
      mockRuleResolver.getRule.mockResolvedValue(rule);
      const createdFile = { basename: "new-instance", path: "parent-folder/new-instance.md" };
      mockGenericAssetCreationService.createAsset.mockResolvedValue(createdFile as any);

      mockShowLabelInputModal.mockResolvedValue({ label: "Task", taskSize: null, openInNewTab: false });

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(mockGenericAssetCreationService.createAsset).toHaveBeenCalledWith(
        expect.objectContaining({
          folderPath: "parent-folder",
        }),
      );
    });
  });

  describe("fallback creation (no rule found)", () => {
    const mockCanCreateInstance = require("exocortex").canCreateInstance;

    it("should use generic fallback when no rule exists", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      mockRuleResolver.getRule.mockResolvedValue(null);
      const createdFile = { basename: "new-instance", path: "parent-folder/new-instance.md" };
      mockGenericAssetCreationService.createAsset.mockResolvedValue(createdFile as any);

      mockShowLabelInputModal.mockResolvedValue({ label: "Test Instance", taskSize: '"[[ems__TaskSize_M]]"', openInNewTab: false });

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(mockRuleResolver.getRule).toHaveBeenCalledWith("Task");
      expect(mockGenericAssetCreationService.createAsset).toHaveBeenCalledWith(
        expect.objectContaining({
          className: "Task",
          label: "Test Instance",
          folderPath: "parent-folder",
          propertyValues: expect.objectContaining({
            "ems__Effort_taskSize": '"[[ems__TaskSize_M]]"',
          }),
        }),
      );
      expect(mockNotifier.success).toHaveBeenCalledWith("Instance created: new-instance");
    });

    it("should handle fallback with empty label", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      mockRuleResolver.getRule.mockResolvedValue(null);
      const createdFile = { basename: "new-instance", path: "parent-folder/new-instance.md" };
      mockGenericAssetCreationService.createAsset.mockResolvedValue(createdFile as any);

      mockShowLabelInputModal.mockResolvedValue({ label: "", taskSize: null, openInNewTab: false });

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(mockGenericAssetCreationService.createAsset).toHaveBeenCalledWith(
        expect.objectContaining({
          label: undefined,
        }),
      );
    });
  });

  describe("error handling", () => {
    const mockCanCreateInstance = require("exocortex").canCreateInstance;

    it("should handle service error and show error notice", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const error = new Error("Failed to create asset");
      mockGenericAssetCreationService.createAsset.mockRejectedValue(error);

      mockShowLabelInputModal.mockResolvedValue({ label: "Test", taskSize: null, openInNewTab: false });

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      expect(mockGenericAssetCreationService.createAsset).toHaveBeenCalled();
      expect(LoggingService.error).toHaveBeenCalledWith("Create instance error", error);
      expect(mockNotifier.error).toHaveBeenCalledWith("Failed to create instance: Failed to create asset");
    });

    it("should handle ruleResolver error gracefully", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      mockRuleResolver.getRule.mockRejectedValue(new Error("Triple store unavailable"));

      mockShowLabelInputModal.mockResolvedValue({ label: "Test", taskSize: null, openInNewTab: false });

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(mockNotifier.error).toHaveBeenCalledWith("Failed to create instance: Triple store unavailable");
    });
  });

  describe("array instanceClass", () => {
    const mockCanCreateInstance = require("exocortex").canCreateInstance;

    it("should handle array instanceClass and use first element", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const arrayContext = {
        ...mockContext,
        instanceClass: ["Task", "Project"],
      };
      mockRuleResolver.getRule.mockResolvedValue(null);
      const createdFile = { basename: "new-task", path: "parent-folder/new-task.md" };
      mockGenericAssetCreationService.createAsset.mockResolvedValue(createdFile as any);

      mockShowLabelInputModal.mockResolvedValue({ label: "My Task", taskSize: null, openInNewTab: false });

      command.checkCallback(false, mockFile, arrayContext);
      await flushPromises();

      expect(mockRuleResolver.getRule).toHaveBeenCalledWith("Task");
      expect(mockGenericAssetCreationService.createAsset).toHaveBeenCalledWith(
        expect.objectContaining({ className: "Task" }),
      );
      expect(mockNotifier.success).toHaveBeenCalledWith("Instance created: new-task");
    });

    it("should handle empty instanceClass array", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      const emptyContext = { ...mockContext, instanceClass: [] };
      mockRuleResolver.getRule.mockResolvedValue(null);
      const createdFile = { basename: "new-instance", path: "parent-folder/new-instance.md" };
      mockGenericAssetCreationService.createAsset.mockResolvedValue(createdFile as any);

      mockShowLabelInputModal.mockResolvedValue({ label: "Test", taskSize: null, openInNewTab: false });

      command.checkCallback(false, mockFile, emptyContext);
      await flushPromises();

      expect(mockRuleResolver.getRule).toHaveBeenCalledWith("");
      expect(mockGenericAssetCreationService.createAsset).toHaveBeenCalledWith(
        expect.objectContaining({ className: "" }),
      );
    });
  });

  describe("modal defaults", () => {
    const mockCanCreateInstance = require("exocortex").canCreateInstance;

    it("should pass default label based on file label and date", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
        frontmatter: { exo__Asset_label: "My Prototype" },
      });
      mockRuleResolver.getRule.mockResolvedValue(null);
      const createdFile = { basename: "new-instance", path: "new-instance.md" };
      mockGenericAssetCreationService.createAsset.mockResolvedValue(createdFile as any);

      mockShowLabelInputModal.mockResolvedValue({ label: "Test", taskSize: null, openInNewTab: false });

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(mockShowLabelInputModal).toHaveBeenCalledWith(
        mockApp,
        `My Prototype ${DateFormatter.toDateString(new Date())}`,
        true,
      );
    });

    it("should use file basename when no label in metadata", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
        frontmatter: {},
      });
      mockRuleResolver.getRule.mockResolvedValue(null);
      const createdFile = { basename: "new-instance", path: "new-instance.md" };
      mockGenericAssetCreationService.createAsset.mockResolvedValue(createdFile as any);

      mockShowLabelInputModal.mockResolvedValue({ label: "Test", taskSize: null, openInNewTab: false });

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(mockShowLabelInputModal).toHaveBeenCalledWith(
        mockApp,
        `test-file ${DateFormatter.toDateString(new Date())}`,
        true,
      );
    });
  });

  describe("file activation wait", () => {
    const mockCanCreateInstance = require("exocortex").canCreateInstance;

    it("should wait for file to become active via polling", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      mockRuleResolver.getRule.mockResolvedValue(null);
      const createdFile = { basename: "new-instance", path: "new-instance.md" };
      mockGenericAssetCreationService.createAsset.mockResolvedValue(createdFile as any);

      mockShowLabelInputModal.mockResolvedValue({ label: "Test", taskSize: null, openInNewTab: false });

      let attempts = 0;
      mockApp.workspace.getActiveFile = jest.fn(() => {
        attempts++;
        return attempts >= 3 ? mockTFile : null;
      });

      command.checkCallback(false, mockFile, mockContext);

      await waitForCondition(
        () => mockNotifier.success.mock.calls.some((call: string[]) => call[0] === "Instance created: new-instance"),
        { timeout: 3000 },
      );

      expect((mockApp.workspace.getActiveFile as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(mockNotifier.success).toHaveBeenCalledWith("Instance created: new-instance");
    });
  });

  describe("null metadata handling", () => {
    const mockCanCreateInstance = require("exocortex").canCreateInstance;

    it("should handle null cache from metadataCache", async () => {
      mockCanCreateInstance.mockReturnValue(true);
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue(null);
      mockRuleResolver.getRule.mockResolvedValue(null);
      const createdFile = { basename: "new-instance", path: "new-instance.md" };
      mockGenericAssetCreationService.createAsset.mockResolvedValue(createdFile as any);

      mockShowLabelInputModal.mockResolvedValue({ label: "Test", taskSize: null, openInNewTab: false });

      command.checkCallback(false, mockFile, mockContext);
      await flushPromises();

      expect(mockGenericAssetCreationService.createAsset).toHaveBeenCalled();
      expect(mockNotifier.success).toHaveBeenCalledWith("Instance created: new-instance");
    });
  });
});
