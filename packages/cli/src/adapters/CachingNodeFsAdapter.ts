import { NodeFsAdapter } from "./NodeFsAdapter.js";

/**
 * One indexed markdown asset: its vault-relative path and parsed frontmatter.
 * `content` is populated only when the adapter was constructed with
 * `cacheContent: true` (body-link audits need the raw text; plain
 * frontmatter audits should not pay the memory cost).
 */
export interface IndexedAsset {
  path: string;
  metadata: Record<string, unknown>;
  content?: string;
}

/**
 * Read-side caching wrapper over {@link NodeFsAdapter}. Builds a single
 * vault-wide index (one disk pass) and serves the read methods that
 * {@link findReferencedFile} calls from memory, turning a naive O(N²) audit
 * (every per-asset resolve re-walks + re-parses the whole vault) into O(N)
 * build + O(1) UID lookups.
 *
 * Crucially this preserves resolver UNIFICATION: the co-location audit still
 * resolves `exo__Asset_isDefinedBy` through the exact same `findReferencedFile`
 * code path as `apply repair-folder`, so an audit violation is guaranteed to
 * map to the same move target. Only the underlying fs lookups are memoized.
 *
 * Mutating methods (createFile/updateFile/...) are inherited unchanged — this
 * adapter is intended for read-only audit use.
 */
export class CachingNodeFsAdapter extends NodeFsAdapter {
  private indexed = false;
  private readonly uidToPath = new Map<string, string>();
  private readonly basenameToPaths = new Map<string, string[]>();
  private readonly allPaths: string[] = [];
  private readonly pathSet = new Set<string>();
  private readonly assets: IndexedAsset[] = [];
  private readonly cacheContent: boolean;

  constructor(rootPath: string, options?: { cacheContent?: boolean }) {
    super(rootPath);
    this.cacheContent = options?.cacheContent ?? false;
  }

  /** Build the index once (idempotent). One disk pass over all markdown files. */
  async buildIndex(): Promise<void> {
    if (this.indexed) return;
    const files = await super.getMarkdownFiles();
    for (const rel of files) {
      this.allPaths.push(rel);
      this.pathSet.add(rel);
      let metadata: Record<string, unknown> = {};
      let content: string | undefined;
      try {
        if (this.cacheContent) {
          // Single read serves both frontmatter and body — the audit hot loop
          // must not re-read 11k+ files from disk a second time.
          content = await super.readFile(rel);
          // Same parser as the base getFileMetadata path — two parse paths
          // selected by a constructor flag must never drift.
          metadata = this.extractFrontmatter(content);
        } else {
          metadata = await super.getFileMetadata(rel);
        }
      } catch {
        metadata = {};
      }
      // Mirror base NodeFsAdapter.findFileByUID semantics (normalizeValue +
      // array support) so the cache resolves UIDs identically to migration.
      const rawUid = metadata?.["exo__Asset_uid"];
      const uidValues = Array.isArray(rawUid) ? rawUid : [rawUid];
      for (const v of uidValues) {
        const key = CachingNodeFsAdapter.normalizeUid(v);
        if (key.length > 0 && !this.uidToPath.has(key)) {
          this.uidToPath.set(key, rel);
        }
      }
      // Basename index, symmetric to uidToPath (RFC df39007b §Шаг 1): the
      // imports audit resolves ~50k+ wikilink targets — a per-link linear
      // scan over all paths would be O(N·M). ALL paths sharing a basename are
      // kept so callers can detect ambiguity instead of silently guessing.
      const base = CachingNodeFsAdapter.basenameOf(rel);
      const existing = this.basenameToPaths.get(base);
      if (existing) {
        existing.push(rel);
      } else {
        this.basenameToPaths.set(base, [rel]);
      }
      this.assets.push(
        this.cacheContent ? { path: rel, metadata, content } : { path: rel, metadata },
      );
    }
    this.indexed = true;
  }

  /**
   * All vault-relative paths whose basename (filename without `.md`) equals
   * `basename`. Empty array when none. Multiple entries = ambiguous basename —
   * callers decide (the imports audit counts these separately per RFC R5).
   */
  async findPathsByBasename(basename: string): Promise<string[]> {
    await this.buildIndex();
    return this.basenameToPaths.get(basename) ?? [];
  }

  /** Whether an indexed markdown file exists at this exact vault-relative path. */
  async hasIndexedPath(filePath: string): Promise<boolean> {
    await this.buildIndex();
    const norm = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
    return this.pathSet.has(norm);
  }

  private static basenameOf(rel: string): string {
    const slash = rel.lastIndexOf("/");
    const name = slash === -1 ? rel : rel.slice(slash + 1);
    return name.endsWith(".md") ? name.slice(0, -3) : name;
  }

  /** All indexed assets (path + frontmatter), reusing the single index pass. */
  async indexedAssets(): Promise<IndexedAsset[]> {
    await this.buildIndex();
    return this.assets;
  }

  override async getMarkdownFiles(rootPath?: string): Promise<string[]> {
    // A scoped sub-path query is rare and not part of the audit hot loop —
    // delegate uncached to keep semantics identical.
    if (rootPath) return super.getMarkdownFiles(rootPath);
    await this.buildIndex();
    return this.allPaths;
  }

  override async findFileByUID(uid: string): Promise<string | null> {
    await this.buildIndex();
    return this.uidToPath.get(CachingNodeFsAdapter.normalizeUid(uid)) ?? null;
  }

  /** Match base NodeFsAdapter.normalizeValue: strip quotes/brackets + trim. */
  private static normalizeUid(value: unknown): string {
    if (value === null || value === undefined) return "";
    return String(value)
      .replace(/["'[\]]/g, "")
      .trim();
  }

  override async fileExists(filePath: string): Promise<boolean> {
    await this.buildIndex();
    const norm = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
    if (this.pathSet.has(norm)) return true;
    // Non-indexed (absolute / non-md / outside-vault) paths fall back to disk.
    return super.fileExists(filePath);
  }
}
