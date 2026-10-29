/**
 * RFC 9821a379 (ticket 058bad52) at the page level:
 *  - AC9 — a daily-note Layout whose block is a `query-table` leaves the day's
 *    task table exactly as without a Layout (same call, same options);
 *  - the row provider and the «индекс стабилен» flag reach `ExoLayoutRenderer`.
 *
 * revert-verify: `UniversalLayoutRenderer.queryTable.spec.json`.
 */
import "reflect-metadata";
import { container } from "tsyringe";
import {
  DI_TOKENS,
  registerCoreServices,
  resetContainer,
  LayoutSelector,
  type Layout,
  type LayoutBlock,
} from "@kitelev/exocortex-core";
import { UniversalLayoutRenderer } from "../../../../src/presentation/renderers/UniversalLayoutRenderer";
import type { ExocortexSettings } from "../../../../src/domain/settings/ExocortexSettings";

function enhance(el: HTMLElement): HTMLElement {
  const any = el as unknown as Record<string, unknown>;
  any.setAttr = (k: string, v: string) => el.setAttribute(k, v);
  any.createDiv = (options?: {
    cls?: string;
    attr?: Record<string, string>;
    text?: string;
  }) => {
    const child = document.createElement("div");
    if (options?.cls) child.className = options.cls;
    if (options?.text) child.textContent = options.text;
    for (const [k, v] of Object.entries(options?.attr ?? {}))
      child.setAttribute(k, v);
    el.appendChild(child as unknown as Node);
    return enhance(child);
  };
  any.createEl = (tag: string) => {
    const child = document.createElement(tag);
    el.appendChild(child as unknown as Node);
    return enhance(child);
  };
  any.addClass = (c: string) => el.classList.add(c);
  any.empty = () => {
    el.innerHTML = "";
  };
  return el;
}

const queryBlock = {
  kind: "query-table",
  uid: "qb",
  title: "Эпизоды дня",
  collapsed: false,
  layoutRef: "daily-layout",
  order: 1,
  sourcePath: "qb.md",
  query: "q",
  limit: 100,
  emptyText: "Эпизодов нет",
} as LayoutBlock;

const dailyLayout: Layout = {
  uid: "daily-layout",
  label: "Daily",
  targetClass: "pn__DailyNote",
  blocks: ["qb"],
  priority: 0,
  coexistsWithDefault: true,
  sourcePath: "layout.md",
};

