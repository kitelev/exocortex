import path from "path";
import fs from "fs-extra";
import {
  NoteToRDFConverter,
  Triple,
  IRI,
  vaultPathToIRI,
  frontmatterDeclaresFileSpace,
  type IFile,
  type IFolder,
} from "@kitelev/exocortex-core";
import { FileSystemVaultAdapter } from "../adapters/FileSystemVaultAdapter.js";
import {
  serializeNode,
  deserializeNode,
  type SerializedNode,
  type SerializedTriple,
} from "./tripleSerialization.js";
import { materializeInferredTriples } from "./materializeInferred.js";

// Re-export for callers that previously imported these from CacheManager
// (kept for backward compatibility within the cli package surface).
export { serializeNode, deserializeNode };
export type { SerializedNode, SerializedTriple };

/**
 * On-disk format version of `.exocortex/cache/triples.json`.
 *
 * #4263 (v2): the cache is keyed per FILE — every walked `.md` file has an
 * entry with its `mtimeMs` and the triples its conversion committed — plus one
 * `inferred` bucket for the layer `index` materializes. The pre-#4263 format
 * (flat `triples[]` + `metadata.vaultMtime`) has no version field; it is read
 * as "invalid" and rebuilt once (no migration).
 */
export const CACHE_FORMAT_VERSION = 2;

/**
 * Cache metadata stored alongside the triple cache
 */
export interface CacheMetadata {
  /** CLI version used to create cache */
  version: string;
  /** Cache creation timestamp (Unix ms) */
  timestamp: number;
  /** Absolute path to vault */
  vaultPath: string;
  /** Number of triples cached (explicit + inferred) */
  tripleCount: number;
  /** On-disk format version — {@link CACHE_FORMAT_VERSION} */
  formatVersion: number;
  /** Number of per-file entries (= walked `.md` files at build time) */
  fileCount: number;
  /** Number of triples in the inferred layer (0 = no layer) */
  inferredCount: number;
  /**
   * FileSpace mount-folder exclusion prefixes discovered by the last FULL
   * walk. A delta pass reuses them instead of re-running the discovery
   * (`getFrontmatter` per vault file) — see
   * `NoteToRDFConverter.convertVaultWithValidation({ fileSpacePrefixes })`.
   */
  fileSpacePrefixes: string[];
}

/**
 * One walked `.md` file: its mtime at build time and the triples its
 * conversion committed (empty for skipped / excluded files, which still
 * need an entry so that fixing them later counts as a change).
 */
export interface CacheFileEntry {
  path: string;
  mtimeMs: number;
  triples: SerializedTriple[];
}

/**
 * Cache file structure (format v2)
 */
interface CacheData {
  metadata: CacheMetadata;
  files: CacheFileEntry[];
  inferred: SerializedTriple[];
}

/**
 * Vault-relative path → mtimeMs of every `.md` file the converter would walk.
 * Insertion order = `FileSystemVaultAdapter.getAllFiles()` order.
 */
export type FileManifest = Map<string, number>;

/**
 * Difference between the persisted manifest and the vault's current one.
 */
export interface ManifestDiff {
  added: string[];
  modified: string[];
  removed: string[];
}

/** How {@link CacheManager.loadOrBuild} produced its result. */
export type CacheLoadMode = "hit" | "delta" | "rebuild";

/**
 * Statistics about the current cache
 */
export interface CacheStats {
  /** Number of triples in cache */
  tripleCount: number;
  /** Cache creation timestamp */
  createdAt: Date;
  /** Whether cache is currently valid */
  isValid: boolean;
  /** Cache file size in bytes */
  sizeBytes: number;
}

/**
 * Result of loadOrBuild operation
 */
export interface LoadOrBuildResult {
  /** The loaded or built triples */
  triples: Triple[];
  /**
   * Whether the triples came from the cache. `true` for a plain hit AND for a
   * delta refresh (the full re-parse was avoided); `false` for a rebuild.
   */
  cacheHit: boolean;
  /** Time taken to load/build in milliseconds */
  durationMs: number;
  /** #4263 — hit / delta / rebuild */
  mode: CacheLoadMode;
  /** #4263 — files re-parsed by a delta refresh (0 for hit; all files for rebuild) */
  reparsedFiles: number;
  /** #4263 — why a rebuild was chosen (absent for hit / delta) */
  rebuildReason?: string;
}

