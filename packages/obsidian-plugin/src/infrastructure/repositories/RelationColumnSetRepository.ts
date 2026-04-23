/**
 * RelationColumnSetRepository — vault-backed index of `ui__RelationColumnSet` assets.
 *
 * Phase 1 of RFC be70f741-a8e3-4826-aab1-d3f950068861.
 *
 * Responsibilities
 * - Initial full scan on `initialize()`.
 * - Subscribe to `metadataCache` `changed` / `deleted` / `renamed` events.
 * - Coalesce event bursts with 150 ms trailing debounce.
 * - Rebuild the full index on any event; publish via atomic double-buffering swap.
 * - Class-filter by frontmatter (`exo__Instance_class` matches either the
 *   `ui__RelationColumnSet` IRI or the canonical UID) — never by path.
 *
 * Phase 1 Exit-behaviour: Repository is wired through DI, index is live,
 * but NO consumer — RelationsRenderer integration is Phase 3.  Therefore
 * this Phase is behaviour-neutral to the auto-backlinks table (and the
 * smoke-/snapshot-tests prove that by construction).
 *
 * @module infrastructure/repositories
 */

import {
  createRelationColumnSetFromFrontmatter,
  isRelationColumnSetFrontmatter,
  type RelationColumnSet,
} from "exocortex";

/**
 * Minimal abstraction over the Obsidian vault + metadata cache used by the
 * Repository.  The concrete adapter lives in `ObsidianRelationColumnSetAdapter`
 * (same directory) so the Repository remains unit-testable without Obsidian.
 */
export interface RelationColumnSetVaultAdapter {
  getAllMarkdownPaths(): readonly string[];
  getFrontmatter(path: string): Record<string, unknown> | null;
  on(
    event: "changed" | "deleted" | "renamed",
    handler: RelationColumnSetEventHandler,
  ): () => void;
}

export type RelationColumnSetEventHandler = (payload: { path: string }) => void;

export interface RelationColumnSetLogger {
  warn(message: string): void;
  info?(message: string): void;
}

const NOOP_LOGGER: RelationColumnSetLogger = {
  warn: () => {},
  info: () => {},
};

export interface RelationColumnSetRepositoryOptions {
  readonly debounceMs?: number;
  readonly logger?: RelationColumnSetLogger;
  readonly setTimer?: (cb: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

const DEFAULT_DEBOUNCE_MS = 150;

/**
 * Read-only snapshot of the validated index at a given instant.  The returned
 * arrays MUST NOT be mutated by callers; mutations will corrupt the next swap
 * because the backing array is shared until the next rebuild.
 */
export interface RelationColumnSetSnapshot {
  readonly all: readonly RelationColumnSet[];
  readonly byUid: ReadonlyMap<string, RelationColumnSet>;
}

const EMPTY_SNAPSHOT: RelationColumnSetSnapshot = {
  all: Object.freeze([]),
  byUid: new Map(),
};

export class RelationColumnSetRepository {
  private readonly adapter: RelationColumnSetVaultAdapter;
  private readonly debounceMs: number;
  private readonly logger: RelationColumnSetLogger;
  private readonly setTimer: (cb: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  private snapshot: RelationColumnSetSnapshot = EMPTY_SNAPSHOT;
  private readonly unsubs: Array<() => void> = [];
  private pendingTimer: unknown = null;
  private disposed = false;
  private initialized = false;

  constructor(
    adapter: RelationColumnSetVaultAdapter,
    options: RelationColumnSetRepositoryOptions = {},
  ) {
    this.adapter = adapter;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.logger = options.logger ?? NOOP_LOGGER;
    this.setTimer = options.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
    this.clearTimer =
      options.clearTimer ?? ((handle) => clearTimeout(handle as never));
  }

  /**
   * Initial full scan and subscription.  Idempotent — calling twice is a no-op.
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

  /**
   * Disposes all subscriptions and cancels the pending debounce timer.
   * The last-published snapshot remains available until GC.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.initialized = false;
    for (const unsub of this.unsubs.splice(0)) {
      try {
        unsub();
      } catch (error) {
        this.logger.warn(
          `RelationColumnSetRepository dispose: unsubscribe failed: ${String(error)}`,
        );
      }
    }
    if (this.pendingTimer !== null) {
      this.clearTimer(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  /**
   * Read-only handle to the current snapshot.  Safe across swap boundaries —
   * the returned reference is immutable; subsequent rebuilds publish a new
   * reference, leaving existing readers untouched (double-buffering).
   */
  getSnapshot(): RelationColumnSetSnapshot {
    return this.snapshot;
  }

  /**
   * Test hook: force a synchronous rebuild, bypassing the debounce.  Used by
   * Phase 2 resolver-priming smoke tests and by component-tests that need
   * deterministic state between operations.
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
    const nextAll: RelationColumnSet[] = [];
    const nextByUid = new Map<string, RelationColumnSet>();

    for (const path of paths) {
      const frontmatter = this.adapter.getFrontmatter(path);
      if (!isRelationColumnSetFrontmatter(frontmatter)) continue;

      const parsed = createRelationColumnSetFromFrontmatter(frontmatter, {
        sourcePath: path,
        warn: (msg) => this.logger.warn(msg),
      });
      if (parsed === null) continue;

      if (nextByUid.has(parsed.uid)) {
        this.logger.warn(
          `RelationColumnSetRepository: duplicate exo__Asset_uid ${parsed.uid} (${path}); keeping first-seen`,
        );
        continue;
      }
      nextAll.push(parsed);
      nextByUid.set(parsed.uid, parsed);
    }

    // Atomic publication — existing readers keep a reference to the old
    // snapshot; new readers see the next one.
    this.snapshot = Object.freeze({
      all: Object.freeze(nextAll) as readonly RelationColumnSet[],
      byUid: nextByUid,
    });
  }
}