describe("UniversalLayoutRenderer — query-table block (RFC 9821a379, ticket 058bad52)", () => {
  let mockApp: any;
  let mockVaultAdapter: any;

  beforeEach(() => {
    resetContainer();
    mockApp = {
      vault: { getMarkdownFiles: jest.fn().mockReturnValue([]) },
      metadataCache: {
        getFileCache: jest.fn().mockReturnValue({
          frontmatter: { exo__Instance_class: ["[[pn__DailyNote]]"] },
        }),
        getFirstLinkpathDest: jest.fn(),
      },
      workspace: {
        getActiveFile: jest.fn().mockReturnValue({
          path: "2026-08-10 Note.md",
          basename: "2026-08-10 Note",
        }),
        openLinkText: jest.fn(),
      },
    };
    mockVaultAdapter = {
      getAllFiles: jest.fn().mockReturnValue([]),
      getFrontmatter: jest.fn().mockReturnValue({}),
    };
    container.register(DI_TOKENS.IVaultAdapter, { useValue: mockVaultAdapter });
    container.register(DI_TOKENS.ILogger, {
      useValue: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
      },
    });
    registerCoreServices();
  });

  afterEach(() => resetContainer());

  function build(layouts: Layout[], services: Record<string, unknown> = {}) {
    const blocks = [queryBlock];
    const renderer = new UniversalLayoutRenderer(
      mockApp,
      { enableExoLayoutRenderer: true } as ExocortexSettings,
      { saveSettings: jest.fn() } as never,
      mockVaultAdapter,
      {
        layoutSelector: new LayoutSelector({ all: layouts }),
        exoLayoutRepository: {
          getSnapshot: () => ({
            layouts,
            blocks,
            blocksByUid: new Map(blocks.map((b) => [b.uid, b])),
            blocksByLabel: new Map(),
          }),
        } as never,
        ...services,
      },
    );
    const tasks = jest.fn().mockResolvedValue(undefined);
    const internals = renderer as any;
    internals.dailyNavRenderer = { render: jest.fn() };
    internals.dailyTasksRenderer = { render: tasks };
    internals.buttonGroupsBuilder = { build: jest.fn().mockResolvedValue([]) };
    internals.relationsRenderer = {
      getAssetRelations: jest.fn().mockResolvedValue([]),
      render: jest.fn().mockResolvedValue(undefined),
    };
    internals.areaTreeRenderer = {
      render: jest.fn().mockResolvedValue(undefined),
    };
    internals.exoLayoutRenderer = {
      render: jest.fn().mockResolvedValue({ rendered: true, blockCount: 1 }),
      beginPage: jest.fn(() => 7),
    };
    return {
      renderer,
      tasks,
      exo: internals.exoLayoutRenderer.render as jest.Mock,
    };
  }

  it("N1 @req:23f10730-82f7-4037-b566-da79d5fa3378 a daily Layout with a query-table block leaves the day's task table as without a Layout (AC9)", async () => {
    const without = build([]);
    await without.renderer.render(
      "",
      enhance(document.createElement("div")),
      {} as never,
    );
    const withLayout = build([dailyLayout]);
    await withLayout.renderer.render(
      "",
      enhance(document.createElement("div")),
      {} as never,
    );

    expect(withLayout.exo).toHaveBeenCalledTimes(1);
    expect(without.tasks).toHaveBeenCalledTimes(1);
    expect(withLayout.tasks).toHaveBeenCalledTimes(1);
    expect(withLayout.tasks.mock.calls[0][3]).toBe(
      without.tasks.mock.calls[0][3],
    );
    expect(withLayout.tasks.mock.calls[0][4]).toEqual(
      without.tasks.mock.calls[0][4],
    );
    expect(withLayout.tasks.mock.calls[0][4]).toEqual({
      excludeActions: false,
    });
  });

  it("U2 @req:23f10730-82f7-4037-b566-da79d5fa3378 every page render begins a page of its root — a page WITHOUT a Layout too", async () => {
    const withoutLayout = build([]);
    const el = enhance(document.createElement("div"));
    await withoutLayout.renderer.render("", el, {} as never);
    const begin = (withoutLayout.renderer as any).exoLayoutRenderer
      .beginPage as jest.Mock;
    expect(begin).toHaveBeenCalledTimes(1);
    expect(begin.mock.calls[0][0]).toBe(el);
    expect(withoutLayout.exo).not.toHaveBeenCalled();
  });

  it("U3 @req:23f10730-82f7-4037-b566-da79d5fa3378 the Layout render carries the generation of the page render that started it", async () => {
    const withLayout = build([dailyLayout]);
    const el2 = enhance(document.createElement("div"));
    await withLayout.renderer.render("", el2, {} as never);
    expect(withLayout.exo.mock.calls[0][0]).toBe(el2);
    expect(withLayout.exo.mock.calls[0][4]).toBe(7);
  });

  function blockRendererDeps(services: Record<string, unknown>) {
    const renderer = new UniversalLayoutRenderer(
      mockApp,
      { enableExoLayoutRenderer: true } as ExocortexSettings,
      { saveSettings: jest.fn() } as never,
      mockVaultAdapter,
      services,
    );
    return (renderer as any).exoLayoutRenderer.deps;
  }

  it("U1 @req:23f10730-82f7-4037-b566-da79d5fa3378 the row provider reaches the block renderer", () => {
    const provider = jest.fn();
    expect(
      blockRendererDeps({ queryTableProvider: provider }).queryTableProvider,
    ).toBe(provider);
  });

  /**
   * Two page renders of ONE root: the first is held at an await, a refresh()
   * renders the root again meanwhile, then the first is released. With the page
   * begun before the first await, the refreshed (visible) block gets the rows
   * and the query runs once. `slow` picks which await holds the first render:
   * the button groups build, or the lazy asset-graph loader — in production the
   * loader is wired (ExocortexPlugin), so ITS await is the first one.
   */
  async function refreshOverSlowerFirstRender(slow: "build" | "loader") {
    const flush = async (): Promise<void> => {
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    };
    let answer!: (v: unknown) => void;
    const provider = jest
      .fn()
      .mockImplementationOnce(() => new Promise((r) => (answer = r)));
    const blocks = [queryBlock];
    let release!: () => void;
    const held = <T,>(value: T) =>
      jest
        .fn()
        .mockImplementationOnce(
          () => new Promise<T>((r) => (release = () => r(value))),
        )
        .mockResolvedValue(value);
    const renderer = new UniversalLayoutRenderer(
      mockApp,
      { enableExoLayoutRenderer: true } as ExocortexSettings,
      { saveSettings: jest.fn() } as never,
      mockVaultAdapter,
      {
        layoutSelector: new LayoutSelector({ all: [dailyLayout] }),
        exoLayoutRepository: {
          getSnapshot: () => ({
            layouts: [dailyLayout],
            blocks,
            blocksByUid: new Map(blocks.map((b) => [b.uid, b])),
            blocksByLabel: new Map(),
          }),
        } as never,
        queryTableProvider: provider as never,
      },
    );
    const internals = renderer as any;
    internals.dailyNavRenderer = { render: jest.fn() };
    internals.dailyTasksRenderer = {
      render: jest.fn().mockResolvedValue(undefined),
    };
    internals.buttonGroupsBuilder = {
      build: slow === "build" ? held([]) : jest.fn().mockResolvedValue([]),
    };
    if (slow === "loader") {
      internals.lazyAssetGraphLoader = { ensureLoadedByIRI: held(undefined) };
    }
    internals.relationsRenderer = {
      getAssetRelations: jest.fn().mockResolvedValue([]),
      render: jest.fn().mockResolvedValue(undefined),
    };
    internals.areaTreeRenderer = {
      render: jest.fn().mockResolvedValue(undefined),
    };
    const exo = internals.exoLayoutRenderer;
    const paints = jest
      .spyOn(exo.deps.reactRenderer, "render")
      .mockImplementation(() => undefined);

    const el = enhance(document.createElement("div"));
    document.body.appendChild(el as unknown as Node);
    try {
      const first = renderer.render("", el, {} as never);
      await flush();
      await renderer.refresh();
      await flush();
      const refreshedBlock = el.querySelector('[data-block-uid="qb"]');
      release();
      await first;
      await flush();
      answer({
        kind: "rows",
        queryLabel: "Q",
        columns: ["c"],
        rows: [[{ kind: "text", text: "r" }]],
        total: 1,
        elapsedMs: 1,
      });
      await exo.whenSettled();
      await flush();
      const kinds = paints.mock.calls
        .filter(([c]) => c === refreshedBlock)
        .map(
          ([, e]) => (e as { props: { state: { kind: string } } }).props.state.kind,
        );
      return { kinds, providerCalls: provider.mock.calls.length };
    } finally {
      el.remove();
    }
  }

  it("U5 @req:23f10730-82f7-4037-b566-da79d5fa3378 the page is begun before the button groups await: a refresh() over a slower first render of the same root gets the rows, the query runs once", async () => {
    expect(await refreshOverSlowerFirstRender("build")).toEqual({
      kinds: ["loading", "rows"],
      providerCalls: 1,
    });
  });

  it("U6 @req:23f10730-82f7-4037-b566-da79d5fa3378 the page is begun before the lazy asset-graph loader — the first await in production", async () => {
    expect(await refreshOverSlowerFirstRender("loader")).toEqual({
      kinds: ["loading", "rows"],
      providerCalls: 1,
    });
  });

  it("U4 @req:23f10730-82f7-4037-b566-da79d5fa3378 the index-stability flag reaches the block renderer", () => {
    const stability = {
      isStable: () => true,
      whenStable: () => Promise.resolve({ kind: "stable" as const }),
    };
    expect(
      blockRendererDeps({ indexStability: stability }).indexStability,
    ).toBe(stability);
  });
});
