import type { App } from "obsidian";

import {
  FocusProfileSwitchManager,
  TS_FLOOR_ONTOLOGY_URIS,
  type IProfileResolver,
  type IRdfIndexer,
  type ISettingsStore,
  type ProfileResolution,
  type SwitchJournalEntry,
  type SwitchSettings,
} from "../../src/infrastructure/adapters/FocusProfileSwitchManager";
import { PluginLockManager } from "../../src/infrastructure/adapters/PluginLockManager";

// ─── Fake App / vault.adapter ────────────────────────────────────────────

interface FakeStore {
  files: Map<string, string>;
}

function makeFakeApp(): { app: App; store: FakeStore } {
  const files = new Map<string, string>();
  const app = {
    vault: {
      adapter: {
        exists: async (path: string) => files.has(path),
        read: async (path: string) => {
          const v = files.get(path);
          if (v === undefined) throw new Error(`ENOENT: ${path}`);
          return v;
        },
        write: async (path: string, data: string) => {
          files.set(path, data);
        },
        remove: async (path: string) => {
          files.delete(path);
        },
      },
    },
  } as unknown as App;
  return { app, store: { files } };
}

// ─── Fake IProfileResolver ───────────────────────────────────────────────

class FakeProfileResolver implements IProfileResolver {
  constructor(
    private readonly profiles: Map<string, ProfileResolution>,
    private readonly sharedOntologies: string[] = [],
  ) {}

  async resolve(uid: string): Promise<ProfileResolution | null> {
    return this.profiles.get(uid) ?? null;
  }

  async discoverSharedOntologies(): Promise<string[]> {
    return this.sharedOntologies;
  }
}

// ─── Fake IRdfIndexer ────────────────────────────────────────────────────

class FakeRdfIndexer implements IRdfIndexer {
  refreshCalls = 0;
  failOnce = false;

  async refresh(): Promise<void> {
    this.refreshCalls++;
    if (this.failOnce) {
      this.failOnce = false;
      throw new Error("Simulated re-index failure");
    }
  }
}

// ─── Fake ISettingsStore ─────────────────────────────────────────────────

class FakeSettingsStore implements ISettingsStore {
  state: SwitchSettings = { activeProfileUid: null, _switchInProgress: false };
  saveCalls: SwitchSettings[] = [];

  async load(): Promise<SwitchSettings> {
    return { ...this.state };
  }
  async save(s: SwitchSettings): Promise<void> {
    this.state = { ...s };
    this.saveCalls.push({ ...s });
  }
}

// ─── Test harness ────────────────────────────────────────────────────────

interface Harness {
  app: App;
  store: FakeStore;
  resolver: FakeProfileResolver;
  rdf: FakeRdfIndexer;
  settings: FakeSettingsStore;
  lockMgr: PluginLockManager;
  mgr: FocusProfileSwitchManager;
  notifyCalls: string[];
  clock: { current: Date; advance: (ms: number) => void };
}

function makeHarness(opts: {
  profiles: Array<[string, ProfileResolution]>;
  sharedOntologies?: string[];
}): Harness {
  const { app, store } = makeFakeApp();
  const profilesMap = new Map<string, ProfileResolution>(opts.profiles);
  const resolver = new FakeProfileResolver(profilesMap, opts.sharedOntologies);
  const rdf = new FakeRdfIndexer();
  const settings = new FakeSettingsStore();
  let current = new Date("2026-06-01T00:00:00.000Z");
  const clock = {
    get current(): Date {
      return current;
    },
    advance: (ms: number) => {
      current = new Date(current.getTime() + ms);
    },
  };
  const lockMgr = new PluginLockManager({ app, pid: "fixed-pid", now: () => current });
  const notifyCalls: string[] = [];
  const mgr = new FocusProfileSwitchManager({
    app,
    lockMgr,
    resolver,
    rdfIndexer: rdf,
    settingsStore: settings,
    now: () => current,
    notify: (m) => notifyCalls.push(m),
  });
  return { app, store, resolver, rdf, settings, lockMgr, mgr, notifyCalls, clock };
}

const UID_BASE = "ae00f219-base";
const UID_PERSONAL = "0a0791c1-personal";
const UID_READING = "8169cc07-reading";

const ONTO_EXO = "https://exocortex.my/ontology/exo";
const ONTO_EXOCMD = "https://exocortex.my/ontology/exocmd";
const ONTO_KITELEV = "https://exocortex.my/ontology/kitelev";
const ONTO_TBANK = "https://exocortex.my/ontology/tbank";

// ─── resolveEffectiveSet + TS-floor ──────────────────────────────────────

