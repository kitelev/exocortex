import {
  FocusProfileCommands,
  type FocusProfileChoice,
  type FocusProfileCommandsDeps,
  type IAssetSpacePusher,
} from "../../src/infrastructure/adapters/FocusProfileCommands";
import type { FocusProfileSwitchManager } from "../../src/infrastructure/adapters/FocusProfileSwitchManager";

// ─── Test doubles ────────────────────────────────────────────────────────

class FakeSwitchMgr {
  switchCalls: string[] = [];
  failOnce = false;
  async switchProfile(uid: string): Promise<void> {
    this.switchCalls.push(uid);
    if (this.failOnce) {
      this.failOnce = false;
      throw new Error("simulated switch failure");
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
  pickCalls: { options: FocusProfileChoice[]; title: string }[];
  fuzzyResult: FocusProfileChoice | null;
  activeFilePath: string | null;
  cmd: FocusProfileCommands;
}

function makeHarness(opts: {
  profiles: FocusProfileChoice[];
  pickResult?: FocusProfileChoice | null;
  activeFilePath?: string | null;
  asLookups?: Array<[string, string]>;
  listError?: Error;
}): Harness {
  const switchMgr = new FakeSwitchMgr();
  const pushMgr = new FakePushMgr();
  if (opts.asLookups) {
    for (const [folder, uid] of opts.asLookups) pushMgr.lookups.set(folder, uid);
  }
  const notices: string[] = [];
  const pickCalls: { options: FocusProfileChoice[]; title: string }[] = [];
  const deps: FocusProfileCommandsDeps = {
    switchMgr: switchMgr as unknown as FocusProfileSwitchManager,
    pushMgr,
    profileLister: async () => {
      if (opts.listError) throw opts.listError;
      return opts.profiles;
    },
    fuzzyPick: async (options, title) => {
      pickCalls.push({ options, title });
      return opts.pickResult === undefined ? null : opts.pickResult;
    },
    getActiveFilePath: () => opts.activeFilePath ?? null,
    notify: (m) => notices.push(m),
  };
  return {
    switchMgr,
    pushMgr,
    notices,
    pickCalls,
    fuzzyResult: opts.pickResult ?? null,
    activeFilePath: opts.activeFilePath ?? null,
    cmd: new FocusProfileCommands(deps),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// invokeSwitchProfile
// ═══════════════════════════════════════════════════════════════════════════

describe("FocusProfileCommands.invokeSwitchProfile", () => {
  it("opens fuzzy picker с listed profiles", async () => {
    const profiles = [
      { uid: "u1", label: "profile-base" },
      { uid: "u2", label: "profile-personal" },
    ];
    const h = makeHarness({ profiles, pickResult: profiles[1] });
    await h.cmd.invokeSwitchProfile();

    expect(h.pickCalls).toHaveLength(1);
    expect(h.pickCalls[0].options).toEqual(profiles);
    expect(h.pickCalls[0].title).toBe("Switch focus profile");
  });

  it("invokes switchMgr.switchProfile with chosen uid", async () => {
    const profiles = [{ uid: "u2", label: "profile-personal" }];
    const h = makeHarness({ profiles, pickResult: profiles[0] });
    await h.cmd.invokeSwitchProfile();

    expect(h.switchMgr.switchCalls).toEqual(["u2"]);
    expect(h.notices.some((n) => n.includes("profile-personal"))).toBe(true);
  });

  it("does nothing when user cancels picker (null)", async () => {
    const profiles = [{ uid: "u1", label: "p1" }];
    const h = makeHarness({ profiles, pickResult: null });
    await h.cmd.invokeSwitchProfile();

    expect(h.switchMgr.switchCalls).toHaveLength(0);
  });

  it("shows Notice when no FocusProfile assets in vault", async () => {
    const h = makeHarness({ profiles: [] });
    await h.cmd.invokeSwitchProfile();

    expect(h.pickCalls).toHaveLength(0);
    expect(h.notices.some((n) => /No FocusProfile/.test(n))).toBe(true);
  });

  it("surfaces lister error as Notice без crash", async () => {
    const h = makeHarness({
      profiles: [],
      listError: new Error("vault read failed"),
    });
    await h.cmd.invokeSwitchProfile();

    expect(h.pickCalls).toHaveLength(0);
    expect(h.notices.some((n) => /Could not list profiles.*vault read failed/.test(n))).toBe(true);
  });

  it("surfaces switchProfile failure as Notice без re-throw", async () => {
    const profiles = [{ uid: "u1", label: "p1" }];
    const h = makeHarness({ profiles, pickResult: profiles[0] });
    h.switchMgr.failOnce = true;

    await expect(h.cmd.invokeSwitchProfile()).resolves.not.toThrow();
    expect(h.notices.some((n) => /Switch failed.*simulated/.test(n))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// invokePushCurrentAssetSpace
// ═══════════════════════════════════════════════════════════════════════════

describe("FocusProfileCommands.invokePushCurrentAssetSpace", () => {
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
    expect(h.notices.some((n) => /Not in an assetspace folder/.test(n))).toBe(true);
  });

  it("Notice when folder is не declared AssetSpace ABox", async () => {
    const h = makeHarness({
      profiles: [],
      activeFilePath: "assetspaces/unknown/file.md",
      // no lookup entry for assetspaces/unknown
    });
    await h.cmd.invokePushCurrentAssetSpace();

    expect(h.pushMgr.pushedAs).toHaveLength(0);
    expect(h.notices.some((n) => /not declared as an AssetSpace/.test(n))).toBe(true);
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
});

// ═══════════════════════════════════════════════════════════════════════════
// extractAssetSpaceFolder helper
// ═══════════════════════════════════════════════════════════════════════════

describe("FocusProfileCommands.extractAssetSpaceFolder", () => {
  it("extracts folder from typical path", () => {
    expect(FocusProfileCommands.extractAssetSpaceFolder("assetspaces/exo/foo.md")).toBe("assetspaces/exo");
  });

  it("extracts folder from deeply nested path", () => {
    expect(FocusProfileCommands.extractAssetSpaceFolder("assetspaces/ems/sub/dir/bar.md")).toBe("assetspaces/ems");
  });

  it("normalizes Windows backslash separators", () => {
    // Source `\\` = single backslash in actual string → regex /\\/ matches
    expect(FocusProfileCommands.extractAssetSpaceFolder("assetspaces\\shared-identities\\file.md")).toBe("assetspaces/shared-identities");
  });

  it("returns null for path outside assetspaces", () => {
    expect(FocusProfileCommands.extractAssetSpaceFolder("03 Knowledge/inbox/note.md")).toBeNull();
    expect(FocusProfileCommands.extractAssetSpaceFolder("inbox/note.md")).toBeNull();
  });

  it("returns null when assetspaces/ has no sub-folder", () => {
    expect(FocusProfileCommands.extractAssetSpaceFolder("assetspaces/loose.md")).toBeNull();
  });
});
