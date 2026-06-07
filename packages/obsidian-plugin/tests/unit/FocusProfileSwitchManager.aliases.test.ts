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
 * RFC 0a0791c1 Phase 5 T2 — the soft RDF-filter path (`softSwitchFocusProfile`
 * + `switchProfile` / `softSwitchProfile` aliases) was removed. The mount-state
 * apply path remains:
 *   - hardSwitchKnowledgeProfile  (destructive filesystem materialize)
 *   - hardSwitchProfile → hardSwitchKnowledgeProfile (deprecated alias, kept)
 *
 * These tests verify:
 *   1. the canonical mount path throws when its deps are not wired
 *   2. the deprecated `hardSwitchProfile` alias delegates to the canonical
 *      method (proven via spyOn — alias body MUST call canonical method)
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
  refreshCalls = 0;
  async refresh(): Promise<void> {
    this.refreshCalls++;
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

// ─── Deprecated alias delegation ─────────────────────────────────────────

describe("FocusProfileSwitchManager — deprecated hard alias delegates to canonical", () => {
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
