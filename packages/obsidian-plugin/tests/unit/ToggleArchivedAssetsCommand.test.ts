import { ToggleArchivedAssetsCommand } from "../../src/application/commands/ToggleArchivedAssetsCommand";
import { Notice } from "obsidian";
import { ExocortexPluginInterface } from "../../src/types";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Notice: jest.fn(),
}));

describe("ToggleArchivedAssetsCommand", () => {
  let command: ToggleArchivedAssetsCommand;
  let mockNotifier: any;
  let mockPlugin: jest.Mocked<ExocortexPluginInterface>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock plugin
    mockPlugin = {
      settings: {
        showArchivedAssets: false,
      },
      saveSettings: jest.fn(),
      refreshLayout: jest.fn(),
    } as unknown as jest.Mocked<ExocortexPluginInterface>;

    // Create command instance
    mockNotifier = { info: jest.fn(), success: jest.fn(), error: jest.fn(), warn: jest.fn(), confirm: jest.fn() };
    command = new ToggleArchivedAssetsCommand(mockPlugin, mockNotifier);
  });

  describe("id and name", () => {
    it("should have correct id and name", () => {
      expect(command.id).toBe("toggle-archived-assets-visibility");
      expect(command.name).toBe("Toggle archived assets visibility");
    });
  });

  describe("callback", () => {
    it("should toggle showArchivedAssets from false to true", async () => {
      mockPlugin.settings.showArchivedAssets = false;
      mockPlugin.saveSettings.mockResolvedValue();

      await command.callback();

      expect(mockPlugin.settings.showArchivedAssets).toBe(true);
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
      expect(mockPlugin.refreshLayout).toHaveBeenCalled();
      expect(mockNotifier.info).toHaveBeenCalledWith("Archived assets shown");
    });

    it("should toggle showArchivedAssets from true to false", async () => {
      mockPlugin.settings.showArchivedAssets = true;
      mockPlugin.saveSettings.mockResolvedValue();

      await command.callback();

      expect(mockPlugin.settings.showArchivedAssets).toBe(false);
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
      expect(mockPlugin.refreshLayout).toHaveBeenCalled();
      expect(mockNotifier.info).toHaveBeenCalledWith("Archived assets hidden");
    });

    it("should handle multiple toggles correctly", async () => {
      mockPlugin.settings.showArchivedAssets = false;
      mockPlugin.saveSettings.mockResolvedValue();

      // First toggle (false -> true)
      await command.callback();
      expect(mockPlugin.settings.showArchivedAssets).toBe(true);
      expect(mockNotifier.info).toHaveBeenNthCalledWith(1, "Archived assets shown");

      // Second toggle (true -> false)
      await command.callback();
      expect(mockPlugin.settings.showArchivedAssets).toBe(false);
      expect(mockNotifier.info).toHaveBeenNthCalledWith(2, "Archived assets hidden");

      // Third toggle (false -> true)
      await command.callback();
      expect(mockPlugin.settings.showArchivedAssets).toBe(true);
      expect(mockNotifier.info).toHaveBeenNthCalledWith(3, "Archived assets shown");

      expect(mockPlugin.saveSettings).toHaveBeenCalledTimes(3);
      expect(mockPlugin.refreshLayout).toHaveBeenCalledTimes(3);
    });

    it("should handle saveSettings errors gracefully", async () => {
      mockPlugin.settings.showArchivedAssets = false;
      const error = new Error("Failed to save settings");
      mockPlugin.saveSettings.mockRejectedValue(error);

      await expect(command.callback()).rejects.toThrow("Failed to save settings");

      // Settings should still be toggled even if save fails
      expect(mockPlugin.settings.showArchivedAssets).toBe(true);
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
      // refreshLayout should not be called if saveSettings fails
      expect(mockPlugin.refreshLayout).not.toHaveBeenCalled();
    });

    it("should handle missing refreshLayout gracefully", async () => {
      mockPlugin.settings.showArchivedAssets = false;
      mockPlugin.refreshLayout = undefined;
      mockPlugin.saveSettings.mockResolvedValue();

      await command.callback();

      expect(mockPlugin.settings.showArchivedAssets).toBe(true);
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
      expect(mockNotifier.info).toHaveBeenCalledWith("Archived assets shown");
      // Should not throw even if refreshLayout is undefined
    });

    it("should persist state across command instances", async () => {
      mockPlugin.settings.showArchivedAssets = false;
      mockPlugin.saveSettings.mockResolvedValue();

      // First command instance
      const command1 = new ToggleArchivedAssetsCommand(mockPlugin, mockNotifier);
      await command1.callback();
      expect(mockPlugin.settings.showArchivedAssets).toBe(true);

      // Second command instance should see the updated state
      const command2 = new ToggleArchivedAssetsCommand(mockPlugin, mockNotifier);
      await command2.callback();
      expect(mockPlugin.settings.showArchivedAssets).toBe(false);
    });

    it("should call refreshLayout if it exists", async () => {
      mockPlugin.settings.showArchivedAssets = false;
      mockPlugin.saveSettings.mockResolvedValue();
      const mockRefreshLayout = jest.fn();
      mockPlugin.refreshLayout = mockRefreshLayout;

      await command.callback();

      expect(mockRefreshLayout).toHaveBeenCalled();
    });

    it("should not throw if refreshLayout is null", async () => {
      mockPlugin.settings.showArchivedAssets = false;
      mockPlugin.saveSettings.mockResolvedValue();
      mockPlugin.refreshLayout = null;

      await command.callback();

      expect(mockPlugin.settings.showArchivedAssets).toBe(true);
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
      expect(mockNotifier.info).toHaveBeenCalledWith("Archived assets shown");
    });
  });
});