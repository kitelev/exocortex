/**
 * ExoLayoutRenderer — orchestrates block-by-block rendering of a resolved
 * `exo__Layout` into the Obsidian DOM.
 *
 * Role in the pipeline (RFC exo__Layout §"Architectural placement"):
 *   `UniversalLayoutRenderer` resolves a Layout via `LayoutSelector`; if a
 *   Layout is returned and the feature flag is on, this renderer iterates
 *   the layout's `blocks` array, looks up each block asset in the repository
 *   snapshot, and delegates to the appropriate block view.
 *
 * Reliability (RFC §"Reliability", lesson from `feedback_relcolset_shipped_bugs`):
 *   - Missing block asset → skip + log.warn; other blocks still render.
 *   - Unknown block kind → never happens by construction (parser returns null
 *     for unknown classes and the repository filters them out), but we still
 *     branch defensively to satisfy the fault-injection test matrix.
 *   - Empty blocks array → rendered empty section, no throw.
 *
 * Security: block `title` and all rendered cell values are JSX-escaped by the
 * React components; see `presentation/components/LayoutBlocks.tsx`.
 *
 * @module presentation/renderers
 * @since 15.x (RFC exo__Layout Phase 2)
 */

import React from "react";
import type { TFile } from "obsidian";
import type {
  DailyEffortsPartition,
  DailyEffortsPartitioned,
  Layout,
  LayoutBlock,
  QueryTableBlock,
} from "@kitelev/exocortex-core";
import type { ReactRenderer } from "@plugin/presentation/utils/ReactRenderer";
import type { ExoLayoutSnapshot } from "@plugin/infrastructure/repositories";
import type { AssetRelation } from "./layout/types";
import type { ILogger } from "@plugin/adapters/logging/ILogger";
import type { ObsidianApp } from "@plugin/types";
import type { IndexStabilityOutcome } from "@plugin/application/services/IndexStability";
import {
  BacklinksTableBlockView,
  DailyEffortsBlockView,
  PropertiesBlockView,
  QueryTableBlockView,
  type QueryTableViewState,
} from "@plugin/presentation/components/LayoutBlocks";
import {
  describeQueryTableProblem,
  type QueryTableOutcome,
  type QueryTableProvider,
} from "./layout/QueryTableProvider";
import { AssetMetadataService } from "@plugin/presentation/renderers/layout/helpers/AssetMetadataService";
import {
  WikiLinkHelpers,
  partitionDailyEffortsByClass,
  resolveDailyEffortVisibility,
} from "@kitelev/exocortex-core";

/**
 * A day-scoped effort surfaced to a `daily-efforts-by-class` block. The
 * provider (wired in `UniversalLayoutRenderer`) scans the vault for efforts
 * relevant to the note's day and returns this minimal shape; the renderer
 * partitions it once per render.
 *
 * The provider stamps two orthogonal relevance flags (req b2a33efc / issue
 * #3781): `inDay` (matched `isEffortInDay` — start/end/planned; feeds the
 * Actions/Tasks/Projects class buckets) and `closedInDay` (matched
 * `isEffortClosedInDay` — resolution/end on the day; feeds the "closed" axis).
 * Both are optional for back-compat: a legacy/test item without flags is
 * treated as `inDay` (in the class buckets) and not closed.
 */
export interface DailyEffortItem {
  readonly path: string;
  readonly title: string;
  readonly metadata: Record<string, unknown>;
  /** Whether the effort matched `isEffortInDay` (feeds the class buckets). */
  readonly inDay?: boolean;
  /** Whether the effort was closed on the day (feeds the "closed" axis). */
  readonly closedInDay?: boolean;
}