/**
 * Result of buildCache operation
 */
export interface BuildCacheResult {
  /** Number of triples cached */
  tripleCount: number;
  /** Time taken to build cache in milliseconds */
  durationMs: number;
}

/**
 * Information about a file that was skipped during indexing
 */
export interface SkippedFileInfo {
  /** Path of the skipped file */
  path: string;
  /** Reason why the file was skipped */
  reason: string;
}

/**
 * Result of buildCacheWithValidation operation
 */
export interface BuildCacheWithValidationResult extends BuildCacheResult {
  /** Files that were skipped during indexing */
  skippedFiles: SkippedFileInfo[];
  /** Summary statistics */
  summary: {
    /** Total number of files in vault */
    total: number;
    /** Number of files successfully indexed */
    indexed: number;
    /** Number of files skipped */
    skipped: number;
  };
}

/**
 * Options for building cache with validation
 */
export interface BuildCacheOptions {
  /** If true, throws on first invalid IRI instead of skipping */
  strict?: boolean;
}

/**
 * Fraction of the manifest above which a delta is abandoned for a full
 * rebuild (#4263). A delta's fixed cost (cache read + referrer scan + cache
 * write) is paid regardless of the diff size, and a per-file re-parse costs
 * the same as in a full walk, so the threshold guards clean-slate semantics
 * on a large churn (e.g. a fresh `exosync pull` of half the vault) rather
 * than raw speed. Half the vault is the documented cut-off.
 */
export const DELTA_REBUILD_RATIO = 0.5;

/**
 * `prefix__LocalName` — the label / basename form the converter turns into a
 * SYMBOLIC ontology IRI for every file that LINKS to the asset
 * (`NoteToRDFConverter.valueToRDFObject` → `expandClassValue`). Same shape as
 * `Namespace.fromPropertyKey` accepts; deliberately prefix-agnostic because
 * the converter derives ad-hoc namespaces for unknown prefixes too.
 */
const TBOX_FORM = /^[a-z][a-zA-Z0-9]*__\S+$/;

const ASSET_LABEL_IRI_SUFFIX = "#Asset_label";

/**
 * Manages persistent triple cache for SPARQL queries.
 *
 * The cache stores RDF triples converted from vault notes, eliminating the
 * need to re-parse the entire vault on each query.
 *
 * #4263 — validity and refresh are keyed per FILE, not on the vault root
 * directory's mtime (which a nested `assetspaces/**` edit never touches):
 *
 * - `isCacheValid()` compares the persisted per-file manifest
 *   (`relPath → mtimeMs`) with a fresh stat-walk of the same file set the
 *   converter indexes (`FileSystemVaultAdapter.getAllFiles()`).
 * - `loadOrBuild()` on a non-empty diff re-parses ONLY the changed files (plus
 *   the files that link to an added/removed target, whose emitted object IRI
 *   depends on the target's existence), drops the entries of removed files,
 *   re-materializes the inferred layer when one is present, and persists the
 *   result. A TBox-form asset change (its label feeds the SYMBOLIC IRI every
 *   referrer emits), a FileSpace declaration change, a legacy/corrupt cache,
 *   a failed walk or a diff above {@link DELTA_REBUILD_RATIO} fall back to the
 *   full rebuild that existed before.
 *
 * @example
 * ```typescript
 * const cache = new CacheManager("/path/to/vault");
 *
 * // Load from cache or build fresh
 * const { triples, cacheHit, mode } = await cache.loadOrBuild();
 * console.log(`Loaded ${triples.length} triples (${mode})`);
 *
 * // Check cache stats
 * const stats = await cache.getCacheStats();
 * if (stats) {
 *   console.log(`Cache has ${stats.tripleCount} triples, valid: ${stats.isValid}`);
 * }
 *
 * // Force rebuild
 * await cache.invalidate();
 * await cache.buildCache();
 * ```
 */
export class CacheManager {
  private readonly vaultPath: string;
  private readonly cachePath: string;
  private readonly cliVersion: string = "1.0.0"; // Will be replaced by actual version

  constructor(vaultPath: string) {
    this.vaultPath = path.resolve(vaultPath);
    this.cachePath = path.join(this.vaultPath, ".exocortex", "cache", "triples.json");
  }

  /**
   * Returns the path to the cache file
   */
  getCachePath(): string {
    return this.cachePath;
  }

