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
  type ILogger,
  type INotificationService,
  type IFile,
  IRI,
} from "exocortex";
import { ObsidianVaultAdapter } from '@plugin/adapters/ObsidianVaultAdapter';
import { LoggerFactory } from '@plugin/adapters/logging/LoggerFactory';

/**
 * Effective ontology filter context (Issue #3321 / RFC 0a0791c1). Captures the
 * `effectiveOntologies` allow-set AND the `folder → AssetSpace UID` map that
 * the converter needs to resolve which AssetSpace owns a given file. The two
 * fields travel together because the filter is meaningless without the map.
 *
 * Stored as a snapshot inside the indexer so that mid-session reindexing
 * (`refresh()` re-runs after a profile switch OR per-file `updateFile` events)
 * applies the active filter consistently.
 */
export interface EffectiveOntologyFilter {
  effectiveOntologies: ReadonlySet<string>;
  assetSpaceFolderToUid: ReadonlyMap<string, string>;
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
   * Active effective-ontology filter snapshot (Issue #3321). `null` means
   * no filter is in effect — index the full vault (backward-compatible
   * pre-#3321 behaviour). Updated by `setFilter()` and consumed by
   * `initialize()` / `refresh()` / per-file `updateFile()`.
   *
   * Per-file updateFile events do NOT currently re-filter against this
   * snapshot — files surviving the initial walk are assumed to stay in
   * scope until the next full reindex. This matches the pre-#3321
   * `excludedFolders` event semantics. A profile switch triggers a full
   * `refresh()` which re-runs the walk with the current filter.
   */
  private filter: EffectiveOntologyFilter | null = null;

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

  /**
   * Update the active effective-ontology filter snapshot (Issue #3321).
   * Pass `null` to clear the filter (revert to indexing the full vault).
   *
   * Does NOT trigger reindexing — callers (typically
   * {@link FocusProfileSwitchManager.switchProfile}) call `setFilter(...)`
   * then `refresh()` so the two operations happen in a controlled order.
   */
  setFilter(filter: EffectiveOntologyFilter | null): void {
    this.filter = filter;
  }

  /** Test helper — current filter snapshot. */
  getFilter(): EffectiveOntologyFilter | null {
    return this.filter;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      const triples = await this.errorHandler.executeWithRetry(
        async () => this.converter.convertVault({
          excludedFolders: this.excludedFolders,
          effectiveOntologies: this.filter?.effectiveOntologies,
          assetSpaceFolderToUid: this.filter?.assetSpaceFolderToUid,
        }),
        { context: "VaultRDFIndexer.initialize", operation: "convertVault" }
      );
      await this.tripleStore.addAll(triples);
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
    await this.errorHandler.executeWithRetry(
      async () => this.removeFileTriples(file.path),
      { context: "VaultRDFIndexer.removeFile", filePath: file.path }
    );
  }

  async renameFile(file: TFile, oldPath: string): Promise<void> {
    await this.errorHandler.executeWithRetry(
      async () => {
        await this.removeFileTriples(oldPath);
        await this.updateFile(file);
      },
      { context: "VaultRDFIndexer.renameFile", filePath: file.path, oldPath }
    );
  }

  private async removeFileTriples(filePath: string): Promise<void> {
    const fileIRI = new IRI(`obsidian://vault/${encodeURI(filePath)}`);
    const triples = await this.tripleStore.match(fileIRI);
    await this.tripleStore.removeAll(triples);
  }

  /**
   * Clear the triple store and rebuild from the current vault state.
   *
   * Issue #3321 / RFC 0a0791c1 — accepts an optional `filter` argument so a
   * profile switch (via {@link FocusProfileSwitchManager.switchProfile})
   * can atomically update the snapshot and reindex in one call. Pattern:
   *   - `refresh()` — reindex with the previously-stored filter (or none).
   *   - `refresh(filter)` — update the stored filter, then reindex. Pass
   *      a `null`-like sentinel via `setFilter(null)` if you want to clear
   *      the filter; `refresh()` without args does NOT clear the snapshot.
   *
   * The two-step `setFilter` + `refresh` pattern matches the
   * {@link FocusProfileSwitchManager} contract which expects `refresh` to
   * take an `effectiveOntologies` set; the filter object bundles the
   * companion folder→UID map so the two arrive atomically.
   */
  async refresh(filter?: EffectiveOntologyFilter): Promise<void> {
    if (filter !== undefined) {
      this.filter = filter;
    }
    await this.errorHandler.executeWithRetry(
      async () => {
        await this.tripleStore.clear();
        const triples = await this.converter.convertVault({
          excludedFolders: this.excludedFolders,
          effectiveOntologies: this.filter?.effectiveOntologies,
          assetSpaceFolderToUid: this.filter?.assetSpaceFolderToUid,
        });
        await this.tripleStore.addAll(triples);
        await this.runInference();
      },
      { context: "VaultRDFIndexer.refresh", operation: "refresh" }
    );
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
