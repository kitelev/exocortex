import { NoteToRDFConverter, type Triple } from "@kitelev/exocortex-core";
import { FileSystemVaultAdapter } from "../adapters/FileSystemVaultAdapter.js";
import { CacheManager, type CacheLoadMode } from "./CacheManager.js";

export interface LoadVaultTriplesOptions {
  /**
   * `true` → the persistent per-file triple cache (`CacheManager.loadOrBuild`:
   * hit / delta refresh / full rebuild, persisted). `false` → the traditional
   * full parse (`NoteToRDFConverter.convertVault`): no cache read, no cache
   * write — byte-for-byte the pre-#4263 no-flag path.
   */
  useCache: boolean;
}

export interface LoadVaultTriplesResult {
  triples: Triple[];
  /** `true` when the full re-parse was avoided (cache hit or delta refresh) */
  cacheHit: boolean;
  /** `hit` / `delta` / `rebuild` with the cache, `full-parse` without it */
  mode: CacheLoadMode | "full-parse";
  /** Files re-parsed by a delta refresh (`undefined` outside the cache path) */
  reparsedFiles?: number;
}

/**
 * The ONE way a CLI command turns a vault path into its triple set (#4263).
 *
 * Replaces the copy-pasted `if (useCache) { new CacheManager(vaultPath)
 * .loadOrBuild() } else { new NoteToRDFConverter(new FileSystemVaultAdapter(
 * vaultPath)).convertVault() }` block that `query`, `classes`, `run-query` and
 * `validate-schema` each carried, so the next commands to gain `--use-cache`
 * (#4264: `apply` / `resolve-buttons` / `create`, which additionally need
 * write-through) extend one loader instead of a fifth copy.
 *
 * Observable behaviour of the four migrated commands is unchanged: same
 * converter, same adapter, same cache manager, same result fields.
 */
export async function loadVaultTriples(
  vaultPath: string,
  options: LoadVaultTriplesOptions,
): Promise<LoadVaultTriplesResult> {
  if (options.useCache) {
    // Use the persistent single-vault triple cache for faster loading.
    const cacheManager = new CacheManager(vaultPath);
    const cacheResult = await cacheManager.loadOrBuild();
    return {
      triples: cacheResult.triples,
      cacheHit: cacheResult.cacheHit,
      mode: cacheResult.mode,
      reparsedFiles: cacheResult.reparsedFiles,
    };
  }

  // Traditional single-vault loading.
  const vaultAdapter = new FileSystemVaultAdapter(vaultPath);
  const converter = new NoteToRDFConverter(vaultAdapter);
  const triples = await converter.convertVault();
  return { triples, cacheHit: false, mode: "full-parse" };
}