  /**
   * Checks if the cache is valid.
   *
   * Cache is valid when:
   * - Cache file exists and is a format-v2 cache with complete metadata
   * - The persisted per-file manifest equals a fresh walk of the vault
   *   (no `.md` file added, modified or removed since the cache was written —
   *   nested paths included; the vault root directory's mtime plays no part)
   */
  async isCacheValid(): Promise<boolean> {
    const diff = await this.computeManifestDiff();
    return diff !== null && isEmptyDiff(diff);
  }

  /**
   * #4263 — the added / modified / removed vault-relative paths between the
   * persisted manifest and the vault's current state, or `null` when the
   * cache is absent / corrupt / legacy or the vault cannot be walked (the
   * caller then falls back to a full rebuild).
   */
  async computeManifestDiff(): Promise<ManifestDiff | null> {
    const cached = await this.readCacheData();
    if (!cached) {
      return null;
    }
    const current = this.computeFileManifest();
    if (!current) {
      return null;
    }
    return diffManifest(cached.files, current);
  }

  /**
   * Loads triples from cache if valid, refreshes only what changed when the
   * diff is small, otherwise builds and caches them from scratch.
   *
   * @returns LoadOrBuildResult with triples, cache hit status, mode and duration
   */
  async loadOrBuild(): Promise<LoadOrBuildResult> {
    const startTime = Date.now();

    const cached = await this.readCacheData();
    if (!cached) {
      return this.rebuild(startTime, "cache absent, corrupt or legacy format");
    }

    const manifest = this.computeFileManifest();
    if (!manifest) {
      return this.rebuild(startTime, "vault could not be walked");
    }

    const diff = diffManifest(cached.files, manifest);
    if (isEmptyDiff(diff)) {
      return {
        triples: this.materializeTriples(cached),
        cacheHit: true,
        durationMs: Date.now() - startTime,
        mode: "hit",
        reparsedFiles: 0,
      };
    }

    const adapter = new FileSystemVaultAdapter(this.vaultPath);
    const plan = this.planDelta(cached, manifest, diff, adapter);
    if (plan.rebuildReason) {
      return this.rebuild(startTime, plan.rebuildReason);
    }

    const refreshed = await this.applyDelta(cached, manifest, diff, plan.reparse, adapter);
    return {
      triples: this.materializeTriples(refreshed),
      cacheHit: true,
      durationMs: Date.now() - startTime,
      mode: "delta",
      reparsedFiles: plan.reparse.length,
    };
  }

  private async rebuild(startTime: number, reason: string): Promise<LoadOrBuildResult> {
    await this.buildCache();
    const built = await this.readCacheData();
    const triples = built ? this.materializeTriples(built) : [];
    return {
      triples,
      cacheHit: false,
      durationMs: Date.now() - startTime,
      mode: "rebuild",
      reparsedFiles: built ? built.files.length : 0,
      rebuildReason: reason,
    };
  }

  /**
   * Explicit triples in file order, then the inferred layer — the same
   * concatenation a full walk followed by `index`'s materialization yields.
   */
  private materializeTriples(data: CacheData): Triple[] {
    const triples: Triple[] = [];
    for (const entry of data.files) {
      for (const t of entry.triples) {
        triples.push(this.deserializeTriple(t));
      }
    }
    for (const t of data.inferred) {
      triples.push(this.deserializeTriple(t));
    }
    return triples;
  }

  /**
   * Reads and structurally validates the cache file. `null` for absent /
   * unparseable / pre-#4263 (no `formatVersion`, flat `triples`) content.
   */
  private async readCacheData(): Promise<CacheData | null> {
    try {
      if (!(await fs.pathExists(this.cachePath))) {
        return null;
      }
      const raw = (await fs.readJson(this.cachePath)) as Partial<CacheData>;
      if (
        !raw.metadata ||
        raw.metadata.formatVersion !== CACHE_FORMAT_VERSION ||
        typeof raw.metadata.tripleCount !== "number" ||
        !Array.isArray(raw.files) ||
        !Array.isArray(raw.inferred)
      ) {
        return null;
      }
      for (const entry of raw.files) {
        if (
          typeof entry?.path !== "string" ||
          typeof entry.mtimeMs !== "number" ||
          !Array.isArray(entry.triples)
        ) {
          return null;
        }
      }
      return {
        metadata: {
          ...raw.metadata,
          fileSpacePrefixes: Array.isArray(raw.metadata.fileSpacePrefixes)
            ? raw.metadata.fileSpacePrefixes
            : [],
        },
        files: raw.files,
        inferred: raw.inferred,
      };
    } catch {
      return null;
    }
  }

