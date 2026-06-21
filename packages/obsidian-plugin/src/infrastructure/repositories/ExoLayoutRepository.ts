/**
 * ExoLayoutRepository — vault-backed index of `exo__Layout` and
 * `exo__LayoutBlock` (subclass) assets.
 *
 * Phase 2 of RFC exo__Layout (6628d78a-78a9-473c-ace3-e9b6d28750d1).
 *
 * Responsibilities
 * - Initial full scan on `initialize()`.
 * - Subscribe to `metadataCache` `changed` / `deleted` / `renamed` events.
 * - Coalesce event bursts with 150 ms trailing debounce.
 * - Rebuild the index on any event; publish atomically via double-buffering.
 * - Index two kinds of assets from a single vault pass:
 *   - Layouts — parsed via `createLayoutFromFrontmatter`.
 *   - LayoutBlocks — parsed via `createLayoutBlockFromFrontmatter` (handles
 *     `exo__PropertiesBlock` and `exo__BacklinksTableBlock` discrimination).
 *
 * Design decisions (advisor-locked 2026-04-25)
 * - Single Repository, not two: one vault pass, one subscription, one debounce
 *   — half the subscription leakage surface versus two repos and a single
 *   rebuild refreshes both indices atomically.
 * - Blocks are indexed by BOTH `uid` and `label` so the resolver can resolve
 *   `Layout.blocks` entries in either canonical form (`[[<uuid>]]`,
 *   `[[<label>]]`, or `[[<uuid>|<label>]]` which WikiLinkHelpers.normalize
 *   collapses to `<label>`).
 *
 * @module infrastructure/repositories
 */

import {
  createLayoutBlockFromFrontmatter,
  createLayoutFromFrontmatter,
  isLayoutBlockFrontmatter,
  isLayoutFrontmatter,
  type Layout,
  type LayoutBlock,
} from "@kitelev/exocortex-core";

export interface ExoLayoutVaultAdapter {
  getAllMarkdownPaths(): readonly string[];
  getFrontmatter(path: string): Record<string, unknown> | null;
  on(
    event: "changed" | "deleted" | "renamed",
    handler: ExoLayoutEventHandler,
  ): () => void;
}

export type ExoLayoutEventHandler = (payload: { path: string }) => void;

export interface ExoLayoutLogger {
  warn(message: string): void;
  info?(message: string): void;
}

const NOOP_LOGGER: ExoLayoutLogger = {
  warn: () => {},
  info: () => {},
};

