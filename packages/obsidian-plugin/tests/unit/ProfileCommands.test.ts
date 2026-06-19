import {
  ProfileCommands,
  type ProfileChoice,
  type ProfileCommandsDeps,
  type IAssetSpacePusher,
} from "../../src/infrastructure/adapters/ProfileCommands";
import {
  type ProfileApplyManager,
  ApplyAbortedByUser,
  TsFloorViolationError,
  UncommittedChangesAbortError,
} from "../../src/infrastructure/adapters/ProfileApplyManager";

// ─── Test doubles ────────────────────────────────────────────────────────

class FakeSwitchMgr {
  applyCalls: string[] = [];
  /** Error to throw from the next applyProfile call (then cleared). */
  applyThrows: Error | null = null;
  async applyProfile(uid: string): Promise<void> {
    this.applyCalls.push(uid);
    if (this.applyThrows) {
      const e = this.applyThrows;
      this.applyThrows = null;
      throw e;
    }
  }
}

class FakePushMgr implements IAssetSpacePusher {
  lookups = new Map<string, string | null>();
  pushedAs: string[] = [];
  pushReturn: string | null = "a".repeat(40);
  pushThrows: Error | null = null;

  lookupAssetSpaceForPath(folder: string): string | null {
    return this.lookups.get(folder) ?? null;
  }
  async pushAssetSpace(asUid: string): Promise<string> {
    this.pushedAs.push(asUid);
    if (this.pushThrows) throw this.pushThrows;
    return this.pushReturn ?? "";
  }
}

interface Harness {
  switchMgr: FakeSwitchMgr;
  pushMgr: FakePushMgr;
  notices: string[];
  pickCalls: {
    options: ProfileChoice[];
    title: string;
    initialQuery?: string;
  }[];
  fuzzyResult: ProfileChoice | null;
  activeFilePath: string | null;
  cmd: ProfileCommands;
}

