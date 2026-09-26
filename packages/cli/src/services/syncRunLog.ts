/**
 * ExoSync run journal (req e5e45283) — one JSONL line per `exosync sync` /
 * `exosync-parity` run.
 *
 * Why it exists: `restCalls` and the reported quota already reach stdout, but
 * stdout dies with the run. The 2026-09-26 incident was diagnosed against
 * `GET /rate_limit` — an endpoint that turned out to be blind here — precisely
 * because no durable record of what each run actually spent existed. One line
 * per run makes the question "who spent the budget, and when" answerable after
 * the fact, without re-running anything.
 *
 * Placement follows the existing device-local convention of its siblings
 * (`exosync-watermarks.local.json`, `exosync-etags.local.json`): the `.local.`
 * infix keeps Obsidian Sync from replicating it, so each device journals its
 * own spending — which is the unit that matters, since the quota is per token
 * per device.
 *
 * ⛔ Append-only, and deliberately without a stat/rotate step: checking a
 * file's size before writing it is the `js/file-system-race` shape CodeQL
 * flags (and the codebase has already been bitten by it). At ~200 bytes a line
 * and a few dozen runs a day the file grows a couple of megabytes a year —
 * cheaper than the race. Trimming, if it is ever wanted, belongs to a separate
 * reader that owns the file, not to the hot path of every sync.
 */

import { promises as fsp } from "node:fs";
import * as path from "node:path";
import type { RateLimitSnapshot } from "@kitelev/exocortex-core";

/** Device-local journal filename (sibling of the watermark / ETag stores). */
export const RUN_LOG_FILENAME = "exosync-runs.local.jsonl";

/** One journalled run. */
export interface SyncRunLogEntry {
  /** ISO-8601 local timestamp with offset — comparable across devices. */
  ts: string;
  /** Which command produced this line (`sync` | `parity`). */
  command: string;
  /** Vault root the run operated on. */
  vault: string;
  /** Logical transport calls the run made (cache hits and 304s included). */
  restCalls: number;
  /** Quota GitHub reported, or null when no response carried the headers. */
  limit: number | null;
  remaining: number | null;
  used: number | null;
  resetEpoch: number | null;
  /** Process exit code the run is about to return. */
  exitCode: number;
}

/** Absolute journal path for a vault + Obsidian config dir. */
export function runLogPathFor(vaultPath: string, configDir: string): string {
  return path.join(
    vaultPath,
    configDir,
    "plugins",
    "exocortex",
    RUN_LOG_FILENAME,
  );
}

/**
 * Append one line to the journal. **Never throws** — a diagnostic that can
 * fail a sync would be worse than no diagnostic: the run has already done its
 * real work by the time this is called, and losing a journal line costs a
 * later investigation, while losing the sync costs the user's data flow.
 *
 * Returns whether the line was written, so a caller that wants to assert the
 * write (a test) can, without the production path caring.
 */
export async function appendSyncRunLog(
  logPath: string,
  entry: SyncRunLogEntry,
  io: { appendFile?: typeof fsp.appendFile } = {},
): Promise<boolean> {
  const append = io.appendFile ?? fsp.appendFile;
  try {
    await append(logPath, `${JSON.stringify(entry)}\n`, "utf-8");
    return true;
  } catch {
    return false;
  }
}

/** Build a journal entry from a run's observed numbers. */
export function runLogEntry(args: {
  command: string;
  vault: string;
  restCalls: number;
  quota: RateLimitSnapshot | undefined;
  exitCode: number;
  now?: () => Date;
}): SyncRunLogEntry {
  const d = (args.now ?? ((): Date => new Date()))();
  return {
    ts: localIso(d),
    command: args.command,
    vault: args.vault,
    restCalls: args.restCalls,
    limit: args.quota?.limit ?? null,
    remaining: args.quota?.remaining ?? null,
    used: args.quota?.used ?? null,
    resetEpoch: args.quota?.resetEpoch ?? null,
    exitCode: args.exitCode,
  };
}

/** `2026-09-26T21:53:58+0500` — local wall-clock plus offset, never bare UTC. */
function localIso(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` +
    `${sign}${p(Math.floor(abs / 60))}${p(abs % 60)}`
  );
}
