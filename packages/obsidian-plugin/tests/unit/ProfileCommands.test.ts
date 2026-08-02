import {
  ProfileCommands,
  SHOW_ALL_PROFILES_UID,
  type ProfileChoice,
  type ProfileCommandsDeps,
  type IAssetSpacePusher,
} from "../../src/infrastructure/adapters/ProfileCommands";
import {
  type ProfileApplyManager,
  ApplyAbortedByUser,
  NoPreviousProfileError,
  TsFloorViolationError,
  UncommittedChangesAbortError,
} from "../../src/infrastructure/adapters/ProfileApplyManager";

// ─── Test doubles ────────────────────────────────────────────────────────

class FakeSwitchMgr {
  applyCalls: string[] = [];
  undoCalls = 0;
  /** Error to throw from the next applyProfile call (then cleared). */
  applyThrows: Error | null = null;
  /** Error to throw from the next undoLastApply call (then cleared). */
  undoThrows: Error | null = null;
  async applyProfile(uid: string): Promise<void> {
    this.applyCalls.push(uid);
    if (this.applyThrows) {
      const e = this.applyThrows;
      this.applyThrows = null;
      throw e;
    }
  }
  async undoLastApply(): Promise<void> {
    this.undoCalls++;
    if (this.undoThrows) {
      const e = this.undoThrows;
      this.undoThrows = null;
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
  previousProfileUid?: string | null;
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
    getPreviousProfileUid: () => opts.previousProfileUid ?? null,
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
      getPreviousProfileUid: () => null,
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
      getPreviousProfileUid: () => null,
      notify: (m) => notices.push(m),
    });