function makeHarness(opts: {
  profiles: ProfileChoice[];
  pickResult?: ProfileChoice | null;
  activeFilePath?: string | null;
  asLookups?: Array<[string, string]>;
  listError?: Error;
  activeProfileUid?: string | null;
}): Harness {
  const switchMgr = new FakeSwitchMgr();
  const pushMgr = new FakePushMgr();
  if (opts.asLookups) {
    for (const [folder, uid] of opts.asLookups)
      pushMgr.lookups.set(folder, uid);
  }
  const notices: string[] = [];
  const pickCalls: {
    options: ProfileChoice[];
    title: string;
    initialQuery?: string;
  }[] = [];
  const deps: ProfileCommandsDeps = {
    switchMgr: switchMgr as unknown as ProfileApplyManager,
    pushMgr,
    profileLister: async () => {
      if (opts.listError) throw opts.listError;
      return opts.profiles;
    },
    fuzzyPick: async (options, title, initialQuery) => {
      pickCalls.push({ options, title, initialQuery });
      return opts.pickResult === undefined ? null : opts.pickResult;
    },
    getActiveFilePath: () => opts.activeFilePath ?? null,
    getActiveProfileUid: () => opts.activeProfileUid ?? null,
    notify: (m) => notices.push(m),
  };
  return {
    switchMgr,
    pushMgr,
    notices,
    pickCalls,
    fuzzyResult: opts.pickResult ?? null,
    activeFilePath: opts.activeFilePath ?? null,
    cmd: new ProfileCommands(deps),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// invokePushCurrentAssetSpace
// ═══════════════════════════════════════════════════════════════════════════

describe("ProfileCommands.invokePushCurrentAssetSpace", () => {
  it("Notice when no active file", async () => {
    const h = makeHarness({ profiles: [], activeFilePath: null });
    await h.cmd.invokePushCurrentAssetSpace();

    expect(h.pushMgr.pushedAs).toHaveLength(0);
    expect(h.notices.some((n) => /No active file/.test(n))).toBe(true);
  });

  it("Notice when active file outside assetspaces/", async () => {
    const h = makeHarness({
      profiles: [],
      activeFilePath: "03 Knowledge/inbox/random.md",
    });
    await h.cmd.invokePushCurrentAssetSpace();

    expect(h.pushMgr.pushedAs).toHaveLength(0);
    expect(h.notices.some((n) => /Not in an assetspace folder/.test(n))).toBe(
      true,
    );
  });

  it("Notice when folder is не declared AssetSpace ABox", async () => {
    const h = makeHarness({
      profiles: [],
      activeFilePath: "assetspaces/unknown/file.md",
      // no lookup entry for assetspaces/unknown
    });
    await h.cmd.invokePushCurrentAssetSpace();

    expect(h.pushMgr.pushedAs).toHaveLength(0);
    expect(h.notices.some((n) => /not declared as an AssetSpace/.test(n))).toBe(
      true,
    );
  });

  it("invokes pushAssetSpace and shows SHA Notice on success", async () => {
    const h = makeHarness({
      profiles: [],
      activeFilePath: "assetspaces/exo/foo.md",
      asLookups: [["assetspaces/exo", "as-uid-1"]],
    });
    h.pushMgr.pushReturn = "deadbeef00112233445566778899aabbccddeeff";

    await h.cmd.invokePushCurrentAssetSpace();

    expect(h.pushMgr.pushedAs).toEqual(["as-uid-1"]);
    expect(h.notices.some((n) => /deadbee/.test(n))).toBe(true);
  });

  it("does not emit duplicate Notice when push returns empty SHA (no dirty files)", async () => {
    const h = makeHarness({
      profiles: [],
      activeFilePath: "assetspaces/exo/foo.md",
      asLookups: [["assetspaces/exo", "as-uid-1"]],
    });
    h.pushMgr.pushReturn = "";

    await h.cmd.invokePushCurrentAssetSpace();

    // «Pushing…» Notice emitted before push, that's OK; final «Pushed → SHA» should NOT
    expect(h.notices.some((n) => /Pushed.*→/.test(n))).toBe(false);
  });

  it("surfaces pushAssetSpace failure as Notice без crash", async () => {
    const h = makeHarness({
      profiles: [],
      activeFilePath: "assetspaces/exo/foo.md",
      asLookups: [["assetspaces/exo", "as-uid-1"]],
    });
    h.pushMgr.pushThrows = new Error("rate limit guard hit");

    await expect(h.cmd.invokePushCurrentAssetSpace()).resolves.not.toThrow();
    expect(h.notices.some((n) => /Push failed.*rate limit/.test(n))).toBe(true);
  });

  it("#3557 — uses pushMgrFactory (current PAT) over the onload-captured pushMgr", async () => {
    // The onload-captured pushMgr froze with whatever PAT existed at load (empty
    // on a fresh vault). A PAT set after onload must authenticate the push
    // without a reload → the command rebuilds the pusher per invocation.
    const stale = new FakePushMgr(); // no lookup entry — would no-op if used
    const fresh = new FakePushMgr();
    fresh.lookups.set("assetspaces/exo", "as-uid-1");
    fresh.pushReturn = "feedface00112233445566778899aabbccddeeff";
    const notices: string[] = [];
    const cmd = new ProfileCommands({
      switchMgr: new FakeSwitchMgr() as unknown as ProfileApplyManager,
      pushMgr: stale,
      pushMgrFactory: async () => fresh,
      profileLister: async () => [],
      fuzzyPick: async () => null,
      getActiveFilePath: () => "assetspaces/exo/foo.md",
      getActiveProfileUid: () => null,
      notify: (m) => notices.push(m),
    });

    await cmd.invokePushCurrentAssetSpace();

    // The fresh (current-PAT) pusher handled the push; the stale onload one was
    // never touched. Pre-fix: stale.lookupAssetSpaceForPath → null → no-op.
    expect(fresh.pushedAs).toEqual(["as-uid-1"]);
    expect(stale.pushedAs).toHaveLength(0);
    expect(notices.some((n) => /feedfac/.test(n))).toBe(true);
  });

  it("#3557 — surfaces a Notice (no unhandled rejection) when pushMgrFactory rejects", async () => {
    const notices: string[] = [];
    const cmd = new ProfileCommands({
      switchMgr: new FakeSwitchMgr() as unknown as ProfileApplyManager,
      pushMgr: new FakePushMgr(),
      pushMgrFactory: async () => {
        throw new Error("PAT read failed");
      },
      profileLister: async () => [],
      fuzzyPick: async () => null,
      getActiveFilePath: () => "assetspaces/exo/foo.md",
      getActiveProfileUid: () => null,
      notify: (m) => notices.push(m),
    });

    // Fire-and-forget callsite — a factory rejection must degrade to a Notice,
    // not an unhandled promise rejection.
    await expect(cmd.invokePushCurrentAssetSpace()).resolves.not.toThrow();
    expect(notices.some((n) => /Push failed.*PAT read failed/.test(n))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// extractAssetSpaceFolder helper
// ═══════════════════════════════════════════════════════════════════════════

describe("ProfileCommands.extractAssetSpaceFolder", () => {
  it("extracts folder from typical path", () => {
    expect(
      ProfileCommands.extractAssetSpaceFolder("assetspaces/exo/foo.md"),
    ).toBe("assetspaces/exo");
  });

  it("extracts folder from deeply nested path", () => {
    expect(
      ProfileCommands.extractAssetSpaceFolder(
        "assetspaces/ems/sub/dir/bar.md",
      ),
    ).toBe("assetspaces/ems");
  });

  it("normalizes Windows backslash separators", () => {
    // Source `\\` = single backslash in actual string → regex /\\/ matches
    expect(
      ProfileCommands.extractAssetSpaceFolder(
        "assetspaces\\shared-identities\\file.md",
      ),
    ).toBe("assetspaces/shared-identities");
  });

  it("returns null for path outside assetspaces", () => {
    expect(
      ProfileCommands.extractAssetSpaceFolder(
        "03 Knowledge/inbox/note.md",
      ),
    ).toBeNull();
    expect(
      ProfileCommands.extractAssetSpaceFolder("inbox/note.md"),
    ).toBeNull();
  });

  it("returns null when assetspaces/ has no sub-folder", () => {
    expect(
      ProfileCommands.extractAssetSpaceFolder("assetspaces/loose.md"),
    ).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// invokeApplyProfile — «Apply profile» (RFC 0a0791c1 Phase 5 T2)
// ═══════════════════════════════════════════════════════════════════════════

describe("ProfileCommands.invokeApplyProfile (Apply profile)", () => {
  it("opens the picker from the single profile lister with the «Apply profile» title", async () => {
    const profiles = [{ uid: "k1", label: "knowledge-one" }];
    const h = makeHarness({ profiles, pickResult: profiles[0] });
    await h.cmd.invokeApplyProfile();

    expect(h.pickCalls).toHaveLength(1);
    expect(h.pickCalls[0].options).toEqual(profiles);
    expect(h.pickCalls[0].title).toBe("Apply profile");
    // No pre-narrowing when invoked normally (palette command).
    expect(h.pickCalls[0].initialQuery).toBeUndefined();
  });

  it("forwards an initialQuery to the picker (onboarding §3.1 step 3 — «starter»)", async () => {
    const profiles = [
      { uid: "k1", label: "knowledge-one" },
      { uid: "starter-uid", label: "starter" },
    ];
    const h = makeHarness({ profiles, pickResult: profiles[1] });
    await h.cmd.invokeApplyProfile("starter");

    expect(h.pickCalls).toHaveLength(1);
    expect(h.pickCalls[0].initialQuery).toBe("starter");
    // The full list is still passed — the query only pre-narrows.
    expect(h.pickCalls[0].options).toEqual(profiles);
    expect(h.switchMgr.applyCalls).toEqual(["starter-uid"]);
  });

  it("invokes applyProfile with the chosen uid", async () => {
    const profiles = [{ uid: "k1", label: "knowledge-one" }];
    const h = makeHarness({ profiles, pickResult: profiles[0] });
    await h.cmd.invokeApplyProfile();

    expect(h.switchMgr.applyCalls).toEqual(["k1"]);
  });

  it("shows Notice when no profiles in vault", async () => {
    const h = makeHarness({ profiles: [] });
    await h.cmd.invokeApplyProfile();

    expect(h.pickCalls).toHaveLength(0);
    expect(h.notices.some((n) => /No profiles found/.test(n))).toBe(true);
  });

  it("does nothing when user cancels picker", async () => {
    const profiles = [{ uid: "k1", label: "k1" }];
    const h = makeHarness({ profiles, pickResult: null });
    await h.cmd.invokeApplyProfile();

    expect(h.switchMgr.applyCalls).toHaveLength(0);
  });

  it("maps ApplyAbortedByUser to a cancelled Notice (no re-throw)", async () => {
    const profiles = [{ uid: "k1", label: "k1" }];
    const h = makeHarness({ profiles, pickResult: profiles[0] });
    h.switchMgr.applyThrows = new ApplyAbortedByUser();

    await expect(h.cmd.invokeApplyProfile()).resolves.not.toThrow();
    expect(h.notices.some((n) => /cancelled/i.test(n))).toBe(true);
  });

  it("maps TsFloorViolationError to a refused Notice", async () => {
    const profiles = [{ uid: "k1", label: "k1" }];
    const h = makeHarness({ profiles, pickResult: profiles[0] });
    h.switchMgr.applyThrows = new TsFloorViolationError(
      "missing $exo floor",
    );

    await h.cmd.invokeApplyProfile();
    expect(h.notices.some((n) => /refused.*missing \$exo floor/.test(n))).toBe(
      true,
    );
  });

  it("maps UncommittedChangesAbortError to an aborted Notice with file count", async () => {
    const profiles = [{ uid: "k1", label: "k1" }];
    const h = makeHarness({ profiles, pickResult: profiles[0] });
    h.switchMgr.applyThrows = new UncommittedChangesAbortError("dirty", [
      { asUid: "as1", submodulePath: "assetspaces/x", files: ["a.md", "b.md"] },
    ]);

    await h.cmd.invokeApplyProfile();
    expect(h.notices.some((n) => /aborted.*2 uncommitted file/.test(n))).toBe(
      true,
    );
  });

  it("surfaces generic apply failure as a Notice без re-throw", async () => {
    const profiles = [{ uid: "k1", label: "k1" }];
    const h = makeHarness({ profiles, pickResult: profiles[0] });
    h.switchMgr.applyThrows = new Error("boom");

    await expect(h.cmd.invokeApplyProfile()).resolves.not.toThrow();
    expect(h.notices.some((n) => /failed.*boom/.test(n))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// invokeShowCurrentState (RFC 0a0791c1 Phase 5 T2 — single slot)
// ═══════════════════════════════════════════════════════════════════════════

describe("ProfileCommands.invokeShowCurrentState", () => {
  it("reports the active profile label", async () => {
    const h = makeHarness({
      profiles: [{ uid: "k1", label: "knowledge-main" }],
      activeProfileUid: "k1",
    });
    await h.cmd.invokeShowCurrentState();

    expect(h.notices).toHaveLength(1);
    expect(h.notices[0]).toMatch(/Active profile: knowledge-main/);
  });

  it("shows (none) when no profile is applied", async () => {
    const h = makeHarness({ profiles: [], activeProfileUid: null });
    await h.cmd.invokeShowCurrentState();

    expect(h.notices[0]).toMatch(/Active profile: \(none\)/);
  });

  it("falls back to the raw UID when the label is not in the lister", async () => {
    const h = makeHarness({
      profiles: [{ uid: "other", label: "other" }],
      activeProfileUid: "k-missing",
    });
    await h.cmd.invokeShowCurrentState();

    expect(h.notices[0]).toMatch(/Active profile: k-missing/);
  });

  it("degrades to «(unknown)» when the lister throws (never crashes)", async () => {
    const h = makeHarness({
      profiles: [],
      listError: new Error("vault read failed"),
      activeProfileUid: "k1",
    });
    await expect(h.cmd.invokeShowCurrentState()).resolves.not.toThrow();
    expect(h.notices[0]).toMatch(/Active profile: k1 \(unknown\)/);
  });
});
