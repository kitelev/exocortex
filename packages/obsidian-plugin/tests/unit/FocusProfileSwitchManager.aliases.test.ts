import type { App } from "obsidian";

import {
  FocusProfileSwitchManager,
  type FocusProfileSwitchManagerOptions,
  type IProfileResolver,
  type IRdfIndexer,
  type ISettingsStore,
  type ProfileResolution,
  type SwitchSettings,
} from "../../src/infrastructure/adapters/FocusProfileSwitchManager";
import { PluginLockManager } from "../../src/infrastructure/adapters/PluginLockManager";

/**
 * AC15 (RFC 13da049f Phase 6.5b) — Knowledge/Focus method split.
 *
 * Canonical names:
 *   - softSwitchFocusProfile  (RDF query-time filter only)
 *   - hardSwitchKnowledgeProfile  (destructive filesystem materialize)
 *
 * Deprecated aliases (retained for backward compatibility):
 *   - switchProfile          → softSwitchFocusProfile
 *   - softSwitchProfile      → softSwitchFocusProfile
 *   - hardSwitchProfile      → hardSwitchKnowledgeProfile
 *
 * These tests verify:
 *   1. canonical methods perform the correct path
 *   2. each deprecated alias delegates to its canonical counterpart
 *      (proven via spyOn — alias body MUST call canonical method)
 */

// ─── Fakes ───────────────────────────────────────────────────────────────

function makeFakeApp(): { app: App; files: Map<string, string> } {
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
      getMarkdownFiles: () => [],
    },
    metadataCache: {
      getFileCache: () => null,
    },
  } as unknown as App;
  return { app, files };
}

class FakeProfileResolver implements IProfileResolver {
  constructor(private readonly profiles: Map<string, ProfileResolution>) {}
  async resolve(uid: string): Promise<ProfileResolution | null> {
    return this.profiles.get(uid) ?? null;
  }
  async discoverSharedOntologies(): Promise<string[]> {
    return [];
  }
}

class FakeRdfIndexer implements IRdfIndexer {
  refreshCalls: ReadonlySet<string>[] = [];
  async refresh(effectiveOntologies: ReadonlySet<string>): Promise<void> {
    this.refreshCalls.push(new Set(effectiveOntologies));
  }
}

class FakeSettingsStore implements ISettingsStore {
  state: SwitchSettings = { activeProfileUid: null, _switchInProgress: false };
  async load(): Promise<SwitchSettings> {
    return { ...this.state };
  }
  async save(s: SwitchSettings): Promise<void> {
    this.state = { ...s };
  }
}

interface Harness {
  mgr: FocusProfileSwitchManager;
  rdf: FakeRdfIndexer;
  settings: FakeSettingsStore;
  notifyCalls: string[];
}

const UID_BASE = "ae00f219-base";
const ONTO_EXO = "https://exocortex.my/ontology/exo";
const ONTO_EXOCMD = "https://exocortex.my/ontology/exocmd";
const ONTO_KITELEV = "https://exocortex.my/ontology/kitelev";

function makeHarness(): Harness {
  const { app } = makeFakeApp();
  const profiles = new Map<string, ProfileResolution>([
    [
      UID_BASE,
      {
        uid: UID_BASE,
        includes: [ONTO_KITELEV],
        extends: null,
        label: "profile-base",
      },
    ],
  ]);
  const resolver = new FakeProfileResolver(profiles);
  const rdf = new FakeRdfIndexer();
  const settings = new FakeSettingsStore();
  const current = new Date("2026-06-04T00:00:00.000Z");
  const lockMgr = new PluginLockManager({ app, pid: "fixed-pid", now: () => current });
  const notifyCalls: string[] = [];
  const opts: FocusProfileSwitchManagerOptions = {
    app,
    lockMgr,
    resolver,
    rdfIndexer: rdf,
    settingsStore: settings,
    now: () => current,
    notify: (m) => notifyCalls.push(m),
  };
  const mgr = new FocusProfileSwitchManager(opts);
  return { mgr, rdf, settings, notifyCalls };
}

