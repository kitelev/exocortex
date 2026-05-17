import type { App, TFile } from "obsidian";
import {
  ExoQLParser,
  ExoQLAlgebraTranslator,
  AlgebraOptimizer,
  ExoQLQueryExecutor,
  type SPARQLQuery,
  type SolutionMapping,
  type AlgebraOperation,
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
  private parser: ExoQLParser;
  private translator: ExoQLAlgebraTranslator;
  private optimizer: AlgebraOptimizer;
  private executor: ExoQLQueryExecutor | null = null;
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
    this.parser = new ExoQLParser();
    this.translator = new ExoQLAlgebraTranslator();
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
      this.executor = new ExoQLQueryExecutor(tripleStore);

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

      // ASK queries return boolean, not solution mappings
      if (this.executor.isAskQuery(algebra)) {
        await this.executor.executeAsk(algebra);
        return [];
      }

      return await this.executor.executeAll(algebra);
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

  /**
   * Returns true once the underlying triple store is fully populated and
   * ready to execute SPARQL queries.
   *
   * Used by `DynamicCommandButtonGroupBuilder` (Issue #3171) to decide
   * whether to take the cold-start fast path via `ExocmdFastResolver` or
   * the full-resolver path. The flag flips inside {@link initialize} after
   * `convertVault()` completes — exactly the window we want to avoid
   * blocking the UI on.
   */
  isReady(): boolean {
    return this.isInitialized;
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
