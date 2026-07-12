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
} from "@kitelev/exocortex-core";
import type { ReactRenderer } from "@plugin/presentation/utils/ReactRenderer";
import type { ExoLayoutSnapshot } from "@plugin/infrastructure/repositories";
import type { AssetRelation } from "./layout/types";
import type { ILogger } from "@plugin/adapters/logging/ILogger";
import type { ObsidianApp } from "@plugin/types";
import {
  BacklinksTableBlockView,
  DailyEffortsBlockView,
  PropertiesBlockView,
} from "@plugin/presentation/components/LayoutBlocks";
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
}

export interface ExoLayoutRenderResult {
  readonly rendered: boolean;
  readonly blockCount: number;
}

export class ExoLayoutRenderer {
  constructor(private readonly deps: ExoLayoutRendererDeps) {}

  async render(
    el: HTMLElement,
    file: TFile,
    layout: Layout,
    relations: readonly AssetRelation[],
  ): Promise<ExoLayoutRenderResult> {
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
    const partition = this.computeDailyPartition(file, layout, snapshot);

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
      await this.renderBlock(container, file, block, relations, partition);
      blockCount += 1;
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
    container: HTMLElement,
    file: TFile,
    block: LayoutBlock,
    relations: readonly AssetRelation[],
    partition: DailyEffortsPartitioned<DailyEffortItem> | null,
  ): Promise<void> {
    const blockContainer = container.createDiv({
      cls: "exocortex-exo-layout-block",
      attr: {
        "data-block-uid": block.uid,
        "data-block-kind": block.kind,
      },
    });

    if (block.kind === "properties") {
      this.renderPropertiesBlock(blockContainer, file, block.title);
      return;
    }
    if (block.kind === "backlinks-table") {
      this.renderBacklinksBlock(blockContainer, relations, block);
      return;
    }
    if (block.kind === "daily-efforts-by-class") {
      this.renderDailyEffortsBlock(blockContainer, block.partition, block.title, partition);
      return;
    }
    // Defensive branch — parser/type guard should have prevented unknown
    // kinds from ever reaching this point; we still skip quietly.
    const unreachable: never = block;
    this.deps.logger.warn(
      `ExoLayoutRenderer: unknown block kind on asset ${(unreachable as LayoutBlock).uid}`,
    );
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
