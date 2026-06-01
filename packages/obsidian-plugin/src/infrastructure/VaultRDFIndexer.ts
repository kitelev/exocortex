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
  shouldSkipFileForEffectiveSet,
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
   * Active effective-ontology allow-set (Issue #3321). `null` means no
   * filter is in effect — index the full vault (pre-#3321 behaviour).
   *
   * Stored separately from {@link assetSpaceFolderToUid} because the two
   * arrive from different sources at different cadences:
   *   - `effectiveOntologies` is driven by the active FocusProfile (changes
   *     when the user switches profiles).
   *   - `assetSpaceFolderToUid` is vault topology (changes when an
   *     AssetSpace is added/removed — rare).
   *
   * Splitting the two also allows the indexer to satisfy the
   * `IRdfIndexer.refresh(effectiveOntologies)` contract from B.4 without
   * forcing FocusProfileSwitchManager to know about the folder map.
   */
  private effectiveOntologies: ReadonlySet<string> | null = null;
  /**
   * Precomputed mapping `assetspaces/<folder>` → AssetSpace UID. Populated
   * by the plugin from {@link AssetSpaceManager.lookupAssetSpaceForPath}
   * once at onload and on AssetSpace topology changes. `null` means the
   * map has not been wired yet — the filter (if any) degrades to the
   * no-filter fall-back path with a warn-log (per converter R15 guard).
   */
  private assetSpaceFolderToUid: ReadonlyMap<string, string> | null = null;

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
   * Set the active effective-ontology allow-set. Pass `null` to clear the
   * filter (revert to indexing the full vault).
   *
   * Does NOT trigger reindexing — callers control ordering. Typical flow:
   *   `indexer.setEffectiveOntologies(set)` then `indexer.refresh()`.
   * Or use {@link refresh}'s single-arg form which combines both.
   */
  setEffectiveOntologies(set: ReadonlySet<string> | null): void {
    this.effectiveOntologies = set;
  }

  /**
   * Set the precomputed `assetspaces/<folder>` → AssetSpace UID map. The
   * plugin updates this when the vault's AssetSpace topology changes
   * (rarely) and at onload. Pass `null` to clear.
   *
   * The folder map and the effective-ontology set are decoupled because
   * they change at different cadences and originate from different
   * subsystems (vault topology vs active FocusProfile). The
   * {@link NoteToRDFConverter} requires BOTH to engage the filter;
   * absence of either degrades to the no-filter fall-back.
   */
  setAssetSpaceFolderToUid(map: ReadonlyMap<string, string> | null): void {
    this.assetSpaceFolderToUid = map;
  }

  /** Test/debug helper — current effective set snapshot. */
  getEffectiveOntologies(): ReadonlySet<string> | null {
    return this.effectiveOntologies;
  }

  /** Test/debug helper — current folder→UID map snapshot. */
  getAssetSpaceFolderToUid(): ReadonlyMap<string, string> | null {
    return this.assetSpaceFolderToUid;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      const triples = await this.errorHandler.executeWithRetry(
        async () => this.converter.convertVault({
          excludedFolders: this.excludedFolders,
          effectiveOntologies: this.effectiveOntologies ?? undefined,
          assetSpaceFolderToUid: this.assetSpaceFolderToUid ?? undefined,
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

    // Issue #3321 — same guard for the effective-ontology filter. Without
    // this, an edit to a file in a filtered-OUT AssetSpace would index
    // its triples and gradually drift away from the snapshot the most
    // recent `refresh(effectiveOntologies)` walked. We also remove any
    // stale triples for the path defensively (covers the case where the
    // file was indexed BEFORE the user activated a profile that excludes
    // it). The filter engages only when BOTH the effective set is non-
    // empty AND the folder map is wired — mirroring the converter's
    // engagement contract (`shouldSkipFileForEffectiveSet` is a no-op
    // unless the file lives under `assetspaces/<folder>/`).
    if (
      this.effectiveOntologies !== null &&
      this.effectiveOntologies.size > 0 &&
      this.assetSpaceFolderToUid !== null &&
      shouldSkipFileForEffectiveSet(
        file.path,
        this.effectiveOntologies,
        this.assetSpaceFolderToUid,
      )
    ) {
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
   * Issue #3321 / RFC 0a0791c1 — signature matches
   * {@link IRdfIndexer.refresh} from B.4 so a `FocusProfileSwitchManager`
   * instance can drive a profile-switch reindex by calling
   * `await rdfIndexer.refresh(effectiveSet)` directly.
   *
   * Semantics:
   *   - `refresh()` — reindex with the previously stored effective set
   *     (or no filter if none stored). Does NOT clear the stored set.
   *   - `refresh(set)` — replace the stored effective set with `set`,
   *     then reindex. To clear, call `setEffectiveOntologies(null)`
   *     followed by `refresh()` — `refresh(...)` itself only sets
   *     non-undefined values.
   *
   * The companion `assetSpaceFolderToUid` map is managed independently
   * via {@link setAssetSpaceFolderToUid} because it changes on vault
   * topology (rare) rather than profile switches (per-session).
   */
  async refresh(effectiveOntologies?: ReadonlySet<string>): Promise<void> {
    if (effectiveOntologies !== undefined) {
      this.effectiveOntologies = effectiveOntologies;
    }
    await this.errorHandler.executeWithRetry(
      async () => {
        await this.tripleStore.clear();
        const triples = await this.converter.convertVault({
          excludedFolders: this.excludedFolders,
          effectiveOntologies: this.effectiveOntologies ?? undefined,
          assetSpaceFolderToUid: this.assetSpaceFolderToUid ?? undefined,
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