describe("FocusProfileSwitchManager.resolveEffectiveSet — TS-floor (Vision Lock #17)", () => {
  it("includes TS-floor URIs even when profile has empty includes/overlay", async () => {
    const { mgr } = makeHarness({
      profiles: [
        [
          UID_BASE,
          {
            uid: UID_BASE,
            includes: [],
            extends: null,
            label: "profile-empty",
          },
        ],
      ],
    });
    const effective = await mgr.resolveEffectiveSet(UID_BASE);
    expect(effective.has(ONTO_EXO)).toBe(true);
    expect(effective.has(ONTO_EXOCMD)).toBe(true);
  });

  it("includes shared-identities pattern matches via discoverSharedOntologies", async () => {
    const { mgr } = makeHarness({
      profiles: [
        [
          UID_BASE,
          {
            uid: UID_BASE,
            includes: [],
            extends: null,
            label: "profile-empty",
          },
        ],
      ],
      sharedOntologies: [
        "https://exocortex.my/ontology/shared-identities",
        "https://exocortex.my/ontology/random-not-shared",
      ],
    });
    const effective = await mgr.resolveEffectiveSet(UID_BASE);
    expect(effective.has("https://exocortex.my/ontology/shared-identities")).toBe(true);
    expect(effective.has("https://exocortex.my/ontology/random-not-shared")).toBe(false);
  });

  it("preserves TS-floor URIs even if user tries to declare profile without them", async () => {
    // Pathological case: profile-empty has no overlay
    const { mgr } = makeHarness({
      profiles: [
        [
          UID_BASE,
          { uid: UID_BASE, includes: [], extends: null },
        ],
      ],
    });
    const effective = await mgr.resolveEffectiveSet(UID_BASE);
    for (const floorUri of TS_FLOOR_ONTOLOGY_URIS) {
      expect(effective.has(floorUri)).toBe(true);
    }
  });
});

// ─── computeDerivedSet — inheritance ─────────────────────────────────────

describe("FocusProfileSwitchManager.computeDerivedSet — _extends chain", () => {
  it("walks _imports transitively and accumulates parent _includes", async () => {
    // RFC 01a83de8 Phase 2 — the derived set is the union of _includes along
    // the single-parent _imports chain (base's library AssetSpaces are
    // inherited by the child profile).
    const { mgr } = makeHarness({
      profiles: [
        [UID_BASE, {
          uid: UID_BASE,
          includes: [ONTO_EXO, ONTO_EXOCMD],
          extends: null,
          label: "profile-base",
        }],
        [UID_PERSONAL, {
          uid: UID_PERSONAL,
          includes: [ONTO_KITELEV],
          extends: UID_BASE,
          label: "profile-personal",
        }],
      ],
    });
    const derived = await mgr.computeDerivedSet(UID_PERSONAL);
    expect(derived.has(ONTO_KITELEV)).toBe(true);
    expect(derived.has(ONTO_EXO)).toBe(true);
    expect(derived.has(ONTO_EXOCMD)).toBe(true);
  });

  it("handles profile with no parent (extends=null)", async () => {
    const { mgr } = makeHarness({
      profiles: [
        [UID_BASE, {
          uid: UID_BASE,
          includes: [ONTO_KITELEV],
          extends: null,
        }],
      ],
    });
    const derived = await mgr.computeDerivedSet(UID_BASE);
    expect(derived.has(ONTO_KITELEV)).toBe(true);
    expect(derived.size).toBe(1);
  });

  it("handles missing parent (resolver returns null) without throw", async () => {
    const { mgr } = makeHarness({
      profiles: [
        [UID_PERSONAL, {
          uid: UID_PERSONAL,
          includes: [ONTO_KITELEV],
          extends: "no-such-uid",
        }],
      ],
    });
    const derived = await mgr.computeDerivedSet(UID_PERSONAL);
    expect(derived.has(ONTO_KITELEV)).toBe(true);
  });

  it("throws on _extends cycle (depth exceeds maxExtendsDepth)", async () => {
    // Each profile extends the next; with maxDepth=5 a chain of 7+ throws
    const profiles: Array<[string, ProfileResolution]> = [];
    for (let i = 0; i < 8; i++) {
      profiles.push([`p${i}`, {
        uid: `p${i}`,
        includes: [],
        extends: `p${i + 1}`,
      }]);
    }
    profiles.push([`p8`, {
      uid: "p8",
      includes: [],
      extends: "p0", // cycle back
    }]);
    const { mgr } = makeHarness({ profiles });
    await expect(mgr.computeDerivedSet("p0")).rejects.toThrow(/exceeds max depth/);
  });

  it("self-referencing _extends does not infinite-loop (cycle guard via visited)", async () => {
    const { mgr } = makeHarness({
      profiles: [
        [UID_BASE, {
          uid: UID_BASE,
          includes: [ONTO_KITELEV],
          extends: UID_BASE, // self
        }],
      ],
    });
    const derived = await mgr.computeDerivedSet(UID_BASE);
    expect(derived.has(ONTO_KITELEV)).toBe(true);
  });
});