export interface ExoLayoutRendererDeps {
  readonly app: ObsidianApp;
  readonly reactRenderer: ReactRenderer;
  readonly logger: ILogger;
  readonly snapshotProvider: () => ExoLayoutSnapshot;
  /**
   * RFC pn__DailyNote toggles (req a38ac95b) — supplies the day's efforts for
   * `daily-efforts-by-class` blocks. Returns `null` when `file` is not a daily
   * note (or no day can be derived); returns the (possibly empty) effort list
   * otherwise. Optional: when absent, daily-efforts blocks render empty. The
   * read-path is Obsidian-core only (vault.adapter), no Platform gate
   * (desktop↔mobile parity).
   */
  readonly dailyEffortsProvider?: (
    file: TFile,
  ) => readonly DailyEffortItem[] | null;
  /**
   * RFC 9821a379 §Шаг 2 (ticket 058bad52) — rows of a `query-table` block.
   * Absent ⇒ the block says the runner is not wired (never a silent blank).
   */
  readonly queryTableProvider?: QueryTableProvider;
  /**
   * RFC 9821a379 decision 7 — «индекс стабилен». While it is false a
   * `query-table` block shows loading and waits; absent ⇒ treated as stable.
   */
  readonly indexStability?: {
    isStable(): boolean;
    whenStable(): Promise<IndexStabilityOutcome>;
  };
}

export interface ExoLayoutRenderResult {
  readonly rendered: boolean;
  readonly blockCount: number;
}

export class ExoLayoutRenderer {
  /**
   * Which page render owns each ROOT element (the container the page renderer
   * draws into). RFC §Шаг 2: «ответ, пришедший после смены страницы,
   * отбрасывается». A `query-table` fill queries and paints only while
   *  - its page render is still the latest one of its root — a re-render of the
   *    same root (`refresh()`) supersedes it, even when the OLDER render reaches
   *    this renderer later (renders finish out of order), and
   *  - its root, if it was on the page when the render started, still is —
   *    opening another note removes the root.
   * ⛔ Keyed per root, never one counter for the plugin: two pages render
   * concurrently, and a slow render of the page that was LEFT would otherwise
   * supersede the visible one and leave it on «Загрузка…» (ticket 058bad52,
   * review X1). A root that was not on the page when its render started is
   * judged by its generation alone. Both page renders in ExocortexPlugin
   * attach the root first; `UniversalLayoutRenderer.refresh()` re-renders the
   * root it last drew into without checking that it is still attached, so a
   * refresh after autoRenderLayout removed that root queries once and paints
   * into the detached root — a cost, not a wrong page.
   */
  private readonly roots = new WeakMap<
    HTMLElement,
    { readonly generation: number; readonly wasOnPage: boolean }
  >();
  private lastGeneration = 0;
  private readonly pending = new Set<Promise<void>>();

  constructor(private readonly deps: ExoLayoutRendererDeps) {}

  /**
   * Resolves when every asynchronous block fill started so far has painted or
   * been dropped. The page does not wait for it (`render()` returns as soon as
   * the placeholders are in place); tests and measurements do.
   */
  whenSettled(): Promise<void> {
    return Promise.all([...this.pending]).then(() => undefined);
  }

  /**
   * A page render of `root` starts — the page renderer calls it FIRST, before
   * any await, and passes the result to {@link render}. Every earlier render of
   * the same root is superseded from this moment, including one that has not
   * reached {@link render} yet. Returns the render's generation.
   */
  beginPage(root: HTMLElement): number {
    const generation = ++this.lastGeneration;
    this.roots.set(root, { generation, wasOnPage: root.isConnected });
    return generation;
  }

