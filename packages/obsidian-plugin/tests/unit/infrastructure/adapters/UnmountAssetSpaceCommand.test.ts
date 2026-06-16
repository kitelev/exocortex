import {
  UnmountAssetSpaceCommand,
  type UnmountableAssetSpace,
  type UnmountAssetSpaceCommandDeps,
} from "../../../../src/infrastructure/adapters/UnmountAssetSpaceCommand";

/**
 * Unit tests for the «Exocortex: Unmount assetspace» palette command logic
 * (#e6b8827c). The handler is pure (no Obsidian) — every boundary is faked.
 *
 * The load-bearing behaviour is the TS-floor REFUSE (floor-policy A): selecting
 * a floor AssetSpace must NOT call `unmount`. The "floor pick → unmount NOT
 * called" test is the guard; deleting the `chosen.isFloor` branch in the handler
 * makes it FAIL (revert-verify).
 */

const EXO: UnmountableAssetSpace = {
  submodulePath: "assetspaces/kitelev/exoas-exo",
  url: "https://github.com/kitelev/exoas-exo",
  uid: "49fd2e56-4656-4ca7-a789-f472b16ea260",
  namespace: "exo",
  label: "exo",
  isFloor: true,
};

const PMBOK: UnmountableAssetSpace = {
  submodulePath: "assetspaces/kitelev/exoas-pmbok-ontology",
  url: "https://github.com/kitelev/exoas-pmbok-ontology",
  uid: "abc12345-0000-0000-0000-000000000000",
  namespace: "pmbok",
  label: "pmbok",
  isFloor: false,
};

interface Harness {
  cmd: UnmountAssetSpaceCommand;
  notices: string[];
  unmountCalls: string[];
  confirmCalls: string[];
  /** Mutable counter (object so closures + assertions share the live value). */
  state: { onUnmountedCalls: number; pickedTitle: string | null; pickedItems: UnmountableAssetSpace[] | null };
}

function makeHarness(opts: {
  mounted?: UnmountableAssetSpace[];
  listThrows?: boolean;
  /** submodulePath the fake picker returns, or null to simulate cancel. */
  pickPath?: string | null;
  confirm?: boolean;
  unmountThrows?: boolean;
}): Harness {
  const notices: string[] = [];
  const unmountCalls: string[] = [];
  const confirmCalls: string[] = [];
  const state = {
    onUnmountedCalls: 0,
    pickedTitle: null as string | null,
    pickedItems: null as UnmountableAssetSpace[] | null,
  };

  const mounted = opts.mounted ?? [];

  const deps: UnmountAssetSpaceCommandDeps = {
    listMounted: async () => {
      if (opts.listThrows) throw new Error("scan boom");
      return mounted;
    },
    fuzzyPick: async (items, title) => {
      state.pickedItems = items;
      state.pickedTitle = title;
      if (opts.pickPath === undefined || opts.pickPath === null) return null;
      return items.find((m) => m.submodulePath === opts.pickPath) ?? null;
    },
    confirm: async (message) => {
      confirmCalls.push(message);
      return opts.confirm ?? true;
    },
    unmount: async (submodulePath) => {
      unmountCalls.push(submodulePath);
      if (opts.unmountThrows) throw new Error("rmdir boom");
    },
    notify: (message) => notices.push(message),
    onUnmounted: async () => {
      state.onUnmountedCalls++;
    },
  };

  return {
    cmd: new UnmountAssetSpaceCommand(deps),
    notices,
    unmountCalls,
    confirmCalls,
    state,
  };
}

describe("UnmountAssetSpaceCommand", () => {
  it("no mounted AssetSpaces → notice, picker never opened", async () => {
    const h = makeHarness({ mounted: [] });
    await h.cmd.invokeUnmount();
    expect(h.notices).toEqual(["No mounted AssetSpaces to unmount."]);
    expect(h.state.pickedItems).toBeNull();
    expect(h.unmountCalls).toEqual([]);
  });

  it("listMounted throws → graceful error notice, no unmount", async () => {
    const h = makeHarness({ listThrows: true });
    await h.cmd.invokeUnmount();
    expect(h.notices[0]).toContain("could not list mounted AssetSpaces");
    expect(h.notices[0]).toContain("scan boom");
    expect(h.unmountCalls).toEqual([]);
  });

  it("non-floor pick + confirm → unmount called, success notice, re-index hook fired", async () => {
    const h = makeHarness({
      mounted: [EXO, PMBOK],
      pickPath: PMBOK.submodulePath,
      confirm: true,
    });
    await h.cmd.invokeUnmount();

    expect(h.unmountCalls).toEqual([PMBOK.submodulePath]);
    expect(h.confirmCalls).toHaveLength(1);
    expect(h.state.onUnmountedCalls).toBe(1);
    expect(h.notices.some((n) => n.includes("Unmounting pmbok"))).toBe(true);
    expect(h.notices.some((n) => n.includes("Unmounted pmbok"))).toBe(true);
    // The picker received ALL mounted (incl. floor) so the user sees full state.
    expect(h.state.pickedItems?.map((m) => m.submodulePath)).toEqual([
      EXO.submodulePath,
      PMBOK.submodulePath,
    ]);
    expect(h.state.pickedTitle).toBe("Unmount assetspace");
  });

  it("[floor-refuse] floor pick → REFUSED: no confirm, no unmount, no re-index", async () => {
    // Revert-verify: removing the `chosen.isFloor` guard in the handler makes
    // this fail (unmount would be called for exo → self-brick).
    const h = makeHarness({
      mounted: [EXO, PMBOK],
      pickPath: EXO.submodulePath,
      confirm: true,
    });
    await h.cmd.invokeUnmount();

    expect(h.unmountCalls).toEqual([]); // ← the guard
    expect(h.confirmCalls).toEqual([]); // refused before the confirm gate
    expect(h.state.onUnmountedCalls).toBe(0);
    const refusal = h.notices.find((n) => n.includes("refused"));
    expect(refusal).toBeDefined();
    expect(refusal).toContain("TS-floor");
    expect(refusal).toContain("exo");
  });

  it("cancelled picker (null) → no confirm, no unmount, no notice", async () => {
    const h = makeHarness({ mounted: [EXO, PMBOK], pickPath: null });
    await h.cmd.invokeUnmount();
    expect(h.unmountCalls).toEqual([]);
    expect(h.confirmCalls).toEqual([]);
    expect(h.notices).toEqual([]);
  });

  it("confirm declined → no unmount", async () => {
    const h = makeHarness({
      mounted: [PMBOK],
      pickPath: PMBOK.submodulePath,
      confirm: false,
    });
    await h.cmd.invokeUnmount();
    expect(h.confirmCalls).toHaveLength(1);
    expect(h.unmountCalls).toEqual([]);
  });

  it("unmount throws → failure notice, no re-index hook", async () => {
    const h = makeHarness({
      mounted: [PMBOK],
      pickPath: PMBOK.submodulePath,
      confirm: true,
      unmountThrows: true,
    });
    await h.cmd.invokeUnmount();
    expect(h.unmountCalls).toEqual([PMBOK.submodulePath]);
    expect(h.notices.some((n) => n.includes("Unmount failed") && n.includes("rmdir boom"))).toBe(
      true,
    );
    expect(h.state.onUnmountedCalls).toBe(0);
  });
});
