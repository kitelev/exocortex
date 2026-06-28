/**
 * UniversalLayoutRenderer — suppress the legacy DailyTasksRenderer when an
 * active layout carries daily-efforts-by-class blocks (RL#4c), while preserving
 * the daily navigation. Back-compat: no daily-efforts layout → legacy renders
 * unchanged.
 *
 * Covers req a38ac95b assertion (h) daily navigation preserved after reroute +
 * the no-duplicate-Tasks orchestration.
 *
 * @req:a38ac95b-b347-42e4-8522-f481ab422337
 *
 * revert-verify: removing the `if (!dailyEffortsLayoutActive)` guard around the
 * legacy `dailyTasksRenderer.render(...)` call → the "suppressed" test goes RED
 * (legacy render fires alongside the block pipeline = duplicate Tasks);
 * restoring → GREEN.
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
  const anyEl = el as unknown as Record<string, unknown>;
  anyEl.createDiv = (options?: { cls?: string | string[] }) => {
    const child = document.createElement("div");
    if (options?.cls) {
      child.className = Array.isArray(options.cls)
        ? options.cls.join(" ")
        : options.cls;
    }
    el.appendChild(child);
    return enhance(child);
  };
  anyEl.createEl = (tag: string) => {
    const child = document.createElement(tag);
    el.appendChild(child);
    return enhance(child);
  };
  anyEl.addClass = (c: string) => el.classList.add(c);
  anyEl.empty = () => {
    el.innerHTML = "";
  };
  return el;
}

function dailyLayout(blocks: string[]): Layout {
  return {
    uid: "daily-layout",
    label: "Daily",
    targetClass: "pn__DailyNote",
    blocks,
    priority: 0,
    coexistsWithDefault: true,
    sourcePath: "layout.md",
  };
}

function dailyBlock(uid: string): LayoutBlock {
  return {
    kind: "daily-efforts-by-class",
    uid,
    title: "Tasks",
    collapsed: false,
    sourcePath: `${uid}.md`,
    partition: "tasks",
  } as LayoutBlock;
}

function backlinksBlock(uid: string): LayoutBlock {
  return {
    kind: "backlinks-table",
    uid,
    title: "Children",
    collapsed: false,
    sourcePath: `${uid}.md`,
    rowClass: "ems__Task",
    referencingProperty: "ems__Effort_parent",
    columns: [],
    sortBy: null,
    sortOrder: "asc",
    limit: null,
    showArchived: false,
  } as LayoutBlock;
}

function snapshotWith(blocks: LayoutBlock[]) {
  const byUid = new Map<string, LayoutBlock>();
  const byLabel = new Map<string, LayoutBlock>();
  for (const b of blocks) {
    byUid.set(b.uid, b);
    byLabel.set(b.uid, b);
  }
  return { layouts: [], blocks, blocksByUid: byUid, blocksByLabel: byLabel };
}

describe("UniversalLayoutRenderer — daily-efforts suppression (req a38ac95b h)", () => {
  let mockApp: any;
  let mockSettings: ExocortexSettings;
  let mockPlugin: any;
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
        getActiveFile: jest.fn().mockReturnValue({ path: "2026-06-28.md", basename: "2026-06-28" }),
        openLinkText: jest.fn(),
      },
    };
    mockSettings = { enableExoLayoutRenderer: true } as ExocortexSettings;
    mockPlugin = { saveSettings: jest.fn() };
    mockVaultAdapter = {
      getAllFiles: jest.fn().mockReturnValue([]),
      getFrontmatter: jest.fn().mockReturnValue({}),
    };
    const mockLogger = { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };
    container.register(DI_TOKENS.IVaultAdapter, { useValue: mockVaultAdapter });
    container.register(DI_TOKENS.ILogger, { useValue: mockLogger });
    registerCoreServices();
  });

  afterEach(() => resetContainer());

  function buildRenderer(layout: Layout, snapshotBlocks: LayoutBlock[]) {
    const layoutSelector = new LayoutSelector({ all: [layout] });
    const exoLayoutRepository = {
      getSnapshot: () => snapshotWith(snapshotBlocks),
    } as never;
    const renderer = new UniversalLayoutRenderer(
      mockApp,
      mockSettings,
      mockPlugin,
      mockVaultAdapter,
      { layoutSelector, exoLayoutRepository },
    );
    // Isolate the orchestration: spy on the section renderers/builders so the
    // render() flow is deterministic and we observe only the call decisions.
    const navSpy = jest.fn();
    const tasksSpy = jest.fn().mockResolvedValue(undefined);
    (renderer as any).dailyNavRenderer = { render: navSpy };
    (renderer as any).dailyTasksRenderer = { render: tasksSpy };
    (renderer as any).buttonGroupsBuilder = { build: jest.fn().mockResolvedValue([]) };
    (renderer as any).relationsRenderer = {
      getAssetRelations: jest.fn().mockResolvedValue([]),
      render: jest.fn().mockResolvedValue(undefined),
    };
    (renderer as any).areaTreeRenderer = { render: jest.fn().mockResolvedValue(undefined) };
    (renderer as any).exoLayoutRenderer = {
      render: jest.fn().mockResolvedValue({ rendered: true, blockCount: 1 }),
    };
    return { renderer, navSpy, tasksSpy };
  }

  test("@req:a38ac95b-b347-42e4-8522-f481ab422337 daily-efforts layout active → legacy DailyTasksRenderer suppressed, nav preserved", async () => {
    const { renderer, navSpy, tasksSpy } = buildRenderer(
      dailyLayout(["t"]),
      [dailyBlock("t")],
    );
    const el = enhance(document.createElement("div"));
    await renderer.render("", el, {} as never);

    expect(navSpy).toHaveBeenCalledTimes(1); // navigation preserved
    expect(tasksSpy).not.toHaveBeenCalled(); // legacy Tasks suppressed
    expect((renderer as any).exoLayoutRenderer.render).toHaveBeenCalledTimes(1);
  });

  test("layout without daily-efforts block → legacy DailyTasksRenderer still runs (back-compat)", async () => {
    const { renderer, navSpy, tasksSpy } = buildRenderer(
      dailyLayout(["b"]),
      [backlinksBlock("b")],
    );
    const el = enhance(document.createElement("div"));
    await renderer.render("", el, {} as never);

    expect(navSpy).toHaveBeenCalledTimes(1);
    expect(tasksSpy).toHaveBeenCalledTimes(1); // not suppressed
  });

  test("layoutHasDailyEffortsBlock decision (unit)", () => {
    const { renderer } = buildRenderer(dailyLayout(["t"]), [dailyBlock("t")]);
    expect((renderer as any).layoutHasDailyEffortsBlock(dailyLayout(["t"]))).toBe(true);
    expect((renderer as any).layoutHasDailyEffortsBlock(dailyLayout(["b"]))).toBe(false);
  });
});