export interface ExoLayoutRepositoryOptions {
  readonly debounceMs?: number;
  readonly logger?: ExoLayoutLogger;
  readonly setTimer?: (cb: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

const DEFAULT_DEBOUNCE_MS = 150;

/**
 * Read-only snapshot of the validated index at a given instant.  Returned
 * arrays/maps MUST NOT be mutated by callers — they are frozen and shared
 * until the next rebuild publishes a new snapshot.
 */
export interface ExoLayoutSnapshot {
  readonly layouts: readonly Layout[];
  readonly blocks: readonly LayoutBlock[];
  readonly blocksByUid: ReadonlyMap<string, LayoutBlock>;
  readonly blocksByLabel: ReadonlyMap<string, LayoutBlock>;
}

const EMPTY_SNAPSHOT: ExoLayoutSnapshot = Object.freeze({
  layouts: Object.freeze([]) as readonly Layout[],
  blocks: Object.freeze([]) as readonly LayoutBlock[],
  blocksByUid: new Map<string, LayoutBlock>(),
  blocksByLabel: new Map<string, LayoutBlock>(),
});

export class ExoLayoutRepository {
  private readonly adapter: ExoLayoutVaultAdapter;
  private readonly debounceMs: number;
  private readonly logger: ExoLayoutLogger;
  private readonly setTimer: (cb: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  private snapshot: ExoLayoutSnapshot = EMPTY_SNAPSHOT;
  private readonly unsubs: Array<() => void> = [];
  private pendingTimer: unknown = null;
  private disposed = false;
  private initialized = false;

  constructor(
    adapter: ExoLayoutVaultAdapter,
    options: ExoLayoutRepositoryOptions = {},
  ) {
    this.adapter = adapter;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.logger = options.logger ?? NOOP_LOGGER;
    this.setTimer = options.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
    this.clearTimer =
      options.clearTimer ?? ((handle) => clearTimeout(handle as never));
  }

  /**
   * Initial full scan + subscription.  Idempotent.
   */
  initialize(): void {
    if (this.initialized || this.disposed) return;
    this.initialized = true;
    this.rebuildSync();
    this.unsubs.push(
      this.adapter.on("changed", this.onVaultEvent),
      this.adapter.on("deleted", this.onVaultEvent),
      this.adapter.on("renamed", this.onVaultEvent),
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.initialized = false;
    for (const unsub of this.unsubs.splice(0)) {
      try {
        unsub();
      } catch (error) {
        this.logger.warn(
          `ExoLayoutRepository dispose: unsubscribe failed: ${String(error)}`,
        );
      }
    }
    if (this.pendingTimer !== null) {
      this.clearTimer(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  getSnapshot(): ExoLayoutSnapshot {
    return this.snapshot;
  }

  /**
   * Force synchronous rebuild, bypassing the internal 150 ms debounce.
   *
   * Public API. In addition to test fixtures, this is called from
   * `ExocortexPlugin` on `metadataCache.on("resolved")` to close the
   * cold-start race where Obsidian parses Layout / LayoutBlock files
   * BEFORE this repository's `on("changed")` subscription is wired —
   * `initialize()`'s synchronous initial scan sees an empty cache and
   * no later "changed" event ever fires, leaving the snapshot empty
   * and `LayoutSelector.resolve()` returning null. Issue #3368.
   *
   * Idempotent and safe to call from any path.
   */
  rebuildNow(): void {
    if (this.disposed) return;
    if (this.pendingTimer !== null) {
      this.clearTimer(this.pendingTimer);
      this.pendingTimer = null;
    }
    this.rebuildSync();
  }

  private readonly onVaultEvent = (_payload: { path: string }): void => {
    if (this.disposed) return;
    if (this.pendingTimer !== null) {
      this.clearTimer(this.pendingTimer);
    }
    this.pendingTimer = this.setTimer(() => {
      this.pendingTimer = null;
      if (this.disposed) return;
      this.rebuildSync();
    }, this.debounceMs);
  };

  private rebuildSync(): void {
    const paths = this.adapter.getAllMarkdownPaths();
    const nextLayouts: Layout[] = [];
    const nextLayoutsByUid = new Set<string>();
    const nextBlocks: LayoutBlock[] = [];
    const nextBlocksByUid = new Map<string, LayoutBlock>();
    const nextBlocksByLabel = new Map<string, LayoutBlock>();

    for (const path of paths) {
      const frontmatter = this.adapter.getFrontmatter(path);
      if (!frontmatter) continue;

      if (isLayoutFrontmatter(frontmatter)) {
        const parsed = createLayoutFromFrontmatter(frontmatter, {
          sourcePath: path,
          warn: (msg) => this.logger.warn(msg),
        });
        if (parsed === null) continue;
        if (nextLayoutsByUid.has(parsed.uid)) {
          this.logger.warn(
            `ExoLayoutRepository: duplicate exo__Asset_uid ${parsed.uid} for Layout (${path}); keeping first-seen`,
          );
          continue;
        }
        nextLayouts.push(parsed);
        nextLayoutsByUid.add(parsed.uid);
        continue;
      }

      if (isLayoutBlockFrontmatter(frontmatter)) {
        const parsed = createLayoutBlockFromFrontmatter(frontmatter, {
          sourcePath: path,
          warn: (msg) => this.logger.warn(msg),
        });
        if (parsed === null) continue;
        if (nextBlocksByUid.has(parsed.uid)) {
          this.logger.warn(
            `ExoLayoutRepository: duplicate exo__Asset_uid ${parsed.uid} for LayoutBlock (${path}); keeping first-seen`,
          );
          continue;
        }
        nextBlocks.push(parsed);
        nextBlocksByUid.set(parsed.uid, parsed);
        // Label index — first-seen wins on collision (same as UID rule).
        // Title is user-facing; the `label` we index here is the block's
        // `exo__Asset_label`, pulled via `extractBase` — for the purposes of
        // resolver lookups, we want the basename-level identifier (the form
        // that `WikiLinkHelpers.normalize` returns for `[[<label>]]`).
        const label = extractLabel(frontmatter);
        if (label !== null && !nextBlocksByLabel.has(label)) {
          nextBlocksByLabel.set(label, parsed);
        }
      }
    }

    this.snapshot = Object.freeze({
      layouts: Object.freeze(nextLayouts) as readonly Layout[],
      blocks: Object.freeze(nextBlocks) as readonly LayoutBlock[],
      blocksByUid: nextBlocksByUid,
      blocksByLabel: nextBlocksByLabel,
    });
  }
}

function extractLabel(
  frontmatter: Record<string, unknown>,
): string | null {
  const labelRaw = frontmatter["exo__Asset_label"];
  if (typeof labelRaw === "string" && labelRaw.trim().length > 0) {
    return labelRaw.trim();
  }
  return null;
}