  async render(
    el: HTMLElement,
    file: TFile,
    layout: Layout,
    relations: readonly AssetRelation[],
    pageGeneration: number = this.beginPage(el),
  ): Promise<ExoLayoutRenderResult> {
    const isCurrent = (): boolean => {
      const root = this.roots.get(el);
      return (
        root !== undefined &&
        root.generation === pageGeneration &&
        (!root.wasOnPage || el.isConnected)
      );
    };
    const snapshot = this.deps.snapshotProvider();
    const container = el.createDiv({ cls: "exocortex-exo-layout" });
    container.setAttr("data-layout-uid", layout.uid);
    container.setAttr(
      "data-coexists-with-default",
      String(layout.coexistsWithDefault),
    );

    // Resolve note frontmatter (for daily-efforts visibility overrides) and
    // the day's efforts partition ONCE per render. The partition is a single
    // O(n) scan reused across all three daily-efforts blocks (perf — review
    // note); it is computed lazily only when the layout actually carries a
    // daily-efforts block.
    const noteFrontmatter = (this.deps.app.metadataCache.getFileCache(file)
      ?.frontmatter ?? null) as Record<string, unknown> | null;
    // AC11 — a failure of the shared daily computation is the daily blocks'
    // failure, drawn in THEIR places; the other blocks still render.
    let partition: DailyEffortsPartitioned<DailyEffortItem> | null = null;
    let partitionError: Error | null = null;
    try {
      partition = this.computeDailyPartition(file, layout, snapshot);
    } catch (error) {
      partitionError =
        error instanceof Error ? error : new Error(String(error));
    }

    let blockCount = 0;
    for (const rawRef of layout.blocks) {
      const block = resolveBlock(rawRef, snapshot);
      if (block === null) {
        this.deps.logger.warn(
          `ExoLayoutRenderer: block "${rawRef}" not found (layout=${layout.uid}, file=${file.path})`,
        );
        continue;
      }
      // RL#4a — a block resolved as not-visible is skipped entirely (no DOM,
      // no React render). Visibility is generic (`block.visible !== false`)
      // for properties/backlinks blocks; for daily-efforts blocks it merges
      // the per-note override > Layout default > built-in VL#3.
      if (!this.isBlockVisible(block, noteFrontmatter)) {
        continue;
      }
      const blockContainer = container.createDiv({
        cls: "exocortex-exo-layout-block",
        attr: {
          "data-block-uid": block.uid,
          "data-block-kind": block.kind,
        },
      });
      // AC11 (RFC 9821a379) — a block that throws draws its error in its own
      // place; the next blocks and the page sections below still render.
      try {
        await this.renderBlock(
          blockContainer,
          file,
          block,
          relations,
          partition,
          partitionError,
          isCurrent,
        );
        blockCount += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.deps.logger.error(
          `ExoLayoutRenderer: block ${block.uid} failed (file=${file.path}): ${message}`,
        );
        blockContainer.createDiv({
          cls: "exocortex-layout-block-error",
        }).textContent = `Блок «${block.title}»: ${message}`;
      }
    }

    return { rendered: blockCount > 0, blockCount };
  }

  /**
   * Compute the day-efforts partition once when the layout has at least one
   * daily-efforts block and a provider is wired. Returns `null` otherwise
   * (non-daily layouts pay zero cost).
   */
  private computeDailyPartition(
    file: TFile,
    layout: Layout,
    snapshot: ExoLayoutSnapshot,
  ): DailyEffortsPartitioned<DailyEffortItem> | null {
    if (this.deps.dailyEffortsProvider === undefined) return null;
    const hasDailyBlock = layout.blocks.some((rawRef) => {
      const block = resolveBlock(rawRef, snapshot);
      return block !== null && block.kind === "daily-efforts-by-class";
    });
    if (!hasDailyBlock) return null;
    const efforts = this.deps.dailyEffortsProvider(file) ?? [];
    // Class buckets (Actions/Tasks/Projects) are computed ONLY over the `inDay`
    // subset → byte-identical to req a38ac95b (a Trashed-only closure, inDay
    // false, is excluded from the class buckets). The "closed" axis (req
    // b2a33efc / issue #3781) is the `closedInDay` subset — orthogonal to the
    // class buckets, may overlap them (a Done task appears in both). Items
    // without the flags (legacy/test shape) default to inDay + not-closed.
    const inDayEfforts = efforts.filter((e) => e.inDay !== false);
    const closed = efforts.filter((e) => e.closedInDay === true);
    return { ...partitionDailyEffortsByClass(inDayEfforts), closed };
  }

  private isBlockVisible(
    block: LayoutBlock,
    noteFrontmatter: Record<string, unknown> | null,
  ): boolean {
    if (block.kind === "daily-efforts-by-class") {
      return resolveDailyEffortVisibility(
        block.partition,
        noteFrontmatter,
        block.visible,
      );
    }
    return block.visible !== false;
  }