  /**
   * Stat-walk of exactly the file set the converter indexes
   * (`FileSystemVaultAdapter.getAllFiles()`: every `.md` outside hidden
   * directories), in that adapter's order. `null` if the vault cannot be
   * walked. ~1 stat per file, no file reads.
   */
  private computeFileManifest(adapter?: FileSystemVaultAdapter): FileManifest | null {
    try {
      const vault = adapter ?? new FileSystemVaultAdapter(this.vaultPath);
      const manifest: FileManifest = new Map();
      for (const file of vault.getAllFiles()) {
        try {
          const stat = fs.statSync(path.join(this.vaultPath, file.path));
          manifest.set(file.path, stat.mtimeMs);
        } catch {
          // vanished between readdir and stat — not part of this snapshot
        }
      }
      return manifest;
    } catch {
      return null;
    }
  }

  /**
   * Decide what a delta must re-parse, or why it must give way to a rebuild.
   *
   * Beyond the changed files themselves, the converter's emission for a file
   * depends on OTHER files in two ways (`NoteToRDFConverter.valueToRDFObject`):
   *
   * 1. a `[[<uid>]]` object is the target's file-IRI while the target exists
   *    and the synthesized `obsidian://vault/<uid>.md` (or the raw wikilink
   *    literal for a non-UUID linkpath) while it does not — so every file that
   *    links to an ADDED or REMOVED target is re-parsed as a referrer;
   * 2. a target whose label / basename is `prefix__LocalName` (TBox form) is
   *    emitted as a SYMBOLIC ontology IRI derived from that label — a change
   *    to such an asset can rewrite every referrer's triples, and referrers
   *    cannot be found by scanning for the target's file-IRI, so this case
   *    falls back to a full rebuild.
   */
  private planDelta(
    cached: CacheData,
    manifest: FileManifest,
    diff: ManifestDiff,
    adapter: FileSystemVaultAdapter,
  ): { reparse: string[]; rebuildReason?: string } {
    const changed = diff.added.length + diff.modified.length + diff.removed.length;
    const population = Math.max(cached.files.length, manifest.size, 1);
    if (changed > population * DELTA_REBUILD_RATIO) {
      return {
        reparse: [],
        rebuildReason: `${changed} of ${population} files changed (> ${DELTA_REBUILD_RATIO * 100}%)`,
      };
    }

    const cachedByPath = new Map<string, CacheFileEntry>();
    for (const entry of cached.files) {
      cachedByPath.set(entry.path, entry);
    }

    // Object IRIs / literal fragments whose presence in another file's
    // triples marks that file as a referrer of a changed target.
    const referrerIris = new Set<string>();
    const referrerLiteralNeedles: string[] = [];

    for (const removed of diff.removed) {
      if (isTBoxBasename(removed)) {
        return { reparse: [], rebuildReason: `TBox-form file removed: ${removed}` };
      }
      const entry = cachedByPath.get(removed);
      if (entry && entryHasTBoxLabel(entry)) {
        return { reparse: [], rebuildReason: `TBox-form asset removed: ${removed}` };
      }
      // Referrers held the resolved file-IRI; after removal they must emit
      // the unresolved form.
      referrerIris.add(vaultPathToIRI(removed));
    }

    for (const changedPath of [...diff.added, ...diff.modified]) {
      if (isTBoxBasename(changedPath)) {
        return { reparse: [], rebuildReason: `TBox-form file changed: ${changedPath}` };
      }
      const file = adapter.getAbstractFileByPath(changedPath);
      const frontmatter =
        file && isFile(file) ? adapter.getFrontmatter(file) : null;
      if (frontmatter && frontmatterDeclaresFileSpace(frontmatter)) {
        return {
          reparse: [],
          rebuildReason: `FileSpace declaration changed: ${changedPath}`,
        };
      }
      const label = frontmatter?.["exo__Asset_label"];
      if (typeof label === "string" && TBOX_FORM.test(label)) {
        return { reparse: [], rebuildReason: `TBox-form asset changed: ${changedPath}` };
      }
      const previous = cachedByPath.get(changedPath);
      if (previous && entryHasTBoxLabel(previous)) {
        return {
          reparse: [],
          rebuildReason: `asset lost its TBox-form label: ${changedPath}`,
        };
      }
    }

    for (const added of diff.added) {
      // Referrers of a target that did not exist hold either the synthesized
      // `obsidian://vault/<uid>.md` IRI (UUID linkpath) or the raw wikilink
      // literal (any other linkpath); after the add they resolve to the real
      // file-IRI. Both forms are keyed on the target's basename.
      const basename = path.basename(added);
      referrerIris.add(vaultPathToIRI(basename));
      const stem = path.basename(added, path.extname(added));
      referrerLiteralNeedles.push(`[[${stem}]]`, `[[${stem}|`);
    }

    const reparse = new Set<string>([...diff.added, ...diff.modified]);
    const removed = new Set(diff.removed);
    if (referrerIris.size > 0 || referrerLiteralNeedles.length > 0) {
      for (const entry of cached.files) {
        if (reparse.has(entry.path) || removed.has(entry.path)) {
          continue;
        }
        if (entryRefersTo(entry, referrerIris, referrerLiteralNeedles)) {
          reparse.add(entry.path);
        }
      }
    }

    return { reparse: [...reparse] };
  }

