import type { App } from "obsidian";
import { PluginSettingsStoreAdapter } from "../../src/infrastructure/adapters/PluginSettingsStoreAdapter";
import { PluginLocalDataStore } from "../../src/infrastructure/adapters/PluginLocalDataStore";

// ─── Real-shape fake App.vault.adapter ───────────────────────────────────

function makeFakeApp(): { app: App; files: Map<string, string> } {
  const files = new Map<string, string>();
  const app = {
    vault: {
      configDir: ".obsidian",
      adapter: {
        exists: async (p: string) => files.has(p),
        read: async (p: string) => {
          const v = files.get(p);
          if (v === undefined) throw new Error(`ENOENT: ${p}`);
          return v;
        },
        write: async (p: string, data: string) => {
          files.set(p, data);
        },
      },
    },
  } as unknown as App;
  return { app, files };
}

async function makeInitializedStore(app: App): Promise<PluginLocalDataStore> {
  const store = new PluginLocalDataStore({ app });
  await store.init();
  return store;
}

describe("PluginSettingsStoreAdapter (Issue #3327 Item #3 — device-local backing)", () => {
  it("throws when localDataStore is undefined", () => {
    expect(
      () => new PluginSettingsStoreAdapter(undefined as never),
    ).toThrow(/localDataStore is required/);
  });

  it("load returns defaults when localDataStore is empty", async () => {
    const { app } = makeFakeApp();
    const localStore = await makeInitializedStore(app);
    const adapter = new PluginSettingsStoreAdapter(localStore);
    const s = await adapter.load();
    expect(s.activeProfileUid).toBeNull();
    expect(s._switchInProgress).toBe(false);
  });

  it("load returns persisted values from localDataStore", async () => {
    const { app } = makeFakeApp();
    const localStore = await makeInitializedStore(app);
    await localStore.save({
      activeProfileUid: "p1",
      _switchInProgress: true,
    });
    const adapter = new PluginSettingsStoreAdapter(localStore);
    const s = await adapter.load();
    expect(s.activeProfileUid).toBe("p1");
    expect(s._switchInProgress).toBe(true);
  });

  it("save writes through to localDataStore (data.local.json)", async () => {
    const { app, files } = makeFakeApp();
    const localStore = await makeInitializedStore(app);
    const adapter = new PluginSettingsStoreAdapter(localStore);

    await adapter.save({ activeProfileUid: "p2", _switchInProgress: true });

    // File materialized at the expected device-local path.
    const path = ".obsidian/plugins/exocortex/data.local.json";
    expect(files.has(path)).toBe(true);
    const parsed = JSON.parse(files.get(path) ?? "{}");
    expect(parsed.activeProfileUid).toBe("p2");
    expect(parsed._switchInProgress).toBe(true);

    // Cache reflects the write (sync accessors stay in sync).
    expect(localStore.getActiveProfileUid()).toBe("p2");
    expect(localStore.isSwitchInProgress()).toBe(true);
  });

  // ─── AC14 — dual Knowledge/Focus slots through the adapter ──────────────

  it("load surfaces the dual Knowledge/Focus slots", async () => {
    const { app } = makeFakeApp();
    const localStore = await makeInitializedStore(app);
    await localStore.save({
      activeProfileUid: "k1",
      activeKnowledgeProfileUid: "k1",
      activeFocusProfileUid: "f1",
      _switchInProgress: false,
    });
    const adapter = new PluginSettingsStoreAdapter(localStore);
    const s = await adapter.load();
    expect(s.activeKnowledgeProfileUid).toBe("k1");
    expect(s.activeFocusProfileUid).toBe("f1");
  });

  it("save maps the Focus slot through to data.local.json", async () => {
    const { app, files } = makeFakeApp();
    const localStore = await makeInitializedStore(app);
    const adapter = new PluginSettingsStoreAdapter(localStore);

    await adapter.save({
      activeProfileUid: "f7",
      activeFocusProfileUid: "f7",
      _switchInProgress: false,
    });

    const parsed = JSON.parse(
      files.get(".obsidian/plugins/exocortex/data.local.json") ?? "{}",
    );
    expect(parsed.activeFocusProfileUid).toBe("f7");
    expect(localStore.getActiveFocusProfileUid()).toBe("f7");
  });

  it("save with the Focus slot preserves the Knowledge slot (soft switch must not wipe Knowledge)", async () => {
    const { app, files } = makeFakeApp();
    const localStore = await makeInitializedStore(app);
    // Knowledge was set earlier (e.g. by a prior hard switch).
    await localStore.save({
      activeProfileUid: "k1",
      activeKnowledgeProfileUid: "k1",
      activeFocusProfileUid: null,
      _switchInProgress: false,
    });
    const adapter = new PluginSettingsStoreAdapter(localStore);

    // A soft switch loads → sets Focus → saves. The adapter must preserve the
    // Knowledge slot it didn't touch.
    const settings = await adapter.load();
    settings.activeFocusProfileUid = "f2";
    await adapter.save(settings);

    const parsed = JSON.parse(
      files.get(".obsidian/plugins/exocortex/data.local.json") ?? "{}",
    );
    expect(parsed.activeKnowledgeProfileUid).toBe("k1"); // preserved
    expect(parsed.activeFocusProfileUid).toBe("f2");
  });
});
