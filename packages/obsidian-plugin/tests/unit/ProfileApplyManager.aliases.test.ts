import type { App } from "obsidian";

import {
  ProfileApplyManager,
  type ProfileApplyManagerOptions,
  type IProfileResolver,
  type IRdfIndexer,
  type ISettingsStore,
  type ProfileResolution,
  type SwitchSettings,
} from "../../src/infrastructure/adapters/ProfileApplyManager";
import { PluginLockManager } from "../../src/infrastructure/adapters/PluginLockManager";

/**
 * RFC 0a0791c1 Phase 5 T2 — the soft RDF-filter path (the former public soft
 * method + its aliases) was removed; the deprecated `hardSwitchProfile` alias
 * was removed in Phase 5 T6. The mount-state apply path remains:
 *   - applyProfile  (destructive filesystem materialize)
 *
 * These tests verify the canonical mount path throws when its deps are not wired.
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
  mgr: ProfileApplyManager;
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
  const opts: ProfileApplyManagerOptions = {
    app,
    lockMgr,
    resolver,
    rdfIndexer: rdf,
    settingsStore: settings,
    now: () => current,
    notify: (m) => notifyCalls.push(m),
  };
  const mgr = new ProfileApplyManager(opts);
  return { mgr, rdf, settings, notifyCalls };
}

// ─── Canonical applyProfile (wiring assertion) ─────────────

describe("ProfileApplyManager.applyProfile (canonical)", () => {
  it("throws when apply dependencies are not wired (assertApplyDepsWired)", async () => {
    const h = makeHarness();
    await expect(h.mgr.applyProfile(UID_BASE)).rejects.toThrow(
      /applyProfile: dependencies not wired/,
    );
  });
});
