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
 * AC16 (RFC 13da049f Phase 6.5b) — soft-switch compatibility check.
 *
 * On incompatibility the switch must perform 4 measurable actions WITHOUT
 * throwing:
 *   1. console.warn with the violation message
 *   2. user-facing Notice
 *   3. RDF re-index with the no-filter set (empty)
 *   4. resolve successfully (no throw); the Focus selection is still persisted
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
const ONTO_EXOCMD = "https://exocortex.my/ontology/exocmd";
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
      alwaysOnOverlay: [],
      extends: null,
      ...fields,
    },
  ];
}

describe("FocusProfileSwitchManager.softSwitchFocusProfile — AC16 compat", () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("backward-compat: no active Knowledge + no _appliesTo → applies the Focus filter (no warn)", async () => {
    const { mgr, rdf, notifyCalls } = makeMgr({
      profiles: [profile(FOCUS_F1, { includes: [ONTO_TBANK] })],
      // no activeKnowledgeProfileUid set
    });
    await expect(mgr.softSwitchFocusProfile(FOCUS_F1)).resolves.toBeUndefined();

    expect(rdf.refreshCalls).toHaveLength(1);
    const set = rdf.refreshCalls[0];
    expect(set.has(ONTO_TBANK)).toBe(true); // narrowed filter applied
    expect(set.has(ONTO_EXO)).toBe(true); // TS-floor
    expect(warnSpy).not.toHaveBeenCalled();
    expect(notifyCalls.some((n) => /Switched to/.test(n))).toBe(true);
  });

  it("violation — _appliesTo mismatch → 4 actions (warn, Notice, no-filter, no throw)", async () => {
    const { mgr, rdf, settings, notifyCalls } = makeMgr({
      profiles: [
        profile(FOCUS_F1, {
          includes: [ONTO_KITELEV],
          appliesTo: KNOWLEDGE_K1,
        }),
        profile(KNOWLEDGE_K2, { includes: [ONTO_KITELEV] }),
      ],
      settings: { activeKnowledgeProfileUid: KNOWLEDGE_K2 },
    });

    // Action #4 — resolves successfully (no throw).
    await expect(mgr.softSwitchFocusProfile(FOCUS_F1)).resolves.toBeUndefined();

    // Action #1 — console.warn with compatibility message.
    expect(warnSpy).toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0][0])).toMatch(
      /applies-to mismatch|_appliesTo/,
    );
    // Action #2 — user-facing Notice.
    expect(notifyCalls.some((n) => /full vault/i.test(n))).toBe(true);
    // Action #3 — RDF re-index with empty (no-filter) set.
    expect(rdf.refreshCalls).toHaveLength(1);
    expect(rdf.refreshCalls[0].size).toBe(0);
    // Selection still persisted (Focus slot).
    expect(settings.state.activeFocusProfileUid).toBe(FOCUS_F1);
    expect(settings.state._switchInProgress).toBe(false);
    // No misleading «Switched to» success Notice.
    expect(notifyCalls.some((n) => /Switched to/.test(n))).toBe(false);
  });

  it("compatible — _appliesTo matches active Knowledge AND includes ⊆ effective → narrowed filter", async () => {
    const { mgr, rdf } = makeMgr({
      profiles: [
        profile(FOCUS_F1, {
          includes: [ONTO_KITELEV],
          appliesTo: KNOWLEDGE_K1,
        }),
        profile(KNOWLEDGE_K1, { includes: [ONTO_KITELEV, ONTO_TBANK] }),
      ],
      settings: { activeKnowledgeProfileUid: KNOWLEDGE_K1 },
    });
    await mgr.softSwitchFocusProfile(FOCUS_F1);

    expect(rdf.refreshCalls).toHaveLength(1);
    const set = rdf.refreshCalls[0];
    expect(set.has(ONTO_KITELEV)).toBe(true); // narrowed filter, not empty
    expect(set.size).toBeGreaterThan(0);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("violation — includes ⊄ active Knowledge effective set → no-filter", async () => {
    const { mgr, rdf, notifyCalls } = makeMgr({
      profiles: [
        // F1 references ONTO_PERSONAL which K1 does not provide.
        profile(FOCUS_F1, { includes: [ONTO_PERSONAL] }),
        profile(KNOWLEDGE_K1, { includes: [ONTO_KITELEV, ONTO_TBANK] }),
      ],
      settings: { activeKnowledgeProfileUid: KNOWLEDGE_K1 },
    });
    await mgr.softSwitchFocusProfile(FOCUS_F1);

    expect(rdf.refreshCalls[0].size).toBe(0); // no-filter
    expect(warnSpy).toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0][0])).toMatch(
      /subset violation|outside the active/,
    );
    expect(notifyCalls.some((n) => /full vault/i.test(n))).toBe(true);
  });

  it("compatible — includes references a TS-floor ontology even if Knowledge omits it", async () => {
    const { mgr, rdf } = makeMgr({
      profiles: [
        // F1 includes $exocmd (a TS-floor ontology) — always in effective set.
        profile(FOCUS_F1, { includes: [ONTO_EXOCMD] }),
        profile(KNOWLEDGE_K1, { includes: [ONTO_KITELEV] }),
      ],
      settings: { activeKnowledgeProfileUid: KNOWLEDGE_K1 },
    });
    await mgr.softSwitchFocusProfile(FOCUS_F1);

    expect(rdf.refreshCalls[0].size).toBeGreaterThan(0); // applied, not no-filter
  });

  it("EC3 — active Knowledge has empty effective set (not materialized) → no-filter", async () => {
    const { mgr, rdf, notifyCalls } = makeMgr({
      profiles: [
        profile(FOCUS_F1, { includes: [ONTO_KITELEV] }),
        // Empty Knowledge profile — derived set is empty.
        profile(KNOWLEDGE_EMPTY, { includes: [], alwaysOnOverlay: [] }),
      ],
      settings: { activeKnowledgeProfileUid: KNOWLEDGE_EMPTY },
    });
    await mgr.softSwitchFocusProfile(FOCUS_F1);

    expect(rdf.refreshCalls[0].size).toBe(0); // no-filter
    expect(warnSpy).toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0][0])).toMatch(
      /EC3|empty effective set|not materialised/,
    );
    expect(notifyCalls.some((n) => /full vault/i.test(n))).toBe(true);
  });

  it("never throws — compat evaluation error proceeds with the declared filter", async () => {
    const { mgr, rdf } = makeMgr({
      profiles: [profile(FOCUS_F1, { includes: [ONTO_TBANK] })],
      settings: { activeKnowledgeProfileUid: KNOWLEDGE_THROW },
      throwForUids: [KNOWLEDGE_THROW], // resolving the active Knowledge throws
    });
    // Must resolve (no throw) AND apply the declared filter (not no-filter).
    await expect(mgr.softSwitchFocusProfile(FOCUS_F1)).resolves.toBeUndefined();
    expect(rdf.refreshCalls).toHaveLength(1);
    expect(rdf.refreshCalls[0].has(ONTO_TBANK)).toBe(true);
    expect(rdf.refreshCalls[0].size).toBeGreaterThan(0);
  });
});
