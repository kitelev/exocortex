import fs from "fs-extra";
import path from "path";
import { NodeFsAdapter } from "./NodeFsAdapter.js";
import type { AssetLookupIndex } from "../cache/CacheManager.js";

/**
 * Read-side memo over {@link NodeFsAdapter} for the READ-ONLY planning phase of
 * `create-batch` (req 1848dff9-bb2e-43a9-95e7-d917d6cef552).
 *
 * Why it exists: one `create` reads every vault file several times — class index, TBox walk,
 * anchor / status resolution — because every lookup walks the vault and `NodeFsAdapter` caches
 * nothing. Planning N items through the same collaborators would pay that N times over; this
 * adapter answers every repeated lookup from memory, so a batch pays each vault pass once.
 *
 * ⚠ Two measurements of "how many times" live in this package and they do NOT agree, because they
 * were taken over different corpora: this class's original note said FOUR passes over 34,935 files
 * on vault-exodev, while {@link CreateContextOptions.fsAdapter} records FIVE passes / 84,618 reads
 * over 16,923 **markdown** files on vault-bot-kitelev (2026-09-25, #4291). Neither is wrong; the
 * pass COUNT also grew between them. Treat the figure next to each claim as scoped to the vault and
 * file population named there, and re-measure before quoting either in a new decision.
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
 * The one exception is {@link findFileByUidFilename}: memoising per uid would
 * still walk the vault once per DISTINCT uid — a batch linking to 6,500
 * different existing assets would walk it 6,500 times — so it walks once,
 * keeps every markdown filename in the base walk's order, and answers each uid
 * with the base walk's own predicate over that list.
 *
 * A failed load is not memoised: the next caller retries it, as it would have
 * with `NodeFsAdapter`, instead of a one-off I/O hiccup pinning a file as
 * unreadable for the whole batch.
 *
 * ⛤ Unlike {@link CachingNodeFsAdapter} (which indexes once and serves UID /
 * existence lookups from that index), this covers every read method `create`'s
 * collaborators call — `getFileMetadata`, `findFileByUidFilename`,
 * `findFileByLinkpath`, `findFilesByMetadata` included — which is what makes
 * the per-item cost independent of the vault size.
 */
export class PlanningFsAdapter extends NodeFsAdapter {
  private readonly root: string;
  private markdownNames?: Promise<{ lower: string; rel: string }[]>;
  private readonly listings = new Map<string, Promise<string[]>>();
  private readonly contents = new Map<string, Promise<string>>();
  private readonly metadata = new Map<string, Promise<Record<string, any>>>();
  private readonly existence = new Map<string, Promise<boolean>>();
  private readonly byUidFilename = new Map<string, Promise<string | null>>();
  private readonly byLinkpath = new Map<string, Promise<string | null>>();
  private readonly byMetadataQuery = new Map<string, Promise<string[]>>();

  /**
   * #4291 — an OPTIONAL single-key lookup index, plus the paths its source
   * could not speak about. Injected (the CLI derives it from the persistent
   * triple cache); `undefined` ⇒ every lookup scans, i.e. exactly the
   * pre-#4291 behaviour.
   */
  private readonly lookupIndexSource?: () => Promise<AssetLookupIndex | undefined>;
  private lookupIndexLoad?: Promise<AssetLookupIndex | undefined>;

  constructor(
    rootPath: string,
    options: {
      lookupIndex?: () => Promise<AssetLookupIndex | undefined>;
    } = {},
  ) {
    super(rootPath);
    this.root = rootPath;
    this.lookupIndexSource = options.lookupIndex;
  }

