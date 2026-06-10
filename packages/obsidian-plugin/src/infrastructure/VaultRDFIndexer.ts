import { App, TFile, EventRef } from "obsidian";
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
} from "exocortex";
import { ObsidianVaultAdapter } from '@plugin/adapters/ObsidianVaultAdapter';
import { LoggerFactory } from '@plugin/adapters/logging/LoggerFactory';

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

  constructor(
    private app: App,
    logger?: ILogger,
    notifier?: INotificationService,
    excludedFolders: string[] = [],
  ) {
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
      const result = await this.errorHandler.executeWithRetry(
        async () => this.converter.convertVaultWithValidation({
          excludedFolders: this.excludedFolders,
        }),
        { context: "VaultRDFIndexer.initialize", operation: "convertVault" }
      );
      this.applyFileSpaceDiscovery(result.fileSpaces);
      await this.tripleStore.addAll(result.triples);
      await this.runInference();

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
    const run = this.errorHandler
      .executeWithRetry(
        async () => {
          await this.tripleStore.clear();
          const result = await this.converter.convertVaultWithValidation({
            excludedFolders: this.excludedFolders,
          });
          this.applyFileSpaceDiscovery(result.fileSpaces);
          await this.tripleStore.addAll(result.triples);
          await this.runInference();
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

  dispose(): void {
    for (const ref of this.eventRefs) {
      this.app.vault.offref(ref);
    }
    this.eventRefs = [];
    this.isInitialized = false;
  }
}
