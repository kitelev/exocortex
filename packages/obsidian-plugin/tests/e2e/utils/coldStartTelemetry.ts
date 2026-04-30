import * as fs from "fs";
import * as path from "path";

/**
 * Cold-start telemetry — per-step P99 instrumentation for Phase 3.1
 * (RFC 32a64ed9 §3.1 — Xvfb startup variance profiling).
 *
 * Records 6 distinct steps in the cold-start lifecycle. Steps 1–3 are emitted
 * by `docker-entrypoint-e2e.sh` (shell-level) into the JSONL file pointed to
 * by the `COLD_START_TELEMETRY_LOG` env var. Steps 4–6 are emitted by the
 * Node-side helpers (this module + `waitForExocortexPlugin.ts`) into the same
 * file. A post-run aggregator computes P50/P95/P99 across all records and
 * prints a summary to stderr.
 *
 * Schema (JSONL — one record per step, one file per CI run):
 *   {
 *     "ts": <epoch_ms>,                       // emission timestamp
 *     "step": <ColdStartStep>,                // see ColdStartStep type
 *     "ms": <number>,                         // duration of this step
 *     "spec": <string?>,                      // optional spec identifier
 *     "shard": <string?>,                     // optional CI shard id
 *     "context": "shell" | "node" | "browser" // emission origin
 *   }
 *
 * The 6 instrumented steps:
 *   1. docker_pull         — image pull (emitted by CI workflow, not entrypoint)
 *   2. container_start     — entrypoint script invoked → just before xvfb-run
 *   3. xvfb_ready          — xvfb-run spawned → Obsidian binary launched
 *   4. obsidian_spawn      — Obsidian binary launched → window.app available
 *   5. plugin_load         — window.app available → exocortex plugin registered
 *   6. vault_index         — plugin registered → vault.adapter.list completes
 *   7. first_interaction   — vault index ready → first user-facing interaction
 *
 * (Step 1 is technically out-of-process; if `docker_pull` is not in the JSONL,
 *  the aggregator reports it as `n/a` rather than failing.)
 *
 * Backwards-compatibility contract:
 *  - All emission is best-effort: any I/O failure is swallowed silently.
 *  - If `COLD_START_TELEMETRY_LOG` is unset, only stderr is written.
 *  - Existing PLUGIN_WAIT_MS log channel is preserved unchanged.
 */

export type ColdStartStep =
  | "docker_pull"
  | "container_start"
  | "xvfb_ready"
  | "obsidian_spawn"
  | "plugin_load"
  | "vault_index"
  | "first_interaction";

export interface ColdStartTelemetryRecord {
  ts: number;
  step: ColdStartStep;
  ms: number;
  spec?: string;
  shard?: string;
  context: "shell" | "node" | "browser";
}

/**
 * Emit a single cold-start telemetry record. Writes to stderr always, and
 * additionally to JSONL at `COLD_START_TELEMETRY_LOG` when the env var is set.
 *
 * Best-effort: never throws. Test execution must not be impacted by telemetry.
 */
export function emitColdStartStep(record: Omit<ColdStartTelemetryRecord, "ts">): void {
  const full: ColdStartTelemetryRecord = { ...record, ts: Date.now() };

  // Stderr line — picked up by CI log scrapers regardless of file sink.
  // Format mirrors PLUGIN_WAIT_MS for grep-compatibility.
  process.stderr.write(
    `[COLD_START_TELEMETRY] step=${full.step} ms=${full.ms} ` +
      `spec=${full.spec ?? "unknown"} shard=${full.shard ?? "unknown"} ` +
      `context=${full.context}\n`,
  );

  const logPath = process.env.COLD_START_TELEMETRY_LOG;
  if (!logPath || logPath.length === 0) return;

  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify(full) + "\n", "utf8");
  } catch {
    // Observability is advisory; never fail tests on telemetry I/O.
  }
}

/**
 * Compute percentiles from a numeric array. Returns null for empty input.
 * Linear interpolation between adjacent samples (Type-7, the R/numpy default).
 */
export function percentile(samples: number[], p: number): number | null {
  if (samples.length === 0) return null;
  if (p < 0 || p > 100) throw new RangeError(`percentile p must be 0..100, got ${p}`);
  const sorted = [...samples].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

/**
 * Read a JSONL telemetry file and emit per-step P50/P95/P99 to stderr.
 * Returns the aggregated stats for programmatic consumption. Designed to
 * be invoked from a CI post-step (e.g. after the e2e job completes).
 *
 * Best-effort: returns empty stats if the file is missing or malformed.
 */
export function summarizeColdStartTelemetry(
  logPath: string,
): Partial<Record<ColdStartStep, { count: number; p50: number; p95: number; p99: number }>> {
  const stats: Partial<
    Record<ColdStartStep, { count: number; p50: number; p95: number; p99: number }>
  > = {};

  let raw: string;
  try {
    raw = fs.readFileSync(logPath, "utf8");
  } catch {
    process.stderr.write(`[COLD_START_TELEMETRY] no log at ${logPath} — skipping\n`);
    return stats;
  }

  const buckets: Partial<Record<ColdStartStep, number[]>> = {};
  for (const line of raw.split("\n")) {
    if (line.length === 0) continue;
    try {
      const rec = JSON.parse(line) as ColdStartTelemetryRecord;
      const arr = buckets[rec.step] ?? [];
      arr.push(rec.ms);
      buckets[rec.step] = arr;
    } catch {
      // Skip malformed lines — telemetry is best-effort.
    }
  }

  const allSteps: ColdStartStep[] = [
    "docker_pull",
    "container_start",
    "xvfb_ready",
    "obsidian_spawn",
    "plugin_load",
    "vault_index",
    "first_interaction",
  ];

  for (const step of allSteps) {
    const samples = buckets[step] ?? [];
    if (samples.length === 0) {
      process.stderr.write(`[COLD_START_TELEMETRY_SUMMARY] step=${step} count=0 (n/a)\n`);
      continue;
    }
    const p50 = percentile(samples, 50)!;
    const p95 = percentile(samples, 95)!;
    const p99 = percentile(samples, 99)!;
    stats[step] = { count: samples.length, p50, p95, p99 };
    process.stderr.write(
      `[COLD_START_TELEMETRY_SUMMARY] step=${step} count=${samples.length} ` +
        `p50=${p50.toFixed(0)} p95=${p95.toFixed(0)} p99=${p99.toFixed(0)}\n`,
    );
  }

  return stats;
}
