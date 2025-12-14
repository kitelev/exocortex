import { App, TFile } from "obsidian";
import {
  SPARQLParser,
  AlgebraTranslator,
  AlgebraOptimizer,
  BGPExecutor,
  type SPARQLQuery,
  type SolutionMapping,
  type AlgebraOperation,
  type BGPOperation,
  ValidationError,
  ServiceError,
  ApplicationErrorHandler,
  type ILogger,
  type INotificationService,
} from "exocortex";
import { VaultRDFIndexer } from '@plugin/infrastructure/VaultRDFIndexer';
import { LoggerFactory } from '@plugin/adapters/logging/LoggerFactory';

export class SPARQLQueryService {
  private indexer: VaultRDFIndexer;
  private parser: SPARQLParser;
  private translator: AlgebraTranslator;
  private optimizer: AlgebraOptimizer;
  private executor: BGPExecutor | null = null;
  private isInitialized = false;
  private errorHandler: ApplicationErrorHandler;
  private logger: ILogger;

  constructor(
    app: App,
    logger?: ILogger,
    notifier?: INotificationService
  ) {
    const defaultLogger = LoggerFactory.create("SPARQLQueryService");
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

    this.indexer = new VaultRDFIndexer(app, this.logger, notifier);
    this.parser = new SPARQLParser();
    this.translator = new AlgebraTranslator();
    this.optimizer = new AlgebraOptimizer();
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      await this.errorHandler.executeWithRetry(
        async () => this.indexer.initialize(),
        { context: "SPARQLQueryService.initialize", operation: "initializeIndexer" }
      );

      const tripleStore = this.indexer.getTripleStore();
      this.executor = new BGPExecutor(tripleStore);

      this.isInitialized = true;
    } catch (error) {
      const serviceError = new ServiceError(
        "failed to initialize sparql query service",
        {
          service: "SPARQLQueryService",
          operation: "initialize",
          originalError: error instanceof Error ? error.message : String(error),
        }
      );
      this.errorHandler.handle(serviceError);
      throw serviceError;
    }
  }

  async query(queryString: string): Promise<SolutionMapping[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.executor) {
      throw new ServiceError(
        "query executor not initialized",
        {
          service: "SPARQLQueryService",
          operation: "query",
        }
      );
    }

    try {
      const ast: SPARQLQuery = this.parser.parse(queryString);

      let algebra: AlgebraOperation = this.translator.translate(ast);
      algebra = this.optimizer.optimize(algebra);

      const resultIterator = this.executor.execute(algebra as BGPOperation);
      const results: SolutionMapping[] = [];
      for await (const mapping of resultIterator) {
        results.push(mapping);
      }

      return results;
    } catch (error) {
      if (error instanceof ServiceError) {
        this.errorHandler.handle(error);
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes("parse") || errorMessage.includes("syntax")) {
        const validationError = new ValidationError(
          "invalid sparql query",
          {
            query: queryString,
            originalError: errorMessage,
          }
        );
        this.errorHandler.handle(validationError);
        throw validationError;
      }

      const serviceError = new ServiceError(
        "sparql query execution failed",
        {
          service: "SPARQLQueryService",
          operation: "query",
          query: queryString,
          originalError: errorMessage,
        }
      );
      this.errorHandler.handle(serviceError);
      throw serviceError;
    }
  }

  async refresh(): Promise<void> {
    await this.errorHandler.executeWithRetry(
      async () => this.indexer.refresh(),
      { context: "SPARQLQueryService.refresh", operation: "refreshIndexer" }
    );
  }

  async updateFile(file: TFile): Promise<void> {
    await this.errorHandler.executeWithRetry(
      async () => this.indexer.updateFile(file),
      { context: "SPARQLQueryService.updateFile", filePath: file.path }
    );
  }

  async dispose(): Promise<void> {
    this.indexer.dispose();
    this.executor = null;
    this.isInitialized = false;
  }

  /**
   * Get the underlying triple store for direct access.
   * Useful for debugging and advanced SPARQL operations.
   */
  getTripleStore() {
    return this.indexer.getTripleStore();
  }
}
