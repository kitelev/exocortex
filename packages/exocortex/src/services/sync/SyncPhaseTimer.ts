/**
 * ExoSync Phase 0 — per-phase wall-clock instrumentation (measure-first).
 *
 * Andrey's directive: before choosing an optimisation (mtime-manifest vs
 * Compare API vs parallelising the detect phase), MEASURE which phase actually
 * dominates a real iPhone sync (>2 min on a 14-AS / ~6304-file vault). The
 * hypothesis (`exosync-perf-plan-2026-06-20.md` §2) is that the unconditional
 * local read + SHA-1 of EVERY file each sync dominates — this instrumentation
 * confirms or refutes it with numbers.
 *
 * Mechanism — port chokepoints. The {@link SyncEngine} drives the WHOLE remote
 * side through ONE injected `transport` and the WHOLE hashing side through ONE
 * injected `sha1`; local file IO goes through ONE `LocalFilesPort` per repo.
 * Wrapping those three chokepoints attributes every REST round-trip, every
 * SHA-1 digest and every file read/write to a per-AS timer WITHOUT threading a
 * timer through the dozen call sites. Because `syncLocked` runs strictly
 * sequentially (D11 `opInProgress` guard + sequential `for…await` at every
 * read / hash / blob site — verified: no `Promise.all` on the hot path), the
 * accumulated per-bucket durations approximate wall-clock per phase, and their
 * sum approximates the repo's wall-clock (minus the negligible pure-CPU diff).
 *
 * Observation-only: a timer can never change the sync outcome — the wrappers
 * are transparent pass-throughs and accumulate in `finally`, mirroring the
 * #3498 onProgress discipline. Decision (AC): instrumentation is PERMANENT and
 * always-on (the per-op overhead is two clock reads — negligible), so Andrey
 * just syncs and reads the breakdown; no debug toggle to flip.
 */

import type { RestCommitRequest } from "../../infrastructure/github/restCommit";

/**
 * Wall-clock buckets one sync's time is attributed to. Local phases (the
 * hypothesised hot path) are separated from remote REST phases so the
 * dominant cost is unambiguous.
 */
export type SyncPhase =
  | "localList" // adapter.list() — recursive mount-folder directory walk
  | "localRead" // adapter.read()/readBinary() — read ALL syncable file content
  | "localWrite" // adapter.write()/writeBinary() — pull-applied writes to disk
  | "hash" // gitBlobSha → sha1 digest of every file (hypothesised hot path)
  | "restHead" // GET git/refs/heads — getHeadSha (≥1 round-trip per AS, no-op too)
  | "restCommit" // GET git/commits/{sha} — getCommitInfo (base / race / D22)
  | "restTree" // GET git/trees/{sha}?recursive=1 — full recursive tree fetch+parse
  | "restBlob" // GET git/blobs/{sha} — per-changed-blob content fetch
  | "restPush"; // POST/PATCH — createCommit chain (blobs/trees/commits/refs)

/** Stable phase order for deterministic snapshots and formatting. */
export const SYNC_PHASES: readonly SyncPhase[] = [
  "localList",
  "localRead",
  "localWrite",
  "hash",
  "restHead",
  "restCommit",
  "restTree",
  "restBlob",
  "restPush",
];

/** Operation counts that contextualise the durations. */
export interface SyncPhaseCounts {
  /** Files read from disk (adapter.read/readBinary) this sync. */
  filesRead: number;
  /** SHA-1 digests computed (gitBlobSha) this sync. */
  filesHashed: number;
  /** Files written to disk (pull-applied changes) this sync. */
  filesWritten: number;
  /** Total REST round-trips (transport calls) this sync. */
  restCalls: number;
}

/** Immutable timing snapshot for one AS, attached to its `RepoSyncResult`. */
export interface SyncPhaseTimings {
  /** Wall-clock milliseconds accumulated per phase. */
  durations: Record<SyncPhase, number>;
  counts: SyncPhaseCounts;
}

/** Clock injected for deterministic tests; defaults to `Date.now` in prod. */
export type NowFn = () => number;

function zeroDurations(): Record<SyncPhase, number> {
  const d = {} as Record<SyncPhase, number>;
  for (const p of SYNC_PHASES) d[p] = 0;
  return d;
}

function zeroCounts(): SyncPhaseCounts {
  return { filesRead: 0, filesHashed: 0, filesWritten: 0, restCalls: 0 };
}

/**
 * Map a single transport request to its phase bucket by URL/method. POST/PATCH
 * is always the createCommit chain (push). GET buckets by the Git Data API
 * path segment (refs/commits/trees/blobs).
 */
export function classifyRestPhase(req: RestCommitRequest): SyncPhase {
  if (req.method !== "GET") return "restPush";
  const u = req.url;
  if (u.includes("/git/blobs/")) return "restBlob";
  if (u.includes("/git/trees/")) return "restTree";
  if (u.includes("/git/commits/")) return "restCommit";
  if (u.includes("/git/refs/")) return "restHead";
  // Unknown GET — bucket conservatively as a commit-class round-trip rather
  // than silently dropping it (the round-trip still happened).
  return "restCommit";
}

