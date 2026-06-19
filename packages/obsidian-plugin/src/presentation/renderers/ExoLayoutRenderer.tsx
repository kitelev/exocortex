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
import type { Layout, LayoutBlock } from "exocortex";
import type { ReactRenderer } from "@plugin/presentation/utils/ReactRenderer";
import type { ExoLayoutSnapshot } from "@plugin/infrastructure/repositories";
import type { AssetRelation } from "./layout/types";
import type { ILogger } from "@plugin/adapters/logging/ILogger";
import type { ObsidianApp } from "@plugin/types";
import {
  BacklinksTableBlockView,
  PropertiesBlockView,
} from "@plugin/presentation/components/LayoutBlocks";
import { AssetMetadataService } from "@plugin/presentation/renderers/layout/helpers/AssetMetadataService";
import { WikiLinkHelpers } from "exocortex";

export interface ExoLayoutRendererDeps {
  readonly app: ObsidianApp;
  readonly reactRenderer: ReactRenderer;
  readonly logger: ILogger;
  readonly snapshotProvider: () => ExoLayoutSnapshot;
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

    let blockCount = 0;
    for (const rawRef of layout.blocks) {
      const block = resolveBlock(rawRef, snapshot);
      if (block === null) {
        this.deps.logger.warn(
          `ExoLayoutRenderer: block "${rawRef}" not found (layout=${layout.uid}, file=${file.path})`,
        );
        continue;
      }
      await this.renderBlock(container, file, block, relations);
      blockCount += 1;
    }

    return { rendered: blockCount > 0, blockCount };
  }

  private async renderBlock(
    container: HTMLElement,
    file: TFile,
    block: LayoutBlock,
    relations: readonly AssetRelation[],
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
    // Defensive branch — parser/type guard should have prevented unknown
    // kinds from ever reaching this point; we still skip quietly.
    const unreachable: never = block;
    this.deps.logger.warn(
      `ExoLayoutRenderer: unknown block kind on asset ${(unreachable as LayoutBlock).uid}`,
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