  private memo<T>(
    store: Map<string, Promise<T>>,
    key: string,
    load: () => Promise<T>,
  ): Promise<T> {
    let pending = store.get(key);
    if (!pending) {
      const loading = load();
      pending = loading;
      store.set(key, loading);
      loading.catch(() => {
        if (store.get(key) === loading) store.delete(key);
      });
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

  /**
   * The ONE place a vault file's text is read during planning (#4291).
   *
   * `NodeFsAdapter.getFileMetadata` reads through `this.readFile`, so memoising
   * here also serves every frontmatter lookup — and, via
   * {@link readFileAbsolute}, the collaborators that walk the vault themselves
   * (`ShapeLoader`, `PropertyNameValidator`) rather than through the adapter.
   * Before they shared this memo each of them re-read the whole corpus: five
   * passes, 84 618 reads over 16 923 files for ONE `create`.
   *
   * Semantics are the base class's — `super.readFile` still raises
   * `FileNotFoundError` for a missing file, and a failed read is not memoised.
   */
  override readFile(filePath: string): Promise<string> {
    return this.memo(this.contents, filePath, () => super.readFile(filePath));
  }

  /**
   * {@link readFile} for a caller holding an ABSOLUTE path.
   *
   * The vault walkers address files absolutely (`path.join(dir, entry.name)`
   * from the vault root); the memo is keyed vault-relative, so both address
   * the same entry and neither reads a file the other already read.
   */
  readFileAbsolute(absolutePath: string): Promise<string> {
    return this.readFile(path.relative(this.root, absolutePath));
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
    const uidLower = uid.toLowerCase();
    return this.memo(this.byUidFilename, uidLower, async () => {
      // The base walk's predicate, applied to the base walk's order: the first
      // `<uid>.md` / `<uid> …` / `<uid>-…` markdown file, depth-first.
      for (const { lower, rel } of await this.walkMarkdownNames()) {
        if (
          lower.startsWith(uidLower + ".md") ||
          lower.startsWith(uidLower + " ") ||
          lower.startsWith(uidLower + "-")
        ) {
          return rel;
        }
      }
      return null;
    });
  }

  /**
   * Every markdown file, in the order {@link NodeFsAdapter.findFileByUidFilename}
   * visits them: `readdir` order, depth-first, hidden directories and
   * `node_modules` skipped. Walked once per planning phase.
   */
  private walkMarkdownNames(): Promise<{ lower: string; rel: string }[]> {
    this.markdownNames ??= (async () => {
      const names: { lower: string; rel: string }[] = [];
      const walk = async (dir: string): Promise<void> => {
        let entries;
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name.startsWith(".") || entry.name === "node_modules") {
              continue;
            }
            await walk(fullPath);
          } else if (entry.isFile() && entry.name.endsWith(".md")) {
            names.push({
              lower: entry.name.toLowerCase(),
              rel: path.relative(this.root, fullPath),
            });
          }
        }
      };
      await walk(this.root);
      return names;
    })();
    return this.markdownNames;
  }

  override findFileByLinkpath(target: string): Promise<string | null> {
    return this.memo(this.byLinkpath, target.trim(), () =>
      super.findFileByLinkpath(target),
    );
  }

  /**
   * #4291 — the paths a `{ exo__Asset_uid: <string> }` lookup has to CONSIDER,
   * in `getMarkdownFiles()` order, or `null` when there is no usable index.
   *
   * ⛤ This narrows the CANDIDATE LIST, it does not answer the query: the
   * caller still runs the base class's predicate, through the base class's
   * metadata reader, over these paths in the base class's order — so the
   * result is what a full scan would have returned, computed without reading
   * the other ~17 000 files. That is a stronger guarantee than "the index says
   * so", and it is why a duplicated uid needs no special case.
   *
   * The index's `unknownPaths` (entries the cache holds no triples for — 4 of
   * 17 136 on the measured vault) are ALWAYS candidates: the cache does not
   * know their uid, so only the predicate can decide. A vault dirty enough for
   * that set to be large gets no narrowing at all rather than a slow one.
   */
  private async narrowedCandidates(
    key: "exo__Asset_uid" | "exo__Asset_label",
    value: string,
  ): Promise<string[] | null> {
    if (!this.lookupIndexSource) return null;
    this.lookupIndexLoad ??= this.lookupIndexSource().catch(() => undefined);
    const index = await this.lookupIndexLoad;
    if (!index) return null;
    if (index.unknownPaths.length > PlanningFsAdapter.MAX_UNKNOWN_PATHS) {
      return null;
    }
    const source = key === "exo__Asset_uid" ? index.byUid : index.byLabel;
    const wanted = new Set([...(source.get(value) ?? []), ...index.unknownPaths]);
    if (wanted.size === 0) return [];
    // `getMarkdownFiles()` is a readdir walk (memoised, no file reads); taking
    // the order from it is what makes the narrowed answer order-identical to
    // the scan's.
    const all = await this.getMarkdownFiles();
    return all.filter((file) => wanted.has(file));
  }

  /** Above this many cache-unjudgeable files, narrowing is not worth its slack. */
  private static readonly MAX_UNKNOWN_PATHS = 200;

  /**
   * The single-key query shapes narrowing applies to. Anything else (a
   * multi-key query, another key, a non-string value) takes the scan
   * unchanged.
   *
   * `create` reaches this through THREE call sites, all measured on the PR
   * head rather than recalled (review of PR #4476 — an earlier revision of
   * this docstring said "the two … and the only ones", and that was a false
   * statement in the code, not merely a stale one):
   *
   * | site | key |
   * |---|---|
   * | `NodeFsAdapter.findFileByUID` (the `isDefinedBy` anchor) | `exo__Asset_uid` |
   * | `EffortStatusResolver.resolveStatusUid` (the default status) | `exo__Asset_label` |
   * | `EffortStatusResolver.resolveClassFile` (the status-bearing walk) | `exo__Asset_label` |
   *
   * The third is narrowed too, and deliberately so: it resolves a class
   * reference that is not a UUID, i.e. a `prefix__Name` label, which the index
   * keys verbatim. It is exercised end to end — `ems__Task` is status-bearing
   * only via the `ems__Effort` walk, and the byte-identity axis compares the
   * resolved `ems__Effort_status` between the narrowed and the scanning path.
   */
  private static narrowableQuery(
    query: Record<string, any>,
  ): { key: "exo__Asset_uid" | "exo__Asset_label"; value: string } | null {
    const keys = Object.keys(query);
    if (keys.length !== 1) return null;
    const key = keys[0];
    if (key !== "exo__Asset_uid" && key !== "exo__Asset_label") return null;
    const value = query[key];
    return typeof value === "string" && value.length > 0 ? { key, value } : null;
  }

  override async findFilesByMetadata(
    query: Record<string, any>,
  ): Promise<string[]> {
    const matches = await this.memo(
      this.byMetadataQuery,
      JSON.stringify(query),
      async () => {
        const narrowable = PlanningFsAdapter.narrowableQuery(query);
        const candidates =
          narrowable === null
            ? null
            : await this.narrowedCandidates(narrowable.key, narrowable.value);
        if (candidates === null) {
          return super.findFilesByMetadata(query);
        }
        const found: string[] = [];
        for (const file of candidates) {
          try {
            const metadata = await this.getFileMetadata(file);
            if (this.matchesQuery(metadata, query)) {
              found.push(file);
            }
          } catch {
            continue;
          }
        }
        return found;
      },
    );
    return matches.slice();
  }

  /** Drop every memo — a write makes all of them potentially stale. */
  private forget(): void {
    this.markdownNames = undefined;
    this.listings.clear();
    this.contents.clear();
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
