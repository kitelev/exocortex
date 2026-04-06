import { flushPromises } from "./helpers/testHelpers";
import { ReloadLayoutCommand } from "../../src/application/commands/ReloadLayoutCommand";

describe("ReloadLayoutCommand", () => {
  let command: ReloadLayoutCommand;
  let mockReloadLayoutCallback: jest.Mock;
  let mockNotifier: { info: jest.Mock; success: jest.Mock; error: jest.Mock; warn: jest.Mock; confirm: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    mockReloadLayoutCallback = jest.fn();
    mockNotifier = { info: jest.fn(), success: jest.fn(), error: jest.fn(), warn: jest.fn(), confirm: jest.fn() };
  });

  describe("id and name", () => {
    it("should have correct id and name", () => {
      command = new ReloadLayoutCommand(mockReloadLayoutCallback, mockNotifier);
      expect(command.id).toBe("reload-layout");
      expect(command.name).toBe("Reload layout");
    });
  });

  describe("callback", () => {
    it("should call reloadLayoutCallback and show success notice", () => {
      command = new ReloadLayoutCommand(mockReloadLayoutCallback, mockNotifier);

      command.callback();

      expect(mockReloadLayoutCallback).toHaveBeenCalled();
      expect(mockNotifier.success).toHaveBeenCalledWith("Layout reloaded");
    });

    it("should show failure notice when reloadLayoutCallback is undefined", () => {
      command = new ReloadLayoutCommand(undefined, mockNotifier);

      command.callback();

      expect(mockNotifier.error).toHaveBeenCalledWith("Failed to reload layout");
    });

    it("should show failure notice when reloadLayoutCallback is null", () => {
      command = new ReloadLayoutCommand(null as any, mockNotifier);

      command.callback();

      expect(mockNotifier.error).toHaveBeenCalledWith("Failed to reload layout");
    });

    it("should handle multiple calls correctly", () => {
      command = new ReloadLayoutCommand(mockReloadLayoutCallback, mockNotifier);

      command.callback();
      command.callback();
      command.callback();

      expect(mockReloadLayoutCallback).toHaveBeenCalledTimes(3);
      expect(mockNotifier.success).toHaveBeenCalledTimes(3);
      expect(mockNotifier.success).toHaveBeenCalledWith("Layout reloaded");
    });

    it("should handle callback that throws error", () => {
      const errorCallback = jest.fn(() => {
        throw new Error("Reload failed");
      });
      command = new ReloadLayoutCommand(errorCallback, mockNotifier);

      expect(() => command.callback()).toThrow("Reload failed");
      expect(errorCallback).toHaveBeenCalled();
      expect(mockNotifier.success).not.toHaveBeenCalled();
    });

    it("should work with async callback", () => {
      const asyncCallback = jest.fn(async () => {
        await flushPromises();
      });
      command = new ReloadLayoutCommand(asyncCallback, mockNotifier);

      command.callback();

      expect(asyncCallback).toHaveBeenCalled();
      expect(mockNotifier.success).toHaveBeenCalledWith("Layout reloaded");
    });

    it("should show failure notice when callback is empty string", () => {
      command = new ReloadLayoutCommand("" as any, mockNotifier);

      command.callback();

      expect(mockNotifier.error).toHaveBeenCalledWith("Failed to reload layout");
    });

    it("should show failure notice when callback is false", () => {
      command = new ReloadLayoutCommand(false as any, mockNotifier);

      command.callback();

      expect(mockNotifier.error).toHaveBeenCalledWith("Failed to reload layout");
    });
  });
});
