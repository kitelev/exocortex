/**
 * Single wiring point for conditional Git Data reads (req
 * `af002ec4-ec4e-4482-b7b5-77e79dd332df`, issue #3975).
 *
 * The three ExoSync read paths (`exosync sync`, `exosync-parity`,
 * `exosync-quarantine`) build their transport the same way, so "is it on,
 * where does the ETag store live" is decided here once rather than three
 * times.
 *
 * Opt-OUT, not opt-in: a conditional read is behaviour-neutral by
 * construction — a 304 is replayed from the body the ETag was issued for, and
 * anything unexpected degrades to an ordinary request — so the default is on.
 * `--no-conditional-requests` / `EXOCORTEX_EXOSYNC_CONDITIONAL=0` turn it off
 * when debugging a suspected stale read.
 */

import { randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";

import {
  ConditionalRequestCache,
  withConditionalRequests,
  type ConditionalStoreIO,
  type RestCommitTransport,
} from "@kitelev/exocortex-core";

/**
 * Node adapter for the ETag store — ONE implementation, so the three read
 * paths cannot drift apart.
 *
 * ⛔ The temp name is unique per CALL, not per process: concurrent writers
 * inside one process (the engine fetches through a bounded pool) would
 * otherwise open the same temp path with truncate semantics and could leave a
 * torn file. A torn ETag store is harmless by design — it reads as empty and
 * the next request goes out unconditional — but "harmless corruption" is still
 * corruption we can simply not create.
 */
export function nodeConditionalStoreIO(filePath: string): ConditionalStoreIO {
  return {
    async read(): Promise<string | null> {
      // read-then-catch, not exists-then-read: a stat/read pair on one path is
      // `js/file-system-race` (CodeQL), and ENOENT is the ordinary first run.
      try {
        return await fsp.readFile(filePath, "utf-8");
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "EISDIR" || code === "ENOTDIR") {
          return null;
        }
        throw err;
      }
    },
    async writeAtomic(content: string): Promise<void> {
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      const tmp = `${filePath}.${process.pid}-${randomUUID()}.tmp`;
      await fsp.writeFile(tmp, content, "utf-8");
      await fsp.rename(tmp, filePath);
    },
  };
}

export interface ConditionalWiring {
  transport: RestCommitTransport;
  /** Null when disabled — callers report "not used", not zeroes. */
  cache: ConditionalRequestCache | null;
}

export interface ConditionalWiringOptions {
  /** `false` from `--no-conditional-requests`. */
  enabled?: boolean;
  env?: NodeJS.ProcessEnv;
  /** Where the ETag store lives (same single-file IO as the watermark). */
  io: ConditionalStoreIO;
}

function envDisables(env: NodeJS.ProcessEnv): boolean {
  const raw = env.EXOCORTEX_EXOSYNC_CONDITIONAL;
  return raw === "0" || raw === "false" || raw === "off";
}

/**
 * Caches wired in this process whose store may still have a write in flight
 * (req 0700c0e0: the store is written BEHIND each mutation).
 *
 * ⚠ One set per PROCESS, not per run. `settleConditionalStores()` drains
 * every cache wired so far, so two overlapping runs in one process would
 * settle each other's caches: a run finishing first takes the other's cache
 * out of the set, and the later run can return before its own last write.
 * The CLI runs one command per process and no caller overlaps runs today;
 * overlapping them needs per-run scoping (e.g. AsyncLocalStorage) first.
 * A cache wired OUTSIDE `withSettledConditionalStores` stays referenced here
 * until the next settle.
 */
const unsettled = new Set<ConditionalRequestCache>();

export function wireConditionalRequests(
  transport: RestCommitTransport,
  opts: ConditionalWiringOptions,
): ConditionalWiring {
  const env = opts.env ?? process.env;
  if (opts.enabled === false || envDisables(env)) {
    return { transport, cache: null };
  }
  const cache = new ConditionalRequestCache({ io: opts.io });
  unsettled.add(cache);
  return { transport: withConditionalRequests(transport, cache), cache };
}

/**
 * Caches wired and not yet settled. Exported so tests can pin that a command
 * entry point settles what it wired: the set is drained synchronously when a
 * settle starts, so a non-zero count after a command returned means the
 * command bypassed `withSettledConditionalStores` (fs timing plays no part).
 */
export function unsettledConditionalStoreCount(): number {
  return unsettled.size;
}

/** Wait until every wired cache has written its last mutation to disk. */
export async function settleConditionalStores(): Promise<void> {
  const caches = [...unsettled];
  unsettled.clear();
  await Promise.all(caches.map((c) => c.flush()));
}

/**
 * Run a command body and settle the ETag stores it wired BEFORE returning or
 * re-throwing.
 *
 * ⛔ Not «the process waits for pending I/O anyway»: that holds for the
 * success path (`process.exitCode`), but a thrown error reaches
 * `ErrorHandler.handle`, which calls `process.exit()` — a write still behind
 * the last mutation would be lost (and its temp file left). In-process callers
 * (tests) would also read an unsettled store. Settling here makes «a run ends
 * with its store on disk» a property of the command, not of how it exits.
 */
export async function withSettledConditionalStores<T>(
  body: () => Promise<T>,
): Promise<T> {
  try {
    return await body();
  } finally {
    await settleConditionalStores();
  }
}
