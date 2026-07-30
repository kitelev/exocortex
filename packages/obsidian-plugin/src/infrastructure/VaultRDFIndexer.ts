import { App, TFile, EventRef, parseYaml } from "obsidian";
import {
  InMemoryTripleStore,
  NoteToRDFConverter,
  ApplicationErrorHandler,
  RDFSInferenceEngine,
  NonInheritablePropertyRegistry,
  PropertyCardinalityRegistry,
  PrototypeChainMaterializer,
  INFERRED_GRAPH,
  Namespace,
  NetworkError,
  ServiceError,
  isPathExcluded,
  normaliseExcludedFolders,
  discoverFileSpaceExclusions,
  frontmatterDeclaresFileSpace,
  type FileSpaceDiscoveryResult,
  type ILogger,
  type INotificationService,
  type IFile,
  IRI,
} from "@kitelev/exocortex-core";
import { ObsidianVaultAdapter } from '@plugin/adapters/ObsidianVaultAdapter';
import { LoggerFactory } from '@plugin/adapters/logging/LoggerFactory';

/**
 * Outcome of the last FULL vault walk (Issue #3472).
 *
 * `total`/`indexed`/`skipped` come straight from
 * `NoteToRDFConverter.convertVaultWithValidation().summary` — `skipped` is
 * the Issue #3468 aggregated counter (invariant violations + invalid IRIs),
 * NOT a second parallel metric. `durationMs` covers the whole rebuild
 * (convertVault + addAll + inference), including retry attempts of the
 * indexer-internal `executeWithRetry` — it reports how long the user
 * actually waited, not how long the last attempt took. Known limitation:
 * `SPARQLQueryService` wraps `initialize()`/`refresh()` in a SECOND
 * `executeWithRetry`; if the inner layer exhausts its retries and the
 * outer layer re-invokes, the timer restarts and only the last outer
 * attempt is measured. `finishedAt` lets callers reject stats from a walk
 * that completed before THEIR walk was initiated (stale-stats guard for
 * the coalesced-refresh path).
 */
export interface VaultWalkStats {
  readonly total: number;
  readonly indexed: number;
  readonly skipped: number;
  readonly durationMs: number;
  readonly finishedAt: number;
}

export class VaultRDFIndexer {
  private tripleStore: InMemoryTripleStore;
  private converter: NoteToRDFConverter;
  private vaultAdapter: ObsidianVaultAdapter;
  private isInitialized = false;
  private eventRefs: EventRef[] = [];
  private errorHandler: ApplicationErrorHandler;
  private logger: ILogger;
  /**
   * Snapshot of vault-relative folder prefixes whose files must not be
   * indexed. The plugin's settings tab passes the current list through the
   * constructor; this instance keeps a frozen copy so per-event handlers
   * (modify/rename/create) honour the same set as the initial walk.
   */
  private readonly excludedFolders: string[];
  /**
   * FileSpace mount prefixes derived from vault `exo__FileSpace`
   * declarations (onto-RFC 18808c73 Phase 5) — kept in sync with the latest
   * walk so live-edit events honour the same skip as `convertVault*`.
   * Unlike `excludedFolders` these are NOT settings — they re-derive from
   * RDF declarations on every walk and on declaration edits.
   */
  private fileSpacePrefixes: string[] = [];
  /** Vault paths of the FileSpace declaration assets themselves. */
  private fileSpaceDeclarations = new Set<string>();
  /**
   * In-flight full-reindex latch. Event handlers are fire-and-forget; a
   * declaration-triggered `refresh()` clears and rebuilds the whole store,
   * so concurrent per-file updates during that window would race
   * clear()/addAll() (duplicate or lost triples). Handlers await the
   * latch and RETURN — the refresh re-reads the current vault state, so
   * their work is already covered.
   */
  private refreshInFlight: Promise<void> | null = null;
  /**
   * Stats of the last completed FULL walk (initialize/refresh) — null until
   * the first walk succeeds. Incremental per-file updates do not touch it.
   * Consumed by the one-shot «indexing complete» notice (Issue #3472).
   */
  private lastWalkStats: VaultWalkStats | null = null;

