import { NodeFsAdapter } from "./NodeFsAdapter.js";

/**
 * Read-side memo over {@link NodeFsAdapter} for the READ-ONLY planning phase of
 * `create-batch` (req 1848dff9-bb2e-43a9-95e7-d917d6cef552).
 *
 * Why it exists: one `create` reads every vault file four times (measured
 * 2026-09-25 on vault-exodev, 34,935 files: class index, TBox walk, anchor /
 * status resolution — every lookup walks the vault because `NodeFsAdapter`
 * caches nothing). Planning N items through the same collaborators would read
 * the vault 4×N times. This adapter answers every repeated lookup from memory,
 * so a batch pays each vault pass once.
 *
 * Correct by construction for the phase it serves: planning never writes, so
 * nothing it memoises can go stale while it runs. The write phase uses a
 * separate vault adapter. The mutating methods below still drop every memo
 * before delegating, so an unexpected write can never be answered from a
 * pre-write snapshot.
 *
 * Semantics are the base class's: every override memoises the INHERITED
 * implementation per argument rather than re-implementing it, so a lookup
 * answers exactly what `NodeFsAdapter` would have answered the first time.
 *
 * ⛤ Unlike {@link CachingNodeFsAdapter} (which indexes once and serves UID /
 * existence lookups from that index), this covers every read method `create`'s
 * collaborators call — `getFileMetadata`, `findFileByUidFilename`,
 * `findFileByLinkpath`, `findFilesByMetadata` included — which is what makes
 * the per-item cost independent of the vault size.
 */
export class PlanningFsAdapter extends NodeFsAdapter {
  private readonly listings = new Map<string, Promise<string[]>>();
  private readonly metadata = new Map<string, Promise<Record<string, any>>>();
  private readonly existence = new Map<string, Promise<boolean>>();
  private readonly byUidFilename = new Map<string, Promise<string | null>>();
  private readonly byLinkpath = new Map<string, Promise<string | null>>();
  private readonly byMetadataQuery = new Map<string, Promise<string[]>>();

  private memo<T>(
    store: Map<string, Promise<T>>,
    key: string,
    load: () => Promise<T>,
  ): Promise<T> {
    let pending = store.get(key);
    if (!pending) {
      pending = load();
      store.set(key, pending);
    }
    return pending;
  }

  override async getMarkdownFiles(rootPath?: string): Promise<string[]> {
    const files = await this.memo(this.listings, rootPath ?? "", () =>
      super.getMarkdownFiles(rootPath),
    );
    // A copy: callers own the array they are handed (the base class returns a
    // fresh one per call, and a caller that sorts or splices it must not
    // reorder the memo for the next caller).
    return files.slice();
  }

  override async getFileMetadata(
    filePath: string,
  ): Promise<Record<string, any>> {
    const parsed = await this.memo(this.metadata, filePath, () =>
      super.getFileMetadata(filePath),
    );
    // A clone for the same reason as the listing copy: the base class hands
    // out a freshly parsed object per call, so a caller may mutate it. Sharing
    // one object would let one item's planning leak into the next.
    return structuredClone(parsed);
  }

  override fileExists(filePath: string): Promise<boolean> {
    return this.memo(this.existence, filePath, () =>
      super.fileExists(filePath),
    );
  }

  override findFileByUidFilename(uid: string): Promise<string | null> {
    return this.memo(this.byUidFilename, uid.toLowerCase(), () =>
      super.findFileByUidFilename(uid),
    );
  }

  override findFileByLinkpath(target: string): Promise<string | null> {
    return this.memo(this.byLinkpath, target.trim(), () =>
      super.findFileByLinkpath(target),
    );
  }

  override async findFilesByMetadata(
    query: Record<string, any>,
  ): Promise<string[]> {
    const matches = await this.memo(
      this.byMetadataQuery,
      JSON.stringify(query),
      () => super.findFilesByMetadata(query),
    );
    return matches.slice();
  }

  /** Drop every memo — a write makes all of them potentially stale. */
  private forget(): void {
    this.listings.clear();
    this.metadata.clear();
    this.existence.clear();
    this.byUidFilename.clear();
    this.byLinkpath.clear();
    this.byMetadataQuery.clear();
  }

  override async createFile(
    filePath: string,
    content: string,
  ): Promise<string> {
    this.forget();
    return super.createFile(filePath, content);
  }

  override async updateFile(filePath: string, content: string): Promise<void> {
    this.forget();
    return super.updateFile(filePath, content);
  }

  override async writeFile(filePath: string, content: string): Promise<void> {
    this.forget();
    return super.writeFile(filePath, content);
  }

  override async deleteFile(filePath: string): Promise<void> {
    this.forget();
    return super.deleteFile(filePath);
  }

  override async renameFile(oldPath: string, newPath: string): Promise<void> {
    this.forget();
    return super.renameFile(oldPath, newPath);
  }

  override async createDirectory(dirPath: string): Promise<void> {
    this.forget();
    return super.createDirectory(dirPath);
  }
}
