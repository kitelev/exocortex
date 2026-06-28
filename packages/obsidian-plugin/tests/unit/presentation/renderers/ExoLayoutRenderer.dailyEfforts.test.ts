/**
 * ExoLayoutRenderer — per-block visibility (RL#4a) + daily-efforts-by-class
 * block rendering (RL#4b) with the visibility precedence
 * (frontmatter override > Layout default > built-in VL#3).
 *
 * Covers req a38ac95b assertions:
 *   (a) a block with visible=false is NOT rendered, a sibling visible one is.
 *   (b) daily-efforts-by-class partitions the day's efforts by class.
 *   (c) RL#1 — a day's meeting renders in the Tasks block at the default.
 *   (d)(e) precedence + coercion at the renderer level (frontmatter override).
 *   (f) VL#3 no-config default: Actions+Tasks shown, Projects hidden.
 *
 * @req:a38ac95b-b347-42e4-8522-f481ab422337
 *
 * revert-verify:
 *  - removing the `if (!this.isBlockVisible(...)) continue;` gate in render()
 *    → the visibility / VL#3 / precedence tests go RED (hidden blocks render);
 *    restoring → GREEN.
 *  - removing the `daily-efforts-by-class` case in renderBlock() → the
 *    partition / RL#1 tests go RED.
 */

import type { Layout, LayoutBlock } from "@kitelev/exocortex-core";
import { ExoLayoutRenderer } from "../../../../src/presentation/renderers/ExoLayoutRenderer";
import type {
  DailyEffortItem,
} from "../../../../src/presentation/renderers/ExoLayoutRenderer";
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

function propertiesBlock(uid: string, visible?: boolean): LayoutBlock {
  return {
    kind: "properties",
    uid,
    title: `Props ${uid}`,
    collapsed: false,
    visible,
    sourcePath: `${uid}.md`,
  } as LayoutBlock;
}