  /**
   * Periodic per-file progress sink for FULL walks (#al-activitylog-progress).
   * Forwarded into `convertVaultWithValidation({ onProgress })` from both
   * `initialize()` and `refresh()` so a long cold-start index AND a
   * profile-apply reindex both visibly advance in the activity log. Optional —
   * omitted in unit tests / non-plugin contexts. Per-file incremental updates
   * (`updateFile`) deliberately do NOT emit (single-file, instant).
   */
  private readonly onIndexProgress?: (processed: number, total: number) => void;

  constructor(
    private app: App,
    logger?: ILogger,
    notifier?: INotificationService,
    excludedFolders: string[] = [],
    /** Injectable clock for deterministic duration tests. */
    private readonly now: () => number = () => Date.now(),
    onIndexProgress?: (processed: number, total: number) => void,
  ) {
    this.onIndexProgress = onIndexProgress;
    this.tripleStore = new InMemoryTripleStore();
    this.vaultAdapter = new ObsidianVaultAdapter(
      app.vault,
      app.metadataCache,
      app
    );
    this.converter = new NoteToRDFConverter(this.vaultAdapter, logger || LoggerFactory.create("NoteToRDFConverter"));
    this.excludedFolders = normaliseExcludedFolders(excludedFolders);

    const defaultLogger = LoggerFactory.create("VaultRDFIndexer");
    this.logger = logger || {
      debug: defaultLogger.debug.bind(defaultLogger),
      info: defaultLogger.info.bind(defaultLogger),
      warn: defaultLogger.warn.bind(defaultLogger),
      error: defaultLogger.error.bind(defaultLogger),
    };

    const defaultNotifier: INotificationService = {
      info: () => {},
      warn: () => {},
      error: () => {},
      success: () => {},
      confirm: async () => false,
    };

    this.errorHandler = new ApplicationErrorHandler(
      {},
      this.logger,
      notifier || defaultNotifier
    );
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      const startedAt = this.now();
      const result = await this.errorHandler.executeWithRetry(
        async () => this.converter.convertVaultWithValidation({
          excludedFolders: this.excludedFolders,
          onProgress: this.onIndexProgress,
        }),
        { context: "VaultRDFIndexer.initialize", operation: "convertVault" }
      );
      this.applyFileSpaceDiscovery(result.fileSpaces);
      await this.tripleStore.addAll(result.triples);
      await this.runInference();
      this.recordWalkStats(result.summary, startedAt);

      this.registerEventListeners();

      this.isInitialized = true;
    } catch (error) {
      throw new ServiceError("failed to initialize vault rdf indexer", {
        service: "VaultRDFIndexer",
        operation: "initialize",
        originalError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private registerEventListeners(): void {
    this.eventRefs.push(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile) {
          void (async () => {
            try {
              await this.updateFile(file);
            } catch (error) {
              this.handleFileError("modify", file.path, error);
            }
          })();
        }
      })
    );

    this.eventRefs.push(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) {
          void (async () => {
            try {
              await this.removeFile(file);
            } catch (error) {
              this.handleFileError("delete", file.path, error);
            }
          })();
        }
      })
    );

    this.eventRefs.push(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile) {
          void (async () => {
            try {
              await this.updateFile(file);
            } catch (error) {
              this.handleFileError("create", file.path, error);
            }
          })();
        }
      })
    );

    this.eventRefs.push(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile) {
          void (async () => {
            try {
              await this.renameFile(file, oldPath);
            } catch (error) {
              this.handleFileError("rename", file.path, error, { oldPath });
            }
          })();
        }
      })
    );
  }

  private handleFileError(
    operation: string,
    filePath: string,
    error: unknown,
    context?: Record<string, unknown>
  ): void {
    const networkError = new NetworkError(
      `failed to ${operation} file in rdf index`,
      {
        service: "VaultRDFIndexer",
        operation,
        filePath,
        ...context,
        originalError: error instanceof Error ? error.message : String(error),
      }
    );
    this.errorHandler.handle(networkError);
  }

  async updateFile(file: TFile): Promise<void> {
    if (file.extension !== "md") {
      return;
    }

    // A full reindex is rebuilding the store right now — adding this
    // file's triples concurrently would race clear()/addAll(); the
    // refresh re-reads the current vault state, so just wait it out.
    if (this.refreshInFlight !== null) {
      await this.refreshInFlight;
      return;
    }

    // A FileSpace declaration changed or appeared — recompute the exclusion
    // set. A changed mount set requires a full reindex: newly-excluded
    // content must be purged AND previously-excluded files may need
    // indexing (declaration removed/retargeted). `refresh()` re-derives
    // the discovery itself, so this returns right after.
    if (
      this.fileSpaceDeclarations.has(file.path) ||
      this.isFileSpaceDeclaration(file)
    ) {
      if (await this.rediscoverFileSpaces()) {
        await this.refresh();
        return;
      }
    }

    // Honour folder-exclusion settings for live-edit events too. Without
    // this guard a file inside an excluded folder would still be indexed
    // when the user edited it (the initial walk in `initialize()` excludes
    // it, but `vault.on("modify")` would re-introduce it). To keep the
    // store consistent with the configured exclusion set we also remove
    // any stale triples that may exist for the path (e.g. files that were
    // indexed before the user added their folder to the exclusion list).
    if (isPathExcluded(file.path, this.excludedFolders)) {
      await this.removeFileTriples(file.path);
      return;
    }

    // FileSpace skip for live edits (onto-RFC 18808c73 Phase 5): content
    // inside a FileSpace mount must never (re-)enter the triple store.
    if (isPathExcluded(file.path, this.fileSpacePrefixes)) {
      await this.removeFileTriples(file.path);
      return;
    }

    // Issue #3936: a reified `exo__Statement` note emits a materialized LOGICAL
    // EDGE `<subject> <predicate> <object>` (convertLegacyNote, EKA D5) whose
    // SUBJECT is the statement's referent — NOT this file's IRI. So the
    // incremental path below (`removeFileTriples` is subject-scoped to the file
    // IRI) cannot purge the OLD edge on re-index, leaving it stale alongside the
    // freshly-emitted one after any edit to the statement's subject/predicate/
    // object. A graph edit is graph-wide; mirror the FileSpace-declaration
    // branch above and do a full `refresh()` (clear + rebuild), which purges the
    // stale edge. Detected from the CURRENT (pre-edit) store state — the file is
    // still typed `exo#Statement` there — so this also covers the removal case
    // (edited to no longer be a statement, whose old edge would otherwise
    // linger). Reified statements are rare, so the full-refresh cost is
    // acceptable (same trade-off as the FileSpace branch). (Enum `rdf:type`
    // shadow triples are NOT covered here on purpose: they are globally-true,
    // idempotent facts about the enum instance, never stale-divergent. The A2
    // symbolic superclass edges the issue also cited do not exist on this
    // branch — their PR #3935 was closed, not merged.)
    if (await this.wasReifiedStatement(file.path)) {
      await this.refresh();
      return;
    }

    await this.errorHandler.executeWithRetry(
      async () => {
        const fileIRI = new IRI(`obsidian://vault/${encodeURI(file.path)}`);
        const isPrototype = await this.hasInstances(fileIRI);

        await this.removeFileTriples(file.path);
        const triples = await this.converter.convertNote(file as IFile);
        await this.tripleStore.addAll(triples);

        if (isPrototype) {
          await this.runInference();
        }
      },
      { context: "VaultRDFIndexer.updateFile", filePath: file.path }
    );
  }

  private async hasInstances(fileIRI: IRI): Promise<boolean> {
    const prototypePredicate = Namespace.EXO.term("Asset_prototype");
    const instances = await this.tripleStore.match(undefined, prototypePredicate, fileIRI);
    return instances.length > 0;
  }

  /**
   * Issue #3936: is `path` CURRENTLY indexed as a reified `exo__Statement`
   * (i.e. the store holds `<fileIRI> rdf:type exo#Statement`, emitted by the
   * converter for a note whose `exo__Instance_class` is `exo__Statement`)?
   *
   * A reified statement emits an extra materialized edge on a NON-file-IRI
   * subject that the subject-scoped `removeFileTriples` cannot evict, so an
   * incremental re-index leaves the OLD edge stale. Callers route such a file
   * to a full `refresh()` instead. Reading the PRE-mutation store state means
   * this also fires when a statement is edited to no longer BE a statement (its
   * old edge must still be purged) and when a statement is deleted.
   */
  private async wasReifiedStatement(path: string): Promise<boolean> {
    const fileIRI = new IRI(`obsidian://vault/${encodeURI(path)}`);
    const rdfType = Namespace.RDF.term("type");
    const statementClass = Namespace.EXO.term("Statement");
    const typed = await this.tripleStore.match(fileIRI, rdfType, statementClass);
    return typed.length > 0;
  }

  async removeFile(file: TFile): Promise<void> {
    if (this.refreshInFlight !== null) {
      await this.refreshInFlight;
      return; // the refresh saw the current (post-delete) vault state
    }
    // Deleting a FileSpace declaration un-excludes its mount — previously
    // skipped files must be indexed, which only a full reindex can do.
    if (this.fileSpaceDeclarations.has(file.path)) {
      if (await this.rediscoverFileSpaces()) {
        await this.refresh();
        return;
      }
    }
    // Issue #3936: deleting a reified exo__Statement leaves its materialized
    // logical edge (non-file-IRI subject) stale — subject-scoped
    // removeFileTriples cannot evict it. Full refresh purges it (same rationale
    // as updateFile).
    if (await this.wasReifiedStatement(file.path)) {
      await this.refresh();
      return;
    }
    await this.errorHandler.executeWithRetry(
      async () => this.removeFileTriples(file.path),
      { context: "VaultRDFIndexer.removeFile", filePath: file.path }
    );
  }

  async renameFile(file: TFile, oldPath: string): Promise<void> {
    if (this.refreshInFlight !== null) {
      await this.refreshInFlight;
      return; // the refresh saw the current (post-rename) vault state
    }
    // A renamed declaration changes the declaration set (and possibly the
    // exclusion set, e.g. moved into its own mount) — recompute first.
    if (this.fileSpaceDeclarations.has(oldPath)) {
      if (await this.rediscoverFileSpaces()) {
        await this.refresh();
        return;
      }
    }
    await this.errorHandler.executeWithRetry(
      async () => {
        await this.removeFileTriples(oldPath);
        await this.updateFile(file);
      },
      { context: "VaultRDFIndexer.renameFile", filePath: file.path, oldPath }
    );
  }

  /**
   * Post-sync targeted reindex of the paths ExoSync just mutated on disk
   * (RFC 8f93ff95). ExoSync writes via the low-level `vault.adapter.write`,
   * which fires NO Obsidian vault/metadataCache event, so nothing reindexes
   * the store and pulled assets stay invisible in Layouts until restart. This
   * is the explicit trigger — exactly like `ProfileApplyManager` calling
   * `refresh()` after its own adapter writes.
   *
   * Each path is re-read STRAIGHT FROM DISK (not metadataCache): present ⇒
   * re-index from disk, absent ⇒ remove its triples (a synced deletion). Then
   * a SINGLE `runInference()` re-materializes RDFS + prototype-chain triples
   * for the whole batch (per-file inference is intentionally skipped — review
   * MEDIUM-3 mitigation). Unlike {@link refresh} it does NOT `clear()` the
   * store, so a mid-batch failure leaves a partial-but-non-empty store (no
   * blank-Layout risk); the command layer surfaces an explicit Notice on throw.
   *
   * Guards mirror {@link updateFile}: a full reindex in flight is waited out
   * (it re-reads the current vault state, covering these paths), and a mutated
   * KNOWN FileSpace declaration falls back to a full {@link refresh} (a changed
   * mount set must purge/admit content a targeted update cannot).
   *
   * @param paths - Vault-relative paths mutated by one sync run
   *   (`RepoSyncResult.pulledPaths` ∪ `mergedPaths`). De-duplicated internally.
   */
  async reindexPathsFromDisk(paths: string[]): Promise<void> {
    const unique = [...new Set(paths)];
    if (unique.length === 0) {
      return;
    }

    // A full reindex is rebuilding the store right now — targeted adds would
    // race clear()/addAll(); the refresh re-reads the current vault state, so
    // these paths are already covered.
    if (this.refreshInFlight !== null) {
      await this.refreshInFlight;
      return;
    }

    // A mutated KNOWN FileSpace declaration changes the mount set (newly
    // excluded content must be purged, previously-excluded admitted) — only a
    // full reindex does that correctly. (A brand-new declaration arriving via
    // sync is a Tier-1 gap covered by the next full walk / restart.)
    if (unique.some((p) => this.fileSpaceDeclarations.has(p))) {
      if (await this.rediscoverFileSpaces()) {
        await this.refresh();
        return;
      }
    }

    for (const path of unique) {
      await this.updateFileFromDisk(path);
    }
    // One global inference for the whole batch — covers inherited / subClass /
    // prototype-chain triples the per-file targeted update skips.
    await this.runInference();
  }

  /**
   * Reindex one path read from disk (RFC 8f93ff95). Needs no `TFile` and does
   * NOT read frontmatter from metadataCache: the content comes from the
   * low-level `vault.adapter` (mobile-safe, the same seam ExoSync writes
   * through) and the frontmatter is parsed from it. That makes a just-synced
   * asset visible even when metadataCache has not caught up.
   *
   * Dispatch is by disk presence — a readable path is re-indexed, an absent
   * path (synced deletion) has its triples removed. Does NOT run inference;
   * the batch driver {@link reindexPathsFromDisk} runs it once afterwards.
   */
  private async updateFileFromDisk(path: string): Promise<void> {
    if (!path.endsWith(".md")) {
      return;
    }

    // Honour folder-exclusion + FileSpace mount skips for synced paths too
    // (mirrors updateFile): excluded content must never (re-)enter the store,
    // and a stale triple for a now-excluded path is purged.
    if (
      isPathExcluded(path, this.excludedFolders) ||
      isPathExcluded(path, this.fileSpacePrefixes)
    ) {
      await this.removeFileTriples(path);
      return;
    }

    const content = await this.readFromDisk(path);
    // Always drop the path's prior triples first (overwrite-on-reindex). For a
    // synced deletion (no content on disk) this is the whole operation.
    await this.removeFileTriples(path);
    if (content === null) {
      return;
    }

    const frontmatter = this.parseFrontmatterFromContent(content);
    if (frontmatter === null) {
      return; // no/invalid frontmatter → nothing to index
    }
    const triples = await this.converter.convertNoteFromFrontmatter(
      this.syntheticFile(path),
      frontmatter,
    );
    await this.tripleStore.addAll(triples);
  }

  /**
   * Low-level disk read by path (DataAdapter — mobile-safe, bypasses the
   * `TFile` registry and metadataCache). Returns `null` on miss/unreadable so
   * the caller treats a vanished path as a deletion.
   */
  private async readFromDisk(path: string): Promise<string | null> {
    try {
      return await this.app.vault.adapter.read(path);
    } catch {
      return null;
    }
  }

  /**
   * Parse the YAML frontmatter block from raw file content (disk-read path).
   * Mirrors `ObsidianVaultAdapter.extractFrontmatter` — `null` when there is
   * no block, it is empty, or the YAML is invalid.
   *
   * A leading BOM and `\r\n` line endings are normalised first: this is the
   * SOLE frontmatter parser on the post-sync reindex path (no metadataCache
   * fallback), and `updateFileFromDisk` removes the path's prior triples
   * BEFORE calling here — so a CRLF/BOM asset that fails to parse would not
   * just stay stale, it would silently VANISH from the store until restart.
   * Plugin/CLI/Obsidian write LF, so this is defensive against foreign-tool
   * edits, not the common case.
   */
  private parseFrontmatterFromContent(
    content: string,
  ): Record<string, unknown> | null {
    const normalised = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
    const match = normalised.match(/^---\n([\s\S]*?)\n---/);
    if (!match) {
      return null;
    }
    const yaml = match[1];
    if (!yaml || yaml.trim() === "") {
      return null;
    }
    try {
      const parsed = parseYaml(yaml);
      return typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  /**
   * Minimal {@link IFile} from a vault path — only `path`/`basename` are read
   * by the converter on the disk-read reindex path, so a synthetic identity
   * (no `TFile` lookup) is sufficient and mobile-safe.
   */
  private syntheticFile(path: string): IFile {
    const name = path.split("/").pop() ?? path;
    return { path, basename: name.replace(/\.md$/, ""), name, parent: null };
  }

  /** Adopt a walk's discovery result as the live-event exclusion set. */
  private applyFileSpaceDiscovery(discovery: FileSpaceDiscoveryResult): void {
    this.fileSpacePrefixes = discovery.prefixes;
    this.fileSpaceDeclarations = new Set(discovery.declarationPaths);
  }

  /**
   * Re-run FileSpace discovery against the current vault state. Returns
   * `true` when the exclusion PREFIX set changed (caller must `refresh()`
   * to purge/index accordingly); the declaration set is always adopted.
   */
  private async rediscoverFileSpaces(): Promise<boolean> {
    const discovered = discoverFileSpaceExclusions(this.vaultAdapter);
    const changed =
      JSON.stringify([...discovered.prefixes].sort()) !==
      JSON.stringify([...this.fileSpacePrefixes].sort());
    this.applyFileSpaceDiscovery(discovered);
    return changed;
  }

  /**
   * Cheap per-event probe: does this file's frontmatter declare
   * `exo__FileSpace` membership in UUID-wikilink form? (Label-form links
   * resolve during full walks; per-event detection stays cheap by design.)
   */
  private isFileSpaceDeclaration(file: TFile): boolean {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as
      | Record<string, unknown>
      | undefined;
    return frontmatterDeclaresFileSpace(fm);
  }

  private async removeFileTriples(filePath: string): Promise<void> {
    const fileIRI = new IRI(`obsidian://vault/${encodeURI(filePath)}`);
    const triples = await this.tripleStore.match(fileIRI);
    await this.tripleStore.removeAll(triples);
  }

  /**
   * Clear the triple store and rebuild from the current vault state.
   *
   * Signature matches {@link IRdfIndexer.refresh} so a
   * `ProfileApplyManager` instance can drive a profile-switch reindex
   * by calling `await rdfIndexer.refresh()` directly. Profile switching is
   * now mount-state based (RFC 01a83de8 Phase 3 — the query-time soft-filter
   * was removed); the refresh re-indexes whatever AssetSpace folders are
   * currently materialised on disk.
   */
  async refresh(): Promise<void> {
    // Coalesce concurrent refreshes (latch) — two rapid declaration edits
    // must not interleave two clear()/addAll() rebuilds.
    if (this.refreshInFlight !== null) {
      return this.refreshInFlight;
    }
    const startedAt = this.now();
    const run = this.errorHandler
      .executeWithRetry(
        async () => {
          await this.tripleStore.clear();
          const result = await this.converter.convertVaultWithValidation({
            excludedFolders: this.excludedFolders,
            onProgress: this.onIndexProgress,
          });
          this.applyFileSpaceDiscovery(result.fileSpaces);
          await this.tripleStore.addAll(result.triples);
          await this.runInference();
          this.recordWalkStats(result.summary, startedAt);
        },
        { context: "VaultRDFIndexer.refresh", operation: "refresh" }
      )
      .finally(() => {
        this.refreshInFlight = null;
      });
    this.refreshInFlight = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async runInference(): Promise<void> {
    if (this.tripleStore.clearGraph) {
      await this.tripleStore.clearGraph(INFERRED_GRAPH);
    }

    const engine = new RDFSInferenceEngine();
    await engine.materialize(this.tripleStore);

    const registry = new NonInheritablePropertyRegistry();
    await registry.initialize(this.tripleStore);
    const cardinalityRegistry = new PropertyCardinalityRegistry();
    await cardinalityRegistry.initialize(this.tripleStore);
    const materializer = new PrototypeChainMaterializer(registry, cardinalityRegistry);
    await materializer.materialize(this.tripleStore);
  }

  getTripleStore(): InMemoryTripleStore {
    return this.tripleStore;
  }

  /**
   * Stats of the last completed FULL vault walk, or null if no walk has
   * succeeded yet. See {@link VaultWalkStats} for field semantics.
   */
  getLastWalkStats(): VaultWalkStats | null {
    // Shallow copy — the accessor is re-exported through the public
    // SPARQLApi; handing out the internal reference would let API
    // consumers mutate plugin-internal state.
    return this.lastWalkStats === null ? null : { ...this.lastWalkStats };
  }

  private recordWalkStats(
    summary: { total: number; indexed: number; skipped: number },
    startedAt: number,
  ): void {
    const finishedAt = this.now();
    this.lastWalkStats = {
      total: summary.total,
      indexed: summary.indexed,
      skipped: summary.skipped,
      durationMs: finishedAt - startedAt,
      finishedAt,
    };
  }

  dispose(): void {
    for (const ref of this.eventRefs) {
      this.app.vault.offref(ref);
    }
    this.eventRefs = [];
    this.isInitialized = false;
  }
}
