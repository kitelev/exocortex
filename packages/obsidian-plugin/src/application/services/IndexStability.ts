/**
 * RFC 9821a379 decision 7 — «индекс стабилен»: may a page block trust the
 * triple store to answer a query completely?
 *
 * Two conditions, both observable (ticket 058bad52):
 *
 *  1. A COMPLETE index exists. ⛔ Not the indexer's own `initialized`: on a
 *     cold boot the eager walk runs against a still-parsing metadataCache and
 *     leaves a PARTIAL store (#2780/#3587). A complete index is either the
 *     eager walk over an ALREADY resolved cache (marked by the plugin, same
 *     moment as the #3472 notice — {@link markInitialIndexComplete}) or ANY
 *     full rebuild (`refresh()`) that completed — the post-`resolved` one, a
 *     profile switch, a link-label refresh. Counting every completed rebuild
 *     is what lets the index recover after a failed first walk.
 *  2. No full rebuild is in flight — it clears the store and refills it.
 *
 * Not tracked (the RFC letter): incremental updates — a per-file swap, or
 * `reindexPathsFromDisk` after an ExoSync pull, which re-runs the global
 * inference over the whole store. A query in that window may miss inferred
 * triples for a moment; a full-rebuild window would miss everything.
 *
 * A complete index is never revoked: after a full rebuild fails for good (its
 * retries exhausted) the store is left cleared — or, when it failed after the
 * walk loaded the triples, without the inferred ones — and until the next
 * successful rebuild only per-file updates refill it, while {@link isStable}
 * holds; a block drawn or woken then shows its empty text or an incomplete
 * table — a named limitation (ticket 058bad52); closing it needs a «store
 * incomplete» state on top of the retries.
 *
 * When the authoritative first walk FAILS and no complete index exists,
 * {@link whenStable} reports the failure (terminal for that wait) instead of
 * waiting forever — the block then says so instead of spinning.
 *
 * Pure in-memory state, no Node/Obsidian dependency (Desktop↔Mobile parity).
 */
export interface IndexRefreshState {
  isRefreshing(): boolean;
  whenRefreshSettled(): Promise<void>;
  /** Full rebuilds that completed successfully so far. */
  completedRefreshCount(): number;
}

export type IndexStabilityOutcome =
  | { readonly kind: "stable" }
  | { readonly kind: "failed"; readonly message: string };

export class IndexStability {
  private initialComplete = false;
  private failure: string | null = null;
  private wake!: () => void;
  private signal: Promise<void>;

  constructor(private readonly index: IndexRefreshState) {
    this.signal = this.newSignal();
  }

  /** The eager walk over an already-resolved cache completed (idempotent). */
  markInitialIndexComplete(): void {
    if (this.initialComplete) return;
    this.initialComplete = true;
    this.failure = null;
    this.fire();
  }

  /**
   * The authoritative first walk failed. Once a complete index exists the
   * failure is not recorded — a later step failing after a successful rebuild
   * is not an index failure — but the waiters are still woken: that rebuild
   * may have completed with no mark at all (the step after it threw), and a
   * waiter asleep before it would otherwise never re-check.
   */
  markInitialIndexFailed(message: string): void {
    if (!this.hasCompleteIndex()) this.failure = message;
    this.fire();
  }

  isStable(): boolean {
    return this.hasCompleteIndex() && !this.index.isRefreshing();
  }

  /**
   * Resolves the next time {@link isStable} holds, or with the failure when the
   * first walk failed and no complete index exists. Re-checks after every
   * settled rebuild: a second rebuild may start while the first settles.
   */
  async whenStable(): Promise<IndexStabilityOutcome> {
    for (;;) {
      if (this.index.isRefreshing()) {
        await this.index.whenRefreshSettled();
        continue;
      }
      if (this.hasCompleteIndex()) return { kind: "stable" };
      if (this.failure !== null) {
        return { kind: "failed", message: this.failure };
      }
      await this.signal;
    }
  }

  private hasCompleteIndex(): boolean {
    return this.initialComplete || this.index.completedRefreshCount() > 0;
  }

  private fire(): void {
    const wake = this.wake;
    this.signal = this.newSignal();
    wake();
  }

  private newSignal(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.wake = resolve;
    });
  }
}
