/**
 * ExoLayoutRenderer unit tests — validates orchestration semantics.
 *
 *   - Missing block ref → skipped + logged (fault-tolerant).
 *   - Properties + backlinks-table blocks delegated to React components.
 *   - Layout.blocks iteration order preserved in DOM.
 */

import type { Layout, LayoutBlock } from "@kitelev/exocortex-core";
import { ExoLayoutRenderer } from "../../../../src/presentation/renderers/ExoLayoutRenderer";
import type { ExoLayoutSnapshot } from "../../../../src/infrastructure/repositories";
import type { AssetRelation } from "../../../../src/presentation/renderers/layout/types";

function enhance(el: HTMLElement): HTMLElement {
  (el as unknown as { setAttr: (k: string, v: string) => void }).setAttr = (
    k,
    v,
  ) => el.setAttribute(k, v);
  (el as unknown as { createDiv: (options?: unknown) => HTMLElement }).createDiv = (
    options?: { cls?: string | string[]; attr?: Record<string, string> },
  ) => {
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

function makeLayout(overrides: Partial<Layout>): Layout {
  return {
    uid: overrides.uid ?? "layout-uid",
    label: overrides.label ?? "Layout",
    targetClass: overrides.targetClass ?? "ems__Task",
    blocks: overrides.blocks ?? ["block-a"],
    priority: overrides.priority ?? 0,
    coexistsWithDefault: overrides.coexistsWithDefault ?? false,
    sourcePath: overrides.sourcePath ?? "layout.md",
  };
}

function makePropertiesBlock(uid: string, label = "Props"): LayoutBlock {
  return {
    kind: "properties",
    uid,
    title: "Properties",
    collapsed: false,
    sourcePath: `${uid}.md`,
  } as LayoutBlock;
}

function makeBacklinksBlock(uid: string, label = "Backlinks"): LayoutBlock {
  return {
    kind: "backlinks-table",
    uid,
    title: "Child Tasks",
    collapsed: false,
    sourcePath: `${uid}.md`,
    rowClass: "ems__Task",
    referencingProperty: "ems__Effort_parent",
    columns: ["exo__Asset_label"],
    sortBy: null,
    sortOrder: "asc",
    limit: null,
    showArchived: false,
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

describe("ExoLayoutRenderer", () => {
  function makeRenderer(snapshot: ExoLayoutSnapshot, warnings: string[] = []) {
    const reactRenderer = {
      render: jest.fn(),
      cleanup: jest.fn(),
    };
    const logger = {
      warn: jest.fn((..._args: unknown[]) => {
        warnings.push(JSON.stringify(_args[0]));
      }),
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    };
    const app = {
      metadataCache: {
        getFileCache: jest.fn(() => ({
          frontmatter: { exo__Asset_label: "Asset" },
        })),
      },
    };
    const renderer = new ExoLayoutRenderer({
      app: app as never,
      reactRenderer: reactRenderer as never,
      logger: logger as never,
      snapshotProvider: () => snapshot,
    });
    return { renderer, reactRenderer, logger };
  }

  test("iterates Layout.blocks in order and renders each resolved block", async () => {
    const blocks = [
      makePropertiesBlock("block-a"),
      makeBacklinksBlock("block-b"),
    ];
    const snap = makeSnapshot(blocks);
    const layout = makeLayout({ blocks: ["block-a", "block-b"] });
    const { renderer, reactRenderer } = makeRenderer(snap);
    const el = makeEl();

    const result = await renderer.render(
      el,
      { path: "asset.md" } as never,
      layout,
      [],
    );

    expect(result).toEqual({ rendered: true, blockCount: 2 });
    expect(reactRenderer.render).toHaveBeenCalledTimes(2);
  });

  test("missing block ref is skipped with warn, rest still render", async () => {
    const blocks = [makePropertiesBlock("block-a")];
    const snap = makeSnapshot(blocks);
    const layout = makeLayout({ blocks: ["missing", "block-a"] });
    const warnings: string[] = [];
    const { renderer, reactRenderer, logger } = makeRenderer(snap, warnings);
    const el = makeEl();

    const result = await renderer.render(
      el,
      { path: "asset.md" } as never,
      layout,
      [],
    );

    expect(result.blockCount).toBe(1);
    expect(reactRenderer.render).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalled();
  });

  test("empty layout.blocks array → rendered:false, no render calls", async () => {
    const snap = makeSnapshot([]);
    const layout = makeLayout({ blocks: [] });
    const { renderer, reactRenderer } = makeRenderer(snap);
    const el = makeEl();

    // Forge through the Layout type (constructor-level guard prevents this
    // via parser, but defensively renderer should not throw).
    const result = await renderer.render(
      el,
      { path: "asset.md" } as never,
      layout,
      [],
    );
    expect(result).toEqual({ rendered: false, blockCount: 0 });
    expect(reactRenderer.render).not.toHaveBeenCalled();
  });

  test("data-layout-uid attribute set on container", async () => {
    const blocks = [makePropertiesBlock("block-a")];
    const snap = makeSnapshot(blocks);
    const layout = makeLayout({ uid: "my-layout", blocks: ["block-a"] });
    const { renderer } = makeRenderer(snap);
    const el = makeEl();

    await renderer.render(el, { path: "asset.md" } as never, layout, []);

    const container = el.querySelector(".exocortex-exo-layout");
    expect(container?.getAttribute("data-layout-uid")).toBe("my-layout");
  });

  test("backlinks block filters relations by rowClass + referencingProperty", async () => {
    const block = makeBacklinksBlock("block-b");
    const snap = makeSnapshot([block]);
    const layout = makeLayout({ blocks: ["block-b"] });
    const { renderer, reactRenderer } = makeRenderer(snap);
    const el = makeEl();

    const relations: AssetRelation[] = [
      {
        path: "t1.md",
        title: "Task 1",
        propertyName: "ems__Effort_parent",
        isBodyLink: false,
        created: 0,
        modified: 0,
        metadata: { exo__Instance_class: ["[[ems__Task]]"] },
        file: { path: "t1.md", basename: "t1" },
      } as AssetRelation,
      {
        path: "o1.md",
        title: "Other",
        propertyName: "ems__Effort_area",
        isBodyLink: false,
        created: 0,
        modified: 0,
        metadata: { exo__Instance_class: ["[[ems__Other]]"] },
        file: { path: "o1.md", basename: "o1" },
      } as AssetRelation,
    ];

    await renderer.render(el, { path: "asset.md" } as never, layout, relations);
    const props = (reactRenderer.render as jest.Mock).mock.calls[0][1].props;
    expect(props.rows).toHaveLength(1);
    expect(props.rows[0].title).toBe("Task 1");
  });
});
