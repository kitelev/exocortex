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

function dailyBlock(
  uid: string,
  partition: "actions" | "tasks" | "projects" | "closed" = "tasks",
): LayoutBlock {
  return {
    kind: "daily-efforts-by-class",
    uid,
    title: partition,
    collapsed: false,
    sourcePath: `${uid}.md`,
    partition,
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

  test("layoutClaimedDailyPartitions decision (unit)", () => {
    const { renderer } = buildRenderer(dailyLayout(["t"]), [dailyBlock("t")]);
    expect([
      ...(renderer as any).layoutClaimedDailyPartitions(dailyLayout(["t"])),
    ]).toEqual(["tasks"]);
    expect([
      ...(renderer as any).layoutClaimedDailyPartitions(dailyLayout(["b"])),
    ]).toEqual([]);
  });

  // ── req f56eef78 (#3910): the gate keys on the PARTITION, not on presence ──
  // Paired by construction: the first axis discriminates this design from the
  // pre-#3910 one (it was RED before the narrowing), the second discriminates it
  // from "drop suppression entirely". The third closes the duplicate-row hole
  // that the narrowing itself opens: the legacy table's set is «everything but
  // Project», so an Actions block would otherwise render every Action twice.

  test("@req:f56eef78-61d8-4d12-ac28-886aecefd633 layout with ONLY an actions daily-efforts block → legacy DailyTasksRenderer still runs", async () => {
    const { renderer, navSpy, tasksSpy } = buildRenderer(
      dailyLayout(["a"]),
      [dailyBlock("a", "actions")],
    );
    const el = enhance(document.createElement("div"));
    await renderer.render("", el, {} as never);

    expect(navSpy).toHaveBeenCalledTimes(1);
    expect(tasksSpy).toHaveBeenCalledTimes(1); // time-table NOT taken away
  });

  test("@req:f56eef78-61d8-4d12-ac28-886aecefd633 an actions block makes the legacy table DROP the Actions (no duplicate rows)", async () => {
    const { renderer, tasksSpy } = buildRenderer(
      dailyLayout(["a"]),
      [dailyBlock("a", "actions")],
    );
    const el = enhance(document.createElement("div"));
    await renderer.render("", el, {} as never);

    expect(tasksSpy.mock.calls[0]?.[4]).toEqual({ excludeActions: true });
  });

  test("@req:f56eef78-61d8-4d12-ac28-886aecefd633 no actions block → the legacy table keeps rendering Actions", async () => {
    const { renderer, tasksSpy } = buildRenderer(
      dailyLayout(["p"]),
      [dailyBlock("p", "projects")],
    );
    const el = enhance(document.createElement("div"));
    await renderer.render("", el, {} as never);

    expect(tasksSpy.mock.calls[0]?.[4]).toEqual({ excludeActions: false });
  });

  test("@req:f56eef78-61d8-4d12-ac28-886aecefd633 layout with a tasks daily-efforts block → legacy DailyTasksRenderer suppressed", async () => {
    const { renderer, navSpy, tasksSpy } = buildRenderer(
      dailyLayout(["t"]),
      [dailyBlock("t", "tasks")],
    );
    const el = enhance(document.createElement("div"));
    await renderer.render("", el, {} as never);

    expect(navSpy).toHaveBeenCalledTimes(1);
    expect(tasksSpy).not.toHaveBeenCalled();
  });

  test("@req:f56eef78-61d8-4d12-ac28-886aecefd633 layout mixing actions + tasks → suppressed (the tasks block claims the bulk)", async () => {
    const { renderer, tasksSpy } = buildRenderer(
      dailyLayout(["a", "t"]),
      [dailyBlock("a", "actions"), dailyBlock("t", "tasks")],
    );
    const el = enhance(document.createElement("div"));
    await renderer.render("", el, {} as never);

    expect(tasksSpy).not.toHaveBeenCalled();
  });

  test("@req:f56eef78-61d8-4d12-ac28-886aecefd633 every partition is claimed under its own name", () => {
    const partitions = ["actions", "tasks", "projects", "closed"] as const;
    for (const partition of partitions) {
      const { renderer } = buildRenderer(dailyLayout(["p"]), [
        dailyBlock("p", partition),
      ]);
      expect([
        ...(renderer as any).layoutClaimedDailyPartitions(dailyLayout(["p"])),
      ]).toEqual([partition]);
    }
  });
});
