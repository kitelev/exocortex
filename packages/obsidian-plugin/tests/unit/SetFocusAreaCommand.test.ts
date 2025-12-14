import "reflect-metadata";
import { container } from "tsyringe";
import { DI_TOKENS, registerCoreServices, resetContainer } from "exocortex";
import { SetFocusAreaCommand } from "../../src/application/commands/SetFocusAreaCommand";
import { App, Notice } from "obsidian";
import { ExocortexPluginInterface } from "../../src/types";
import { AreaSelectionModal, AreaSelectionModalResult } from "../../src/presentation/modals/AreaSelectionModal";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Notice: jest.fn(),
}));

jest.mock("../../src/presentation/modals/AreaSelectionModal");

describe("SetFocusAreaCommand", () => {
  let command: SetFocusAreaCommand;
  let mockApp: App;
  let mockPlugin: jest.Mocked<ExocortexPluginInterface>;
  let mockVaultAdapter: any;

  beforeEach(() => {
    jest.clearAllMocks();
    resetContainer();

    mockApp = {} as App;

    mockVaultAdapter = {
      create: jest.fn().mockResolvedValue({
        path: "test-uid.md",
        basename: "test-uid",
        name: "test-uid.md",
        parent: null,
      }),
      getAllFiles: jest.fn().mockReturnValue([]),
      getFrontmatter: jest.fn().mockReturnValue(null),
      getDefaultNewFileParent: jest.fn().mockReturnValue({
        path: "",
        name: "",
      }),
      exists: jest.fn().mockResolvedValue(true),
      createFolder: jest.fn().mockResolvedValue(undefined),
      read: jest.fn().mockResolvedValue(""),
      modify: jest.fn().mockResolvedValue(undefined),
      updateFrontmatter: jest.fn().mockResolvedValue(undefined),
    };

    container.register(DI_TOKENS.IVaultAdapter, { useValue: mockVaultAdapter });
    container.register(DI_TOKENS.ILogger, { useValue: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() } });
    registerCoreServices();

    mockPlugin = {
      settings: {
        activeFocusArea: null,
        defaultOntologyAsset: null,
      },
      saveSettings: jest.fn(),
      refreshLayout: jest.fn(),
      vaultAdapter: mockVaultAdapter,
    } as unknown as jest.Mocked<ExocortexPluginInterface>;

    // Setup modal mock
    (AreaSelectionModal as jest.Mock).mockImplementation((app, onSubmit, currentArea) => ({
      open: jest.fn(() => {
        // Store callback for test access
        (AreaSelectionModal as any).lastCallback = onSubmit;
      }),
    }));

    command = new SetFocusAreaCommand(mockApp, mockPlugin);
  });

  afterEach(() => {
    resetContainer();
  });

  describe("id and name", () => {
    it("should have correct id and name", () => {
      expect(command.id).toBe("set-focus-area");
      expect(command.name).toBe("Set Focus Area");
    });
  });

  describe("callback", () => {
    it("should open AreaSelectionModal", async () => {
      await command.callback();

      expect(AreaSelectionModal).toHaveBeenCalledWith(
        mockApp,
        expect.any(Function),
        null,
      );
      const modalInstance = (AreaSelectionModal as jest.Mock).mock.results[0].value;
      expect(modalInstance.open).toHaveBeenCalled();
    });

    it("should pass current active area to modal", async () => {
      mockPlugin.settings.activeFocusArea = "Development";
      command = new SetFocusAreaCommand(mockApp, mockPlugin);

      await command.callback();

      expect(AreaSelectionModal).toHaveBeenCalledWith(
        mockApp,
        expect.any(Function),
        "Development",
      );
    });

    it("should set focus area when area is selected", async () => {
      mockPlugin.saveSettings.mockResolvedValue();

      await command.callback();

      const callback = (AreaSelectionModal as any).lastCallback;
      expect(callback).toBeDefined();
      await callback({
        selectedArea: "Development",
      });

      expect(mockPlugin.settings.activeFocusArea).toBe("Development");
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
      expect(mockPlugin.refreshLayout).toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith("Focus area set to: Development");
    });

    it("should clear focus area when null is selected", async () => {
      mockPlugin.settings.activeFocusArea = "Development";
      mockPlugin.saveSettings.mockResolvedValue();

      await command.callback();

      const callback = (AreaSelectionModal as any).lastCallback;
      await callback({
        selectedArea: null,
      });

      expect(mockPlugin.settings.activeFocusArea).toBeNull();
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
      expect(mockPlugin.refreshLayout).toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith("Focus area cleared - showing all efforts");
    });

    it("should show appropriate notice when clearing already null area", async () => {
      mockPlugin.settings.activeFocusArea = null;
      mockPlugin.saveSettings.mockResolvedValue();

      await command.callback();

      const callback = (AreaSelectionModal as any).lastCallback;
      await callback({
        selectedArea: null,
      });

      expect(mockPlugin.settings.activeFocusArea).toBeNull();
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
      expect(mockPlugin.refreshLayout).toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith("No focus area selected");
    });

    it("should update focus area when changing from one to another", async () => {
      mockPlugin.settings.activeFocusArea = "Development";
      mockPlugin.saveSettings.mockResolvedValue();

      await command.callback();

      const callback = (AreaSelectionModal as any).lastCallback;
      await callback({
        selectedArea: "Personal",
      });

      expect(mockPlugin.settings.activeFocusArea).toBe("Personal");
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
      expect(mockPlugin.refreshLayout).toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith("Focus area set to: Personal");
    });

    it("should handle saveSettings errors", async () => {
      const error = new Error("Save failed");
      mockPlugin.saveSettings.mockRejectedValue(error);

      await command.callback();

      const callback = (AreaSelectionModal as any).lastCallback;

      await callback({
        selectedArea: "Development",
      });

      expect(mockPlugin.settings.activeFocusArea).toBe("Development");
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
      expect(mockPlugin.refreshLayout).not.toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("Failed to activate focus area"),
      );
    });

    it("should handle missing refreshLayout gracefully", async () => {
      mockPlugin.refreshLayout = undefined;
      mockPlugin.saveSettings.mockResolvedValue();

      await command.callback();

      const callback = (AreaSelectionModal as any).lastCallback;
      await callback({
        selectedArea: "Development",
      });

      expect(mockPlugin.settings.activeFocusArea).toBe("Development");
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith("Focus area set to: Development");
    });

    it("should persist selection across multiple invocations", async () => {
      mockPlugin.saveSettings.mockResolvedValue();

      await command.callback();
      let callback = (AreaSelectionModal as any).lastCallback;
      await callback({
        selectedArea: "Development",
      });
      expect(mockPlugin.settings.activeFocusArea).toBe("Development");

      await command.callback();
      callback = (AreaSelectionModal as any).lastCallback;
      await callback({
        selectedArea: "Personal",
      });
      expect(mockPlugin.settings.activeFocusArea).toBe("Personal");

      await command.callback();
      callback = (AreaSelectionModal as any).lastCallback;
      await callback({
        selectedArea: null,
      });
      expect(mockPlugin.settings.activeFocusArea).toBeNull();

      expect(mockPlugin.saveSettings).toHaveBeenCalledTimes(3);
      expect(mockPlugin.refreshLayout).toHaveBeenCalledTimes(3);
    });
  });
});
