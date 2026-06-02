import type { TFile } from "obsidian";
import type { InMemoryTripleStore, SolutionMapping, Triple } from "exocortex";
import { SPARQLQueryService } from '@plugin/application/services/SPARQLQueryService';
import type ExocortexPlugin from '@plugin/ExocortexPlugin';

/**
 * Application-layer handle to the underlying RDF indexer.
 *
 * Exposes only the operations FocusProfile wiring needs (refresh,
 * filter mutators) so callers in `presentation/` or other plugin
 * surfaces cannot accidentally reach into the infrastructure-layer
 * `VaultRDFIndexer` lifecycle (init, dispose, internal store handles).
 *
 * Closes the abstraction-leak deferred in `getRdfIndexer()` JSDoc
 * (Issue #3327, code-reviewer MEDIUM from PR #3326).
 */
export interface IRdfIndexerHandle {
  /**
   * Reindex the vault. With an explicit `effectiveOntologies` arg the
   * indexer first persists it via `setEffectiveOntologies` before
   * reindexing. Without an arg, reuses the previously stored set.
   */
  refresh(effectiveOntologies?: ReadonlySet<string>): Promise<void>;
  /**
   * Replace the stored effective AssetSpace UID set. Pass `null` to
   * clear (disengages the filter on next refresh).
   */
  setEffectiveOntologies(set: ReadonlySet<string> | null): void;
  /**
   * Replace the folder→AS-UID map used by the converter to decide
   * which `assetspaces/<folder>/` files belong to which AS. Pass
   * `null` to clear (filter disengages — see VaultRDFIndexer:111).
   */
  setAssetSpaceFolderToUid(map: ReadonlyMap<string, string> | null): void;
}

/**
 * Result of a SPARQL SELECT query execution.
 *
 * @example
 * ```typescript
 * const result = await api.query('SELECT ?task WHERE { ?task a ems:Task }');
 * console.log(`Found ${result.count} tasks`);
 * result.bindings.forEach(binding => {
 *   console.log(binding.get('task'));
 * });
 * ```
 */
export interface QueryResult {
  /** Array of solution mappings, each containing variable bindings from a matching result row */
  bindings: SolutionMapping[];
  /** Total number of results returned */
  count: number;
}

/**
 * Result of a SPARQL CONSTRUCT query execution.
 *
 * @example
 * ```typescript
 * const result = await api.construct('CONSTRUCT { ?s ?p ?o } WHERE { ?s a ems:Task }');
 * console.log(`Constructed ${result.count} triples`);
 * ```
 */
export interface ConstructResult {
  /** Array of RDF triples constructed by the query */
  triples: Triple[];
  /** Total number of triples constructed */
  count: number;
}

/**
 * High-level API for executing SPARQL queries against the Obsidian vault's knowledge graph.
 *
 * The SPARQLApi provides a simplified interface for querying RDF data extracted from
 * Obsidian notes. It wraps the lower-level SPARQLQueryService and handles initialization,
 * query execution, and resource management.
 *
 * ## Features
 * - Execute SPARQL SELECT queries
 * - Access the underlying triple store for advanced operations
 * - Refresh data when vault contents change
 * - Proper resource cleanup via dispose
 *
 * ## Supported SPARQL Features
 * - SELECT queries with WHERE clauses
 * - Basic Graph Patterns (BGPs)
 * - FILTER expressions
 * - OPTIONAL patterns
 * - UNION patterns
 * - ORDER BY, LIMIT, OFFSET
 * - Aggregate functions (COUNT, SUM, AVG, MIN, MAX)
 * - GROUP BY and HAVING
 *
 * @example Basic usage
 * ```typescript
 * // Get API instance from plugin
 * const api = plugin.getSPARQLApi();
 *
 * // Execute a simple query
 * const result = await api.query(`
 *   SELECT ?task ?label WHERE {
 *     ?task a <https://exocortex.my/ontology/ems#Task> .
 *     ?task <https://exocortex.my/ontology/exo#Asset_label> ?label .
 *   }
 *   LIMIT 10
 * `);
 *
 * // Process results
 * for (const binding of result.bindings) {
 *   const task = binding.get('task');
 *   const label = binding.get('label');
 *   console.log(`Task: ${task}, Label: ${label}`);
 * }
 * ```
 *
 * @example Using prefixes
 * ```typescript
 * const result = await api.query(`
 *   PREFIX ems: <https://exocortex.my/ontology/ems#>
 *   PREFIX exo: <https://exocortex.my/ontology/exo#>
 *
 *   SELECT ?task ?status WHERE {
 *     ?task a ems:Task .
 *     ?task ems:Task_status ?status .
 *   }
 * `);
 * ```
 *
 * @see {@link SPARQLQueryService} for the underlying query execution engine
 * @see {@link InMemoryTripleStore} for direct triple store access
 */
