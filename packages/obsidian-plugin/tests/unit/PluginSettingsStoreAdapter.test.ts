import { PluginSettingsStoreAdapter } from "../../src/infrastructure/adapters/PluginSettingsStoreAdapter";

describe("PluginSettingsStoreAdapter", () => {
  it("throws when host is undefined", () => {
    expect(
      () => new PluginSettingsStoreAdapter(undefined as any),
    ).toThrow(/host is required/);
  });

  it("load defaults missing fields to null + false", async () => {
    const settings: Record<string, unknown> = {};
    const adapter = new PluginSettingsStoreAdapter({
      readSettings: () => settings,
      saveSettings: async () => {},
    });
    const s = await adapter.load();
    expect(s.activeProfileUid).toBeNull();
    expect(s._switchInProgress).toBe(false);
  });

  it("load returns existing values when present", async () => {
    const settings: Record<string, unknown> = {
      activeProfileUid: "p1",
      _switchInProgress: true,
    };
    const adapter = new PluginSettingsStoreAdapter({
      readSettings: () => settings,
      saveSettings: async () => {},
    });
    const s = await adapter.load();
    expect(s.activeProfileUid).toBe("p1");
    expect(s._switchInProgress).toBe(true);
  });

  it("save mutates the live settings object AND calls saveSettings", async () => {
    const settings: Record<string, unknown> = {
      activeProfileUid: null,
      _switchInProgress: false,
    };
    const saveSettings = jest.fn().mockResolvedValue(undefined);
    const adapter = new PluginSettingsStoreAdapter({
      readSettings: () => settings,
      saveSettings,
    });
    await adapter.save({ activeProfileUid: "p2", _switchInProgress: true });
    expect(settings.activeProfileUid).toBe("p2");
    expect(settings._switchInProgress).toBe(true);
    expect(saveSettings).toHaveBeenCalledTimes(1);
  });

  it("load coerces non-string activeProfileUid to null", async () => {
    const settings: Record<string, unknown> = { activeProfileUid: 42 };
    const adapter = new PluginSettingsStoreAdapter({
      readSettings: () => settings,
      saveSettings: async () => {},
    });
    expect((await adapter.load()).activeProfileUid).toBeNull();
  });

  it("load coerces non-boolean _switchInProgress to false", async () => {
    const settings: Record<string, unknown> = { _switchInProgress: "yes" };
    const adapter = new PluginSettingsStoreAdapter({
      readSettings: () => settings,
      saveSettings: async () => {},
    });
    expect((await adapter.load())._switchInProgress).toBe(false);
  });
});
