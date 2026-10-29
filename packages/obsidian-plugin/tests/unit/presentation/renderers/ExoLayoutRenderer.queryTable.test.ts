/**
 * RFC 9821a379 §Шаг 2 — drawing the `query-table` block (ticket 058bad52):
 * AC8 (loading until the index is stable, then rows without a re-render),
 * the asynchronous scaffold (a late answer for a replaced page is dropped),
 * AC11 (a failing block draws its error in place; the next blocks still draw).
 *
 * revert-verify: `ExoLayoutRenderer.queryTable.spec.json`.
 */
import React from "react";
import type {
  Layout,
  LayoutBlock,
  QueryTableBlock,
} from "@kitelev/exocortex-core";
import { ExoLayoutRenderer } from "../../../../src/presentation/renderers/ExoLayoutRenderer";
import type { ExoLayoutSnapshot } from "../../../../src/infrastructure/repositories";
import type { QueryTableOutcome } from "../../../../src/presentation/renderers/layout/QueryTableProvider";
import type { QueryTableViewState } from "../../../../src/presentation/components/LayoutBlocks";
import type { IndexStabilityOutcome } from "../../../../src/application/services/IndexStability";

function enhance(el: HTMLElement): HTMLElement {
  const any = el as unknown as Record<string, unknown>;
  any.setAttr = (k: string, v: string) => el.setAttribute(k, v);
  any.createDiv = (options?: {
    cls?: string;
    attr?: Record<string, string>;
  }) => {
    const child = document.createElement("div");
    if (options?.cls) child.className = options.cls;
    for (const [k, v] of Object.entries(options?.attr ?? {}))
      child.setAttribute(k, v);
    el.appendChild(child as unknown as Node);
    return enhance(child);
  };
  return el;
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

function queryBlock(uid = "qb", emptyText = "Эпизодов нет"): QueryTableBlock {
  return {
    kind: "query-table",
    uid,
    title: "Эпизоды дня",
    collapsed: false,
    layoutRef: "L",
    order: 1,
    sourcePath: `${uid}.md`,
    query: "q",
    limit: 100,
    emptyText,
  } as QueryTableBlock;
}

function propertiesBlock(uid: string): LayoutBlock {
  return {
    kind: "properties",
    uid,
    title: "Props",
    collapsed: false,
    layoutRef: "L",
    order: 2,
    sourcePath: `${uid}.md`,
  } as LayoutBlock;
}

function backlinksBlock(uid: string): LayoutBlock {
  return {
    kind: "backlinks-table",
    uid,
    title: "Дети",
    collapsed: false,
    layoutRef: "L",
    order: 1,
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

function dailyBlock(uid: string): LayoutBlock {
  return {
    kind: "daily-efforts-by-class",
    uid,
    title: "Задачи дня",
    collapsed: false,
    layoutRef: "L",
    order: 0,
    sourcePath: `${uid}.md`,
    partition: "tasks",
  } as LayoutBlock;
}

function snapshot(blocks: LayoutBlock[]): ExoLayoutSnapshot {
  const byUid = new Map(blocks.map((b) => [b.uid, b] as const));
  return {
    layouts: [],
    blocks,
    blocksByUid: byUid,
    blocksByLabel: new Map(byUid),
  };
}

function layout(blocks: string[]): Layout {
  return {
    uid: "L",
    label: "L",
    targetClass: "pn__DailyNote",
    blocks,
    priority: 0,
    coexistsWithDefault: true,
    sourcePath: "L.md",
  } as Layout;
}

const ROWS: QueryTableOutcome = {
  kind: "rows",
  queryLabel: "Эпизоды",
  columns: ["Эпизод"],
  rows: [[{ kind: "text", text: "Утро" }]],
  total: 1,
  elapsedMs: 7,
};

function setup(options: {
  blocks?: LayoutBlock[];
  provider?: jest.Mock;
  stability?: {
    isStable(): boolean;
    whenStable(): Promise<IndexStabilityOutcome>;
  };
  withProvider?: boolean;
  dailyEffortsProvider?: () => never;
}) {
  const reactRenderer = { render: jest.fn(), cleanup: jest.fn() };
  const logger = {
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  };
  const openLinkText = jest.fn();
  const app = {
    metadataCache: { getFileCache: jest.fn(() => ({ frontmatter: {} })) },
    workspace: { openLinkText },
  };
  const provider = options.provider ?? jest.fn().mockResolvedValue(ROWS);
  const renderer = new ExoLayoutRenderer({
    app: app as never,
    reactRenderer: reactRenderer as never,
    logger: logger as never,
    snapshotProvider: () => snapshot(options.blocks ?? [queryBlock()]),
    queryTableProvider:
      options.withProvider === false ? undefined : (provider as never),
    indexStability: options.stability,
    dailyEffortsProvider: options.dailyEffortsProvider,
  });
  /** Every state painted into the block container whose ancestor is `root`. */
  const paints = (root: HTMLElement): QueryTableViewState[] =>
    reactRenderer.render.mock.calls
      .filter(([container]) => root.contains(container as Node))
      .map(
        ([, element]) =>
          (element as React.ReactElement<{ state: QueryTableViewState }>).props
            .state,
      );
  /** States painted into exactly this block container. */
  const paintsInto = (container: Element | undefined): string[] =>
    reactRenderer.render.mock.calls
      .filter(([c]) => c === container)
      .map(
        ([, element]) =>
          (element as React.ReactElement<{ state: QueryTableViewState }>).props
            .state.kind,
      );
  return {
    renderer,
    reactRenderer,
    logger,
    provider,
    openLinkText,
    paints,
    paintsInto,
  };
}

/** A root the page renderer draws into, ON the page (attached to the document). */
function onPage(): HTMLElement {
  const el = enhance(document.createElement("div"));
  document.body.appendChild(el as unknown as Node);
  return el;
}

const blocksOf = (root: HTMLElement): Element[] =>
  Array.from(root.querySelectorAll('[data-block-uid="qb"]'));

const STABLE: IndexStabilityOutcome = { kind: "stable" };

const fileA = { path: "notes/2026-08-09 Note.md" } as never;
const fileB = { path: "notes/2026-08-10 Note.md" } as never;

describe("ExoLayoutRenderer — query-table block (RFC 9821a379, ticket 058bad52)", () => {
  it("E1 @req:23f10730-82f7-4037-b566-da79d5fa3378 while the index is not stable the block shows loading and does not query; when it settles the rows appear without another render", async () => {
    let stable = false;
    const settled = deferred<IndexStabilityOutcome>();
    const { renderer, provider, paints } = setup({
      stability: { isStable: () => stable, whenStable: () => settled.promise },
    });
    const el = enhance(document.createElement("div"));
    await renderer.render(el, fileA, layout(["qb"]), []);
    await flush();
    expect(provider).not.toHaveBeenCalled();
    expect(paints(el).map((s) => s.kind)).toEqual(["loading"]);

    stable = true;
    settled.resolve(STABLE);
    await renderer.whenSettled();
    expect(provider).toHaveBeenCalledTimes(1);
    expect(paints(el).map((s) => s.kind)).toEqual(["loading", "rows"]);
  });

  it("E2 @req:23f10730-82f7-4037-b566-da79d5fa3378 an answer for a render of a root that was rendered again (refresh) is dropped", async () => {
    const late = deferred<QueryTableOutcome>();
    const provider = jest
      .fn()
      .mockReturnValueOnce(late.promise)
      .mockResolvedValue(ROWS);
    const { renderer, paintsInto } = setup({ provider });
    const el = enhance(document.createElement("div"));
    await renderer.render(el, fileA, layout(["qb"]), []);
    await flush();
    await renderer.render(el, fileA, layout(["qb"]), []);
    await flush();
    late.resolve(ROWS);
    await renderer.whenSettled();
    const [first, second] = blocksOf(el);
    expect(paintsInto(first)).toEqual(["loading"]);
    expect(paintsInto(second)).toEqual(["loading", "rows"]);
  });

  it("E3 @req:23f10730-82f7-4037-b566-da79d5fa3378 a render of a root rendered again while waiting for a stable index never queries", async () => {
    let stable = false;
    const settled = deferred<IndexStabilityOutcome>();
    const { renderer, provider } = setup({
      stability: { isStable: () => stable, whenStable: () => settled.promise },
    });
    const el = enhance(document.createElement("div"));
    await renderer.render(el, fileA, layout(["qb"]), []);
    await renderer.render(el, fileB, layout(["qb"]), []);
    stable = true;
    settled.resolve(STABLE);
    await flush();
    await renderer.whenSettled();
    expect(provider).toHaveBeenCalledTimes(1);
    expect(provider.mock.calls[0][0]).toBe(fileB);
  });

  it("E9 @req:23f10730-82f7-4037-b566-da79d5fa3378 a page render of the same root WITHOUT a Layout drops the pending answer", async () => {
    const late = deferred<QueryTableOutcome>();
    const provider = jest.fn().mockReturnValueOnce(late.promise);
    const { renderer, paintsInto } = setup({ provider });
    const el = enhance(document.createElement("div"));
    await renderer.render(el, fileA, layout(["qb"]), []);
    await flush();
    renderer.beginPage(el);
    late.resolve(ROWS);
    await flush();
    expect(paintsInto(blocksOf(el)[0])).toEqual(["loading"]);
  });

  it("E10 @req:23f10730-82f7-4037-b566-da79d5fa3378 renders finishing out of order: the page that was left does not silence the visible one", async () => {
    const { renderer, provider, paintsInto } = setup({});
    const rootA = onPage();
    const gA = renderer.beginPage(rootA);
    const rootB = onPage();
    const gB = renderer.beginPage(rootB);
    rootA.remove();
    await renderer.render(rootB, fileB, layout(["qb"]), [], gB);
    await renderer.render(rootA, fileA, layout(["qb"]), [], gA);
    await renderer.whenSettled();
    expect(paintsInto(blocksOf(rootB)[0])).toEqual(["loading", "rows"]);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(provider.mock.calls[0][0]).toBe(fileB);
    rootB.remove();
  });

  it("E11 @req:23f10730-82f7-4037-b566-da79d5fa3378 a page left while its block waited for a stable index never queries", async () => {
    let stable = false;
    const settled = deferred<IndexStabilityOutcome>();
    const { renderer, provider } = setup({
      stability: { isStable: () => stable, whenStable: () => settled.promise },
    });
    const root = onPage();
    await renderer.render(root, fileA, layout(["qb"]), []);
    root.remove();
    stable = true;
    settled.resolve(STABLE);
    await flush();
    await renderer.whenSettled();
    expect(provider).not.toHaveBeenCalled();
  });

  it("E12 @req:23f10730-82f7-4037-b566-da79d5fa3378 a render that started before a newer render of the same root is stale from birth", async () => {
    const { renderer, provider, paintsInto } = setup({});
    const el = enhance(document.createElement("div"));
    const older = renderer.beginPage(el);
    const newer = renderer.beginPage(el);
    await renderer.render(el, fileB, layout(["qb"]), [], newer);
    await renderer.render(el, fileA, layout(["qb"]), [], older);
    await renderer.whenSettled();
    expect(provider).toHaveBeenCalledTimes(1);
    expect(provider.mock.calls[0][0]).toBe(fileB);
    const [fromNewer, fromOlder] = blocksOf(el);
    expect(paintsInto(fromNewer)).toEqual(["loading", "rows"]);
    expect(paintsInto(fromOlder)).toEqual([]);
  });

  it("E13 @req:23f10730-82f7-4037-b566-da79d5fa3378 a failure of the shared daily computation is the daily blocks' own; the query-table block still draws", async () => {
    const { renderer, provider, paintsInto } = setup({
      blocks: [dailyBlock("d"), queryBlock()],
      dailyEffortsProvider: () => {
        throw new Error("daily scan failed");
      },
    });
    const el = enhance(document.createElement("div"));
    const result = await renderer.render(el, fileA, layout(["d", "qb"]), []);
    await renderer.whenSettled();
    expect(
      el.querySelector('[data-block-uid="d"] .exocortex-layout-block-error')
        ?.textContent,
    ).toBe("Блок «Задачи дня»: daily scan failed");
    expect(provider).toHaveBeenCalledTimes(1);
    expect(paintsInto(blocksOf(el)[0])).toEqual(["loading", "rows"]);
    expect(result.blockCount).toBe(1);
  });

  it("E14 @req:23f10730-82f7-4037-b566-da79d5fa3378 an index that could not be built is said in the block, not an endless loading", async () => {
    const { renderer, provider, paints } = setup({
      stability: {
        isStable: () => false,
        whenStable: async () => ({ kind: "failed", message: "walk failed" }),
      },
    });
    const el = enhance(document.createElement("div"));
    await renderer.render(el, fileA, layout(["qb"]), []);
    await renderer.whenSettled();
    expect(provider).not.toHaveBeenCalled();
    expect(paints(el).at(-1)).toEqual({
      kind: "message",
      text: "Индекс хранилища не построен (walk failed) — строки появятся после переиндексации",
    });
  });

  it("E4 @req:23f10730-82f7-4037-b566-da79d5fa3378 a block that throws draws its error in its own place; the next block still renders and render() does not throw", async () => {
    const { renderer, reactRenderer, logger } = setup({
      blocks: [backlinksBlock("bad"), propertiesBlock("ok")],
    });
    const el = enhance(document.createElement("div"));
    const broken = [
      {
        path: "t.md",
        title: "T",
        propertyName: "ems__Effort_parent",
        metadata: undefined,
      },
    ];
    const result = await renderer.render(
      el,
      fileA,
      layout(["bad", "ok"]),
      broken as never,
    );
    expect(result.blockCount).toBe(1);
    const bad = el.querySelector(
      '[data-block-uid="bad"] .exocortex-layout-block-error',
    );
    expect(bad?.textContent).toContain("Блок «Дети»");
    const ok = el.querySelector('[data-block-uid="ok"]');
    expect(reactRenderer.render.mock.calls.some(([c]) => c === ok)).toBe(true);
    expect(logger.error).toHaveBeenCalled();
  });

  it("E5 @req:23f10730-82f7-4037-b566-da79d5fa3378 a provider that throws is shown in the block, not lost", async () => {
    const provider = jest.fn().mockRejectedValue(new Error("boom"));
    const { renderer, paints } = setup({ provider });
    const el = enhance(document.createElement("div"));
    await renderer.render(el, fileA, layout(["qb"]), []);
    await renderer.whenSettled();
    expect(paints(el).at(-1)).toEqual({
      kind: "message",
      text: "Запрос «q»: boom",
    });
  });

  it("E6 @req:23f10730-82f7-4037-b566-da79d5fa3378 an empty result shows the block's own empty text; a problem shows the provider's named message", async () => {
    const provider = jest
      .fn()
      .mockResolvedValueOnce({ ...ROWS, rows: [], total: 0 })
      .mockResolvedValueOnce({
        kind: "unset-token",
        queryLabel: "Эпизоды",
        tokens: ["x"],
      });
    const { renderer, paints } = setup({ provider });
    const el1 = enhance(document.createElement("div"));
    await renderer.render(el1, fileA, layout(["qb"]), []);
    await renderer.whenSettled();
    expect(paints(el1).at(-1)).toMatchObject({
      kind: "rows",
      emptyText: "Эпизодов нет",
    });
    const el2 = enhance(document.createElement("div"));
    await renderer.render(el2, fileA, layout(["qb"]), []);
    await renderer.whenSettled();
    expect(paints(el2).at(-1)).toEqual({
      kind: "message",
      text: "Запрос «Эпизоды»: в запросе не задан $x",
    });
  });

  it("E7 @req:23f10730-82f7-4037-b566-da79d5fa3378 without a wired provider the block says so instead of staying blank", async () => {
    const { renderer, paints } = setup({ withProvider: false });
    const el = enhance(document.createElement("div"));
    await renderer.render(el, fileA, layout(["qb"]), []);
    expect(paints(el)).toEqual([
      {
        kind: "message",
        text: "Запрос «q»: исполнитель запросов не подключён",
      },
    ]);
  });

  it("E8 @req:23f10730-82f7-4037-b566-da79d5fa3378 a link cell opens its asset from the page", async () => {
    const { renderer, reactRenderer, openLinkText } = setup({});
    const el = enhance(document.createElement("div"));
    await renderer.render(el, fileA, layout(["qb"]), []);
    await renderer.whenSettled();
    const props = (
      reactRenderer.render.mock.calls.at(-1)?.[1] as React.ReactElement<{
        onLinkClick?: (p: string) => void;
      }>
    ).props;
    props.onLinkClick?.("my/ep-1.md");
    expect(openLinkText).toHaveBeenCalledWith(
      "my/ep-1.md",
      "notes/2026-08-09 Note.md",
      false,
    );
  });

  it("E15 @req:23f10730-82f7-4037-b566-da79d5fa3378 a page left while its query is in flight (stable index) is not painted", async () => {
    const late = deferred<QueryTableOutcome>();
    const provider = jest.fn().mockReturnValueOnce(late.promise);
    const { renderer, paintsInto } = setup({ provider });
    const root = onPage();
    await renderer.render(root, fileA, layout(["qb"]), []);
    await flush();
    expect(provider).toHaveBeenCalledTimes(1);
    const block = blocksOf(root)[0];
    root.remove();
    late.resolve(ROWS);
    await renderer.whenSettled();
    expect(paintsInto(block)).toEqual(["loading"]);
  });

  it("E16 @req:23f10730-82f7-4037-b566-da79d5fa3378 the error a block draws in its place keeps its title as text, never as HTML", async () => {
    const evil = { ...backlinksBlock("bad"), title: '<img src=x id="pwn">' };
    const { renderer } = setup({ blocks: [evil as LayoutBlock] });
    const el = enhance(document.createElement("div"));
    const broken = [
      {
        path: "t.md",
        title: "T",
        propertyName: "ems__Effort_parent",
        metadata: undefined,
      },
    ];
    await renderer.render(el, fileA, layout(["bad"]), broken as never);
    const error = el.querySelector(
      '[data-block-uid="bad"] .exocortex-layout-block-error',
    );
    expect(error).not.toBeNull();
    expect(error?.querySelector("img")).toBeNull();
    expect(error?.textContent).toContain('Блок «<img src=x id="pwn">»');
  });
});
