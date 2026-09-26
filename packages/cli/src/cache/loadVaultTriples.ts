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
  /**
   * #7a84b9f0 — the files the LOADER dropped, each with the reason it gave, as
   * `convertVaultWithValidation` recorded them (an invariant violation per
   * issue #2997 Phase 2, or a throw while building the file's triples).
   *
   * Present ONLY on the full parse. On the cache path it is `undefined` — NOT
   * an empty array: `loadOrBuild` can only offer {@link zeroTriplePaths}, which
   * is derived from "this entry has no triples" and therefore mixes skipped
   * files with genuinely empty ones (see the note on that field). `undefined`
   * says "this path cannot tell"; `[]` would say "nothing was dropped", and a
   * consumer that printed the second on the strength of the first would be
   * making a claim the cache format does not support.
   */
  skippedFiles?: Array<{ path: string; reason: string }>;
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
  // #7a84b9f0 — `convertVaultWithValidation` is the call `convertVault` already
  // delegates to (`return result.triples`), so the triples are byte-identical;
  // going to it directly is what stops `skippedFiles` from being discarded by
  // the narrower signature one layer above.
  const converted = await converter.convertVaultWithValidation({
    strict: false,
    onFileTriples: (file, own) => {
      committed.set(file.path, own.length);
    },
  });
  const triples = converted.triples;
  const zeroTriplePaths = files
    .filter((f) => (committed.get(f.path) ?? 0) === 0)
    .map((f) => f.path);
  return {
    triples,
    cacheHit: false,
    mode: "full-parse",
    explicitCount: triples.length,
    zeroTriplePaths,
    skippedFiles: converted.skippedFiles,
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
    case "rebuild": {
      // #4277 — a reader's rebuild that inherited the displaced cache's
      // inferred layer says so on stderr, for a human reading the log; the
      // bot engine does NOT parse this line — it reads `"inferenceEnabled":true`
      // off the `triples.json` header (plus its CLI-version marker) to decide
      // whether an `index --force` is still needed. A layer-less rebuild
      // prints exactly the pre-#4277 line — and so does an inherited layer
      // that happens to be EMPTY (a vault that infers nothing): the flag is
      // what the delta keys on, the count here is only what was materialized.
      const inferred = loaded.triples.length - loaded.explicitCount;
      const layer = inferred > 0 ? ` + inferred layer (${inferred})` : "";
      return `🔨 triple cache: rebuild (${loaded.reparsedFiles ?? 0} file(s) parsed, cache written${layer})`;
    }
    default:
      return "triple cache: not used (full parse)";
  }
}

/**
 * #7a84b9f0 — what a command should tell its user about files the loader
 * dropped, or `null` when there is nothing to say.
 *
 * TWO different sentences, because the two load paths know different things:
 *
 * - **full parse** — the loader named exactly the dropped files and why, so the
 *   block names them, in the shape `index` has printed since #2205
 *   (`sparql-index.ts`: the `Files skipped` heading, then `- <path>` and the
 *   reason indented under it). Same information, same layout, one reader.
 * - **cache** — `loadOrBuild` can only say which entries hold no triples, and
 *   that set mixes files the loader skipped with files that are genuinely
 *   empty; the format does not record which is which. So the line states ONLY
 *   the count it can defend, says both populations aloud, and points at the
 *   full parse for the reasons. It deliberately does not say "skipped": that
 *   would be a claim the cache cannot support.
 *
 * Returns the text without a trailing newline; the caller decides the channel
 * (`query` writes it to stderr, keeping stdout a single document).
 */
export const SKIPPED_FILES_NOTICE_LIMIT = 10;

export function skippedFilesNotice(loaded: LoadVaultTriplesResult): string | null {
  const skipped = loaded.skippedFiles;
  if (skipped !== undefined) {
    if (skipped.length === 0) return null;
    const lines = [
      `⚠️  ${skipped.length} file(s) skipped by the vault loader — they contributed no triples:`,
    ];
    // Capped, unlike `index`. The citation-parity with sparql-index.ts covers
    // the LAYOUT, not the channel: `index` prints a terminal report the user
    // asked for, whereas this runs before EVERY query — an uncapped 1 + 2N
    // lines makes a dirty vault's `query` unreadable. The remainder line keeps
    // the same route, so nothing becomes unreachable, only quieter.
    for (const file of skipped.slice(0, SKIPPED_FILES_NOTICE_LIMIT)) {
      lines.push(`   - ${file.path}`);
      lines.push(`     ${file.reason}`);
    }
    const hidden = skipped.length - SKIPPED_FILES_NOTICE_LIMIT;
    if (hidden > 0) {
      lines.push(`   … and ${hidden} more — run 'index' to see them all`);
    }
    return lines.join("\n");
  }

  if (loaded.zeroTriplePaths.length === 0) return null;
  // ⛔ Names NO cause. An earlier draft said "skipped by the loader, or
  // genuinely empty" — a two-member disjunction presented as exhaustive, and
  // it is not: folder-excluded and FileSpace-excluded files land in
  // `zeroTriplePaths` too, and they are neither. Adding a third member only
  // invites a fourth; the honest statement is that the cache does not record
  // the reason at all, plus the route to a run that does.
  return (
    `ℹ️  ${loaded.zeroTriplePaths.length} file(s) contributed no triples; ` +
    `the triple cache does not record WHY — re-run without --use-cache, or ` +
    `run 'index', to see the per-file reasons`
  );
}

/**
 * #4274 (req b6eef8ef) — the ONE line that says the TARGET of a command is
 * itself a file the loader dropped. `apply` answered «Precondition not
 * satisfied» and `resolve-buttons` listed every command as hidden for such a
 * target, with nothing pointing at the cause: the target has no triples, so
 * every precondition and `$target` read sees nothing.
 *
 * `vaultRelative` must be the path in the form the loader records
 * (vault-relative, as `apply`/`resolve-buttons` canonicalise it). Returns null
 * when the target contributed triples. Like {@link skippedFilesNotice}, the
 * cache path names NO cause: the cache does not record one.
 */
export function targetSkippedNotice(
  loaded: LoadVaultTriplesResult,
  vaultRelative: string,
): string | null {
  const skipped = loaded.skippedFiles;
  if (skipped !== undefined) {
    const hit = skipped.find((f) => f.path === vaultRelative);
    if (hit === undefined) return null;
    return (
      `⚠️  "${vaultRelative}" itself was skipped by the vault loader, so it has no ` +
      `triples — preconditions and $target reads see nothing: ${hit.reason}`
    );
  }
  if (!loaded.zeroTriplePaths.includes(vaultRelative)) return null;
  return (
    `ℹ️  "${vaultRelative}" contributed no triples, so preconditions and $target reads ` +
    `see nothing; the triple cache does not record WHY — re-run without --use-cache ` +
    `to see the reason`
  );
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