function dailyBlock(
  uid: string,
  partition: "actions" | "tasks" | "projects",
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

function effort(path: string, classes: string[]): DailyEffortItem {
  return {
    path,
    title: path.replace(/\.md$/, ""),
    metadata: { exo__Instance_class: classes },
  };
}

function makeRenderer(
  snapshot: ExoLayoutSnapshot,
  opts: {
    noteFrontmatter?: Record<string, unknown>;
    dayEfforts?: DailyEffortItem[] | null;
  } = {},
) {
  const renderCalls: Array<{ element: unknown }> = [];
  const reactRenderer = {
    render: jest.fn((_container: HTMLElement, element: unknown) => {
      renderCalls.push({ element });
    }),
    cleanup: jest.fn(),
  };
  const logger = { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() };
  const app = {
    metadataCache: {
      getFileCache: jest.fn(() => ({
        frontmatter: opts.noteFrontmatter ?? {},
      })),
    },
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
  return { renderer, reactRenderer, renderCalls };
}

/** Pull the props of the i-th React element passed to reactRenderer.render. */
function propsAt(reactRenderer: { render: jest.Mock }, i: number): any {
  return (reactRenderer.render as jest.Mock).mock.calls[i][1].props;
}

describe("ExoLayoutRenderer — per-block visibility (req a38ac95b a)", () => {
  test("@req:a38ac95b-b347-42e4-8522-f481ab422337 a block with visible=false is NOT rendered; a sibling visible one is", async () => {
    const hidden = propertiesBlock("hidden", false);
    const shown = propertiesBlock("shown", true);
    const snap = makeSnapshot([hidden, shown]);
    const { renderer, reactRenderer } = makeRenderer(snap);
    const el = makeEl();

    const result = await renderer.render(
      el,
      { path: "n.md" } as never,
      makeLayout(["hidden", "shown"]),
      [],
    );

    expect(result.blockCount).toBe(1);
    expect(reactRenderer.render).toHaveBeenCalledTimes(1);
    // only the visible block produced a DOM container
    const containers = el.querySelectorAll(".exocortex-exo-layout-block");
    expect(containers).toHaveLength(1);
    expect(containers[0].getAttribute("data-block-uid")).toBe("shown");
  });

  test("visible undefined (legacy, flag absent) → block still renders", async () => {
    const legacy = propertiesBlock("legacy"); // visible undefined
    const snap = makeSnapshot([legacy]);
    const { renderer, reactRenderer } = makeRenderer(snap);
    const el = makeEl();
    const result = await renderer.render(
      el,
      { path: "n.md" } as never,
      makeLayout(["legacy"]),
      [],
    );
    expect(result.blockCount).toBe(1);
    expect(reactRenderer.render).toHaveBeenCalledTimes(1);
  });
});

describe("ExoLayoutRenderer — daily-efforts partition (req a38ac95b b, c)", () => {
  const dayEfforts = [
    effort("act.md", ["[[ems__Action]]"]),
    effort("task.md", ["[[ems__Task]]"]),
    effort("meet.md", ["[[ems__Meeting]]"]),
    effort("proj.md", ["[[ems__Project]]"]),
  ];

  test("@req:a38ac95b-b347-42e4-8522-f481ab422337 partitions efforts into Actions / Tasks / Projects blocks", async () => {
    // all three blocks forced visible to verify the partition itself
    const blocks = [
      dailyBlock("a", "actions", true),
      dailyBlock("t", "tasks", true),
      dailyBlock("p", "projects", true),
    ];
    const snap = makeSnapshot(blocks);
    const { renderer, reactRenderer } = makeRenderer(snap, { dayEfforts });
    const el = makeEl();

    await renderer.render(
      el,
      { path: "n.md" } as never,
      makeLayout(["a", "t", "p"]),
      [],
    );

    expect(reactRenderer.render).toHaveBeenCalledTimes(3);
    const actions = propsAt(reactRenderer, 0);
    const tasks = propsAt(reactRenderer, 1);
    const projects = propsAt(reactRenderer, 2);
    expect(actions.items.map((i: { path: string }) => i.path)).toEqual([
      "act.md",
    ]);
    // RL#1 — meeting + task land in Tasks (inclusive carve-out)
    expect(tasks.items.map((i: { path: string }) => i.path).sort()).toEqual([
      "meet.md",
      "task.md",
    ]);
    expect(projects.items.map((i: { path: string }) => i.path)).toEqual([
      "proj.md",
    ]);
  });

  test("RL#1 — at the default (Tasks shown) a day meeting renders in Tasks", async () => {
    // Tasks block with no explicit visible → VL#3 default = shown
    const blocks = [dailyBlock("t", "tasks")];
    const snap = makeSnapshot(blocks);
    const { renderer, reactRenderer } = makeRenderer(snap, {
      dayEfforts: [effort("meet.md", ["[[ems__Meeting]]"])],
    });
    const el = makeEl();
    await renderer.render(el, { path: "n.md" } as never, makeLayout(["t"]), []);
    expect(reactRenderer.render).toHaveBeenCalledTimes(1);
    expect(propsAt(reactRenderer, 0).items.map((i: { path: string }) => i.path)).toEqual([
      "meet.md",
    ]);
  });
});

describe("ExoLayoutRenderer — VL#3 default + precedence (req a38ac95b d, e, f)", () => {
  const dayEfforts = [
    effort("act.md", ["[[ems__Action]]"]),
    effort("task.md", ["[[ems__Task]]"]),
    effort("proj.md", ["[[ems__Project]]"]),
  ];

  test("@req:a38ac95b-b347-42e4-8522-f481ab422337 VL#3 no-config default: Actions + Tasks shown, Projects hidden", async () => {
    // no explicit visible on any block, no frontmatter override
    const blocks = [
      dailyBlock("a", "actions"),
      dailyBlock("t", "tasks"),
      dailyBlock("p", "projects"),
    ];
    const snap = makeSnapshot(blocks);
    const { renderer, reactRenderer } = makeRenderer(snap, { dayEfforts });
    const el = makeEl();
    const result = await renderer.render(
      el,
      { path: "n.md" } as never,
      makeLayout(["a", "t", "p"]),
      [],
    );
    // Projects skipped → 2 blocks rendered
    expect(result.blockCount).toBe(2);
    const kinds = Array.from(
      el.querySelectorAll(".exocortex-exo-layout-block"),
    ).map((c) => c.getAttribute("data-block-uid"));
    expect(kinds).toEqual(["a", "t"]);
  });

  test("frontmatter override pn__DailyNote_showProjects:true reveals Projects (override > VL#3)", async () => {
    const blocks = [dailyBlock("p", "projects")]; // VL#3 default hidden
    const snap = makeSnapshot(blocks);
    const { renderer, reactRenderer } = makeRenderer(snap, {
      dayEfforts,
      noteFrontmatter: { pn__DailyNote_showProjects: true },
    });
    const el = makeEl();
    const result = await renderer.render(
      el,
      { path: "n.md" } as never,
      makeLayout(["p"]),
      [],
    );
    expect(result.blockCount).toBe(1);
    expect(propsAt(reactRenderer, 0).items.map((i: { path: string }) => i.path)).toEqual([
      "proj.md",
    ]);
  });

  test("frontmatter override pn__DailyNote_showActions:\"false\" hides Actions (coercion)", async () => {
    const blocks = [dailyBlock("a", "actions")]; // VL#3 default shown
    const snap = makeSnapshot(blocks);
    const { renderer } = makeRenderer(snap, {
      dayEfforts,
      noteFrontmatter: { pn__DailyNote_showActions: "false" },
    });
    const el = makeEl();
    const result = await renderer.render(
      el,
      { path: "n.md" } as never,
      makeLayout(["a"]),
      [],
    );
    expect(result.blockCount).toBe(0);
  });
});
