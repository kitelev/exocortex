/**
 * LinkLabelRefreshService unit tests (Веха 1 / MVP, WBS bb1c98af + 74cac7b0).
 *
 * The service orchestrates a wikilink-label re-resolve without an Obsidian
 * restart: (1) ensure the index is fresh, (2) force-rebuild open editor views,
 * (3) re-render dynamic layouts. Contract: graceful — each step is isolated,
 * nothing throws out of `refresh()`, nothing shows a Notice, and a failure in
 * one step never aborts the others.
 *
 * These are production-shape tests: the injected deps mirror the real wiring
 * (`sparql.refresh()` is async + store-touching; `updateOptions()` and
 * `autoRenderLayout()` are synchronous side-effects). No stub returns a
 * "success" value that the real runtime wouldn't.
 */

import {
  LinkLabelRefreshService,
  type LinkLabelRefreshDeps,
} from "@plugin/application/services/LinkLabelRefreshService";

function makeDeps(
  overrides: Partial<LinkLabelRefreshDeps> = {},
): { deps: LinkLabelRefreshDeps; calls: string[]; warnings: string[] } {
  const calls: string[] = [];
  const warnings: string[] = [];
  const deps: LinkLabelRefreshDeps = {
    ensureIndexFresh: jest.fn(async () => {
      calls.push("ensureIndexFresh");
    }),
    rebuildEditorViews: jest.fn(() => {
      calls.push("rebuildEditorViews");
    }),
    rerenderLayouts: jest.fn(() => {
      calls.push("rerenderLayouts");
    }),
    logger: {
      debug: jest.fn(),
      warn: jest.fn((message: string) => {
        warnings.push(message);
      }),
    },
    ...overrides,
  };
  return { deps, calls, warnings };
}

describe("LinkLabelRefreshService", () => {
  it("runs all three re-resolve steps in order (index-fresh → views → layouts)", async () => {
    const { deps, calls } = makeDeps();
    const service = new LinkLabelRefreshService(deps);

    await service.refresh();

    expect(calls).toEqual([
      "ensureIndexFresh",
      "rebuildEditorViews",
      "rerenderLayouts",
    ]);
    expect(deps.ensureIndexFresh).toHaveBeenCalledTimes(1);
    expect(deps.rebuildEditorViews).toHaveBeenCalledTimes(1);
    expect(deps.rerenderLayouts).toHaveBeenCalledTimes(1);
  });

  it("awaits the async ensureIndexFresh before rebuilding views (new tabs resolve a fresh index)", async () => {
    const order: string[] = [];
    let resolveFresh!: () => void;
    const { deps } = makeDeps({
      ensureIndexFresh: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveFresh = () => {
              order.push("ensureIndexFresh");
              resolve();
            };
          }),
      ),
      rebuildEditorViews: jest.fn(() => {
        order.push("rebuildEditorViews");
      }),
    });
    const service = new LinkLabelRefreshService(deps);

    const pending = service.refresh();
    // rebuildEditorViews must NOT have fired before the async index refresh
    // settles — otherwise open views rebuild against a stale index.
    expect(order).toEqual([]);
    resolveFresh();
    await pending;

    expect(order).toEqual(["ensureIndexFresh", "rebuildEditorViews"]);
  });

  describe("graceful — never throws, never aborts later steps", () => {
    it("continues to rebuild views + layouts when ensureIndexFresh throws", async () => {
      const { deps, calls, warnings } = makeDeps({
        ensureIndexFresh: jest.fn(async () => {
          throw new Error("index rebuild boom");
        }),
      });
      const service = new LinkLabelRefreshService(deps);

      await expect(service.refresh()).resolves.toBeUndefined();

      // Index step failed but the load-bearing view rebuild + layouts still ran.
      expect(calls).toEqual(["rebuildEditorViews", "rerenderLayouts"]);
      expect(warnings.some((w) => w.includes("ensureIndexFresh"))).toBe(true);
    });

    it("continues to re-render layouts when rebuildEditorViews throws", async () => {
      const { deps, calls, warnings } = makeDeps({
        rebuildEditorViews: jest.fn(() => {
          throw new Error("updateOptions boom");
        }),
      });
      const service = new LinkLabelRefreshService(deps);

      await expect(service.refresh()).resolves.toBeUndefined();

      expect(calls).toEqual(["ensureIndexFresh", "rerenderLayouts"]);
      expect(warnings.some((w) => w.includes("rebuildEditorViews"))).toBe(true);
    });

    it("never throws when rerenderLayouts throws (last step)", async () => {
      const { deps, calls, warnings } = makeDeps({
        rerenderLayouts: jest.fn(() => {
          throw new Error("autoRenderLayout boom");
        }),
      });
      const service = new LinkLabelRefreshService(deps);

      await expect(service.refresh()).resolves.toBeUndefined();

      expect(calls).toEqual(["ensureIndexFresh", "rebuildEditorViews"]);
      expect(warnings.some((w) => w.includes("rerenderLayouts"))).toBe(true);
    });

    it("does not require a logger (optional dep) and still never throws", async () => {
      const { deps } = makeDeps({
        logger: undefined,
        ensureIndexFresh: jest.fn(async () => {
          throw new Error("boom");
        }),
      });
      const service = new LinkLabelRefreshService(deps);

      await expect(service.refresh()).resolves.toBeUndefined();
    });
  });
});
