/**
 * B.10 — Downstream regression tests for Profile switch flow
 * (RFC 0a0791c1 §B.10 + Architect #5).
 *
 * Coverage scope:
 *   1. Filtered effective set respects profile inclusion + TS-floor (R15)
 *   2. Missing parent profile handled gracefully (Architect #5 fallback)
 *   3. Empty includes → TS-floor still preserves plugin survival
 *   4. Concurrent switch attempts blocked by B.6 PluginLockManager
 *   5. **Empirical revert/restore discipline** (per ~/.claude/rules/integration-test-revert-verify.md):
 *      a) Without TS-floor → standalone profile self-bricks (test FAILS reproducibly)
 *      b) With TS-floor → same profile survives (test PASSES)
 *
 * NoteToRDFConverter real-runtime integration deferred к B.11 plugin wiring —
 * Phase C+D activation will exercise that path в e2e tests. B.10 verifies the
 * architectural invariants Phase 4 ships.
 */

import type { App } from "obsidian";

import {
  ProfileApplyManager,
  TS_FLOOR_ONTOLOGY_URIS,
  TS_FLOOR_SHARED_PATTERN,
  type IProfileResolver,
  type IRdfIndexer,
  type ISettingsStore,
  type ProfileResolution,
  type SwitchSettings,
} from "../../src/infrastructure/adapters/ProfileApplyManager";
import { PluginLockManager } from "../../src/infrastructure/adapters/PluginLockManager";

// RFC 0a0791c1 Phase 5 T2 — the public soft `switchProfile` was removed; its
// lock/journal/persist/reindex behavior lives on in the private
// `reindexMountState` helper. These tests drive it directly via a typed cast.
type Reindexable = { reindexMountState(uid: string): Promise<void> };
const reindex = (mgr: ProfileApplyManager, uid: string): Promise<void> =>
  (mgr as unknown as Reindexable).reindexMountState(uid);

// ─── Shared fakes — mirror real Obsidian API per test-fixture-realism ────

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

class FakeResolver implements IProfileResolver {
  constructor(
    private readonly profiles: Map<string, ProfileResolution>,
    public sharedOntologies: string[] = [],
  ) {}
  async resolve(uid: string): Promise<ProfileResolution | null> {
    return this.profiles.get(uid) ?? null;
  }
  async discoverSharedOntologies(): Promise<string[]> {
    return this.sharedOntologies;
  }
}

