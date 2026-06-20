import { createProfileApplyRefreshHook } from "../../src/infrastructure/adapters/profileApplyRefreshHook";

/**
 * GUI-smoke D1 regression guard.
 *
 * The apply-profile / mount-state path funnels through
 * `PluginRdfIndexerAdapter.onAfterRefresh`. Before the D1 fix that hook
 * only re-injected materialization triples; it did NOT invalidate the
 * command/precondition caches or re-render, so inline create-buttons
 * resolved (and cached empty) against the pre-mount store stayed hidden
 * on `ems__Project` / `ems__MeetingPrototype` until a full plugin reload.
 *
 * Revert-verify: delete the `invalidateCommandResolverCache` /
 * `invalidatePreconditionCache` / `clearLazyLoader` / `rerenderLayouts`
 * lines from `createProfileApplyRefreshHook` and the
 * "invalidates caches + re-renders" tests below FAIL; restore → PASS.
 *
 * Link-label Веха 2 (WBS f01836c1): the hook ALSO re-resolves wikilink
 * labels in open editor views (`refreshEditorLabels`). Revert-verify:
 * delete the `deps.refreshEditorLabels()` call from the hook and the
 * "re-resolves wikilink labels" + order tests FAIL; restore → PASS.
 */
describe("createProfileApplyRefreshHook", () => {
  function makeDeps() {
    return {
      refreshAndInject: jest.fn().mockResolvedValue(undefined),
      clearLazyLoader: jest.fn(),
      invalidateCommandResolverCache: jest.fn(),
      invalidatePreconditionCache: jest.fn(),
      rerenderLayouts: jest.fn(),
      refreshEditorLabels: jest.fn(),
    };
  }

  it("re-injects materialization triples (preserves H1 behaviour)", async () => {
    const deps = makeDeps();
    await createProfileApplyRefreshHook(deps)();
    expect(deps.refreshAndInject).toHaveBeenCalledTimes(1);
  });

  it("invalidates the command + precondition caches after a mount-state rebuild (D1)", async () => {
    const deps = makeDeps();
    await createProfileApplyRefreshHook(deps)();
    expect(deps.invalidateCommandResolverCache).toHaveBeenCalledTimes(1);
    expect(deps.invalidatePreconditionCache).toHaveBeenCalledTimes(1);
  });

  it("clears the lazy-loader load-marks after a mount-state rebuild (D1)", async () => {
    const deps = makeDeps();
    await createProfileApplyRefreshHook(deps)();
    expect(deps.clearLazyLoader).toHaveBeenCalledTimes(1);
  });

  it("re-renders active layouts so refreshed buttons appear without a reload (D1)", async () => {
    const deps = makeDeps();
    await createProfileApplyRefreshHook(deps)();
    expect(deps.rerenderLayouts).toHaveBeenCalledTimes(1);
  });

  it("re-resolves wikilink labels in open editor views after a mount-state rebuild (Веха 2)", async () => {
    const deps = makeDeps();
    await createProfileApplyRefreshHook(deps)();
    expect(deps.refreshEditorLabels).toHaveBeenCalledTimes(1);
  });

  it("stays graceful when refreshEditorLabels throws (best-effort UI polish)", async () => {
    const deps = makeDeps();
    deps.refreshEditorLabels.mockImplementation(() => {
      throw new Error("updateOptions blew up");
    });

    // Must resolve, not reject — the earlier duties already succeeded.
    await expect(
      createProfileApplyRefreshHook(deps)(),
    ).resolves.toBeUndefined();
    // The earlier, more-important duties still ran.
    expect(deps.refreshAndInject).toHaveBeenCalledTimes(1);
    expect(deps.invalidateCommandResolverCache).toHaveBeenCalledTimes(1);
    expect(deps.rerenderLayouts).toHaveBeenCalledTimes(1);
  });

  it("re-injects BEFORE invalidating + re-rendering + label-refresh (store must be rebuilt first)", async () => {
    const order: string[] = [];
    const deps = {
      refreshAndInject: jest.fn(async () => {
        order.push("refreshAndInject");
      }),
      clearLazyLoader: jest.fn(() => order.push("clearLazyLoader")),
      invalidateCommandResolverCache: jest.fn(() =>
        order.push("invalidateCommandResolverCache"),
      ),
      invalidatePreconditionCache: jest.fn(() =>
        order.push("invalidatePreconditionCache"),
      ),
      rerenderLayouts: jest.fn(() => order.push("rerenderLayouts")),
      refreshEditorLabels: jest.fn(() => order.push("refreshEditorLabels")),
    };

    await createProfileApplyRefreshHook(deps)();

    expect(order).toEqual([
      "refreshAndInject",
      "clearLazyLoader",
      "invalidateCommandResolverCache",
      "invalidatePreconditionCache",
      "rerenderLayouts",
      "refreshEditorLabels",
    ]);
  });

  it("re-resolves editor labels only AFTER the index-fresh re-inject (fresh metadataCache)", async () => {
    const order: string[] = [];
    const deps = makeDeps();
    deps.refreshAndInject.mockImplementation(async () =>
      order.push("refreshAndInject"),
    );
    deps.refreshEditorLabels.mockImplementation(() =>
      order.push("refreshEditorLabels"),
    );

    await createProfileApplyRefreshHook(deps)();

    expect(order).toEqual(["refreshAndInject", "refreshEditorLabels"]);
  });

  it("re-renders only AFTER caches are invalidated (fresh resolution)", async () => {
    const order: string[] = [];
    const deps = makeDeps();
    deps.invalidateCommandResolverCache.mockImplementation(() =>
      order.push("invalidate"),
    );
    deps.rerenderLayouts.mockImplementation(() => order.push("rerender"));

    await createProfileApplyRefreshHook(deps)();

    expect(order).toEqual(["invalidate", "rerender"]);
  });
});
