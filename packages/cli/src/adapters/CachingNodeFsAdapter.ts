import { NodeFsAdapter } from "./NodeFsAdapter.js";

/**
 * One indexed markdown asset: its vault-relative path and parsed frontmatter.
 */
export interface IndexedAsset {
  path: string;
  metadata: Record<string, unknown>;
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
  private readonly allPaths: string[] = [];
  private readonly pathSet = new Set<string>();
  private readonly assets: IndexedAsset[] = [];

  constructor(rootPath: string) {
    super(rootPath);
  }

  /** Build the index once (idempotent). One disk pass over all markdown files. */
  async buildIndex(): Promise<void> {
    if (this.indexed) return;
    const files = await super.getMarkdownFiles();
    for (const rel of files) {
      this.allPaths.push(rel);
      this.pathSet.add(rel);
      let metadata: Record<string, unknown> = {};
      try {
        metadata = await super.getFileMetadata(rel);
      } catch {
        metadata = {};
      }
      const uid = metadata?.["exo__Asset_uid"];
      if (
        typeof uid === "string" &&
        uid.length > 0 &&
        !this.uidToPath.has(uid)
      ) {
        this.uidToPath.set(uid, rel);
      }
      this.assets.push({ path: rel, metadata });
    }
    this.indexed = true;
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
    return this.uidToPath.get(uid) ?? null;
  }

  override async fileExists(filePath: string): Promise<boolean> {
    await this.buildIndex();
    const norm = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
    if (this.pathSet.has(norm)) return true;
    // Non-indexed (absolute / non-md / outside-vault) paths fall back to disk.
    return super.fileExists(filePath);
  }
}