  /**
   * Re-parse the planned files with the SAME converter pipeline a full walk
   * uses (invariant validation → `convertNote` → two-phase commit), splice the
   * result into the cached per-file entries, re-materialize the inferred
   * layer if the cache carries one, and persist.
   */
  private async applyDelta(
    cached: CacheData,
    manifest: FileManifest,
    diff: ManifestDiff,
    reparse: string[],
    adapter: FileSystemVaultAdapter,
  ): Promise<CacheData> {
    const files: IFile[] = [];
    for (const relPath of reparse) {
      const file = adapter.getAbstractFileByPath(relPath);
      if (file && isFile(file)) {
        files.push(file);
      }
    }

    const perFile = new Map<string, Triple[]>();
    const converter = new NoteToRDFConverter(adapter);
    await converter.convertVaultWithValidation({
      strict: false,
      files,
      fileSpacePrefixes: cached.metadata.fileSpacePrefixes,
      onFileTriples: (file, triples) => {
        perFile.set(file.path, triples);
      },
    });

    const reparsed = new Set(reparse);
    const removed = new Set(diff.removed);
    const makeEntry = (relPath: string): CacheFileEntry => ({
      path: relPath,
      mtimeMs: manifest.get(relPath) ?? 0,
      triples: (perFile.get(relPath) ?? []).map(this.serializeTriple),
    });

    const nextFiles: CacheFileEntry[] = [];
    for (const entry of cached.files) {
      if (removed.has(entry.path)) {
        continue;
      }
      nextFiles.push(reparsed.has(entry.path) ? makeEntry(entry.path) : entry);
    }
    const known = new Set(nextFiles.map((e) => e.path));
    for (const relPath of manifest.keys()) {
      if (!known.has(relPath)) {
        nextFiles.push(makeEntry(relPath));
      }
    }

    let inferred: SerializedTriple[] = [];
    if (cached.inferred.length > 0) {
      const explicit: Triple[] = [];
      for (const entry of nextFiles) {
        for (const t of entry.triples) {
          explicit.push(this.deserializeTriple(t));
        }
      }
      const result = await materializeInferredTriples(explicit);
      inferred = result.inferred.map(this.serializeTriple);
    }

    const data = this.assembleCacheData(nextFiles, inferred, cached.metadata.fileSpacePrefixes);
    await this.writeCacheData(data);
    return data;
  }

  /**
   * Builds and persists the triple cache.
   *
   * Converts all vault notes to RDF triples and saves them to the cache file.
   */
  async buildCache(): Promise<BuildCacheResult> {
    const result = await this.buildCacheWithValidation({ strict: false });
    return {
      tripleCount: result.tripleCount,
      durationMs: result.durationMs,
    };
  }

