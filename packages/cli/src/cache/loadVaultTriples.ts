import path from "path";
import { NoteToRDFConverter, type Triple } from "@kitelev/exocortex-core";
import { FileSystemVaultAdapter } from "../adapters/FileSystemVaultAdapter.js";
import {
  CacheManager,
  type CacheLoadMode,
  type WriteThroughResult,
} from "./CacheManager.js";

export interface LoadVaultTriplesOptions {
  /**
   * `true` → the persistent per-file triple cache (`CacheManager.loadOrBuild`:
   * hit / delta refresh / full rebuild, persisted). `false` → the traditional
   * full parse (`NoteToRDFConverter.convertVault`): no cache read, no cache
   * write — byte-for-byte the pre-#4263 no-flag path.
   */
  useCache: boolean;
  /**
   * #4264 — reuse a caller-owned `CacheManager` (ignored without `useCache`).
   * A command that will WRITE to the vault afterwards passes the instance it
   * later hands to {@link writeThroughCache}, so the write-through diffs
   * against the state loaded here instead of re-reading the cache file.
   */
  cacheManager?: CacheManager;
  /**
   * #4264 — reuse a caller-owned adapter for the FULL-PARSE path (ignored with
   * `useCache`: the cache manager walks with its own). `resolve-buttons` built
   * its store and read the target's frontmatter through ONE adapter before
   * the loader existed; passing it keeps that instance (and its lazily built
   * link indexes) shared instead of paying a second index build.
   */
  vaultAdapter?: FileSystemVaultAdapter;
}

export interface LoadVaultTriplesResult {
  triples: Triple[];
  /** `true` when the full re-parse was avoided (cache hit or delta refresh) */
  cacheHit: boolean;
  /** `hit` / `delta` / `rebuild` with the cache, `full-parse` without it */
  mode: CacheLoadMode | "full-parse";
  /** Files re-parsed by a delta refresh (`undefined` outside the cache path) */
  reparsedFiles?: number;
  /**
   * #4264 — the `CacheManager` that produced a cache-path result (absent on
   * `full-parse`). Holds the loaded state for a later {@link writeThroughCache}.
   */
  cacheManager?: CacheManager;
  /**
   * #4272 — `triples[0 .. explicitCount)` are the EXPLICIT triples (what each
   * file's own frontmatter states); the rest is the inferred layer a cache
   * built by `index` carries (a full parse has none: `explicitCount ===
   * triples.length`). The command's store holds both in one default graph,
   * so a consumer that must not see inherited values (the create-instance
   * resolvers' index) takes this boundary, not the store.
   */
  explicitCount: number;
  /**
   * #4272 — walked markdown files the loader committed NO triples for: skipped
   * by an invariant violation (two-phase commit #2997) or without frontmatter.
   * The full parse names exactly the skipped ones (`skippedFiles`); the cache
   * names every entry with an empty triple list (skipped + genuinely empty —
   * the cache format does not distinguish them). The frontmatter scan those
   * resolvers replaced still read these files, so the index reads exactly
   * them, once, to answer identically.
   */
  zeroTriplePaths: string[];
}

/**
 * The ONE way a CLI command turns a vault path into its triple set (#4263).
 *
 * Replaces the copy-pasted `if (useCache) { new CacheManager(vaultPath)
 * .loadOrBuild() } else { new NoteToRDFConverter(new FileSystemVaultAdapter(
 * vaultPath)).convertVault() }` block that `query`, `classes`, `run-query` and
 * `validate-schema` each carried; #4264 routes `apply` / `resolve-buttons` /
 * `create --validate` through it as well (with the write-through below for
 * the two mutating commands) instead of a fifth and sixth copy.
 *
 * Observable behaviour of the migrated commands is unchanged: same
 * converter, same adapter, same cache manager, same result fields.
 */