  private async renderBlock(
    blockContainer: HTMLElement,
    file: TFile,
    block: LayoutBlock,
    relations: readonly AssetRelation[],
    partition: DailyEffortsPartitioned<DailyEffortItem> | null,
    partitionError: Error | null,
    isCurrent: () => boolean,
  ): Promise<void> {
    if (block.kind === "properties") {
      this.renderPropertiesBlock(blockContainer, file, block.title);
      return;
    }
    if (block.kind === "backlinks-table") {
      this.renderBacklinksBlock(blockContainer, relations, block);
      return;
    }
    if (block.kind === "daily-efforts-by-class") {
      if (partitionError !== null) throw partitionError;
      this.renderDailyEffortsBlock(blockContainer, block.partition, block.title, partition);
      return;
    }
    if (block.kind === "query-table") {
      this.renderQueryTableBlock(blockContainer, file, block, isCurrent);
      return;
    }
    // Defensive branch — parser/type guard should have prevented unknown
    // kinds from ever reaching this point; we still skip quietly.
    const unreachable: never = block;
    this.deps.logger.warn(
      `ExoLayoutRenderer: unknown block kind on asset ${(unreachable as LayoutBlock).uid}`,
    );
  }

  /**
   * RFC 9821a379 §Шаг 2 — draws the placeholder now and fills the rows
   * asynchronously: the page below does not wait for the query, and the fill
   * first waits for a stable index (AC8: loading, never the empty text, while
   * the store is incomplete; the rows appear by themselves when it settles).
   */
  private renderQueryTableBlock(
    container: HTMLElement,
    file: TFile,
    block: QueryTableBlock,
    isCurrent: () => boolean,
  ): void {
    const paint = (state: QueryTableViewState): void => {
      this.deps.reactRenderer.render(
        container,
        React.createElement(QueryTableBlockView, {
          title: block.title,
          state,
          onLinkClick: (path: string) => {
            void this.deps.app.workspace.openLinkText(path, file.path, false);
          },
        }),
      );
    };
    const provider = this.deps.queryTableProvider;
    if (provider === undefined) {
      paint({
        kind: "message",
        text: `Запрос «${block.query}»: исполнитель запросов не подключён`,
      });
      return;
    }
    if (!isCurrent()) return;
    paint({ kind: "loading" });
    const fill = (async () => {
      // Checked at render time above; re-checked only after an await — the
      // stability wait is the only one before the query.
      const stability = this.deps.indexStability;
      if (stability !== undefined && !stability.isStable()) {
        const settled = await stability.whenStable();
        if (!isCurrent()) return;
        if (settled.kind === "failed") {
          paint({
            kind: "message",
            text: `Индекс хранилища не построен (${settled.message}) — строки появятся после переиндексации`,
          });
          return;
        }
      }
      const outcome = await provider(file, block);
      if (!isCurrent()) return;
      paint(toViewState(outcome, block));
    })().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.logger.error(
        `ExoLayoutRenderer: query-table block ${block.uid} failed (file=${file.path}): ${message}`,
      );
      if (isCurrent()) {
        paint({ kind: "message", text: `Запрос «${block.query}»: ${message}` });
      }
    });
    this.pending.add(fill);
    void fill.then(() => this.pending.delete(fill));
  }

  private renderDailyEffortsBlock(
    container: HTMLElement,
    partitionKey: DailyEffortsPartition,
    title: string,
    partition: DailyEffortsPartitioned<DailyEffortItem> | null,
  ): void {
    const items = partition ? partition[partitionKey] : [];
    this.deps.reactRenderer.render(
      container,
      React.createElement(DailyEffortsBlockView, {
        title,
        items: items.map((e) => ({ path: e.path, title: e.title })),
        onItemClick: (path: string) => {
          void this.deps.app.workspace.openLinkText(path, "", false);
        },
      }),
    );
  }

  private renderPropertiesBlock(
    container: HTMLElement,
    file: TFile,
    title: string,
  ): void {
    const cache = this.deps.app.metadataCache.getFileCache(file);
    const frontmatter = (cache?.frontmatter ?? {}) as Record<string, unknown>;
    const entries = Object.entries(frontmatter)
      .filter(([key]) => !key.startsWith("position"))
      .map(([key, value]) => ({ key, value }));

    // RFC 0002 §3.7 (P11): resolve UID-only enum/class wikilink values to a
    // readable `exo__Asset_label` so the Properties block reads "Project",
    // not `[[uuid]]`. Reuses the same resolver the relations table uses.
    const metadataService = new AssetMetadataService(this.deps.app);
    const resolveLabel = (target: string): string | null =>
      metadataService.getAssetLabel(target);

    this.deps.reactRenderer.render(
      container,
      React.createElement(PropertiesBlockView, {
        title,
        properties: entries,
        resolveLabel,
      }),
    );
  }

  private renderBacklinksBlock(
    container: HTMLElement,
    relations: readonly AssetRelation[],
    block: Extract<LayoutBlock, { kind: "backlinks-table" }>,
  ): void {
    const rows = filterBacklinks(relations, block);
    const sorted = sortBacklinks(rows, block);
    const limited =
      block.limit !== null && block.limit >= 0
        ? sorted.slice(0, block.limit)
        : sorted;

    this.deps.reactRenderer.render(
      container,
      React.createElement(BacklinksTableBlockView, {
        title: block.title,
        columns: block.columns,
        rows: limited,
      }),
    );
  }
}

