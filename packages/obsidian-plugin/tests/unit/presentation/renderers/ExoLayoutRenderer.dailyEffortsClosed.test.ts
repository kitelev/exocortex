/**
 * ExoLayoutRenderer — the "Closed today" daily-efforts partition (req b2a33efc /
 * issue #3781). A `daily-efforts-by-class` block with partition "closed" lists
 * the day's efforts stamped `closedInDay` by the provider; the class buckets
 * (Actions/Tasks/Projects) are computed only over the `inDay` subset, so a
 * Trashed-only closure (inDay=false, closedInDay=true) appears ONLY in the
 * closed block — zero regression to req a38ac95b's class partitions.
 *
 * @req:b2a33efc-1b6c-4c9a-ab76-ecff66ffab08
 *
 * revert-verify (production-shape — real ExoLayoutRenderer.computeDailyPartition
 * + partitionDailyEffortsByClass + renderDailyEffortsBlock, only reactRenderer +
 * app boundaries faked):
 *  - neutralising the closed-axis filter in `computeDailyPartition`
 *    (`e.closedInDay === true` → always-false) → the closed block renders empty
 *    while the class blocks stay populated → the "closed lists the closures" +
 *    "Trashed-only appears in closed" assertions go RED; restoring → GREEN.
 *  - reverting the class buckets to run over ALL efforts (drop the
 *    `e.inDay !== false` filter) → the "Trashed-only NOT in Tasks" zero-regression
 *    assertion goes RED (the Trashed-only closure leaks into Tasks); restoring →
 *    GREEN.
 */

import type { Layout, LayoutBlock } from "@kitelev/exocortex-core";
import { ExoLayoutRenderer } from "../../../../src/presentation/renderers/ExoLayoutRenderer";
import type { DailyEffortItem } from "../../../../src/presentation/renderers/ExoLayoutRenderer";
import type { ExoLayoutSnapshot } from "../../../../src/infrastructure/repositories";

function enhance(el: HTMLElement): HTMLElement {
  (el as unknown as { setAttr: (k: string, v: string) => void }).setAttr = (
    k,
    v,
  ) => el.setAttribute(k, v);
  (el as unknown as { createDiv: (options?: unknown) => HTMLElement }).createDiv =
    (options?: { cls?: string | string[]; attr?: Record<string, string> }) => {
      const child = document.createElement("div");
      if (options?.cls) {
        child.className = Array.isArray(options.cls)
          ? options.cls.join(" ")
          : options.cls;
      }
      if (options?.attr) {
        for (const [k, v] of Object.entries(options.attr)) {
          child.setAttribute(k, v);
        }
      }
      el.appendChild(child);
      return enhance(child);
    };
  return el;
}

function makeEl(): HTMLElement {
  return enhance(document.createElement("div"));
}

function makeLayout(blocks: string[]): Layout {
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
  partition: "actions" | "tasks" | "projects" | "closed",
  visible?: boolean,
): LayoutBlock {
  return {
    kind: "daily-efforts-by-class",
    uid,
    title: partition,
    collapsed: false,
    visible,
    sourcePath: `${uid}.md`,
    partition,
  } as LayoutBlock;
}

function makeSnapshot(blocks: LayoutBlock[]): ExoLayoutSnapshot {
  const byUid = new Map<string, LayoutBlock>();
  const byLabel = new Map<string, LayoutBlock>();
  for (const b of blocks) {
    byUid.set(b.uid, b);
    byLabel.set(b.uid, b);
  }
  return {
    layouts: [],
    blocks: [...blocks],
    blocksByUid: byUid,
    blocksByLabel: byLabel,
  };
}

/** A day-relevant effort stamped with the two orthogonal relevance flags. */
function effort(
  path: string,
  classes: string[],
  flags: { inDay: boolean; closedInDay: boolean },
): DailyEffortItem {
  return {
    path,
    title: path.replace(/\.md$/, ""),
    metadata: { exo__Instance_class: classes },
    inDay: flags.inDay,
    closedInDay: flags.closedInDay,
  };
}

function makeRenderer(
  snapshot: ExoLayoutSnapshot,
  opts: { dayEfforts?: DailyEffortItem[] | null } = {},
) {
  const reactRenderer = {
    render: jest.fn(),
    cleanup: jest.fn(),
  };
  const logger = {
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  };
  const app = {
    metadataCache: { getFileCache: jest.fn(() => ({ frontmatter: {} })) },
    workspace: { openLinkText: jest.fn() },
  };
  const renderer = new ExoLayoutRenderer({
    app: app as never,
    reactRenderer: reactRenderer as never,
    logger: logger as never,
    snapshotProvider: () => snapshot,
    dailyEffortsProvider:
      opts.dayEfforts === undefined ? undefined : () => opts.dayEfforts ?? null,
  });
  return { renderer, reactRenderer };
}

/** Pull the props of the i-th React element passed to reactRenderer.render. */
function propsAt(reactRenderer: { render: jest.Mock }, i: number): any {
  return (reactRenderer.render as jest.Mock).mock.calls[i][1].props;
}