// ─── switchProfile happy path ────────────────────────────────────────────

describe("FocusProfileSwitchManager.switchProfile — happy path", () => {
  it("persists settings BEFORE re-index (Architect #2 atomicity)", async () => {
    const h = makeHarness({
      profiles: [
        [UID_BASE, { uid: UID_BASE, includes: [ONTO_KITELEV], extends: null, label: "profile-base" }],
      ],
    });

    // Track order: save calls vs rdf.refresh calls
    const events: string[] = [];
    const origSave = h.settings.save.bind(h.settings);
    h.settings.save = async (s: SwitchSettings) => {
      events.push("save");
      await origSave(s);
    };
    const origRefresh = h.rdf.refresh.bind(h.rdf);
    h.rdf.refresh = async () => {
      events.push("refresh");
      await origRefresh();
    };

    await h.mgr.switchProfile(UID_BASE);

    // Expect: save (activeProfileUid + _switchInProgress=true), refresh, save (_switchInProgress=false)
    expect(events).toEqual(["save", "refresh", "save"]);
    expect(h.settings.state.activeProfileUid).toBe(UID_BASE);
    expect(h.settings.state._switchInProgress).toBe(false);
  });

  it("writes starting + completed journal entries", async () => {
    const h = makeHarness({
      profiles: [
        [UID_BASE, { uid: UID_BASE, includes: [], extends: null, label: "profile-base" }],
      ],
    });
    h.clock.advance(1000); // shift base
    await h.mgr.switchProfile(UID_BASE);

    const journalText = h.store.files.get(".exocortex/switch-journal.jsonl");
    expect(journalText).toBeDefined();
    const lines = journalText!.trim().split("\n").map((l) => JSON.parse(l) as SwitchJournalEntry);
    expect(lines).toHaveLength(2);
    expect(lines[0].phase).toBe("starting");
    expect(lines[1].phase).toBe("completed");
    expect(lines[1].elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("notifies user with profile label + elapsed ms", async () => {
    const h = makeHarness({
      profiles: [
        [UID_BASE, { uid: UID_BASE, includes: [], extends: null, label: "my-cool-profile" }],
      ],
    });
    await h.mgr.switchProfile(UID_BASE);
    expect(h.notifyCalls.length).toBe(1);
    expect(h.notifyCalls[0]).toContain("my-cool-profile");
    expect(h.notifyCalls[0]).toMatch(/\d+ms/);
  });

  it("invokes rdf.refresh once on soft switch (RFC 01a83de8 — soft-filter removed)", async () => {
    const h = makeHarness({
      profiles: [
        [UID_BASE, { uid: UID_BASE, includes: [ONTO_TBANK], extends: null }],
      ],
    });
    await h.mgr.switchProfile(UID_BASE);
    // The query-time soft-filter was removed (RFC 01a83de8 Phase 3 T3b); the
    // soft switch persists the active profile and triggers a single full-vault
    // reindex — no effective set is threaded through refresh anymore.
    expect(h.rdf.refreshCalls).toBe(1);
  });
});

// ─── switchProfile lock concurrency ──────────────────────────────────────

describe("FocusProfileSwitchManager.switchProfile — lock contention", () => {
  it("throws when lock already held by foreign holder", async () => {
    const h = makeHarness({
      profiles: [
        [UID_BASE, { uid: UID_BASE, includes: [], extends: null }],
      ],
    });
    // Acquire lock under a different pid
    const foreignLock = new PluginLockManager({ app: h.app, pid: "foreign-pid", now: () => h.clock.current });
    expect(await foreignLock.acquireLock("foreign-op")).toBe(true);

    await expect(h.mgr.switchProfile(UID_BASE)).rejects.toThrow(/lock held/);
  });

  it("releases lock on success", async () => {
    const h = makeHarness({
      profiles: [
        [UID_BASE, { uid: UID_BASE, includes: [], extends: null }],
      ],
    });
    await h.mgr.switchProfile(UID_BASE);
    // Lock file should be removed
    expect(h.store.files.has(".exocortex/switch-lock.json")).toBe(false);
  });

  it("releases lock on failure (re-index throws)", async () => {
    const h = makeHarness({
      profiles: [
        [UID_BASE, { uid: UID_BASE, includes: [], extends: null }],
      ],
    });
    h.rdf.failOnce = true;
    await expect(h.mgr.switchProfile(UID_BASE)).rejects.toThrow(/Simulated/);
    expect(h.store.files.has(".exocortex/switch-lock.json")).toBe(false);
  });
});

// ─── switchProfile failure journal ────────────────────────────────────────

describe("FocusProfileSwitchManager.switchProfile — failure path", () => {
  it("writes failed journal entry when re-index throws", async () => {
    const h = makeHarness({
      profiles: [
        [UID_BASE, { uid: UID_BASE, includes: [], extends: null }],
      ],
    });
    h.rdf.failOnce = true;
    await expect(h.mgr.switchProfile(UID_BASE)).rejects.toThrow();

    const journalText = h.store.files.get(".exocortex/switch-journal.jsonl");
    const lines = journalText!.trim().split("\n").map((l) => JSON.parse(l) as SwitchJournalEntry);
    // Expect: starting, failed (NOT completed)
    expect(lines.map((l) => l.phase)).toEqual(["starting", "failed"]);
  });

  it("leaves _switchInProgress=true when re-index throws (recoverable)", async () => {
    const h = makeHarness({
      profiles: [
        [UID_BASE, { uid: UID_BASE, includes: [], extends: null }],
      ],
    });
    h.rdf.failOnce = true;
    await expect(h.mgr.switchProfile(UID_BASE)).rejects.toThrow();
    expect(h.settings.state._switchInProgress).toBe(true);
  });

  it("redacts PAT-shaped tokens from error messages in journal", async () => {
    const h = makeHarness({
      profiles: [
        [UID_BASE, { uid: UID_BASE, includes: [], extends: null }],
      ],
    });
    h.rdf.refresh = async () => {
      throw new Error(`Auth failed: ghp_${"A".repeat(40)}`);
    };
    await expect(h.mgr.switchProfile(UID_BASE)).rejects.toThrow();

    const journalText = h.store.files.get(".exocortex/switch-journal.jsonl");
    const lines = journalText!.trim().split("\n").map((l) => JSON.parse(l) as SwitchJournalEntry);
    const failed = lines.find((l) => l.phase === "failed")!;
    expect(failed.error).toContain("***REDACTED***");
    expect(failed.error).not.toContain("ghp_AAAAAAAAA");
  });
});

// ─── recoverIfNeeded ──────────────────────────────────────────────────────

describe("FocusProfileSwitchManager.recoverIfNeeded", () => {
  it("returns {recovered:false} when no journal exists", async () => {
    const h = makeHarness({ profiles: [] });
    const res = await h.mgr.recoverIfNeeded();
    expect(res.recovered).toBe(false);
    expect(res.targetUid).toBeNull();
  });

  it("returns {recovered:false} when last journal entry is completed", async () => {
    const h = makeHarness({
      profiles: [
        [UID_BASE, { uid: UID_BASE, includes: [], extends: null }],
      ],
    });
    await h.mgr.switchProfile(UID_BASE);
    const res = await h.mgr.recoverIfNeeded();
    expect(res.recovered).toBe(false);
  });

  it("re-triggers switchProfile when last entry incomplete + _switchInProgress=true", async () => {
    const h = makeHarness({
      profiles: [
        [UID_BASE, { uid: UID_BASE, includes: [], extends: null }],
      ],
    });
    // Simulate crashed mid-switch: write only «starting» entry + set in-progress flag
    await h.app.vault.adapter.write(
      ".exocortex/switch-journal.jsonl",
      JSON.stringify({
        phase: "starting",
        targetUid: UID_BASE,
        ts: "2026-06-01T00:00:00.000Z",
      }) + "\n",
    );
    h.settings.state = { activeProfileUid: UID_BASE, _switchInProgress: true };

    const res = await h.mgr.recoverIfNeeded();
    expect(res.recovered).toBe(true);
    expect(res.targetUid).toBe(UID_BASE);
    expect(h.rdf.refreshCalls).toBe(1);
    expect(h.settings.state._switchInProgress).toBe(false);
  });

  it("does NOT recover when _switchInProgress=false even with incomplete journal", async () => {
    const h = makeHarness({
      profiles: [
        [UID_BASE, { uid: UID_BASE, includes: [], extends: null }],
      ],
    });
    await h.app.vault.adapter.write(
      ".exocortex/switch-journal.jsonl",
      JSON.stringify({ phase: "starting", targetUid: UID_BASE, ts: "..." }) + "\n",
    );
    // settings._switchInProgress is false (default)
    const res = await h.mgr.recoverIfNeeded();
    expect(res.recovered).toBe(false);
  });
});