/**
 * Per-AS accumulator. Created fresh for each repo in `syncLocked` and read by
 * the chokepoint wrappers via the engine's `activeTimer` field (safe: syncs
 * are serialised by the D11 guard).
 */
export class SyncPhaseTimer {
  private readonly durations = zeroDurations();
  private readonly counts = zeroCounts();

  constructor(private readonly now: NowFn) {}

  /**
   * Time an async op into `phase` — transparent pass-through: returns the op's
   * value, rethrows its error, and accumulates the elapsed time in `finally`
   * so a throwing op is still measured and never swallowed.
   */
  async time<T>(phase: SyncPhase, op: () => Promise<T>): Promise<T> {
    const start = this.now();
    try {
      return await op();
    } finally {
      this.durations[phase] += this.now() - start;
    }
  }

  bumpRead(): void {
    this.counts.filesRead++;
  }

  bumpHashed(): void {
    this.counts.filesHashed++;
  }

  bumpWritten(): void {
    this.counts.filesWritten++;
  }

  bumpRest(): void {
    this.counts.restCalls++;
  }

  /** Immutable copy of the accumulated state at the moment of call. */
  snapshot(): SyncPhaseTimings {
    return {
      durations: { ...this.durations },
      counts: { ...this.counts },
    };
  }
}

/** An all-zero timing, for aggregation seeds and tests. */
export function emptyTimings(): SyncPhaseTimings {
  return { durations: zeroDurations(), counts: zeroCounts() };
}

/** Sum of all phase durations (≈ wall-clock for one AS / the whole run). */
export function totalMs(t: SyncPhaseTimings): number {
  let sum = 0;
  for (const p of SYNC_PHASES) sum += t.durations[p];
  return sum;
}

/** Sum two timings (used to aggregate per-AS results into a run total). */
export function addTimings(
  a: SyncPhaseTimings,
  b: SyncPhaseTimings,
): SyncPhaseTimings {
  const durations = zeroDurations();
  for (const p of SYNC_PHASES) durations[p] = a.durations[p] + b.durations[p];
  return {
    durations,
    counts: {
      filesRead: a.counts.filesRead + b.counts.filesRead,
      filesHashed: a.counts.filesHashed + b.counts.filesHashed,
      filesWritten: a.counts.filesWritten + b.counts.filesWritten,
      restCalls: a.counts.restCalls + b.counts.restCalls,
    },
  };
}

/**
 * Aggregate every result's timing into one run total. Results without timings
 * (e.g. a `busy` early-return that never created a timer) contribute nothing.
 */
export function aggregateTimings(
  results: ReadonlyArray<{ timings?: SyncPhaseTimings }>,
): SyncPhaseTimings {
  let acc = emptyTimings();
  for (const r of results) {
    if (r.timings !== undefined) acc = addTimings(acc, r.timings);
  }
  return acc;
}

/** The single largest phase, with its share of the total (null when idle). */
export function dominantPhase(
  t: SyncPhaseTimings,
): { phase: SyncPhase; ms: number; pct: number } | null {
  const total = totalMs(t);
  if (total <= 0) return null;
  let phase: SyncPhase = SYNC_PHASES[0];
  let ms = -1;
  for (const p of SYNC_PHASES) {
    if (t.durations[p] > ms) {
      ms = t.durations[p];
      phase = p;
    }
  }
  return { phase, ms, pct: (ms / total) * 100 };
}

/** Human-readable duration: `1.2s` ≥1000ms, else `742ms`. */
export function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

/**
 * Concise one-line aggregate for the summary toast (iPhone-readable): total +
 * the non-zero phases sorted descending with each phase's share. Empty string
 * when nothing was timed (clean no-op with zero IO — never happens in
 * practice since every AS reads + hashes).
 */
export function formatTimingsLine(t: SyncPhaseTimings): string {
  const total = totalMs(t);
  if (total <= 0) return "";
  const parts = SYNC_PHASES.filter((p) => t.durations[p] > 0)
    .sort((a, b) => t.durations[b] - t.durations[a])
    .map(
      (p) =>
        `${p} ${fmtMs(t.durations[p])} ${Math.round(
          (t.durations[p] / total) * 100,
        )}%`,
    );
  return `⏱ ExoSync ${fmtMs(total)} — ${parts.join(" · ")} (${
    t.counts.filesHashed
  } hashed, ${t.counts.filesRead} read, ${t.counts.restCalls} REST)`;
}

/**
 * Detailed per-AS line for the durable / activity-log channel. Includes ALL
 * phases (zeros too) so the breakdown is comparable across repos.
 */
export function formatRepoTimings(
  repoKey: string,
  t: SyncPhaseTimings,
): string {
  const parts = SYNC_PHASES.map((p) => `${p}=${fmtMs(t.durations[p])}`);
  return `[ExoSync timings] ${repoKey}: total ${fmtMs(
    totalMs(t),
  )} — ${parts.join(" ")} | hashed ${t.counts.filesHashed} read ${
    t.counts.filesRead
  } written ${t.counts.filesWritten} REST ${t.counts.restCalls}`;
}