describe("ExoLayoutRenderer — 'closed' daily-efforts partition (req b2a33efc / #3781)", () => {
  // A day with three efforts of distinct relevance:
  //  - done.md    : DONE task (inDay via endTimestamp, AND closedInDay)
  //  - trashed.md : TRASHED-only task (resolution only → closedInDay, NOT inDay)
  //  - started.md : merely started today (inDay, NOT closedInDay)
  const dayEfforts = [
    effort("done.md", ["[[ems__Task]]"], { inDay: true, closedInDay: true }),
    effort("trashed.md", ["[[ems__Task]]"], {
      inDay: false,
      closedInDay: true,
    }),
    effort("started.md", ["[[ems__Task]]"], {
      inDay: true,
      closedInDay: false,
    }),
  ];

  test("@req:b2a33efc-1b6c-4c9a-ab76-ecff66ffab08 the 'closed' block lists efforts closed on the day (Done + Trashed-only)", async () => {
    const blocks = [dailyBlock("c", "closed", true)];
    const snap = makeSnapshot(blocks);
    const { renderer, reactRenderer } = makeRenderer(snap, { dayEfforts });
    const el = makeEl();

    await renderer.render(
      el,
      { path: "2026-07-12.md" } as never,
      makeLayout(["c"]),
      [],
    );

    expect(reactRenderer.render).toHaveBeenCalledTimes(1);
    const closed = propsAt(reactRenderer, 0);
    expect(closed.title).toBe("closed");
    expect(closed.items.map((i: { path: string }) => i.path).sort()).toEqual([
      "done.md",
      "trashed.md",
    ]);
  });

  test("@req:b2a33efc-1b6c-4c9a-ab76-ecff66ffab08 a Trashed-only closure appears ONLY in 'closed', NEVER in the Tasks class bucket (zero regression to a38ac95b)", async () => {
    const blocks = [
      dailyBlock("t", "tasks", true),
      dailyBlock("c", "closed", true),
    ];
    const snap = makeSnapshot(blocks);
    const { renderer, reactRenderer } = makeRenderer(snap, { dayEfforts });
    const el = makeEl();

    await renderer.render(
      el,
      { path: "2026-07-12.md" } as never,
      makeLayout(["t", "c"]),
      [],
    );

    expect(reactRenderer.render).toHaveBeenCalledTimes(2);
    const tasks = propsAt(reactRenderer, 0);
    const closed = propsAt(reactRenderer, 1);

    // Tasks (class bucket) is computed over the inDay subset only → Done +
    // Started, but NOT the Trashed-only closure. This is the a38ac95b behavior
    // unchanged: the Trashed-only effort has no start/end/planned timestamp so
    // isEffortInDay is false → it must not appear here.
    expect(tasks.items.map((i: { path: string }) => i.path).sort()).toEqual([
      "done.md",
      "started.md",
    ]);
    expect(
      tasks.items.some((i: { path: string }) => i.path === "trashed.md"),
    ).toBe(false);

    // The closed axis carries the Trashed-only closure (and the Done closure).
    expect(closed.items.map((i: { path: string }) => i.path).sort()).toEqual([
      "done.md",
      "trashed.md",
    ]);
  });

  test("@req:b2a33efc-1b6c-4c9a-ab76-ecff66ffab08 a day with nothing closed renders an empty 'closed' block (no error, no items)", async () => {
    const nothingClosed = [
      effort("started.md", ["[[ems__Task]]"], {
        inDay: true,
        closedInDay: false,
      }),
    ];
    const blocks = [dailyBlock("c", "closed", true)];
    const snap = makeSnapshot(blocks);
    const { renderer, reactRenderer } = makeRenderer(snap, {
      dayEfforts: nothingClosed,
    });
    const el = makeEl();

    const result = await renderer.render(
      el,
      { path: "2026-07-12.md" } as never,
      makeLayout(["c"]),
      [],
    );

    // The block still renders (empty-state "No efforts" is DailyEffortsBlockView's
    // job); no throw, zero closed items.
    expect(result.blockCount).toBe(1);
    const closed = propsAt(reactRenderer, 0);
    expect(closed.items).toEqual([]);
  });

  test("@req:b2a33efc-1b6c-4c9a-ab76-ecff66ffab08 the 'closed' partition is shown out of the box (VL built-in default) with no visibility flag", async () => {
    // No per-note override, no Layout per-block default (visible undefined) →
    // built-in default for 'closed' is shown.
    const blocks = [dailyBlock("c", "closed")]; // visible undefined
    const snap = makeSnapshot(blocks);
    const { renderer, reactRenderer } = makeRenderer(snap, { dayEfforts });
    const el = makeEl();

    const result = await renderer.render(
      el,
      { path: "2026-07-12.md" } as never,
      makeLayout(["c"]),
      [],
    );

    expect(result.blockCount).toBe(1);
    expect(reactRenderer.render).toHaveBeenCalledTimes(1);
    expect(propsAt(reactRenderer, 0).title).toBe("closed");
  });

  test("@req:b2a33efc-1b6c-4c9a-ab76-ecff66ffab08 pn__DailyNote_showClosed:false hides the 'closed' block (override > built-in)", async () => {
    const blocks = [dailyBlock("c", "closed")]; // visible undefined → built-in
    const snap = makeSnapshot(blocks);
    const reactRenderer = { render: jest.fn(), cleanup: jest.fn() };
    const logger = {
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    };
    const app = {
      metadataCache: {
        getFileCache: jest.fn(() => ({
          frontmatter: { pn__DailyNote_showClosed: false },
        })),
      },
      workspace: { openLinkText: jest.fn() },
    };
    const renderer = new ExoLayoutRenderer({
      app: app as never,
      reactRenderer: reactRenderer as never,
      logger: logger as never,
      snapshotProvider: () => snap,
      dailyEffortsProvider: () => dayEfforts,
    });
    const el = makeEl();

    const result = await renderer.render(
      el,
      { path: "2026-07-12.md" } as never,
      makeLayout(["c"]),
      [],
    );

    expect(result.blockCount).toBe(0);
    expect(reactRenderer.render).not.toHaveBeenCalled();
  });
});
