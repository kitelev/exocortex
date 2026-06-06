import type { App } from "obsidian";

import {
  FocusProfileSwitchManager,
  type IProfileResolver,
  type IRdfIndexer,
  type ISettingsStore,
  type ProfileResolution,
  type SwitchSettings,
} from "../../src/infrastructure/adapters/FocusProfileSwitchManager";
import { PluginLockManager } from "../../src/infrastructure/adapters/PluginLockManager";

/**
 * Soft-switch filter application after RFC 01a83de8 Phase 3 T4.
 *
 * The former AC16 Focus↔Knowledge compatibility check (RFC 13da049f Phase 6.5b)
 * was REMOVED: Phase 2 collapsed the two profile classes into one `exo__Profile`,
 * so there is no separate Knowledge profile to be (in)compatible with. The soft
 * switch now ALWAYS applies the target profile's narrowed effective set — no
 * compat downgrade to a no-filter (full-vault) view, no compatibility warning.
 * These tests pin that universal behaviour, including scenarios that previously
 * triggered the (now-deleted) no-filter fallback.
 */

// ─── Fakes ───────────────────────────────────────────────────────────────

function makeFakeApp(): { app: App; files: Map<string, string> } {
  const files = new Map<string, string>();
  const app = {
    vault: {
      adapter: {
        exists: async (p: string) => files.has(p),
        read: async (p: string) => {
          const v = files.get(p);
          if (v === undefined) throw new Error(`ENOENT: ${p}`);
          return v;
        },
        write: async (p: string, d: string) => {
          files.set(p, d);
        },
        remove: async (p: string) => {
          files.delete(p);
        },
      },
    },
  } as unknown as App;
  return { app, files };
}