  /**
   * Builds and persists the triple cache with validation.
   *
   * Issue #2205: Enhanced version that provides detailed information about
   * files that were skipped during indexing.
   *
   * #4263: the per-file manifest is captured (stat) BEFORE the conversion
   * reads any file, so a write that lands mid-walk is seen as "modified" by
   * the next validity check rather than silently absorbed.
   *
   * @param options - Build options
   * @param options.strict - If true, throws on first invalid IRI instead of skipping
   * @returns Result with triples, skipped files, and summary statistics
   *
   * @throws Error if strict mode is enabled and an invalid IRI is encountered
   */
  async buildCacheWithValidation(
    options: BuildCacheOptions = {}
  ): Promise<BuildCacheWithValidationResult> {
    const startTime = Date.now();

    const vaultAdapter = new FileSystemVaultAdapter(this.vaultPath);
    const files = vaultAdapter.getAllFiles();
    const manifest: FileManifest = new Map();
    for (const file of files) {
      try {
        manifest.set(file.path, fs.statSync(path.join(this.vaultPath, file.path)).mtimeMs);
      } catch {
        // vanished between readdir and stat — the converter skips it too
      }
    }

    // Convert vault to triples with validation
    const perFile = new Map<string, Triple[]>();
    const converter = new NoteToRDFConverter(vaultAdapter);
    const validationResult = await converter.convertVaultWithValidation({
      strict: options.strict ?? false,
      files,
      onFileTriples: (file, triples) => {
        perFile.set(file.path, triples);
      },
    });

    const entries: CacheFileEntry[] = [];
    for (const file of files) {
      const mtimeMs = manifest.get(file.path);
      if (mtimeMs === undefined) {
        continue;
      }
      entries.push({
        path: file.path,
        mtimeMs,
        triples: (perFile.get(file.path) ?? []).map(this.serializeTriple),
      });
    }

    const data = this.assembleCacheData(
      entries,
      [],
      validationResult.fileSpaces?.prefixes ?? [],
    );
    await this.writeCacheData(data);

    return {
      tripleCount: validationResult.triples.length,
      durationMs: Date.now() - startTime,
      skippedFiles: validationResult.skippedFiles,
      summary: validationResult.summary,
    };
  }

  /**
   * Validates vault files for IRI issues without building cache.
   *
   * Issue #2205: Check vault health by identifying files that would
   * cause IRI validation errors during indexing.
   *
   * @returns Array of files with IRI issues and their reasons
   */
  async validateVault(): Promise<SkippedFileInfo[]> {
    const vaultAdapter = new FileSystemVaultAdapter(this.vaultPath);
    const converter = new NoteToRDFConverter(vaultAdapter);
    return converter.validateVault();
  }

  /**
   * Invalidates the cache by deleting the cache file.
   */
  async invalidate(): Promise<void> {
    if (await fs.pathExists(this.cachePath)) {
      await fs.remove(this.cachePath);
    }
  }

  /**
   * Returns statistics about the current cache.
   *
   * @returns CacheStats if cache exists, null otherwise
   */
  async getCacheStats(): Promise<CacheStats | null> {
    try {
      if (!await fs.pathExists(this.cachePath)) {
        return null;
      }

      const cacheData = await this.readCacheData();
      if (!cacheData) {
        // Present but legacy / corrupt: report it as an invalid cache rather
        // than pretending it is absent, so `index --stats` shows "Valid: No".
        const fileStats = await fs.stat(this.cachePath);
        return {
          tripleCount: 0,
          createdAt: new Date(fileStats.mtimeMs),
          isValid: false,
          sizeBytes: fileStats.size,
        };
      }
      const fileStats = await fs.stat(this.cachePath);
      const isValid = await this.isCacheValid();

      return {
        tripleCount: cacheData.metadata.tripleCount,
        createdAt: new Date(cacheData.metadata.timestamp),
        isValid,
        sizeBytes: fileStats.size,
      };
    } catch {
      return null;
    }
  }

  /**
   * Persist the INFERRED layer (what `index`'s materialization added on top
   * of the explicit per-file triples — see `materializeInferredTriples`),
   * replacing any previous inferred layer and leaving the per-file entries
   * and their manifest untouched.
   *
   * @throws Error if no format-v2 cache exists (build it first)
   */
  async saveInferredTriples(inferred: Triple[]): Promise<void> {
    const cached = await this.readCacheData();
    if (!cached) {
      throw new Error(
        `Cannot save inferred triples: no valid cache at ${this.cachePath} (build the cache first)`,
      );
    }
    const data = this.assembleCacheData(
      cached.files,
      inferred.map(this.serializeTriple),
      cached.metadata.fileSpacePrefixes,
    );
    await this.writeCacheData(data);
  }