function toViewState(
  outcome: QueryTableOutcome,
  block: QueryTableBlock,
): QueryTableViewState {
  if (outcome.kind !== "rows") {
    return { kind: "message", text: describeQueryTableProblem(outcome) };
  }
  return {
    kind: "rows",
    columns: outcome.columns,
    rows: outcome.rows,
    total: outcome.total,
    elapsedMs: outcome.elapsedMs,
    emptyText: block.emptyText,
  };
}

function resolveBlock(
  rawRef: string,
  snapshot: ExoLayoutSnapshot,
): LayoutBlock | null {
  if (!rawRef) return null;
  const normalized = WikiLinkHelpers.normalize(rawRef);
  if (!normalized) return null;
  const byUid = snapshot.blocksByUid.get(normalized);
  if (byUid !== undefined) return byUid;
  const byLabel = snapshot.blocksByLabel.get(normalized);
  if (byLabel !== undefined) return byLabel;
  return null;
}

function filterBacklinks(
  relations: readonly AssetRelation[],
  block: Extract<LayoutBlock, { kind: "backlinks-table" }>,
): AssetRelation[] {
  const out: AssetRelation[] = [];
  for (const r of relations) {
    if (!block.showArchived && r.isArchived) continue;
    if (r.propertyName && normalize(r.propertyName) !== block.referencingProperty) {
      continue;
    }
    if (!r.propertyName && block.referencingProperty) {
      continue;
    }
    if (!matchesRowClass(r.metadata, block.rowClass)) continue;
    out.push(r);
  }
  return out;
}

function sortBacklinks(
  rows: AssetRelation[],
  block: Extract<LayoutBlock, { kind: "backlinks-table" }>,
): AssetRelation[] {
  const sortBy = block.sortBy ?? "exo__Asset_label";
  const dir = block.sortOrder === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const aVal = cellValue(a, sortBy);
    const bVal = cellValue(b, sortBy);
    if (aVal < bVal) return -1 * dir;
    if (aVal > bVal) return 1 * dir;
    return 0;
  });
}

function normalize(value: string): string {
  return WikiLinkHelpers.normalize(value);
}

function matchesRowClass(
  metadata: Record<string, unknown>,
  rowClass: string,
): boolean {
  const raw = metadata["exo__Instance_class"];
  const entries = Array.isArray(raw)
    ? raw.filter((v): v is string => typeof v === "string")
    : typeof raw === "string"
      ? [raw]
      : [];
  for (const entry of entries) {
    if (normalize(entry) === rowClass) return true;
  }
  return false;
}

function cellValue(row: AssetRelation, column: string): string | number {
  if (column === "exo__Asset_label") return row.title ?? "";
  const value = row.metadata[column];
  if (typeof value === "number") return value;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return String(value[0] ?? "");
  return value == null ? "" : String(value);
}
