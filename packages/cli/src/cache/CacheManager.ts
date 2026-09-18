import path from "path";
import crypto from "crypto";
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
  /**
   * Vault paths of the FileSpace DECLARATION assets found by the last full
   * walk (`fileSpaces.declarationPaths`). A delta touching one of them
   * (modified or removed) cannot know the new exclusion set without a
   * discovery sweep, so it falls back to a full rebuild.
   */
  fileSpaceDeclarations: string[];
  /**
   * `true` once `index` persisted an inferred layer via `saveInferredTriples`
   * (even an EMPTY one — a vault whose only prototype was deleted still has
   * inference switched on). A delta re-materializes the layer iff this flag
   * is set; a full rebuild resets it (the flag is a property of how the
   * cache was built, not of the data — reading it off `inferred.length` would
   * leave a cache without a layer forever once the layer happened to be empty).
   */
  inferenceEnabled: boolean;
}

/**
 * One walked `.md` file: its stat stamp at build time and the triples its
 * conversion committed (empty for skipped / excluded files, which still
 * need an entry so that fixing them later counts as a change).
 */
export interface CacheFileEntry {
  path: string;
  mtimeMs: number;
  /** byte size at build time — a same-mtime rewrite (`touch -r`, `rsync -t`) still shows */
  size: number;
  triples: SerializedTriple[];
  /**
   * The file's OWN `exo__Asset_label` (or basename) has the TBox form
   * `prefix__Name`, so referrers emit SYMBOLIC IRIs derived from it. Persisted
   * because for a file the converter SKIPPED (invariant violation → no
   * triples) the label cannot be read back from `triples`, yet referrers
   * read the target's frontmatter directly and still emit symbolically.
   */
  tboxLabel?: true;
}

/**
 * Cache file structure (format v2)
 */
interface CacheData {
  metadata: CacheMetadata;
  files: CacheFileEntry[];
  inferred: SerializedTriple[];
}

/** Stat stamp of one walked file. */
export interface FileStamp {
  mtimeMs: number;
  size: number;
}

/**
 * Vault-relative path → stat stamp of every `.md` file the converter would
 * walk. Insertion order = `FileSystemVaultAdapter.getAllFiles()` order.
 */
export type FileManifest = Map<string, FileStamp>;

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
  /**
   * #4263 — delta only: `true` when the inferred layer was re-materialized,
   * `false` when the persisted layer was kept verbatim because no engine
   * input changed (absent for hit / rebuild).
   */
  inferredRecomputed?: boolean;
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
 * A `triples.json.<pid>.<rand>.tmp` older than this is an orphan (the writer
 * was killed between `writeJson` and `rename`) and is removed before the next
 * write / on invalidate; younger ones may belong to a live concurrent writer.
 */
export const STALE_TMP_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * `prefix__LocalName` — the label / basename form the converter turns into a
 * SYMBOLIC ontology IRI for every file that LINKS to the asset
 * (`NoteToRDFConverter.valueToRDFObject` → `expandClassValue`). Same shape as
 * `Namespace.fromPropertyKey` accepts; deliberately prefix-agnostic because
 * the converter derives ad-hoc namespaces for unknown prefixes too.
 */
const TBOX_FORM = /^[a-z][a-zA-Z0-9]*__\S+$/;

const ASSET_LABEL_IRI_SUFFIX = "#Asset_label";
const ASSET_ALIASES_IRI_SUFFIX = "#Asset_aliases";
const ASSET_PROTOTYPE_IRI_SUFFIX = "#Asset_prototype";

/**
 * Predicates the two inference engines READ (`RDFSInferenceEngine`:
 * `Instance_class` + `Class_superClass`; `PrototypeChainMaterializer`:
 * `Asset_prototype` edges plus every own triple of a prototype / of an
 * instance that has one). A delta whose changed files touch none of these —
 * and are neither prototypes nor prototype-bearing instances — cannot change
 * the inferred layer, so it is kept verbatim instead of being recomputed over
 * the whole vault (see `inferenceInputsChanged`).
 */