    // Fire-and-forget callsite — a factory rejection must degrade to a Notice,
    // not an unhandled promise rejection.
    await expect(cmd.invokePushCurrentAssetSpace()).resolves.not.toThrow();
    expect(notices.some((n) => /Push failed.*PAT read failed/.test(n))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// invokePushCurrentAssetSpace — PAT push 403 after a green "Test connection"
// (RFC 0002 §3.10 / P15c)
// ═══════════════════════════════════════════════════════════════════════════

describe("ProfileCommands.invokePushCurrentAssetSpace — auth-failure (P15c)", () => {
  it("403 push (post green Test-connection) → explains scope/expiry, not opaque", async () => {
    const h = makeHarness({
      profiles: [],
      activeFilePath: "assetspaces/exo/foo.md",
      asLookups: [["assetspaces/exo", "as-uid-1"]],
    });
    // Transport error shape from GitHubRestClient: a write rejected for a
    // read-scoped (or expired) token.
    h.pushMgr.pushThrows = new Error(
      "GitHub request POST https://api.github.com/repos/u/exoas-x/git/commits → HTTP 403: Resource not accessible by personal access token",
    );

    await h.cmd.invokePushCurrentAssetSpace();

    const notice = h.notices.find((n) => /Push failed/.test(n)) ?? "";
    // The explanatory message names the read/write scope gap + recovery path.
    expect(notice).toMatch(/Contents: Read and write/);
    expect(notice).toMatch(/Settings . GitHub PAT|GitHub PAT/);
    expect(notice).toMatch(/Test connection/);
  });

  it("401 push → same auth explanation", async () => {
    const h = makeHarness({
      profiles: [],
      activeFilePath: "assetspaces/exo/foo.md",
      asLookups: [["assetspaces/exo", "as-uid-1"]],
    });
    h.pushMgr.pushThrows = new Error(
      "GitHub request POST https://api.github.com/repos/u/exoas-x/git/refs → HTTP 401: Bad credentials",
    );
    await h.cmd.invokePushCurrentAssetSpace();
    expect(h.notices.some((n) => /Contents: Read and write/.test(n))).toBe(true);
  });

  it("non-auth push failure keeps the generic message (no false scope advice)", async () => {
    const h = makeHarness({
      profiles: [],
      activeFilePath: "assetspaces/exo/foo.md",
      asLookups: [["assetspaces/exo", "as-uid-1"]],
    });
    // 422 non-fast-forward is NOT an auth problem — must not get scope advice.
    h.pushMgr.pushThrows = new Error(
      "GitHub request PATCH https://api.github.com/repos/u/exoas-x/git/refs → HTTP 422: Update is not a fast forward",
    );
    await h.cmd.invokePushCurrentAssetSpace();
    const notice = h.notices.find((n) => /Push failed/.test(n)) ?? "";
    expect(notice).not.toMatch(/Contents: Read and write/);
    expect(notice).toMatch(/fast forward/);
  });

  it("403 rate-limit is throttling, not auth — generic message", async () => {
    const h = makeHarness({
      profiles: [],
      activeFilePath: "assetspaces/exo/foo.md",
      asLookups: [["assetspaces/exo", "as-uid-1"]],
    });
    h.pushMgr.pushThrows = new Error(
      "GitHub request POST https://api.github.com/... → HTTP 403: API rate limit exceeded",
    );
    await h.cmd.invokePushCurrentAssetSpace();
    expect(h.notices.some((n) => /Contents: Read and write/.test(n))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// invokeUndoLastApply (RFC 0002 §3.10 / P15a)
// ═══════════════════════════════════════════════════════════════════════════

describe("ProfileCommands.invokeUndoLastApply", () => {
  it("no previous profile → friendly notice, no undo call", async () => {
    const h = makeHarness({ profiles: [], previousProfileUid: null });
    await h.cmd.invokeUndoLastApply();
    expect(h.switchMgr.undoCalls).toBe(0);
    expect(h.notices.some((n) => /Nothing to undo/.test(n))).toBe(true);
  });

  it("previous profile set → reverts + 'Reverting to <label>…' notice", async () => {
    const h = makeHarness({
      profiles: [{ uid: "prof-prev", label: "Personal" }],
      previousProfileUid: "prof-prev",
    });
    await h.cmd.invokeUndoLastApply();
    expect(h.switchMgr.undoCalls).toBe(1);
    expect(h.notices.some((n) => /Reverting to Personal/.test(n))).toBe(true);
  });

  it("undo cancelled (ApplyAbortedByUser) → 'Undo cancelled.'", async () => {
    const h = makeHarness({
      profiles: [{ uid: "prof-prev", label: "Personal" }],
      previousProfileUid: "prof-prev",
    });
    h.switchMgr.undoThrows = new ApplyAbortedByUser();
    await h.cmd.invokeUndoLastApply();
    expect(h.notices.some((n) => /Undo cancelled/.test(n))).toBe(true);
  });

  it("undo TS-floor refusal → distinct notice", async () => {
    const h = makeHarness({
      profiles: [{ uid: "prof-prev", label: "Personal" }],
      previousProfileUid: "prof-prev",
    });
    h.switchMgr.undoThrows = new TsFloorViolationError("floor brick");
    await h.cmd.invokeUndoLastApply();
    expect(h.notices.some((n) => /Undo refused/.test(n))).toBe(true);
  });

  it("undo uncommitted abort → actionable notice", async () => {
    const h = makeHarness({
      profiles: [{ uid: "prof-prev", label: "Personal" }],
      previousProfileUid: "prof-prev",
    });
    h.switchMgr.undoThrows = new UncommittedChangesAbortError("dirty", [
      { asUid: "x", submodulePath: "assetspaces/x", files: ["a.md", "b.md"] },
    ]);
    await h.cmd.invokeUndoLastApply();
    expect(h.notices.some((n) => /Undo aborted.*uncommitted/.test(n))).toBe(true);
  });

  it("generic undo failure → 'Undo failed: …'", async () => {
    const h = makeHarness({
      profiles: [{ uid: "prof-prev", label: "Personal" }],
      previousProfileUid: "prof-prev",
    });
    h.switchMgr.undoThrows = new Error("boom");
    await h.cmd.invokeUndoLastApply();
    expect(h.notices.some((n) => /Undo failed: boom/.test(n))).toBe(true);
  });

  it("deleted previous profile (NoPreviousProfileError) → surfaces the specific reason", async () => {
    const h = makeHarness({
      profiles: [{ uid: "prof-prev", label: "Personal" }],
      previousProfileUid: "prof-prev",
    });
    // LOW #2 — undoLastApply pre-resolves and throws with a deleted-profile
    // message; the command surfaces it instead of a generic "not recorded".
    h.switchMgr.undoThrows = new NoPreviousProfileError(
      "the profile you'd revert to no longer exists in the vault",
    );
    await h.cmd.invokeUndoLastApply();
    expect(
      h.notices.some((n) => /Nothing to undo — the profile you'd revert to no longer exists/.test(n)),
    ).toBe(true);
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
// invokeApplyProfile — user-scope (RFC 0002 §3.4 P7b «Show all profiles»)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Harness with a queued fuzzyPick so a test can script the show-all → re-open
 * sequence (first call returns the sentinel, second returns a real profile).
 */
function makeScopedHarness(
  profiles: ProfileChoice[],
  pickResults: (ProfileChoice | null)[],
  // req 38e2fdd5 — the quick-switch target (the profile active BEFORE the
  // current one). Defaults to null so every pre-existing caller keeps the
  // untouched, alphabetical picker order.
  previousProfileUid: string | null = null,
): {
  switchMgr: FakeSwitchMgr;
  notices: string[];
  pickCalls: { options: ProfileChoice[]; title: string; initialQuery?: string }[];
  cmd: ProfileCommands;
} {
  const switchMgr = new FakeSwitchMgr();
  const notices: string[] = [];
  const pickCalls: {
    options: ProfileChoice[];
    title: string;
    initialQuery?: string;
  }[] = [];
  let i = 0;
  const cmd = new ProfileCommands({
    switchMgr: switchMgr as unknown as ProfileApplyManager,
    pushMgr: new FakePushMgr(),
    profileLister: async () => profiles,
    fuzzyPick: async (options, title, initialQuery) => {
      pickCalls.push({ options, title, initialQuery });
      return pickResults[i++] ?? null;
    },
    getActiveFilePath: () => null,
    getActiveProfileUid: () => null,
    getPreviousProfileUid: () => previousProfileUid,
    notify: (m) => notices.push(m),
  });
  return { switchMgr, notices, pickCalls, cmd };
}

describe("ProfileCommands.invokeApplyProfile — user-scope (P7b)", () => {
  const RELEVANT: ProfileChoice = {
    uid: "rel",
    label: "$$kitelev-my",
    isLocallyRelevant: true,
  };
  const HIDDEN: ProfileChoice = {
    uid: "hid",
    label: "$$mudriy-tbank",
    isLocallyRelevant: false,
  };

  it("default picker shows only locally-relevant profiles + a «Show all» entry", async () => {
    const h = makeScopedHarness([RELEVANT, HIDDEN], [RELEVANT]);
    await h.cmd.invokeApplyProfile();

    const firstOptions = h.pickCalls[0].options;
    // Relevant profile present; hidden one NOT in the default view.
    expect(firstOptions.some((o) => o.uid === "rel")).toBe(true);
    expect(firstOptions.some((o) => o.uid === "hid")).toBe(false);
    // A «Show all profiles…» sentinel is appended (because one is hidden).
    const sentinel = firstOptions.find((o) => o.kind === "show-all");
    expect(sentinel?.uid).toBe(SHOW_ALL_PROFILES_UID);
    expect(sentinel?.label).toMatch(/Show all profiles.*1 more/);
    // Chose the relevant one → applied.
    expect(h.switchMgr.applyCalls).toEqual(["rel"]);
  });

  it("selecting «Show all» re-opens the picker with EVERY profile, unscoped", async () => {
    const showAll: ProfileChoice = {
      uid: SHOW_ALL_PROFILES_UID,
      label: "Show all profiles… (1 more)",
      kind: "show-all",
    };
    const h = makeScopedHarness([RELEVANT, HIDDEN], [showAll, HIDDEN]);
    await h.cmd.invokeApplyProfile();

    expect(h.pickCalls).toHaveLength(2);
    // Second pick offers the FULL list (no sentinel, both profiles).
    const secondOptions = h.pickCalls[1].options;
    expect(secondOptions.map((o) => o.uid).sort()).toEqual(["hid", "rel"]);
    expect(secondOptions.some((o) => o.kind === "show-all")).toBe(false);
    expect(h.pickCalls[1].initialQuery).toBeUndefined();
    // The previously-hidden profile is now applicable.
    expect(h.switchMgr.applyCalls).toEqual(["hid"]);
  });

  it("never applies the «Show all» sentinel itself", async () => {
    const showAll: ProfileChoice = {
      uid: SHOW_ALL_PROFILES_UID,
      label: "Show all profiles…",
      kind: "show-all",
    };
    // User selects show-all, then cancels the unscoped picker.
    const h = makeScopedHarness([RELEVANT, HIDDEN], [showAll, null]);
    await h.cmd.invokeApplyProfile();

    expect(h.switchMgr.applyCalls).toHaveLength(0);
    expect(
      h.notices.some((n) => n.includes(SHOW_ALL_PROFILES_UID)),
    ).toBe(false);
  });

  it("no «Show all» entry when every profile is locally relevant", async () => {
    const h = makeScopedHarness([RELEVANT], [RELEVANT]);
    await h.cmd.invokeApplyProfile();

    expect(
      h.pickCalls[0].options.some((o) => o.kind === "show-all"),
    ).toBe(false);
  });

  it("fallback — shows ALL profiles directly when NONE is locally relevant (fresh vault)", async () => {
    const h = makeScopedHarness([HIDDEN], [HIDDEN]);
    await h.cmd.invokeApplyProfile();

    // No empty picker, no lone «Show all» — the single profile is shown.
    const opts = h.pickCalls[0].options;
    expect(opts.some((o) => o.kind === "show-all")).toBe(false);
    expect(opts.map((o) => o.uid)).toEqual(["hid"]);
    expect(h.switchMgr.applyCalls).toEqual(["hid"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// req 38e2fdd5 — quick-switch ordering IS WIRED into the picker
//
// The pure helper is unit-tested in domain/profile/quickSwitch.test.ts; these
// drive the REAL invokeApplyProfile so the ordering cannot ship inert.
// ═══════════════════════════════════════════════════════════════════════════

describe("ProfileCommands.invokeApplyProfile — quick-switch ordering (req 38e2fdd5)", () => {
  const PERSONAL: ProfileChoice = { uid: "personal", label: "Personal" };
  const READING: ProfileChoice = { uid: "reading", label: "Reading" };
  const WORK: ProfileChoice = { uid: "work", label: "Work" };

  it("@req:38e2fdd5-8768-4354-8cb8-f1c77856ddb8 offers the profile you came FROM as the picker's first row", async () => {
    const h = makeHarness({
      profiles: [PERSONAL, READING, WORK],
      pickResult: null, // cancel — we only care about what was OFFERED
      activeProfileUid: "personal",
      previousProfileUid: "work",
    });
    await h.cmd.invokeApplyProfile();

    expect(h.pickCalls[0].options.map((o) => o.uid)).toEqual([
      "work", // ← the switch-back target, one tap away
      "personal",
      "reading",
    ]);
  });

  it("zero-regression: with no previous profile the picker order is untouched", async () => {
    const h = makeHarness({
      profiles: [PERSONAL, READING, WORK],
      pickResult: null,
      activeProfileUid: "personal",
      previousProfileUid: null,
    });
    await h.cmd.invokeApplyProfile();

    expect(h.pickCalls[0].options.map((o) => o.uid)).toEqual([
      "personal",
      "reading",
      "work",
    ]);
  });

  it("the unscoped «Show all» re-open is ordered too, and the sentinel is never promoted", async () => {
    const relevant: ProfileChoice = {
      uid: "personal",
      label: "Personal",
      isLocallyRelevant: true,
    };
    const hidden: ProfileChoice = {
      uid: "work",
      label: "Work",
      isLocallyRelevant: false,
    };
    const showAll: ProfileChoice = {
      uid: SHOW_ALL_PROFILES_UID,
      label: "Show all profiles… (1 more)",
      kind: "show-all",
    };
    const h = makeScopedHarness([relevant, hidden], [showAll, null], "work");
    await h.cmd.invokeApplyProfile();

    // First (scoped) view: the previous profile is hidden here, so the order
    // stands and the sentinel keeps its appended position.
    expect(h.pickCalls[0].options[0]?.uid).toBe("personal");
    expect(
      h.pickCalls[0].options[h.pickCalls[0].options.length - 1]?.kind,
    ).toBe("show-all");
    // Second (unscoped) view: the previous profile is now present → promoted.
    expect(h.pickCalls[1].options.map((o) => o.uid)).toEqual([
      "work",
      "personal",
    ]);
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