class FakeProfileResolver implements IProfileResolver {
  constructor(
    private readonly profiles: Map<string, ProfileResolution>,
    private readonly throwForUids: Set<string> = new Set(),
  ) {}
  async resolve(uid: string): Promise<ProfileResolution | null> {
    if (this.throwForUids.has(uid)) throw new Error(`boom resolving ${uid}`);
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
  state: SwitchSettings;
  constructor(initial?: Partial<SwitchSettings>) {
    this.state = {
      activeProfileUid: null,
      _switchInProgress: false,
      ...initial,
    };
  }
  async load(): Promise<SwitchSettings> {
    return { ...this.state };
  }
  async save(s: SwitchSettings): Promise<void> {
    this.state = { ...s };
  }
}

const ONTO_EXO = "https://exocortex.my/ontology/exo";
const ONTO_KITELEV = "https://exocortex.my/ontology/kitelev";
const ONTO_TBANK = "https://exocortex.my/ontology/tbank";
const ONTO_PERSONAL = "https://exocortex.my/ontology/personal";

const FOCUS_F1 = "focus-1";
const KNOWLEDGE_K1 = "knowledge-1";
const KNOWLEDGE_K2 = "knowledge-2";
const KNOWLEDGE_EMPTY = "knowledge-empty";
const KNOWLEDGE_THROW = "knowledge-throw";

function makeMgr(opts: {
  profiles: Array<[string, ProfileResolution]>;
  settings?: Partial<SwitchSettings>;
  throwForUids?: string[];
}): {
  mgr: FocusProfileSwitchManager;
  rdf: FakeRdfIndexer;
  settings: FakeSettingsStore;
  notifyCalls: string[];
} {
  const { app } = makeFakeApp();
  const resolver = new FakeProfileResolver(
    new Map(opts.profiles),
    new Set(opts.throwForUids ?? []),
  );
  const rdf = new FakeRdfIndexer();
  const settings = new FakeSettingsStore(opts.settings);
  const now = new Date("2026-06-05T00:00:00.000Z");
  const lockMgr = new PluginLockManager({ app, pid: "pid", now: () => now });
  const notifyCalls: string[] = [];
  const mgr = new FocusProfileSwitchManager({
    app,
    lockMgr,
    resolver,
    rdfIndexer: rdf,
    settingsStore: settings,
    now: () => now,
    notify: (m) => notifyCalls.push(m),
  });
  return { mgr, rdf, settings, notifyCalls };
}

function profile(
  uid: string,
  fields: Partial<ProfileResolution>,
): [string, ProfileResolution] {
  return [
    uid,
    {
      uid,
      includes: [],
      extends: null,
      ...fields,
    },
  ];
}

describe("FocusProfileSwitchManager.softSwitchFocusProfile — filter application (T4: no compat downgrade)", () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("applies the target's narrowed filter (+ TS-floor) and emits the success Notice", async () => {
    const { mgr, rdf, notifyCalls } = makeMgr({
      profiles: [profile(FOCUS_F1, { includes: [ONTO_TBANK] })],
    });
    await expect(mgr.softSwitchFocusProfile(FOCUS_F1)).resolves.toBeUndefined();

    expect(rdf.refreshCalls).toHaveLength(1);
    const set = rdf.refreshCalls[0];
    expect(set.has(ONTO_TBANK)).toBe(true); // narrowed filter applied
    expect(set.has(ONTO_EXO)).toBe(true); // TS-floor
    expect(warnSpy).not.toHaveBeenCalled();
    expect(notifyCalls.some((n) => /Switched to/.test(n))).toBe(true);
  });

  it("STILL applies the filter when a prior active profile would have triggered the old no-filter fallback (compat removed)", async () => {
    // Pre-T4 this scenario (target _includes ⊄ active Knowledge set, plus an
    // _appliesTo mismatch + an active Knowledge slot) downgraded to a no-filter
    // (size 0) full-vault view with a warning. T4 removed that — the target's
    // filter is always applied, no warn, no "full vault" Notice.
    const { mgr, rdf, settings, notifyCalls } = makeMgr({
      profiles: [
        profile(FOCUS_F1, {
          includes: [ONTO_PERSONAL],
          appliesTo: KNOWLEDGE_K1,
        }),
        profile(KNOWLEDGE_K2, { includes: [ONTO_KITELEV] }),
      ],
      settings: { activeKnowledgeProfileUid: KNOWLEDGE_K2 },
    });
    await expect(mgr.softSwitchFocusProfile(FOCUS_F1)).resolves.toBeUndefined();

    expect(rdf.refreshCalls).toHaveLength(1);
    const set = rdf.refreshCalls[0];
    expect(set.has(ONTO_PERSONAL)).toBe(true); // narrowed filter applied, NOT empty
    expect(set.size).toBeGreaterThan(0);
    expect(warnSpy).not.toHaveBeenCalled(); // no compat warning
    expect(notifyCalls.some((n) => /full vault/i.test(n))).toBe(false);
    expect(notifyCalls.some((n) => /Switched to/.test(n))).toBe(true);
    // Focus selection persisted, flag cleared.
    expect(settings.state.activeFocusProfileUid).toBe(FOCUS_F1);
    expect(settings.state._switchInProgress).toBe(false);
  });

  it("applies the filter even when an EMPTY prior active profile is set (old EC3 no-filter removed)", async () => {
    const { mgr, rdf, notifyCalls } = makeMgr({
      profiles: [
        profile(FOCUS_F1, { includes: [ONTO_KITELEV] }),
        profile(KNOWLEDGE_EMPTY, { includes: [] }),
      ],
      settings: { activeKnowledgeProfileUid: KNOWLEDGE_EMPTY },
    });
    await mgr.softSwitchFocusProfile(FOCUS_F1);

    expect(rdf.refreshCalls[0].has(ONTO_KITELEV)).toBe(true);
    expect(rdf.refreshCalls[0].size).toBeGreaterThan(0); // applied, not no-filter
    expect(warnSpy).not.toHaveBeenCalled();
    expect(notifyCalls.some((n) => /full vault/i.test(n))).toBe(false);
  });

  it("never resolves the active-profile slot, so a resolver that throws on it is irrelevant", async () => {
    // The compat check used to resolve the active Knowledge profile (could
    // throw). That path is gone — the target's filter applies regardless.
    const { mgr, rdf } = makeMgr({
      profiles: [profile(FOCUS_F1, { includes: [ONTO_TBANK] })],
      settings: { activeKnowledgeProfileUid: KNOWLEDGE_THROW },
      throwForUids: [KNOWLEDGE_THROW],
    });
    await expect(mgr.softSwitchFocusProfile(FOCUS_F1)).resolves.toBeUndefined();
    expect(rdf.refreshCalls).toHaveLength(1);
    expect(rdf.refreshCalls[0].has(ONTO_TBANK)).toBe(true);
    expect(rdf.refreshCalls[0].size).toBeGreaterThan(0);
  });
});
