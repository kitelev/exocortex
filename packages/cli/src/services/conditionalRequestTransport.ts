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

export function wireConditionalRequests(
  transport: RestCommitTransport,
  opts: ConditionalWiringOptions,
): ConditionalWiring {
  const env = opts.env ?? process.env;
  if (opts.enabled === false || envDisables(env)) {
    return { transport, cache: null };
  }
  const cache = new ConditionalRequestCache({ io: opts.io });
  return { transport: withConditionalRequests(transport, cache), cache };
}
