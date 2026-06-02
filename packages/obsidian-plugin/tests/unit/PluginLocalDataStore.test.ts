import type { App } from "obsidian";
import { PluginLocalDataStore } from "../../src/infrastructure/adapters/PluginLocalDataStore";

function makeFakeApp(seed: Record<string, string> = {}): {
  app: App;
  files: Map<string, string>;
} {
  const files = new Map<string, string>(Object.entries(seed));
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

const PATH = ".obsidian/plugins/exocortex/data.local.json";

describe("PluginLocalDataStore — initialization", () => {
  it("init() with absent file → empty state", async () => {
    const { app } = makeFakeApp();
    const store = new PluginLocalDataStore({ app });
    await store.init();
    expect(store.getActiveProfileUid()).toBeNull();
    expect(store.isSwitchInProgress()).toBe(false);
  });

  it("init() reads existing data.local.json", async () => {
    const { app } = makeFakeApp({
      [PATH]: JSON.stringify({
        activeProfileUid: "p-x",
        _switchInProgress: true,
        pat: "ghp_secret",
      }),
    });
    const store = new PluginLocalDataStore({ app });
    await store.init();
    expect(store.getActiveProfileUid()).toBe("p-x");
    expect(store.isSwitchInProgress()).toBe(true);
  });

  it("init() tolerates corrupted JSON (returns empty state)", async () => {
    const { app } = makeFakeApp({ [PATH]: "<<not json>>" });
    const store = new PluginLocalDataStore({ app });
    await store.init();
    expect(store.getActiveProfileUid()).toBeNull();
    expect(store.isSwitchInProgress()).toBe(false);
  });

  it("sync accessors throw when init() not yet awaited", () => {
    const { app } = makeFakeApp();
    const store = new PluginLocalDataStore({ app });
    expect(() => store.getActiveProfileUid()).toThrow(
      /init\(\) must be awaited/,
    );
  });
});

describe("PluginLocalDataStore — save", () => {
  it("save persists to disk and updates the cache", async () => {
    const { app, files } = makeFakeApp();
    const store = new PluginLocalDataStore({ app });
    await store.init();
    await store.save({ activeProfileUid: "p-y", _switchInProgress: false });

    const parsed = JSON.parse(files.get(PATH) ?? "{}");
    expect(parsed.activeProfileUid).toBe("p-y");
    expect(parsed._switchInProgress).toBe(false);
    expect(store.getActiveProfileUid()).toBe("p-y");
  });

  it("save preserves unrelated keys (e.g. LocalSecretsStore pat)", async () => {
    const { app, files } = makeFakeApp({
      [PATH]: JSON.stringify({ pat: "ghp_secret-keep-me" }),
    });
    const store = new PluginLocalDataStore({ app });
    await store.init();
    await store.save({ activeProfileUid: "p-z", _switchInProgress: false });

    const parsed = JSON.parse(files.get(PATH) ?? "{}");
    expect(parsed.pat).toBe("ghp_secret-keep-me");
    expect(parsed.activeProfileUid).toBe("p-z");
  });
});

// ─── Migration matrix (advisor #3 — 4 scenarios) ─────────────────────────

describe("PluginLocalDataStore.migrateFromLegacyIfNeeded", () => {
  it("(1) fresh install — legacy and local both empty → 'none'", async () => {
    const { app, files } = makeFakeApp();
    const store = new PluginLocalDataStore({ app });
    const outcome = await store.migrateFromLegacyIfNeeded({});
    expect(outcome).toBe("none");
    expect(store.getActiveProfileUid()).toBeNull();
    expect(store.isSwitchInProgress()).toBe(false);
    // No file written — empty state is in-memory only.
    expect(files.has(PATH)).toBe(false);
  });

  it("(2) pre-upgrade user — legacy populated, local empty → 'legacy' (copy)", async () => {
    const { app, files } = makeFakeApp();
    const store = new PluginLocalDataStore({ app });
    const outcome = await store.migrateFromLegacyIfNeeded({
      activeProfileUid: "p-legacy",
      _switchInProgress: false,
    });
    expect(outcome).toBe("legacy");
    expect(store.getActiveProfileUid()).toBe("p-legacy");
    // File materialized.
    const parsed = JSON.parse(files.get(PATH) ?? "{}");
    expect(parsed.activeProfileUid).toBe("p-legacy");
  });

  it("(2b) pre-upgrade with _switchInProgress=true also migrates the flag", async () => {
    const { app } = makeFakeApp();
    const store = new PluginLocalDataStore({ app });
    const outcome = await store.migrateFromLegacyIfNeeded({
      activeProfileUid: null,
      _switchInProgress: true,
    });
    expect(outcome).toBe("legacy");
    expect(store.isSwitchInProgress()).toBe(true);
  });

  it("(3) already migrated — legacy empty, local populated → 'local' (no-op)", async () => {
    const { app, files } = makeFakeApp({
      [PATH]: JSON.stringify({ activeProfileUid: "p-local" }),
    });
    const store = new PluginLocalDataStore({ app });
    const outcome = await store.migrateFromLegacyIfNeeded({});
    expect(outcome).toBe("local");
    expect(store.getActiveProfileUid()).toBe("p-local");
    // No re-write — file content unchanged.
    const parsed = JSON.parse(files.get(PATH) ?? "{}");
    expect(parsed.activeProfileUid).toBe("p-local");
  });

  it("(4) stale-sync edge — legacy AND local populated → 'local' wins (idempotent)", async () => {
    const { app, files } = makeFakeApp({
      [PATH]: JSON.stringify({ activeProfileUid: "p-local-correct" }),
    });
    const store = new PluginLocalDataStore({ app });
    const outcome = await store.migrateFromLegacyIfNeeded({
      activeProfileUid: "p-legacy-stale",
      _switchInProgress: false,
    });
    expect(outcome).toBe("local");
    expect(store.getActiveProfileUid()).toBe("p-local-correct");
    // Local state preserved — stale legacy did NOT clobber.
    const parsed = JSON.parse(files.get(PATH) ?? "{}");
    expect(parsed.activeProfileUid).toBe("p-local-correct");
  });

  it("migration is idempotent — calling twice does not duplicate work", async () => {
    const { app } = makeFakeApp();
    const store = new PluginLocalDataStore({ app });
    const o1 = await store.migrateFromLegacyIfNeeded({
      activeProfileUid: "p-once",
      _switchInProgress: false,
    });
    expect(o1).toBe("legacy");
    // Second call sees local already populated.
    const o2 = await store.migrateFromLegacyIfNeeded({
      activeProfileUid: "p-once",
      _switchInProgress: false,
    });
    expect(o2).toBe("local");
    expect(store.getActiveProfileUid()).toBe("p-once");
  });
});