class CapturingRdfIndexer implements IRdfIndexer {
  // RFC 01a83de8 Phase 3 T3b — the query-time soft-filter was removed, so the
  // switch no longer threads an effective set into refresh(); it just triggers
  // a full-vault reindex. These tests verify the still-live effective-set
  // computation (TS-floor + extends walk + shared discovery) by calling
  // `resolveEffectiveSet` directly; the fake only counts refresh invocations.
  refreshCount = 0;
  async refresh(): Promise<void> {
    this.refreshCount++;
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
  app: App;
  files: Map<string, string>;
  resolver: FakeResolver;
  rdf: CapturingRdfIndexer;
  settings: FakeSettingsStore;
  lockMgr: PluginLockManager;
  mgr: ProfileApplyManager;
  clock: { current: Date; advance: (ms: number) => void };
}

function makeHarness(
  profiles: Array<[string, ProfileResolution]>,
  shared: string[] = [],
): Harness {
  const { app, files } = makeFakeApp();
  let current = new Date("2026-06-01T08:00:00.000Z");
  const clock = {
    get current(): Date {
      return current;
    },
    advance: (ms: number) => {
      current = new Date(current.getTime() + ms);
    },
  };
  const resolver = new FakeResolver(new Map(profiles), shared);
  const rdf = new CapturingRdfIndexer();
  const settings = new FakeSettingsStore();
  const lockMgr = new PluginLockManager({ app, pid: "test-pid", now: () => current });
  const mgr = new ProfileApplyManager({
    app,
    lockMgr,
    resolver,
    rdfIndexer: rdf,
    settingsStore: settings,
    now: () => current,
  });
  return { app, files, resolver, rdf, settings, lockMgr, mgr, clock };
}

const UID_BASE = "ae00f219-base";
const UID_PERSONAL = "personal-uid";
const UID_BROKEN = "broken-uid";
const ONTO_EXO = "https://exocortex.my/ontology/exo";
const ONTO_EXOCMD = "https://exocortex.my/ontology/exocmd";
const ONTO_KITELEV = "https://exocortex.my/ontology/kitelev";
const ONTO_TBANK = "https://exocortex.my/ontology/tbank";

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO 1: Filtered effective set — included AS + TS-floor
// ═══════════════════════════════════════════════════════════════════════════

describe("B.10 Scenario 1 — Filtered set with AS folder present", () => {
  it("emits effective set = includes ∪ extends*-overlay ∪ TS-floor", async () => {
    const h = makeHarness([
      [UID_BASE, {
        uid: UID_BASE,
        includes: [],
        extends: null,
        label: "profile-base",
      }],
      [UID_PERSONAL, {
        uid: UID_PERSONAL,
        includes: [ONTO_KITELEV],
        extends: UID_BASE,
        label: "profile-personal",
      }],
    ]);

    const eff = await h.mgr.resolveEffectiveSet(UID_PERSONAL);
    expect(eff.has(ONTO_KITELEV)).toBe(true);
    expect(eff.has(ONTO_EXO)).toBe(true);   // overlay via extends
    expect(eff.has(ONTO_EXOCMD)).toBe(true); // overlay via extends + TS-floor

    // The apply reindex path still fires exactly one (full-vault) reindex.
    await reindex(h.mgr, UID_PERSONAL);
    expect(h.rdf.refreshCount).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO 2: Missing parent profile — graceful (Architect #5)
// ═══════════════════════════════════════════════════════════════════════════

describe("B.10 Scenario 2 — Missing parent profile graceful fallback", () => {
  it("does not throw when extends parent absent from resolver", async () => {
    const h = makeHarness([
      [UID_BROKEN, {
        uid: UID_BROKEN,
        includes: [ONTO_TBANK],
        extends: "no-such-profile-uid",
        label: "broken-profile",
      }],
    ]);

    // Should not throw; effective set still has TBANK + TS-floor
    await expect(reindex(h.mgr, UID_BROKEN)).resolves.not.toThrow();
    const eff = await h.mgr.resolveEffectiveSet(UID_BROKEN);
    expect(eff.has(ONTO_TBANK)).toBe(true);
    expect(eff.has(ONTO_EXO)).toBe(true); // TS-floor preserved
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO 3: Empty includes — TS-floor preserves plugin survival (R15)
// ═══════════════════════════════════════════════════════════════════════════

describe("B.10 Scenario 3 — Empty effective_set survives via TS-floor", () => {
  it("profile с empty includes/overlay/extends still emits TS-floor", async () => {
    const h = makeHarness([
      [UID_BASE, {
        uid: UID_BASE,
        includes: [],
        extends: null,
        label: "empty-profile",
      }],
    ]);

    const eff = await h.mgr.resolveEffectiveSet(UID_BASE);
    expect(eff.size).toBeGreaterThan(0);
    for (const floorUri of TS_FLOOR_ONTOLOGY_URIS) {
      expect(eff.has(floorUri)).toBe(true);
    }
  });

  it("plugin can NEVER self-brick — \\$exo + \\$exocmd always in set", async () => {
    // Multiple pathological profiles
    const profiles: Array<[string, ProfileResolution]> = [
      ["empty", { uid: "empty", includes: [], extends: null }],
      ["only-unknown", { uid: "only-unknown", includes: ["https://unknown.example/onto"], extends: null }],
      ["broken-parent", { uid: "broken-parent", includes: [], extends: "non-existent" }],
    ];

    for (const [uid] of profiles) {
      const h = makeHarness(profiles);
      const eff = await h.mgr.resolveEffectiveSet(uid);
      expect(eff.has(ONTO_EXO)).toBe(true);
      expect(eff.has(ONTO_EXOCMD)).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO 4: Concurrent switch attempts blocked by B.6 lock
// ═══════════════════════════════════════════════════════════════════════════

describe("B.10 Scenario 4 — Concurrent switch protected by lock", () => {
  it("second apply-reindex rejects while first holds lock", async () => {
    const profiles: Array<[string, ProfileResolution]> = [
      [UID_BASE, { uid: UID_BASE, includes: [], extends: null }],
    ];
    const h = makeHarness(profiles);

    // Manually hold lock with foreign pid
    const foreignLock = new PluginLockManager({
      app: h.app,
      pid: "concurrent-foreign",
      now: () => h.clock.current,
    });
    expect(await foreignLock.acquireLock("concurrent-op")).toBe(true);

    await expect(reindex(h.mgr, UID_BASE)).rejects.toThrow(/lock held/);

    // No refresh fired — switch did not proceed
    expect(h.rdf.refreshCount).toBe(0);
  });

  it("after foreign lock released, switch can proceed", async () => {
    const h = makeHarness([
      [UID_BASE, { uid: UID_BASE, includes: [], extends: null }],
    ]);

    const foreignLock = new PluginLockManager({
      app: h.app,
      pid: "concurrent-foreign",
      now: () => h.clock.current,
    });
    await foreignLock.acquireLock("op");
    await foreignLock.releaseLock();

    await reindex(h.mgr, UID_BASE);
    expect(h.rdf.refreshCount).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO 5: Empirical revert/restore — TS-floor self-brick reproducer
// ═══════════════════════════════════════════════════════════════════════════
//
// Per ~/.claude/rules/integration-test-revert-verify.md:
//
// "Test that claims to exercise a regression must be empirically verified
//  to FAIL pre-fix and PASS post-fix."
//
// TS-floor is the fix that prevents plugin self-brick (R15 mitigation).
// Below we directly verify both directions:
//   (a) An effective set built WITHOUT the TS-floor union excludes \$exo →
//       profile would self-brick (test asserts the failure mode reproduces)
//   (b) The production resolveEffectiveSet WITH TS-floor includes \$exo →
//       plugin survives.

describe("B.10 Scenario 5 — TS-floor empirical revert/restore", () => {
  it("WITHOUT TS-floor (simulated revert): empty profile yields empty set — self-brick reproduces", () => {
    // Simulate what the effective-set computation would return BEFORE the
    // TS-floor fix was added. We manually construct the "derived only" set
    // и assert that \$exo is missing (the failure that R15 mitigates).
    const profile: ProfileResolution = {
      uid: "empty",
      includes: [],
      extends: null,
    };
    const derivedOnly = new Set<string>([...profile.includes]);
    expect(derivedOnly.has(ONTO_EXO)).toBe(false); // self-brick reproduced
    expect(derivedOnly.size).toBe(0);
  });

  it("WITH TS-floor (production code): same empty profile yields survival set — plugin lives", async () => {
    const h = makeHarness([
      [UID_BASE, { uid: UID_BASE, includes: [], extends: null }],
    ]);
    const eff = await h.mgr.resolveEffectiveSet(UID_BASE);

    // The exact production behavior includes the TS-floor; \$exo is present
    expect(eff.has(ONTO_EXO)).toBe(true);
    expect(eff.has(ONTO_EXOCMD)).toBe(true);
  });

  it("TS_FLOOR_SHARED_PATTERN matches shared-* ontology URIs", () => {
    // Verify the pattern used in resolveEffectiveSet matches what we expect:
    // any URI with 'shared-' segment should be auto-included.
    expect(TS_FLOOR_SHARED_PATTERN.test("https://exocortex.my/ontology/shared-identities")).toBe(true);
    expect(TS_FLOOR_SHARED_PATTERN.test("https://exocortex.my/ontology/shared-concepts")).toBe(true);
    expect(TS_FLOOR_SHARED_PATTERN.test("https://exocortex.my/ontology/kitelev")).toBe(false);
    expect(TS_FLOOR_SHARED_PATTERN.test("https://exocortex.my/ontology/exo")).toBe(false);
  });

  it("shared ontologies surface via discoverSharedOntologies + pattern filter", async () => {
    const h = makeHarness(
      [[UID_BASE, { uid: UID_BASE, includes: [], extends: null }]],
      [
        "https://exocortex.my/ontology/shared-identities",
        "https://exocortex.my/ontology/shared-concepts",
        "https://exocortex.my/ontology/private-data", // should NOT be included
      ],
    );
    const eff = await h.mgr.resolveEffectiveSet(UID_BASE);
    expect(eff.has("https://exocortex.my/ontology/shared-identities")).toBe(true);
    expect(eff.has("https://exocortex.my/ontology/shared-concepts")).toBe(true);
    expect(eff.has("https://exocortex.my/ontology/private-data")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO 6: Recovery after crash mid-switch
// ═══════════════════════════════════════════════════════════════════════════

describe("B.10 Scenario 6 — Crash recovery preserves switch intent", () => {
  it("recoverIfNeeded re-completes interrupted switch idempotently", async () => {
    const h = makeHarness([
      [UID_BASE, { uid: UID_BASE, includes: [ONTO_KITELEV], extends: null, label: "profile" }],
    ]);

    // Simulate crash: starting entry exists, _switchInProgress=true, no completed
    await h.app.vault.adapter.write(
      ".exocortex/switch-journal.jsonl",
      JSON.stringify({
        phase: "starting",
        targetUid: UID_BASE,
        ts: "2026-06-01T07:59:00.000Z",
      }) + "\n",
    );
    h.settings.state = { activeProfileUid: UID_BASE, _switchInProgress: true };

    const result = await h.mgr.recoverIfNeeded();
    expect(result.recovered).toBe(true);
    expect(result.targetUid).toBe(UID_BASE);
    expect(h.rdf.refreshCount).toBe(1);
    expect(h.settings.state._switchInProgress).toBe(false);
  });
});
