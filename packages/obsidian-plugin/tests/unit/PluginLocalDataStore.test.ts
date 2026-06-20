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

describe("PluginLocalDataStore — file-only AssetSpace registry (AC10)", () => {
  const FILE_ONLY_ENTRY = {
    folderName: "assetspaces/exo",
    url: "https://github.com/kitelev/exoas-exo",
    sha: "abc1234",
    addedAt: "2026-06-05T00:00:00Z",
  };

  it("readFileOnlyAssetSpaces returns [] when absent", async () => {
    const { app } = makeFakeApp();
    const store = new PluginLocalDataStore({ app });
    expect(await store.readFileOnlyAssetSpaces()).toEqual([]);
  });

  it("upsert then read round-trips the entry", async () => {
    const { app } = makeFakeApp();
    const store = new PluginLocalDataStore({ app });
    await store.upsertFileOnlyAssetSpace(FILE_ONLY_ENTRY);
    expect(await store.readFileOnlyAssetSpaces()).toEqual([FILE_ONLY_ENTRY]);
  });

  it("upsert is idempotent on folderName (replaces, no duplicate)", async () => {
    const { app } = makeFakeApp();
    const store = new PluginLocalDataStore({ app });
    await store.upsertFileOnlyAssetSpace(FILE_ONLY_ENTRY);
    await store.upsertFileOnlyAssetSpace({
      ...FILE_ONLY_ENTRY,
      sha: "newsha7",
    });
    const all = await store.readFileOnlyAssetSpaces();
    expect(all).toHaveLength(1);
    expect(all[0].sha).toBe("newsha7");
  });

  it("preserves sibling keys (switch state / pat) via RMW", async () => {
    const { app, files } = makeFakeApp({
      [PATH]: JSON.stringify({
        activeProfileUid: "p-keep",
        pat: "ghp_keep",
      }),
    });
    const store = new PluginLocalDataStore({ app });
    await store.upsertFileOnlyAssetSpace(FILE_ONLY_ENTRY);
    const parsed = JSON.parse(files.get(PATH) ?? "{}");
    expect(parsed.activeProfileUid).toBe("p-keep");
    expect(parsed.pat).toBe("ghp_keep");
    expect(parsed._fileOnlyAssetSpaces).toHaveLength(1);
  });

  it("ignores malformed registry items", async () => {
    const { app } = makeFakeApp({
      [PATH]: JSON.stringify({
        _fileOnlyAssetSpaces: [
          { folderName: "assetspaces/exo" }, // missing fields
          FILE_ONLY_ENTRY,
          "garbage",
        ],
      }),
    });
    const store = new PluginLocalDataStore({ app });
    expect(await store.readFileOnlyAssetSpaces()).toEqual([FILE_ONLY_ENTRY]);
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

describe("PluginLocalDataStore — first-run onboarding flag (RFC 0002 §3.1)", () => {
  it("defaults to false when absent", async () => {
    const { app } = makeFakeApp();
    const store = new PluginLocalDataStore({ app });
    expect(await store.getOnboardingCompleted()).toBe(false);
  });

  it("set then read round-trips true", async () => {
    const { app } = makeFakeApp();
    const store = new PluginLocalDataStore({ app });
    await store.setOnboardingCompleted(true);
    expect(await store.getOnboardingCompleted()).toBe(true);
  });

  it("set false clears the flag", async () => {
    const { app } = makeFakeApp();
    const store = new PluginLocalDataStore({ app });
    await store.setOnboardingCompleted(true);
    await store.setOnboardingCompleted(false);
    expect(await store.getOnboardingCompleted()).toBe(false);
  });

  it("only `true` reads as completed (defensive against truthy junk)", async () => {
    const { app } = makeFakeApp({
      [PATH]: JSON.stringify({ onboardingCompleted: "yes" }),
    });
    const store = new PluginLocalDataStore({ app });
    expect(await store.getOnboardingCompleted()).toBe(false);
  });

  it("device-local: RMW preserves sibling keys (PAT, switch state)", async () => {
    const { app, files } = makeFakeApp({
      [PATH]: JSON.stringify({
        pat: "ghp_secret",
        activeProfileUid: "p-x",
        _switchInProgress: true,
      }),
    });
    const store = new PluginLocalDataStore({ app });
    await store.setOnboardingCompleted(true);

    const onDisk = JSON.parse(files.get(PATH) as string) as Record<
      string,
      unknown
    >;
    expect(onDisk.onboardingCompleted).toBe(true);
    // Sibling keys untouched (read-modify-write).
    expect(onDisk.pat).toBe("ghp_secret");
    expect(onDisk.activeProfileUid).toBe("p-x");
    expect(onDisk._switchInProgress).toBe(true);
  });

  it("a switch-state save() preserves the onboarding flag (disjoint namespace)", async () => {
    const { app } = makeFakeApp();
    const store = new PluginLocalDataStore({ app });
    await store.setOnboardingCompleted(true);
    // A later, unrelated switch-state write must not clobber the flag.
    await store.save({ activeProfileUid: "p-y", _switchInProgress: false });
    expect(await store.getOnboardingCompleted()).toBe(true);
  });
});

describe("PluginLocalDataStore — previousProfileUid (undo target, §3.10)", () => {
  it("init() with absent file → null undo target", async () => {
    const { app } = makeFakeApp();
    const store = new PluginLocalDataStore({ app });
    await store.init();
    expect(store.getPreviousProfileUid()).toBeNull();
  });

  it("reads previousProfileUid from data.local.json", async () => {
    const { app } = makeFakeApp({
      [PATH]: JSON.stringify({
        activeProfileUid: "p-active",
        previousProfileUid: "p-prev",
      }),
    });
    const store = new PluginLocalDataStore({ app });
    await store.init();
    expect(store.getActiveProfileUid()).toBe("p-active");
    expect(store.getPreviousProfileUid()).toBe("p-prev");
  });

  it("save() persists previousProfileUid when provided", async () => {
    const { app, files } = makeFakeApp();
    const store = new PluginLocalDataStore({ app });
    await store.init();
    await store.save({
      activeProfileUid: "p-active",
      previousProfileUid: "p-prev",
      _switchInProgress: false,
    });
    expect(store.getPreviousProfileUid()).toBe("p-prev");
    const parsed = JSON.parse(files.get(PATH) ?? "{}");
    expect(parsed.previousProfileUid).toBe("p-prev");
  });

  it("save() WITHOUT previousProfileUid preserves the persisted value (RMW)", async () => {
    const { app, files } = makeFakeApp({
      [PATH]: JSON.stringify({
        activeProfileUid: "p-old",
        previousProfileUid: "p-prev",
        pat: "ghp_keep",
      }),
    });
    const store = new PluginLocalDataStore({ app });
    await store.init();
    // Legacy-shaped save (active + in-progress only) must NOT clobber the undo
    // target — backward compatibility for every prior call site.
    await store.save({ activeProfileUid: "p-new", _switchInProgress: false });
    expect(store.getActiveProfileUid()).toBe("p-new");
    expect(store.getPreviousProfileUid()).toBe("p-prev");
    const parsed = JSON.parse(files.get(PATH) ?? "{}");
    expect(parsed.previousProfileUid).toBe("p-prev");
    expect(parsed.pat).toBe("ghp_keep");
  });

  it("save() can clear the undo target with explicit null", async () => {
    const { app } = makeFakeApp({
      [PATH]: JSON.stringify({ previousProfileUid: "p-prev" }),
    });
    const store = new PluginLocalDataStore({ app });
    await store.init();
    await store.save({
      activeProfileUid: "p-x",
      previousProfileUid: null,
      _switchInProgress: false,
    });
    expect(store.getPreviousProfileUid()).toBeNull();
  });

  it("getPreviousProfileUid throws before init()", () => {
    const { app } = makeFakeApp();
    const store = new PluginLocalDataStore({ app });
    expect(() => store.getPreviousProfileUid()).toThrow(
      /init\(\) must be awaited/,
    );
  });
});