// ─── Canonical softSwitchFocusProfile ────────────────────────────────────

describe("FocusProfileSwitchManager.softSwitchFocusProfile (canonical)", () => {
  it("performs the soft-switch path: persists activeProfileUid + triggers RDF refresh", async () => {
    const h = makeHarness();
    await h.mgr.softSwitchFocusProfile(UID_BASE);

    expect(h.settings.state.activeProfileUid).toBe(UID_BASE);
    expect(h.settings.state._switchInProgress).toBe(false);
    expect(h.rdf.refreshCalls).toHaveLength(1);

    const refreshed = h.rdf.refreshCalls[0];
    expect(refreshed.has(ONTO_KITELEV)).toBe(true);
    // TS-floor URIs always present
    expect(refreshed.has(ONTO_EXO)).toBe(true);
    expect(refreshed.has(ONTO_EXOCMD)).toBe(true);
  });

  it("emits a user-facing notice on success", async () => {
    const h = makeHarness();
    await h.mgr.softSwitchFocusProfile(UID_BASE);
    expect(h.notifyCalls).toHaveLength(1);
    expect(h.notifyCalls[0]).toContain("profile-base");
  });

  it("AC14 — persists the Focus slot (not the Knowledge slot)", async () => {
    const h = makeHarness();
    // Pretend a prior hard switch left a Knowledge selection in place.
    h.settings.state = {
      activeProfileUid: "k-prev",
      activeKnowledgeProfileUid: "k-prev",
      activeFocusProfileUid: null,
      _switchInProgress: false,
    };
    await h.mgr.softSwitchFocusProfile(UID_BASE);
    // Soft switch writes the Focus slot…
    expect(h.settings.state.activeFocusProfileUid).toBe(UID_BASE);
    // …and must NOT disturb the Knowledge slot.
    expect(h.settings.state.activeKnowledgeProfileUid).toBe("k-prev");
  });
});

// ─── Deprecated alias delegation ─────────────────────────────────────────

describe("FocusProfileSwitchManager — deprecated aliases delegate to canonical", () => {
  it("switchProfile delegates to softSwitchFocusProfile", async () => {
    const h = makeHarness();
    const spy = jest.spyOn(h.mgr, "softSwitchFocusProfile");
    await h.mgr.switchProfile(UID_BASE);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(UID_BASE);
    // And observable side-effect: same as canonical
    expect(h.settings.state.activeProfileUid).toBe(UID_BASE);
    expect(h.rdf.refreshCalls).toHaveLength(1);
  });

  it("softSwitchProfile delegates to softSwitchFocusProfile", async () => {
    const h = makeHarness();
    const spy = jest.spyOn(h.mgr, "softSwitchFocusProfile");
    await h.mgr.softSwitchProfile(UID_BASE);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(UID_BASE);
    expect(h.settings.state.activeProfileUid).toBe(UID_BASE);
    expect(h.rdf.refreshCalls).toHaveLength(1);
  });

  it("hardSwitchProfile delegates to hardSwitchKnowledgeProfile", async () => {
    const h = makeHarness();
    // Hard switch requires extra deps wired; without them, the canonical method
    // throws via assertHardSwitchWired(). What we verify here is that the alias
    // routes into the canonical method (not into soft-switch), so the very same
    // wiring error surfaces. Delegation proven by spy + identical throw signature.
    const spy = jest.spyOn(h.mgr, "hardSwitchKnowledgeProfile");
    await expect(h.mgr.hardSwitchProfile(UID_BASE)).rejects.toThrow(
      /dependencies not wired/,
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(UID_BASE);
  });
});

// ─── Canonical hardSwitchKnowledgeProfile (wiring assertion) ─────────────

describe("FocusProfileSwitchManager.hardSwitchKnowledgeProfile (canonical)", () => {
  it("throws when hard-switch dependencies are not wired (assertHardSwitchWired)", async () => {
    const h = makeHarness();
    await expect(h.mgr.hardSwitchKnowledgeProfile(UID_BASE)).rejects.toThrow(
      /hardSwitchKnowledgeProfile: dependencies not wired/,
    );
  });
});
