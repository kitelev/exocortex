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
 */
describe("createProfileApplyRefreshHook", () => {
  function makeDeps() {
    return {
      refreshAndInject: jest.fn().mockResolvedValue(undefined),
      clearLazyLoader: jest.fn(),
      invalidateCommandResolverCache: jest.fn(),
      invalidatePreconditionCache: jest.fn(),
      rerenderLayouts: jest.fn(),
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

  it("re-injects BEFORE invalidating + re-rendering (store must be rebuilt first)", async () => {
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
    };

    await createProfileApplyRefreshHook(deps)();

    expect(order).toEqual([
      "refreshAndInject",
      "clearLazyLoader",
      "invalidateCommandResolverCache",
      "invalidatePreconditionCache",
      "rerenderLayouts",
    ]);
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
