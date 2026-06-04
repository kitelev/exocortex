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

// ─── AC14 — dual Knowledge/Focus active slots ────────────────────────────

describe("PluginLocalDataStore — dual active slots (AC14)", () => {
  it("getters default to null on a fresh store", async () => {
    const { app } = makeFakeApp();
    const store = new PluginLocalDataStore({ app });
    await store.init();
    expect(store.getActiveKnowledgeProfileUid()).toBeNull();
    expect(store.getActiveFocusProfileUid()).toBeNull();
  });

  it("save persists both slots + round-trips through readFromDisk", async () => {
    const { app, files } = makeFakeApp();
    const store = new PluginLocalDataStore({ app });
    await store.init();
    await store.save({
      activeProfileUid: "k1",
      activeKnowledgeProfileUid: "k1",
      activeFocusProfileUid: "f1",
      _switchInProgress: false,
    });

    const parsed = JSON.parse(files.get(PATH) ?? "{}");
    expect(parsed.activeKnowledgeProfileUid).toBe("k1");
    expect(parsed.activeFocusProfileUid).toBe("f1");
    expect(store.getActiveKnowledgeProfileUid()).toBe("k1");
    expect(store.getActiveFocusProfileUid()).toBe("f1");

    // Fresh store reads the persisted slots back.
    const reopened = new PluginLocalDataStore({ app });
    await reopened.init();
    expect(reopened.getActiveKnowledgeProfileUid()).toBe("k1");
    expect(reopened.getActiveFocusProfileUid()).toBe("f1");
  });

  it("save with only the Focus slot preserves the existing Knowledge slot (no clobber)", async () => {
    const { app, files } = makeFakeApp({
      [PATH]: JSON.stringify({
        activeProfileUid: "k1",
        activeKnowledgeProfileUid: "k1",
        activeFocusProfileUid: null,
        pat: "ghp_keep",
      }),
    });
    const store = new PluginLocalDataStore({ app });
    await store.init();
    // Pre-AC14-shaped write (Focus only, Knowledge omitted) must NOT wipe
    // the Knowledge slot.
    await store.save({
      activeProfileUid: "k1",
      activeFocusProfileUid: "f9",
      _switchInProgress: false,
    });

    const parsed = JSON.parse(files.get(PATH) ?? "{}");
    expect(parsed.activeKnowledgeProfileUid).toBe("k1"); // preserved via RMW
    expect(parsed.activeFocusProfileUid).toBe("f9");
    expect(parsed.pat).toBe("ghp_keep"); // unrelated sibling preserved
    expect(store.getActiveKnowledgeProfileUid()).toBe("k1");
    expect(store.getActiveFocusProfileUid()).toBe("f9");
  });

  it("save with omitted dual fields leaves both on-disk slots untouched (pre-AC14 caller)", async () => {
    const { app, files } = makeFakeApp({
      [PATH]: JSON.stringify({
        activeProfileUid: "p0",
        activeKnowledgeProfileUid: "k0",
        activeFocusProfileUid: "f0",
      }),
    });
    const store = new PluginLocalDataStore({ app });
    await store.init();
    await store.save({ activeProfileUid: "p1", _switchInProgress: true });

    const parsed = JSON.parse(files.get(PATH) ?? "{}");
    expect(parsed.activeProfileUid).toBe("p1");
    expect(parsed.activeKnowledgeProfileUid).toBe("k0"); // untouched
    expect(parsed.activeFocusProfileUid).toBe("f0"); // untouched
  });
});

// ─── AC14 — migrateToDualActiveState (R38, idempotency, EC1) ──────────────

