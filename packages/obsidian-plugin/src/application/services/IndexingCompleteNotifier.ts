import type { INotificationService } from "@kitelev/exocortex-core";
import type { VaultWalkStats } from "@plugin/infrastructure/VaultRDFIndexer";

/**
 * Issue #3472 — one-shot «Exocortex: indexing complete» notice.
 *
 * UX gap: the user has no signal when the initial RDF indexing of the vault
 * finishes (i.e. when SPARQL / dynamic buttons / graph features are ready).
 * This emitter shows exactly ONE notice per plugin load, right after the
 * first authoritative full walk completes; all later full refreshes
 * (profile switch, FileSpace declaration edits) and incremental per-file
 * updates stay quiet — they never call this emitter.
 *
 * Counts reuse the Issue #3468 skip aggregation: `stats.skipped` is
 * `convertVaultWithValidation().summary.skipped`.
 */
export class IndexingCompleteNotifier {
  private notified = false;

  constructor(private readonly notifier: INotificationService) {}

  /**
   * Emit the notice if it has not been emitted yet for this plugin load.
   *
   * Guards that intentionally do NOT latch the one-shot flag (a later call
   * with valid stats must still be able to emit):
   * - `stats === null` — no full walk has been recorded yet;
   * - `stats.finishedAt < notBefore` — the stats belong to a walk that
   *   finished BEFORE the caller initiated its own walk. This happens when
   *   `VaultRDFIndexer.refresh()` coalesces into an in-flight refresh that
   *   fails with a swallowed error: the caller's chain continues as if
   *   successful while `getLastWalkStats()` still holds the stats of an
   *   earlier (e.g. eager-init) walk. Reporting those would be a false
   *   positive.
   *
   * @param stats - `VaultRDFIndexer.getLastWalkStats()` snapshot
   * @param notBefore - timestamp taken by the caller right before it
   *   triggered the walk it is reporting on
   */
  notifyOnce(stats: VaultWalkStats | null, notBefore: number): void {
    if (this.notified) return;
    if (stats === null) return;
    if (stats.finishedAt < notBefore) return;
    this.notified = true;

    const files = `${stats.indexed} file${stats.indexed === 1 ? "" : "s"}`;
    // Round half-up at the 0.1s grain BEFORE formatting — a bare
    // `(ms / 1000).toFixed(1)` rounds 850 ms down to "0.8" because 0.85
    // has no exact binary representation.
    const seconds = (Math.round(stats.durationMs / 100) / 10).toFixed(1);
    this.notifier.info(
      `Exocortex: indexing complete (${files}, ${stats.skipped} skipped, ${seconds}s)`,
    );
  }
}