export async function loadVaultTriples(
  vaultPath: string,
  options: LoadVaultTriplesOptions,
): Promise<LoadVaultTriplesResult> {
  if (options.useCache) {
    // Use the persistent single-vault triple cache for faster loading.
    const cacheManager = options.cacheManager ?? new CacheManager(vaultPath);
    // A caller-owned manager must be the one for THIS vault — otherwise the
    // command would read one vault's cache as another vault's triples.
    const expectedCachePath = path.join(
      path.resolve(vaultPath),
      ".exocortex",
      "cache",
      "triples.json",
    );
    if (cacheManager.getCachePath() !== expectedCachePath) {
      throw new Error(
        `loadVaultTriples: the given CacheManager belongs to ${cacheManager.getCachePath()}, not to vault ${vaultPath}`,
      );
    }
    const cacheResult = await cacheManager.loadOrBuild();
    return {
      triples: cacheResult.triples,
      cacheHit: cacheResult.cacheHit,
      mode: cacheResult.mode,
      reparsedFiles: cacheResult.reparsedFiles,
      cacheManager,
      explicitCount: cacheResult.explicitCount,
      zeroTriplePaths: cacheResult.zeroTriplePaths,
    };
  }

  // Traditional single-vault loading.
  const vaultAdapter =
    options.vaultAdapter ?? new FileSystemVaultAdapter(vaultPath);
  const converter = new NoteToRDFConverter(vaultAdapter);
  // #4272 — the same population rule as the cache entries (`CacheManager.
  // buildInternal`): every walked file that committed NO triples — skipped by
  // an invariant, FileSpace-excluded, frontmatter-less — is named so the index
  // still reads it itself. Full parse and both cache paths therefore agree on
  // what `zeroTriplePaths` holds (a cache entry with `triples: []` is exactly
  // "walked, committed nothing").
  const files = vaultAdapter.getAllFiles();
  const committed = new Map<string, number>();
  const triples = await converter.convertVault({
    onFileTriples: (file, own) => {
      committed.set(file.path, own.length);
    },
  });
  const zeroTriplePaths = files
    .filter((f) => (committed.get(f.path) ?? 0) === 0)
    .map((f) => f.path);
  return {
    triples,
    cacheHit: false,
    mode: "full-parse",
    explicitCount: triples.length,
    zeroTriplePaths,
  };
}

/**
 * #4264 — one stderr line describing how a `--use-cache` command loaded its
 * vault. Stderr on purpose: `apply --json` / `resolve-buttons --json` /
 * `create` must keep stdout a single machine-readable document, and the
 * consumer that opts into the cache (the bot loop) logs stderr — this is how
 * it verifies in production that it actually hit the fast path.
 */
export function cacheLoadNotice(loaded: LoadVaultTriplesResult): string {
  switch (loaded.mode) {
    case "hit":
      return "⚡ triple cache: hit";
    case "delta":
      return `♻️  triple cache: delta (${loaded.reparsedFiles ?? 0} file(s) re-parsed)`;
    case "rebuild":
      return `🔨 triple cache: rebuild (${loaded.reparsedFiles ?? 0} file(s) parsed, cache written)`;
    default:
      return "triple cache: not used (full parse)";
  }
}

/** #4264 — a write-through that did not throw, or the reason it could not run. */
export type WriteThroughOutcome =
  | WriteThroughResult
  | { mode: "failed"; reparsedFiles: 0; reason: string };

/**
 * #4264 — best-effort write-through for a mutating `--use-cache` command.
 *
 * Runs `CacheManager.refreshAfterWrite()` and NEVER throws: the vault
 * mutation is already on disk when this runs, and a cache that could not be
 * persisted is merely a cache the next reader refreshes itself (manifest diff
 * → delta / rebuild). The command's exit code and stdout must therefore not
 * depend on it — the caller only reports the outcome on stderr
 * ({@link writeThroughNotice}).
 */
export async function writeThroughCache(
  cacheManager: CacheManager,
): Promise<WriteThroughOutcome> {
  try {
    return await cacheManager.refreshAfterWrite();
  } catch (error) {
    return {
      mode: "failed",
      reparsedFiles: 0,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/** #4264 — the stderr line for a {@link writeThroughCache} outcome. */
export function writeThroughNotice(outcome: WriteThroughOutcome): string {
  switch (outcome.mode) {
    case "delta":
      return `💾 triple cache: write-through persisted (${outcome.reparsedFiles} file(s) re-parsed)`;
    case "noop":
      return "💾 triple cache: write-through — nothing changed";
    case "skipped":
      return `💾 triple cache: write-through skipped (${outcome.reason ?? "unknown"})`;
    default:
      return `⚠ triple cache: write-through failed (${outcome.reason}) — command result unaffected; the next --use-cache run refreshes the cache itself`;
  }
}