describe("PluginLocalDataStore.migrateToDualActiveState", () => {
  it("fresh empty store → 'none', no file written, both slots null", async () => {
    const { app, files } = makeFakeApp();
    const store = new PluginLocalDataStore({ app });
    const outcome = await store.migrateToDualActiveState();
    expect(outcome).toBe("none");
    expect(store.getActiveKnowledgeProfileUid()).toBeNull();
    expect(store.getActiveFocusProfileUid()).toBeNull();
    expect(files.has(PATH)).toBe(false);
  });

  it("legacy present, no dual keys → 'migrated': Knowledge=legacy, Focus=null (R38)", async () => {
    const { app, files } = makeFakeApp({
      [PATH]: JSON.stringify({ activeProfileUid: "p-legacy" }),
    });
    const store = new PluginLocalDataStore({ app });
    const outcome = await store.migrateToDualActiveState();
    expect(outcome).toBe("migrated");
    expect(store.getActiveKnowledgeProfileUid()).toBe("p-legacy");
    // R38 — Focus is NEVER seeded from the legacy single slot.
    expect(store.getActiveFocusProfileUid()).toBeNull();
    // Legacy mirror retained for backward read / downgrade.
    expect(store.getActiveProfileUid()).toBe("p-legacy");

    const parsed = JSON.parse(files.get(PATH) ?? "{}");
    expect(parsed.activeKnowledgeProfileUid).toBe("p-legacy");
    expect(parsed.activeFocusProfileUid).toBeNull();
  });

  it("preserves the _switchInProgress flag while migrating", async () => {
    const { app } = makeFakeApp({
      [PATH]: JSON.stringify({
        activeProfileUid: "p-legacy",
        _switchInProgress: true,
      }),
    });
    const store = new PluginLocalDataStore({ app });
    const outcome = await store.migrateToDualActiveState();
    expect(outcome).toBe("migrated");
    expect(store.isSwitchInProgress()).toBe(true);
  });

  it("already-dual (Knowledge key present) → 'already-dual' no-op, Focus untouched", async () => {
    const { app, files } = makeFakeApp({
      [PATH]: JSON.stringify({
        activeProfileUid: "k1",
        activeKnowledgeProfileUid: "k1",
        activeFocusProfileUid: "f1",
      }),
    });
    const store = new PluginLocalDataStore({ app });
    const outcome = await store.migrateToDualActiveState();
    expect(outcome).toBe("already-dual");
    // Existing Focus selection must NOT be reseeded / wiped.
    expect(store.getActiveFocusProfileUid()).toBe("f1");
    expect(store.getActiveKnowledgeProfileUid()).toBe("k1");
    const parsed = JSON.parse(files.get(PATH) ?? "{}");
    expect(parsed.activeFocusProfileUid).toBe("f1");
  });

  it("already-dual detection works even when Knowledge slot is null (only Focus set)", async () => {
    const { app } = makeFakeApp({
      [PATH]: JSON.stringify({
        activeProfileUid: "p-legacy",
        activeFocusProfileUid: "f-only",
      }),
    });
    const store = new PluginLocalDataStore({ app });
    const outcome = await store.migrateToDualActiveState();
    // The presence of the Focus key marks the dual shape — do NOT re-seed
    // Knowledge from the stale legacy value.
    expect(outcome).toBe("already-dual");
    expect(store.getActiveFocusProfileUid()).toBe("f-only");
    expect(store.getActiveKnowledgeProfileUid()).toBeNull();
  });

  it("is idempotent — second call is a no-op and does not change slots", async () => {
    const { app } = makeFakeApp({
      [PATH]: JSON.stringify({ activeProfileUid: "p-once" }),
    });
    const store = new PluginLocalDataStore({ app });
    const o1 = await store.migrateToDualActiveState();
    expect(o1).toBe("migrated");
    expect(store.getActiveKnowledgeProfileUid()).toBe("p-once");

    const o2 = await store.migrateToDualActiveState();
    expect(o2).toBe("already-dual");
    expect(store.getActiveKnowledgeProfileUid()).toBe("p-once");
    expect(store.getActiveFocusProfileUid()).toBeNull();
  });

  it("EC1 — resume after crash between legacy and dual migration completes the seed", async () => {
    // Simulate: migrateFromLegacyIfNeeded already moved settings → local
    // (data.local.json now has activeProfileUid) but the process crashed
    // before the dual migration ran. Disk has NO dual keys yet.
    const { app } = makeFakeApp();
    const store = new PluginLocalDataStore({ app });
    await store.migrateFromLegacyIfNeeded({
      activeProfileUid: "p-resume",
      _switchInProgress: false,
    });
    expect(store.getActiveProfileUid()).toBe("p-resume");
    expect(store.getActiveKnowledgeProfileUid()).toBeNull(); // not yet migrated

    // Next load resumes the dual migration on the same store.
    const outcome = await store.migrateToDualActiveState();
    expect(outcome).toBe("migrated");
    expect(store.getActiveKnowledgeProfileUid()).toBe("p-resume");
    expect(store.getActiveFocusProfileUid()).toBeNull();

    // And resuming again is a clean no-op.
    expect(await store.migrateToDualActiveState()).toBe("already-dual");
  });

  it("R38 — Mac/iPhone divergence: per-device stores migrate independently", async () => {
    // Two devices, two separate data.local.json files (Sync excludes them).
    // Both start with the same legacy selection synced earlier via plugin.settings.
    const mac = makeFakeApp({
      [PATH]: JSON.stringify({ activeProfileUid: "p-shared" }),
    });
    const iphone = makeFakeApp({
      [PATH]: JSON.stringify({ activeProfileUid: "p-shared" }),
    });
    const macStore = new PluginLocalDataStore({ app: mac.app });
    const iphoneStore = new PluginLocalDataStore({ app: iphone.app });

    expect(await macStore.migrateToDualActiveState()).toBe("migrated");
    expect(await iphoneStore.migrateToDualActiveState()).toBe("migrated");

    // Each device independently seeds Knowledge=legacy, Focus=null.
    expect(macStore.getActiveKnowledgeProfileUid()).toBe("p-shared");
    expect(macStore.getActiveFocusProfileUid()).toBeNull();
    expect(iphoneStore.getActiveKnowledgeProfileUid()).toBe("p-shared");
    expect(iphoneStore.getActiveFocusProfileUid()).toBeNull();

    // Mac picks a Focus profile; iPhone is unaffected (no cross-device leak).
    await macStore.save({
      activeProfileUid: "p-shared",
      activeKnowledgeProfileUid: "p-shared",
      activeFocusProfileUid: "f-mac-only",
      _switchInProgress: false,
    });
    expect(macStore.getActiveFocusProfileUid()).toBe("f-mac-only");

    // iPhone re-reads its own file — still no Focus selection.
    const iphoneReopened = new PluginLocalDataStore({ app: iphone.app });
    await iphoneReopened.init();
    expect(iphoneReopened.getActiveFocusProfileUid()).toBeNull();
    // iPhone's data.local.json carries an explicit null Focus slot (seeded by
    // its own migration) — never the Mac's "f-mac-only" value.
    expect(JSON.parse(iphone.files.get(PATH) ?? "{}").activeFocusProfileUid).toBeNull();
  });
});
