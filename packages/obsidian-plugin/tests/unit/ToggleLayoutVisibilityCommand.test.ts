import { ToggleLayoutVisibilityCommand } from "../../src/application/commands/ToggleLayoutVisibilityCommand";
import { Notice } from "obsidian";
import { ExocortexPluginInterface } from "../../src/types";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Notice: jest.fn(),
}));

describe("ToggleLayoutVisibilityCommand", () => {
  let command: ToggleLayoutVisibilityCommand;
  let mockNotifier: any;
  let mockPlugin: jest.Mocked<ExocortexPluginInterface>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock plugin
    mockPlugin = {
      settings: {
        layoutVisible: false,
      },
      saveSettings: jest.fn(),
      refreshLayout: jest.fn(),
    } as unknown as jest.Mocked<ExocortexPluginInterface>;

    // Create command instance
    mockNotifier = { info: jest.fn(), success: jest.fn(), error: jest.fn(), warn: jest.fn(), confirm: jest.fn() };
    command = new ToggleLayoutVisibilityCommand(mockPlugin, mockNotifier);
  });

  describe("id and name", () => {
    it("should have correct id and name", () => {
      expect(command.id).toBe("toggle-layout-visibility");
      expect(command.name).toBe("Toggle layout visibility");
    });
  });

  describe("callback", () => {
    it("should toggle layoutVisible from false to true", async () => {
      mockPlugin.settings.layoutVisible = false;
      mockPlugin.saveSettings.mockResolvedValue();

      await command.callback();

      expect(mockPlugin.settings.layoutVisible).toBe(true);
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
      expect(mockPlugin.refreshLayout).toHaveBeenCalled();
      expect(mockNotifier.info).toHaveBeenCalledWith("Layout shown");
    });

    it("should toggle layoutVisible from true to false", async () => {
      mockPlugin.settings.layoutVisible = true;
      mockPlugin.saveSettings.mockResolvedValue();

      await command.callback();

      expect(mockPlugin.settings.layoutVisible).toBe(false);
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
      expect(mockPlugin.refreshLayout).toHaveBeenCalled();
      expect(mockNotifier.info).toHaveBeenCalledWith("Layout hidden");
    });

    it("should handle multiple toggles correctly", async () => {
      mockPlugin.settings.layoutVisible = false;
      mockPlugin.saveSettings.mockResolvedValue();

      // First toggle (false -> true)
      await command.callback();
      expect(mockPlugin.settings.layoutVisible).toBe(true);
      expect(mockNotifier.info).toHaveBeenNthCalledWith(1, "Layout shown");

      // Second toggle (true -> false)
      await command.callback();
      expect(mockPlugin.settings.layoutVisible).toBe(false);
      expect(mockNotifier.info).toHaveBeenNthCalledWith(2, "Layout hidden");

      // Third toggle (false -> true)
      await command.callback();
      expect(mockPlugin.settings.layoutVisible).toBe(true);
      expect(mockNotifier.info).toHaveBeenNthCalledWith(3, "Layout shown");

      expect(mockPlugin.saveSettings).toHaveBeenCalledTimes(3);
      expect(mockPlugin.refreshLayout).toHaveBeenCalledTimes(3);
    });

    it("should handle saveSettings errors", async () => {
      mockPlugin.settings.layoutVisible = true;
      const error = new Error("Failed to save settings");
      mockPlugin.saveSettings.mockRejectedValue(error);

      await expect(command.callback()).rejects.toThrow("Failed to save settings");

      // Settings should still be toggled even if save fails
      expect(mockPlugin.settings.layoutVisible).toBe(false);
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
      // refreshLayout should not be called if saveSettings fails
      expect(mockPlugin.refreshLayout).not.toHaveBeenCalled();
    });

    it("should handle missing refreshLayout gracefully", async () => {
      mockPlugin.settings.layoutVisible = true;
      mockPlugin.refreshLayout = undefined;
      mockPlugin.saveSettings.mockResolvedValue();

      await command.callback();

      expect(mockPlugin.settings.layoutVisible).toBe(false);
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
      expect(mockNotifier.info).toHaveBeenCalledWith("Layout hidden");
      // Should not throw even if refreshLayout is undefined
    });

    it("should call refreshLayout if it exists", async () => {
      mockPlugin.settings.layoutVisible = false;
      mockPlugin.saveSettings.mockResolvedValue();
      const mockRefreshLayout = jest.fn();
      mockPlugin.refreshLayout = mockRefreshLayout;

      await command.callback();

      expect(mockRefreshLayout).toHaveBeenCalled();
    });

    it("should persist state across command instances", async () => {
      mockPlugin.settings.layoutVisible = true;
      mockPlugin.saveSettings.mockResolvedValue();

      // First command instance
      const command1 = new ToggleLayoutVisibilityCommand(mockPlugin, mockNotifier);
      await command1.callback();
      expect(mockPlugin.settings.layoutVisible).toBe(false);

      // Second command instance should see the updated state
      const command2 = new ToggleLayoutVisibilityCommand(mockPlugin, mockNotifier);
      await command2.callback();
      expect(mockPlugin.settings.layoutVisible).toBe(true);
    });

    it("should handle rapid consecutive toggles", async () => {
      mockPlugin.settings.layoutVisible = false;
      mockPlugin.saveSettings.mockResolvedValue();

      // Execute multiple toggles in rapid succession
      const promises = [
        command.callback(),
        command.callback(),
        command.callback(),
      ];

      await Promise.all(promises);

      // Final state depends on the number of toggles
      // Since they're synchronous toggles, odd number means true
      expect(mockPlugin.settings.layoutVisible).toBe(true);
      expect(mockPlugin.saveSettings).toHaveBeenCalledTimes(3);
    });
  });
});