/**
 * Single wiring point for the immutable-object cache (req
 * `086df113-16bb-4912-bb09-3a13ee187043`, issue #4410).
 *
 * The three ExoSync read paths (`exosync sync`, `exosync-parity`,
 * `exosync-quarantine`) all build their transport the same way, so the
 * decision «is the cache on, where does it live, how big may it get» lives
 * here once instead of three times.
 *
 * Opt-OUT, not opt-in: the cache is behaviour-neutral by construction (a hit
 * is byte-identical to the response it replaced, or it throws), so the default
 * is on. `--no-object-cache` / `EXOCORTEX_EXOSYNC_CACHE=0` disable it for
 * debugging a suspected stale read.
 */

import {
  ImmutableObjectCache,
  withImmutableObjectCache,
  type RestCommitTransport,
  type Sha1Fn,
} from "@kitelev/exocortex-core";

import {
  nodeObjectCacheIO,
  resolveObjectCacheMaxBytes,
  resolveObjectCacheRoot,
} from "./nodeObjectCacheIO.js";

export interface ObjectCacheWiring {
  transport: RestCommitTransport;
  /** Null when the cache is disabled — callers report "not used", not zeroes. */
  cache: ImmutableObjectCache | null;
}

export interface ObjectCacheWiringOptions {
  /** `false` from `--no-object-cache`. */
  enabled?: boolean;
  /**
   * Defaults to `process.env` — deliberately NOT the command's injected
   * `deps.env`, which exists to inject SECRETS in tests and is routinely `{}`.
   * Reading it here would send a test run's cache into the developer's real
   * `~/.cache` (the store is device-wide), so the store location follows the
   * process environment and tests pin it through `tests/setup.ts`.
   */
  env?: NodeJS.ProcessEnv;
  sha1: Sha1Fn;
  /** Override the storage port (tests). */
  io?: ReturnType<typeof nodeObjectCacheIO>;
}

function envDisables(env: NodeJS.ProcessEnv): boolean {
  const raw = env.EXOCORTEX_EXOSYNC_CACHE;
  return raw === "0" || raw === "false" || raw === "off";
}

/**
 * Decorate a transport with the cache, or hand it back untouched when the
 * cache is off. The returned `cache` lets the caller report hit counts.
 */
export function wireObjectCache(
  transport: RestCommitTransport,
  opts: ObjectCacheWiringOptions,
): ObjectCacheWiring {
  const env = opts.env ?? process.env;
  if (opts.enabled === false || envDisables(env)) {
    return { transport, cache: null };
  }
  const maxBytes = resolveObjectCacheMaxBytes(env);
  const cache = new ImmutableObjectCache({
    io: opts.io ?? nodeObjectCacheIO(resolveObjectCacheRoot(env)),
    sha1: opts.sha1,
    ...(maxBytes !== undefined ? { maxBytes } : {}),
  });
  return { transport: withImmutableObjectCache(transport, cache), cache };
}