export class SPARQLApi {
  private queryService: SPARQLQueryService;

  /**
   * Creates a new SPARQLApi instance.
   *
   * The API is lazily initialized - the triple store and query engine are only
   * created when the first query is executed.
   *
   * @param plugin - The Exocortex plugin instance providing access to the Obsidian app
   *
   * @example
   * ```typescript
   * // Typically obtained via plugin, not created directly
   * const api = plugin.getSPARQLApi();
   *
   * // Or if creating manually (advanced usage)
   * const api = new SPARQLApi(plugin);
   * ```
   */
  constructor(plugin: ExocortexPlugin) {
    this.queryService = new SPARQLQueryService(
      plugin.app,
      undefined,
      undefined,
      plugin.settings?.excludedFolders ?? [],
    );
  }

  /**
   * Executes a SPARQL SELECT query against the knowledge graph.
   *
   * The query is parsed, optimized, and executed against the in-memory triple store
   * containing RDF data extracted from the Obsidian vault. If this is the first query,
   * the triple store will be initialized automatically.
   *
   * @param sparql - The SPARQL query string to execute. Must be a valid SELECT query.
   * @returns Promise resolving to query results containing bindings and count
   *
   * @throws {ValidationError} If the query has syntax errors or is malformed.
   *   The error context includes the original query and parse error details.
   * @throws {ServiceError} If the query service is not properly initialized or
   *   if an internal error occurs during query execution.
   *
   * @example Simple SELECT query
   * ```typescript
   * const result = await api.query('SELECT * WHERE { ?s ?p ?o } LIMIT 10');
   * console.log(`Found ${result.count} triples`);
   * ```
   *
   * @example Query with filters
   * ```typescript
   * const result = await api.query(`
   *   PREFIX ems: <https://exocortex.my/ontology/ems#>
   *   SELECT ?task WHERE {
   *     ?task a ems:Task .
   *     ?task ems:Task_status "active" .
   *   }
   * `);
   * ```
   *
   * @example Handling errors
   * ```typescript
   * try {
   *   const result = await api.query('INVALID SPARQL');
   * } catch (error) {
   *   if (error instanceof ValidationError) {
   *     console.error('Query syntax error:', error.message);
   *   } else if (error instanceof ServiceError) {
   *     console.error('Service error:', error.message);
   *   }
   * }
   * ```
   *
   * @example Accessing binding values
   * ```typescript
   * const result = await api.query('SELECT ?name ?age WHERE { ... }');
   * for (const binding of result.bindings) {
   *   // Get individual variables
   *   const name = binding.get('name'); // Returns IRI, Literal, or BlankNode
   *   const age = binding.get('age');
   *
   *   // Check if variable is bound
   *   if (binding.has('optionalVar')) {
   *     // Process optional variable
   *   }
   *
   *   // Get all bindings as Map
   *   const allBindings = binding.getBindings();
   * }
   * ```
   */
  async query(sparql: string): Promise<QueryResult> {
    const bindings = await this.queryService.query(sparql);
    return {
      bindings,
      count: bindings.length,
    };
  }

  /**
   * Returns the underlying in-memory triple store.
   *
   * Provides direct access to the RDF triple store for advanced operations
   * that are not covered by the standard SPARQL query interface. This is useful
   * for debugging, custom traversals, or integration with other RDF tools.
   *
   * **Note:** The triple store may be empty if no queries have been executed yet
   * (lazy initialization). Call {@link refresh} or execute a query first to ensure
   * the store is populated.
   *
   * @returns The in-memory triple store containing RDF triples from the vault
   *
   * @example Inspecting triple store contents
   * ```typescript
   * const store = api.getTripleStore();
   *
   * // Get all triples (if supported by store implementation)
   * const allTriples = store.getTriples();
   * console.log(`Store contains ${allTriples.length} triples`);
   * ```
   *
   * @example Checking store state
   * ```typescript
   * const store = api.getTripleStore();
   * // Use for debugging or advanced RDF operations
   * ```
   *
   * @see {@link InMemoryTripleStore} for available triple store operations
   */
  getTripleStore(): InMemoryTripleStore {
    return this.queryService.getTripleStore();
  }

  /**
   * Returns true once the underlying triple store is fully populated and
   * ready to serve SPARQL queries.
   *
   * Used by `DynamicCommandButtonGroupBuilder` (Issue #3171) to choose
   * between the cold-start `ExocmdFastResolver` fast path and the full
   * production resolver — the latter requires a populated store.
   */
  isReady(): boolean {
    return this.queryService.isReady();
  }