const INFERENCE_PREDICATE_SUFFIXES = [
  "#Instance_class",
  "#Class_superClass",
  "#type",
  ASSET_PROTOTYPE_IRI_SUFFIX,
];

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
      triples: refreshed.triples,
      cacheHit: true,
      durationMs: Date.now() - startTime,
      mode: "delta",
      reparsedFiles: plan.reparse.length,
      inferredRecomputed: refreshed.inferredRecomputed,
    };
  }

  private async rebuild(startTime: number, reason: string): Promise<LoadOrBuildResult> {
    const built = await this.buildInternal({ strict: false });
    return {
      triples: built.triples,
      cacheHit: false,
      durationMs: Date.now() - startTime,
      mode: "rebuild",
      reparsedFiles: built.data.files.length,
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
          !isSafeRelativePath(entry.path) ||
          typeof entry.mtimeMs !== "number" ||
          typeof entry.size !== "number" ||
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
          fileSpaceDeclarations: Array.isArray(raw.metadata.fileSpaceDeclarations)
            ? raw.metadata.fileSpaceDeclarations
            : [],
          inferenceEnabled:
            typeof raw.metadata.inferenceEnabled === "boolean"
              ? raw.metadata.inferenceEnabled
              : raw.inferred.length > 0,
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
          manifest.set(file.path, { mtimeMs: stat.mtimeMs, size: stat.size });
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
    const declarations = new Set(cached.metadata.fileSpaceDeclarations);

    // Object IRIs and (lower-cased) link targets whose presence in another
    // file's triples marks that file as a referrer of a changed target.
    const referrerIris = new Set<string>();
    const referrerNeedles = new Set<string>();

    for (const removed of diff.removed) {
      if (declarations.has(removed)) {
        return { reparse: [], rebuildReason: `FileSpace declaration removed: ${removed}` };
      }
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
      if (declarations.has(changedPath)) {
        return { reparse: [], rebuildReason: `FileSpace declaration changed: ${changedPath}` };
      }
      if (isTBoxBasename(changedPath)) {
        return { reparse: [], rebuildReason: `TBox-form file changed: ${changedPath}` };
      }
      const file = adapter.getAbstractFileByPath(changedPath);
      const frontmatter =
        file && isFile(file) ? adapter.getFrontmatter(file) : null;
      if (frontmatter && frontmatterDeclaresFileSpaceAnyForm(frontmatter)) {
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
      // A TBox-form ALIAS (`prefix__Name`) is emitted as a SYMBOLIC IRI, and a
      // `[[prefix__Name]]` link resolving through it flips between the
      // target's file-IRI (alias present) and that symbolic IRI (alias
      // absent) — its referrers hold neither a literal needle nor, while the
      // alias is absent, the file-IRI. Like a TBox-form label, it falls back
      // to the full rebuild (review round 2, N1).
      if (
        frontmatterHasTBoxFormAlias(frontmatter) ||
        (previous !== undefined && entryHasTBoxFormAlias(previous))
      ) {
        return { reparse: [], rebuildReason: `TBox-form alias: ${changedPath}` };
      }
      // Alias resolution: `[[<alias>]]` links resolve through the target's
      // frontmatter `aliases` (FileSystemVaultAdapter alias index, lower-cased),
      // so a change to the alias set changes what the referrers emit — the
      // ones that resolved through a REMOVED alias hold the file-IRI (re-parse
      // by IRI; a pure addition changes nothing for them), the ones that will
      // resolve through a new alias hold the raw link (re-parse by needle).
      const oldAliases = previous ? entryAliases(previous) : new Set<string>();
      const newAliases = frontmatterAliases(frontmatter);
      if (previous && !sameSet(oldAliases, newAliases)) {
        let aliasRemoved = false;
        for (const alias of oldAliases) {
          if (!newAliases.has(alias)) {
            referrerNeedles.add(alias);
            aliasRemoved = true;
          }
        }
        for (const alias of newAliases) if (!oldAliases.has(alias)) referrerNeedles.add(alias);
        if (aliasRemoved) {
          referrerIris.add(vaultPathToIRI(changedPath));
        }
      }
      if (!previous) {
        for (const alias of newAliases) referrerNeedles.add(alias);
      }
    }

    for (const added of diff.added) {
      // Referrers of a target that did not exist hold either the synthesized
      // `obsidian://vault/<uid>.md` IRI (UUID linkpath in frontmatter), the
      // raw `[[…]]` literal (non-UUID frontmatter linkpath) or the bare
      // linkpath literal (`exo:Asset_bodyLink` of an unresolved body link);
      // after the add they resolve to the real file-IRI. All three are keyed
      // on the target's basename (case-insensitive, like the adapter index).
      const basename = path.basename(added);
      referrerIris.add(vaultPathToIRI(basename));
      referrerNeedles.add(path.basename(added, path.extname(added)).toLowerCase());
    }

    const reparse = new Set<string>([...diff.added, ...diff.modified]);
    const removed = new Set(diff.removed);
    if (referrerIris.size > 0 || referrerNeedles.size > 0) {
      for (const entry of cached.files) {
        if (reparse.has(entry.path) || removed.has(entry.path)) {
          continue;
        }
        if (entryRefersTo(entry, referrerIris, referrerNeedles)) {
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
  ): Promise<{ data: CacheData; triples: Triple[]; inferredRecomputed: boolean }> {
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
    const makeEntry = (relPath: string): CacheFileEntry =>
      this.makeEntry(relPath, manifest, perFile.get(relPath) ?? [], adapter);

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

    // Explicit triples in file order — returned to the caller AND (when the
    // cache carries an inferred layer) fed to the same engines `index` runs,
    // so the layer is recomputed from the merged state instead of going stale.
    const explicit: Triple[] = [];
    for (const entry of nextFiles) {
      for (const t of entry.triples) {
        explicit.push(this.deserializeTriple(t));
      }
    }
    let inferred: SerializedTriple[] = [];
    let inferredTriples: Triple[] = [];
    let inferredRecomputed = false;
    if (cached.metadata.inferenceEnabled) {
      const nextByPath = new Map<string, CacheFileEntry>();
      for (const entry of nextFiles) nextByPath.set(entry.path, entry);
      if (inferenceInputsChanged(cached, nextByPath, [...reparsed, ...removed])) {
        const result = await materializeInferredTriples(explicit);
        inferredTriples = result.inferred;
        inferred = inferredTriples.map(this.serializeTriple);
        inferredRecomputed = true;
      } else {
        // None of the changed files feeds either engine — the persisted
        // layer is still exactly what a recomputation would yield.
        inferred = cached.inferred;
        inferredTriples = cached.inferred.map(this.deserializeTriple);
      }
    }

    const data = this.assembleCacheData(nextFiles, inferred, {
      fileSpacePrefixes: cached.metadata.fileSpacePrefixes,
      fileSpaceDeclarations: cached.metadata.fileSpaceDeclarations,
      inferenceEnabled: cached.metadata.inferenceEnabled,
    });
    await this.writeCacheData(data);
    return { data, triples: explicit.concat(inferredTriples), inferredRecomputed };
  }

  /**
   * One per-file cache entry: stat stamp from the manifest (captured BEFORE
   * the read), the committed triples, and the TBox-label marker — read from
   * the own-label triple when there is one, from the frontmatter when the
   * converter committed nothing (skipped by an invariant) so that a later
   * removal still triggers the rebuild its symbolic referrers need.
   */
  private makeEntry(
    relPath: string,
    manifest: FileManifest,
    triples: Triple[],
    adapter: FileSystemVaultAdapter,
  ): CacheFileEntry {
    const stamp = manifest.get(relPath);
    const entry: CacheFileEntry = {
      path: relPath,
      mtimeMs: stamp?.mtimeMs ?? 0,
      size: stamp?.size ?? 0,
      triples: triples.map(this.serializeTriple),
    };
    let tbox = entryHasTBoxLabel(entry);
    if (!tbox && triples.length === 0) {
      const file = adapter.getAbstractFileByPath(relPath);
      const frontmatter = file && isFile(file) ? adapter.getFrontmatter(file) : null;
      const label = frontmatter?.["exo__Asset_label"];
      tbox = typeof label === "string" && TBOX_FORM.test(label);
    }
    if (tbox) {
      entry.tboxLabel = true;
    }
    return entry;
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
    return (await this.buildInternal(options)).result;
  }

  /**
   * Full walk + persist; also hands back the freshly converted triples so a
   * rebuild inside `loadOrBuild` need not re-read and re-deserialize the file
   * it just wrote (~100 MB on a 16 k-file vault).
   */
  private async buildInternal(
    options: BuildCacheOptions,
  ): Promise<{ result: BuildCacheWithValidationResult; data: CacheData; triples: Triple[] }> {
    const startTime = Date.now();

    const vaultAdapter = new FileSystemVaultAdapter(this.vaultPath);
    const files = vaultAdapter.getAllFiles();
    const manifest: FileManifest = new Map();
    for (const file of files) {
      try {
        const stat = fs.statSync(path.join(this.vaultPath, file.path));
        manifest.set(file.path, { mtimeMs: stat.mtimeMs, size: stat.size });
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
      if (!manifest.has(file.path)) {
        continue;
      }
      entries.push(this.makeEntry(file.path, manifest, perFile.get(file.path) ?? [], vaultAdapter));
    }

    const data = this.assembleCacheData(entries, [], {
      fileSpacePrefixes: validationResult.fileSpaces?.prefixes ?? [],
      fileSpaceDeclarations: validationResult.fileSpaces?.declarationPaths ?? [],
      inferenceEnabled: false,
    });
    await this.writeCacheData(data);

    // Same concatenation the persisted entries yield on load: files in walk
    // order, each file's committed triples in commit order.
    const triples: Triple[] = [];
    for (const file of files) {
      if (!manifest.has(file.path)) continue;
      const own = perFile.get(file.path);
      if (own) triples.push(...own);
    }

    return {
      result: {
        tripleCount: validationResult.triples.length,
        durationMs: Date.now() - startTime,
        skippedFiles: validationResult.skippedFiles,
        summary: validationResult.summary,
      },
      data,
      triples,
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
    await this.removeStaleTempFiles();
  }

  /**
   * Remove `<cache>.*.tmp` siblings older than STALE_TMP_MAX_AGE_MS — orphans
   * of a writer killed between `writeJson` and `rename` (each is a full copy
   * of the cache). Younger ones are left alone: they may be a live concurrent
   * writer's, and it will rename or remove them itself.
   */
  private async removeStaleTempFiles(): Promise<void> {
    const dir = path.dirname(this.cachePath);
    const prefix = `${path.basename(this.cachePath)}.`;
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      return;
    }
    const cutoff = Date.now() - STALE_TMP_MAX_AGE_MS;
    for (const name of names) {
      if (!name.startsWith(prefix) || !name.endsWith(".tmp")) {
        continue;
      }
      const full = path.join(dir, name);
      try {
        const stat = await fs.stat(full);
        if (stat.mtimeMs < cutoff) {
          await fs.remove(full);
        }
      } catch {
        // renamed or removed by its writer between readdir and stat — fine
      }
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
    const data = this.assembleCacheData(cached.files, inferred.map(this.serializeTriple), {
      fileSpacePrefixes: cached.metadata.fileSpacePrefixes,
      fileSpaceDeclarations: cached.metadata.fileSpaceDeclarations,
      inferenceEnabled: true,
    });
    await this.writeCacheData(data);
  }

  private assembleCacheData(
    files: CacheFileEntry[],
    inferred: SerializedTriple[],
    provenance: Pick<CacheMetadata, "fileSpacePrefixes" | "fileSpaceDeclarations" | "inferenceEnabled">,
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
        fileSpacePrefixes: provenance.fileSpacePrefixes,
        fileSpaceDeclarations: provenance.fileSpaceDeclarations,
        inferenceEnabled: provenance.inferenceEnabled,
      },
      files,
      inferred,
    };
  }

  /**
   * Atomic write: serialize to a sibling temp file, then `rename` over the
   * cache path. `loadOrBuild` now persists on EVERY `--use-cache` command that
   * sees a change, and the bot loop runs several of them concurrently after
   * one edit — an in-place `writeJson` (O_TRUNC) would let a reader parse a
   * half-written ~100 MB file, read it as corrupt, and rebuild from scratch
   * (all readers at once). With rename every reader sees either the previous
   * complete file or the new complete one. No lock is needed: the manifest is
   * captured BEFORE parsing, so the losing writer's snapshot is at worst
   * older and self-corrects on the next check.
   */
  private async writeCacheData(data: CacheData): Promise<void> {
    await fs.ensureDir(path.dirname(this.cachePath));
    await this.removeStaleTempFiles();
    // pid + random: two CacheManager instances in ONE process (or two
    // processes forked in the same ms) must not race on the same temp name.
    const tmp = `${this.cachePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    try {
      await fs.writeJson(tmp, data, { spaces: 0 });
      await fs.rename(tmp, this.cachePath);
    } catch (error) {
      await fs.remove(tmp).catch(() => undefined);
      throw error;
    }
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
  const cachedByPath = new Map<string, FileStamp>();
  for (const entry of cached) {
    cachedByPath.set(entry.path, { mtimeMs: entry.mtimeMs, size: entry.size });
  }
  for (const [relPath, stamp] of current) {
    const previous = cachedByPath.get(relPath);
    if (previous === undefined) {
      added.push(relPath);
    } else if (previous.mtimeMs !== stamp.mtimeMs || previous.size !== stamp.size) {
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
 * Did this file's OWN `exo__Asset_label` have the TBox form? Sources, in
 * order: the persisted marker (set at build time — also for files the
 * converter skipped), then the own-subject label triple. ⛔ The converter
 * emits a TBox-form label as a SYMBOLIC IRI object (`exo:Asset_label
 * <ems#Project>`), not as a literal — so an IRI-typed label object IS the
 * TBox form; the literal check covers the rare label the converter could not
 * expand.
 */
function entryHasTBoxLabel(entry: CacheFileEntry): boolean {
  if (entry.tboxLabel) {
    return true;
  }
  const ownSubject = vaultPathToIRI(entry.path);
  for (const t of entry.triples) {
    if (
      t.subject.type === "IRI" &&
      t.subject.value === ownSubject &&
      t.predicate.type === "IRI" &&
      t.predicate.value.endsWith(ASSET_LABEL_IRI_SUFFIX)
    ) {
      if (t.object.type === "IRI") {
        return true;
      }
      if (t.object.type === "Literal" && TBOX_FORM.test(t.object.value)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Does any triple of this file point at one of the changed targets — by the
 * target's (resolved or synthesized) file-IRI, or by a link literal whose
 * (lower-cased) linkpath is one of the needles? Literal forms the converter
 * emits for an unresolved target: the raw `[[linkpath]]` / `[[linkpath|alias]]`
 * frontmatter value, or the bare `linkpath` of a body link
 * (`exo:Asset_bodyLink`). Each literal is normalised once and looked up in a
 * Set, so the scan stays O(triples) whatever the size of the diff.
 */
function entryRefersTo(
  entry: CacheFileEntry,
  iris: Set<string>,
  needles: Set<string>,
): boolean {
  for (const t of entry.triples) {
    if (t.object.type === "IRI") {
      if (iris.has(t.object.value)) {
        return true;
      }
    } else if (t.object.type === "Literal" && needles.size > 0) {
      if (needles.has(linkpathOf(t.object.value))) {
        return true;
      }
    }
  }
  return false;
}

/** `[[x|alias]]` → `x`, `[[x]]` → `x`, bare `x` → `x`; lower-cased, `.md` stripped. */
function linkpathOf(literal: string): string {
  let inner = literal.trim();
  if (inner.startsWith("[[") && inner.endsWith("]]")) {
    inner = inner.slice(2, -2);
  }
  const pipe = inner.indexOf("|");
  if (pipe >= 0) {
    inner = inner.slice(0, pipe);
  }
  inner = inner.trim().toLowerCase();
  return inner.endsWith(".md") ? inner.slice(0, -3) : inner;
}

/** The file's own `exo:Asset_aliases` literals (lower-cased), from its cached triples. */
function entryAliases(entry: CacheFileEntry): Set<string> {
  const ownSubject = vaultPathToIRI(entry.path);
  const out = new Set<string>();
  for (const t of entry.triples) {
    if (
      t.subject.type === "IRI" &&
      t.subject.value === ownSubject &&
      t.predicate.type === "IRI" &&
      t.predicate.value.endsWith(ASSET_ALIASES_IRI_SUFFIX) &&
      t.object.type === "Literal"
    ) {
      out.add(t.object.value.trim().toLowerCase());
    }
  }
  return out;
}

/** Frontmatter `aliases:` (string or list), lower-cased. */
function frontmatterAliases(frontmatter: Record<string, unknown> | null): Set<string> {
  const out = new Set<string>();
  for (const a of rawFrontmatterAliases(frontmatter)) {
    out.add(a.toLowerCase());
  }
  return out;
}

/** Frontmatter `aliases:` as written (trimmed, non-empty), case preserved. */
function rawFrontmatterAliases(frontmatter: Record<string, unknown> | null): string[] {
  const raw = frontmatter?.["aliases"];
  const list = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
  const out: string[] = [];
  for (const a of list) {
    if (typeof a === "string" && a.trim() !== "") {
      out.push(a.trim());
    }
  }
  return out;
}

/** Does the frontmatter declare an alias of the TBox form `prefix__Name`? */
function frontmatterHasTBoxFormAlias(frontmatter: Record<string, unknown> | null): boolean {
  return rawFrontmatterAliases(frontmatter).some((a) => TBOX_FORM.test(a));
}

/**
 * Did this file's cached `exo:Asset_aliases` carry a TBox-form value? The
 * converter emits such a value as an IRI object (symbolic), so an IRI-typed
 * alias object IS the marker; a literal in TBox form is accepted too.
 */
function entryHasTBoxFormAlias(entry: CacheFileEntry): boolean {
  const ownSubject = vaultPathToIRI(entry.path);
  for (const t of entry.triples) {
    if (
      t.subject.type === "IRI" &&
      t.subject.value === ownSubject &&
      t.predicate.type === "IRI" &&
      t.predicate.value.endsWith(ASSET_ALIASES_IRI_SUFFIX)
    ) {
      if (t.object.type === "IRI") {
        return true;
      }
      if (t.object.type === "Literal" && TBOX_FORM.test(t.object.value.trim())) {
        return true;
      }
    }
  }
  return false;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/**
 * `frontmatterDeclaresFileSpace` is the cheap UUID-only probe; the label form
 * `[[exo__FileSpace]]` resolves through the vault in a full discovery walk.
 * The guard here must catch BOTH, or a label-form declaration slips through
 * the delta and its mount folder keeps being indexed.
 */
function frontmatterDeclaresFileSpaceAnyForm(frontmatter: Record<string, unknown>): boolean {
  if (frontmatterDeclaresFileSpace(frontmatter)) {
    return true;
  }
  const raw = frontmatter["exo__Instance_class"];
  const candidates: unknown[] = Array.isArray(raw) ? raw : [raw];
  return candidates.some(
    (c) => typeof c === "string" && /\bexo__FileSpace\b/.test(c),
  );
}

/**
 * Reject absolute paths (POSIX, drive-letter or root-slash) and `..` segments
 * before they reach `getAbstractFileByPath`. Both separators are segment
 * boundaries: the adapter's `path.relative` yields backslashes on Windows, and
 * rejecting them outright would make the cache never valid there (review
 * round 2, N3).
 */
export function isSafeRelativePath(relPath: string): boolean {
  if (
    relPath.length === 0 ||
    path.isAbsolute(relPath) ||
    /^[a-zA-Z]:/.test(relPath) ||
    /^[\\/]/.test(relPath)
  ) {
    return false;
  }
  return !relPath.split(/[\\/]/).some((seg) => seg === "..");
}

function isInferenceRelevant(t: SerializedTriple): boolean {
  return (
    t.predicate.type === "IRI" &&
    INFERENCE_PREDICATE_SUFFIXES.some((suffix) => t.predicate.value.endsWith(suffix))
  );
}

function hasPrototype(entry: CacheFileEntry | undefined): boolean {
  return (
    !!entry &&
    entry.triples.some(
      (t) => t.predicate.type === "IRI" && t.predicate.value.endsWith(ASSET_PROTOTYPE_IRI_SUFFIX),
    )
  );
}

/**
 * Would re-running the inference engines over the merged explicit set change
 * the persisted layer? `true` when any touched file (before OR after):
 *   - contributes an inference-read predicate whose triple set changed
 *     (`Instance_class` / `Class_superClass` / `rdf:type` / `Asset_prototype`);
 *   - has an `Asset_prototype` (every own property of such an instance masks
 *     an inherited one, so ANY change to it moves the layer);
 *   - is the TARGET of somebody's `Asset_prototype` (its own properties are
 *     what gets inherited).
 * Everything else — the common bot turn: a status / label / timestamp edit
 * on a plain asset — leaves both engines' inputs untouched.
 */
export function inferenceInputsChanged(
  cached: CacheData,
  next: Map<string, CacheFileEntry>,
  touched: string[],
): boolean {
  const cachedByPath = new Map<string, CacheFileEntry>();
  for (const entry of cached.files) cachedByPath.set(entry.path, entry);
  const prototypeTargets = new Set<string>();
  for (const entry of cached.files) {
    for (const t of entry.triples) {
      if (
        t.object.type === "IRI" &&
        t.predicate.type === "IRI" &&
        t.predicate.value.endsWith(ASSET_PROTOTYPE_IRI_SUFFIX)
      ) {
        prototypeTargets.add(t.object.value);
      }
    }
  }
  for (const relPath of touched) {
    const before = cachedByPath.get(relPath);
    const after = next.get(relPath);
    if (hasPrototype(before) || hasPrototype(after)) return true;
    if (prototypeTargets.has(vaultPathToIRI(relPath))) return true;
    const key = (t: SerializedTriple): string =>
      `${t.subject.type}:${t.subject.value}|${t.predicate.value}|${t.object.type}:${t.object.value}`;
    const relevantBefore = (before?.triples ?? []).filter(isInferenceRelevant).map(key).sort();
    const relevantAfter = (after?.triples ?? []).filter(isInferenceRelevant).map(key).sort();
    if (relevantBefore.length !== relevantAfter.length) return true;
    for (let i = 0; i < relevantBefore.length; i++) {
      if (relevantBefore[i] !== relevantAfter[i]) return true;
    }
  }
  return false;
}

// serializeNode/deserializeNode now live in ./tripleSerialization.ts —
// re-exported above for backward compatibility with imports that
// previously pulled them from this module.
