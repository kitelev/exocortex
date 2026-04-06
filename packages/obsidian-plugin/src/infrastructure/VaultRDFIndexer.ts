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

  constructor(
    private app: App,
    logger?: ILogger,
    notifier?: INotificationService
  ) {
    this.tripleStore = new InMemoryTripleStore();
    this.vaultAdapter = new ObsidianVaultAdapter(
      app.vault,
      app.metadataCache,
      app
    );
    this.converter = new NoteToRDFConverter(this.vaultAdapter, logger || LoggerFactory.create("NoteToRDFConverter"));

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
      const triples = await this.errorHandler.executeWithRetry(
        async () => this.converter.convertVault(),
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

  async refresh(): Promise<void> {
    await this.errorHandler.executeWithRetry(
      async () => {
        await this.tripleStore.clear();
        const triples = await this.converter.convertVault();
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