  /**
   * Refreshes the triple store by re-indexing all vault files.
   *
   * Call this method when vault contents have changed and you need to ensure
   * the SPARQL queries reflect the latest data. The refresh operation:
   * 1. Clears the existing triple store
   * 2. Re-scans all markdown files in the vault
   * 3. Extracts RDF triples from frontmatter and content
   * 4. Rebuilds the triple store index
   *
   * **Performance note:** This operation may take several seconds for large vaults.
   * Consider calling it sparingly, such as on plugin reload or explicit user action.
   *
   * @returns Promise that resolves when the refresh is complete
   *
   * @throws {ServiceError} If the indexer fails to refresh. The error context
   *   includes details about which operation failed.
   *
   * @example Manual refresh after vault changes
   * ```typescript
   * // User modified some files
   * await api.refresh();
   *
   * // Now queries will reflect the latest data
   * const result = await api.query('SELECT * WHERE { ?s ?p ?o }');
   * ```
   *
   * @example Handling refresh errors
   * ```typescript
   * try {
   *   await api.refresh();
   *   console.log('Refresh completed successfully');
   * } catch (error) {
   *   console.error('Failed to refresh:', error.message);
   *   // May want to retry or notify user
   * }
   * ```
   */
  async refresh(): Promise<void> {
    await this.queryService.refresh();
  }

  /**
   * Re-indexes triples for a single file.
   *
   * Removes existing triples owned by `file` from the triple store and
   * re-converts the file's frontmatter + body into fresh triples. Unlike
   * {@link refresh}, this operation is O(1 file) rather than O(all files),
   * making it cheap enough to call on every incremental frontmatter mutation.
   *
   * Intended use: call from a `metadataCache.on("changed")` handler after
   * Obsidian has parsed the latest frontmatter. Issue #2785 (hot-mutation
   * cache invalidation gap) requires this entry point because
   * `metadataCache.on("changed")` is the only event that fires with
   * guaranteed-fresh metadata — `vault.on("modify")` may fire before the
   * cache has re-parsed the file, producing a re-index with stale values.
   *
   * @param file - The file whose triples need to be re-indexed
   * @returns Promise that resolves when re-indexing is complete
   *
   * @see Issue #2785
   */
  async reindexFile(file: TFile): Promise<void> {
    await this.queryService.updateFile(file);
  }

  /**
   * Returns an application-layer handle to the underlying RDF indexer.
   * Exposed для RFC 0a0791c1 B.4 wiring — `PluginRdfIndexerAdapter`
   * (Issue #3322) constructs an `IRdfIndexer` over this handle so
   * `FocusProfileSwitchManager.switchProfile` can thread the effective
   * ontology set через `refresh(set)`. `applyActiveProfileFilter`
   * (Issue #3324) uses it to set the folder map and effective set
   * during cold-start.
   *
   * The return type is narrowed к {@link IRdfIndexerHandle} so callers
   * cannot reach into `VaultRDFIndexer` lifecycle (init/dispose/store)
   * — closes the abstraction-leak deferred in PR #3326 (Issue #3327).
   *
   * This is intentionally a thin passthrough; callers should NOT
   * directly mutate indexer state outside of the SwitchManager flow.
   */
  getRdfIndexer(): IRdfIndexerHandle {
    return this.queryService.getIndexer();
  }

  /**
   * Disposes of the SPARQL API and releases all associated resources.
   *
   * This method should be called when the API is no longer needed, typically
   * during plugin unload. After disposal:
   * - The triple store is cleared and dereferenced
   * - The query executor is released
   * - Any pending operations may be cancelled
   *
   * **Important:** After calling dispose, the API instance should not be used.
   * Any subsequent calls to {@link query}, {@link refresh}, or {@link getTripleStore}
   * may throw errors or produce undefined behavior.
   *
   * @returns Promise that resolves when disposal is complete
   *
   * @example Cleanup on plugin unload
   * ```typescript
   * class MyPlugin extends Plugin {
   *   private sparqlApi: SPARQLApi;
   *
   *   async onunload() {
   *     // Clean up SPARQL API resources
   *     await this.sparqlApi.dispose();
   *   }
   * }
   * ```
   *
   * @example Safe disposal pattern
   * ```typescript
   * async function cleanup(api: SPARQLApi | null) {
   *   if (api) {
   *     await api.dispose();
   *   }
   * }
   * ```
   */
  async dispose(): Promise<void> {
    await this.queryService.dispose();
  }
}