  private assembleCacheData(
    files: CacheFileEntry[],
    inferred: SerializedTriple[],
    fileSpacePrefixes: string[],
  ): CacheData {
    let explicitCount = 0;
    for (const entry of files) {
      explicitCount += entry.triples.length;
    }
    return {
      metadata: {
        version: this.cliVersion,
        timestamp: Date.now(),
        vaultPath: this.vaultPath,
        tripleCount: explicitCount + inferred.length,
        formatVersion: CACHE_FORMAT_VERSION,
        fileCount: files.length,
        inferredCount: inferred.length,
        fileSpacePrefixes,
      },
      files,
      inferred,
    };
  }

  private async writeCacheData(data: CacheData): Promise<void> {
    await fs.ensureDir(path.dirname(this.cachePath));
    await fs.writeJson(this.cachePath, data, { spaces: 0 });
  }

  /**
   * Serializes a Triple to JSON-compatible format
   */
  private serializeTriple(triple: Triple): SerializedTriple {
    return {
      subject: serializeNode(triple.subject),
      predicate: serializeNode(triple.predicate),
      object: serializeNode(triple.object),
    };
  }

  /**
   * Deserializes a Triple from JSON format
   */
  private deserializeTriple(data: SerializedTriple): Triple {
    return new Triple(
      deserializeNode(data.subject) as Triple["subject"],
      deserializeNode(data.predicate) as IRI,
      deserializeNode(data.object) as Triple["object"],
    );
  }
}

function isEmptyDiff(diff: ManifestDiff): boolean {
  return diff.added.length === 0 && diff.modified.length === 0 && diff.removed.length === 0;
}

/**
 * Compare the persisted entries against a fresh manifest. Pure and exported
 * for tests; `modified` = same path, different mtimeMs.
 */
export function diffManifest(cached: CacheFileEntry[], current: FileManifest): ManifestDiff {
  const added: string[] = [];
  const modified: string[] = [];
  const removed: string[] = [];
  const cachedByPath = new Map<string, number>();
  for (const entry of cached) {
    cachedByPath.set(entry.path, entry.mtimeMs);
  }
  for (const [relPath, mtimeMs] of current) {
    const previous = cachedByPath.get(relPath);
    if (previous === undefined) {
      added.push(relPath);
    } else if (previous !== mtimeMs) {
      modified.push(relPath);
    }
  }
  for (const relPath of cachedByPath.keys()) {
    if (!current.has(relPath)) {
      removed.push(relPath);
    }
  }
  return { added, modified, removed };
}

function isFile(node: IFile | IFolder): node is IFile {
  return typeof (node as IFile).basename === "string";
}

function isTBoxBasename(relPath: string): boolean {
  return TBOX_FORM.test(path.basename(relPath, path.extname(relPath)));
}

/**
 * Did this file's OWN `exo__Asset_label` (as persisted in its triples) have
 * the TBox form? Only the file's own-subject label triple is consulted.
 */
function entryHasTBoxLabel(entry: CacheFileEntry): boolean {
  const ownSubject = vaultPathToIRI(entry.path);
  for (const t of entry.triples) {
    if (
      t.subject.type === "IRI" &&
      t.subject.value === ownSubject &&
      t.predicate.type === "IRI" &&
      t.predicate.value.endsWith(ASSET_LABEL_IRI_SUFFIX) &&
      t.object.type === "Literal" &&
      TBOX_FORM.test(t.object.value)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Does any triple of this file point at one of the changed targets — by the
 * target's (resolved or synthesized) file-IRI, or by a raw wikilink literal
 * naming the target's basename?
 */
function entryRefersTo(
  entry: CacheFileEntry,
  iris: Set<string>,
  literalNeedles: string[],
): boolean {
  for (const t of entry.triples) {
    if (t.object.type === "IRI") {
      if (iris.has(t.object.value)) {
        return true;
      }
    } else if (t.object.type === "Literal" && literalNeedles.length > 0) {
      const value = t.object.value;
      for (const needle of literalNeedles) {
        if (value.includes(needle)) {
          return true;
        }
      }
    }
  }
  return false;
}

// serializeNode/deserializeNode now live in ./tripleSerialization.ts —
// re-exported above for backward compatibility with imports that
// previously pulled them from this module.
