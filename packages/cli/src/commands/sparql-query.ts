import { Command } from "commander";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import {
  InMemoryTripleStore,
  SPARQLParser,
  SPARQLParseError,
  AlgebraTranslator,
  AlgebraOptimizer,
  AlgebraSerializer,
  QueryExecutor,
  NoteToRDFConverter,
  Triple,
  type SolutionMapping,
  type ConstructOperation,
} from "exocortex";
import { FileSystemVaultAdapter } from "../adapters/FileSystemVaultAdapter.js";
import { TableFormatter } from "../formatters/TableFormatter.js";
import { JsonFormatter } from "../formatters/JsonFormatter.js";
import { CsvFormatter } from "../formatters/CsvFormatter.js";
import { TriplesFormatter } from "../formatters/TriplesFormatter.js";
import { ErrorHandler, type OutputFormat } from "../utils/ErrorHandler.js";
import { VaultNotFoundError, InvalidArgumentsError, QueryTimeoutError } from "../utils/errors/index.js";
import { ResponseBuilder, ErrorCode, type QueryResult, type ConstructResult } from "../responses/index.js";
import { ExitCodes } from "../utils/ExitCodes.js";
import { CacheManager } from "../cache/CacheManager.js";
import { QueryResultCache } from "../cache/QueryResultCache.js";
import { ProgressIndicator } from "../utils/ProgressIndicator.js";
import { QueryAnalyzer } from "../utils/QueryAnalyzer.js";
import { TemplateRegistry } from "../templates/TemplateRegistry.js";
import { SPARQLErrorEnhancer } from "../utils/SPARQLErrorEnhancer.js";
import { NTriplesFormatter } from "../utils/NTriplesFormatter.js";
import { scanVaultNamespaces } from "../utils/VaultNamespaceScanner.js";

export interface SparqlQueryOptions {
  vault: string;
  format: "table" | "json" | "csv" | "ntriples";
  output?: OutputFormat;
  explain?: boolean;
  dryRun?: boolean;
  stats?: boolean;
  noOptimize?: boolean;
  useCache?: boolean;
  cacheTtl?: string;
  cache?: boolean;
  timeout?: string;
  template?: string;
  param?: string;
}

/** Default TTL for query result cache in seconds */
export const DEFAULT_CACHE_TTL_SECONDS = 300;

/** Default timeout in milliseconds (30 seconds) */
export const DEFAULT_TIMEOUT_MS = 30000;

/** Environment variable name for configuring default timeout */
export const ENV_SPARQL_TIMEOUT = "EXOCORTEX_SPARQL_TIMEOUT";

/**
 * Get the default timeout value in milliseconds.
 *
 * Priority:
 * 1. EXOCORTEX_SPARQL_TIMEOUT environment variable (if valid)
 * 2. DEFAULT_TIMEOUT_MS (30000ms = 30s)
 *
 * This allows users to set a global default timeout without
 * specifying --timeout flag on every command.
 *
 * @returns Default timeout in milliseconds
 */
export function getDefaultTimeout(): number {
  const envValue = process.env[ENV_SPARQL_TIMEOUT];

  if (!envValue) {
    return DEFAULT_TIMEOUT_MS;
  }

  try {
    const parsed = parseTimeoutSafe(envValue);
    if (parsed !== null && parsed > 0) {
      return parsed;
    }
  } catch {
    // Invalid env value, fall back to default
  }

  return DEFAULT_TIMEOUT_MS;
}

/**
 * Safely parse a timeout string without throwing errors.
 * Returns null if the value is invalid.
 *
 * @param timeoutStr - Timeout string (e.g., "30s", "5000ms", "15")
 * @returns Timeout in milliseconds or null if invalid
 */
function parseTimeoutSafe(timeoutStr: string): number | null {
  const trimmed = timeoutStr.trim().toLowerCase();

  if (!trimmed) {
    return null;
  }

  // Check for milliseconds
  if (trimmed.endsWith("ms")) {
    const value = parseInt(trimmed.slice(0, -2), 10);
    if (isNaN(value) || value <= 0) {
      return null;
    }
    return value;
  }

  // Check for seconds
  if (trimmed.endsWith("s")) {
    const value = parseInt(trimmed.slice(0, -1), 10);
    if (isNaN(value) || value <= 0) {
      return null;
    }
    return value * 1000;
  }

  // Plain number defaults to seconds
  const value = parseInt(trimmed, 10);
  if (isNaN(value) || value <= 0) {
    return null;
  }
  return value * 1000;
}

/**
 * Parse cache TTL string into seconds.
 * Supports plain number (seconds).
 */
export function parseCacheTtl(ttlStr: string | undefined): number {
  if (!ttlStr) {
    return DEFAULT_CACHE_TTL_SECONDS;
  }

  const value = parseInt(ttlStr.trim(), 10);
  if (isNaN(value) || value <= 0) {
    throw new InvalidArgumentsError(
      `Invalid cache TTL: "${ttlStr}". Must be a positive number (seconds).`,
      'exocortex sparql query --cache-ttl 600 "SELECT * WHERE { ?s ?p ?o }"'
    );
  }
  return value;
}

/**
 * Parse timeout string into milliseconds.
 * Supports formats: "30s", "5000ms", "15" (defaults to seconds)
 */
export function parseTimeout(timeoutStr: string): number {
  const trimmed = timeoutStr.trim().toLowerCase();

  // Check for milliseconds
  if (trimmed.endsWith("ms")) {
    const value = parseInt(trimmed.slice(0, -2), 10);
    if (isNaN(value) || value <= 0) {
      throw new InvalidArgumentsError(
        `Invalid timeout format: "${timeoutStr}". Value must be a positive number.`,
        'exocortex sparql query --timeout "30s" or --timeout "5000ms"'
      );
    }
    return value;
  }

  // Check for seconds
  if (trimmed.endsWith("s")) {
    const value = parseInt(trimmed.slice(0, -1), 10);
    if (isNaN(value) || value <= 0) {
      throw new InvalidArgumentsError(
        `Invalid timeout format: "${timeoutStr}". Value must be a positive number.`,
        'exocortex sparql query --timeout "30s" or --timeout "5000ms"'
      );
    }
    return value * 1000;
  }

  // Plain number defaults to seconds
  const value = parseInt(trimmed, 10);
  if (isNaN(value) || value <= 0) {
    throw new InvalidArgumentsError(
      `Invalid timeout format: "${timeoutStr}". Use formats like "30s", "5000ms", or just a number (seconds).`,
      'exocortex sparql query --timeout "30s" or --timeout "5000ms"'
    );
  }
  return value * 1000;
}

/**
 * Execute a query with timeout protection using Promise.race pattern.
 *
 * @param queryPromise - The promise representing the query execution
 * @param timeoutMs - Timeout in milliseconds
 * @param startTime - Start time for elapsed calculation
 * @returns The query result or throws QueryTimeoutError
 */
export async function executeWithTimeout<T>(
  queryPromise: Promise<T>,
  timeoutMs: number,
  startTime: number = Date.now(),
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      const elapsedMs = Date.now() - startTime;
      reject(new QueryTimeoutError(timeoutMs, elapsedMs));
    }, timeoutMs);
  });

  return Promise.race([queryPromise, timeoutPromise]);
}

export function sparqlQueryCommand(): Command {
  return new Command("query")
    .description("Execute SPARQL query against Obsidian vault")
    .argument("[query]", "SPARQL query string or path to .sparql file (optional if --template is used)")
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option("--format <type>", "Output format: table|json|csv|ntriples", "table")
    .option("--output <type>", "Response format: text|json (for MCP tools)", "text")
    .option("--timeout <duration>", "Query timeout (e.g., 30s, 5000ms)", "30s")
    .option("--dry-run", "Validate query syntax without executing (no vault loading)")
    .option("--explain", "Show optimized query plan")
    .option("--stats", "Show execution statistics")
    .option("--no-optimize", "Disable query optimization")
    .option("--use-cache", "Use persistent triple cache (faster vault loading)")
    .option("--cache-ttl <seconds>", "Query result cache TTL in seconds (default: 300)")
    .option("--no-cache", "Bypass query result cache")
    .option("--template <name>", "Use a predefined query template")
    .option("--param <params>", "Template parameters (format: key=value,key2=value2)")
    .action(async (queryArg: string | undefined, options: SparqlQueryOptions) => {
      const outputFormat = (options.output || "text") as OutputFormat;
      ErrorHandler.setFormat(outputFormat);

      try {
        const startTime = Date.now();

        // Parse timeout - CLI flag takes priority over env var, which takes priority over default
        // Priority: --timeout flag > EXOCORTEX_SPARQL_TIMEOUT env var > 30s default
        const timeoutMs = options.timeout
          ? parseTimeout(options.timeout)
          : getDefaultTimeout();

        // Parse cache TTL
        const cacheTtlSeconds = parseCacheTtl(options.cacheTtl);
        const useQueryResultCache = options.cache !== false; // --no-cache sets this to false

        // Resolve query string from template or direct input
        let queryString: string;
        if (options.template) {
          const registry = new TemplateRegistry();
          const params = options.param ? registry.parseParamString(options.param) : {};
          queryString = registry.applyTemplate(options.template, params);

          if (outputFormat === "text") {
            const template = registry.getTemplate(options.template);
            console.log(`📋 Using template: ${options.template}`);
            if (Object.keys(params).length > 0) {
              console.log(`   Parameters: ${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(", ")}`);
            }
            console.log();
          }
        } else if (queryArg) {
          queryString = loadQuery(queryArg);
        } else {
          throw new InvalidArgumentsError(
            "Either a query argument or --template flag is required.",
            'exocortex sparql query "SELECT * WHERE { ?s ?p ?o }" or exocortex sparql query --template tasks-by-date --param date=2024-01-15'
          );
        }

        // Dry-run mode: validate syntax only, no vault loading
        if (options.dryRun) {
          await executeDryRun(queryString, options, outputFormat);
          return;
        }

        const vaultPath = resolve(options.vault);

        // Check query result cache first (before vault loading)
        if (useQueryResultCache) {
          const queryResultCache = new QueryResultCache();
          const cachedResult = await queryResultCache.get(queryString, cacheTtlSeconds);

          if (cachedResult !== null) {
            const totalDuration = Date.now() - startTime;

            if (outputFormat === "json") {
              // Return cached JSON response
              const response = ResponseBuilder.success(cachedResult, {
                durationMs: totalDuration,
                itemCount: (cachedResult as { count?: number }).count || 0,
                queryResultCacheHit: true,
              });
              console.log(JSON.stringify(response, null, 2));
            } else {
              // Text mode: show cached indicator and results
              console.log(`📦 (cached) Query result loaded from cache in ${totalDuration}ms\n`);
              const result = cachedResult as { type: string; bindings?: unknown[]; triples?: unknown[] };
              if (result.type === "select" && result.bindings) {
                console.log(`✅ Found ${result.bindings.length} result(s)\n`);
                // Output cached bindings
                formatCachedSelectResults(result.bindings, options.format);
              } else if (result.type === "construct" && result.triples) {
                console.log(`✅ Generated ${result.triples.length} triple(s)\n`);
                formatCachedConstructResults(result.triples, options.format);
              }
            }
            return;
          }
        }
        if (!existsSync(vaultPath)) {
          throw new VaultNotFoundError(vaultPath);
        }

        // Only show progress in text mode
        if (outputFormat === "text") {
          console.log(`📦 Loading vault: ${vaultPath}...`);
        }
        const loadStartTime = Date.now();

        let triples: Triple[];
        let cacheHit = false;

        if (options.useCache) {
          // Use cached triples for faster loading
          const cacheManager = new CacheManager(vaultPath);
          const cacheResult = await cacheManager.loadOrBuild();
          triples = cacheResult.triples;
          cacheHit = cacheResult.cacheHit;

          if (outputFormat === "text" && cacheHit) {
            console.log(`🚀 Cache hit! Loading from persistent cache...`);
          }
        } else {
          // Traditional vault loading
          const vaultAdapter = new FileSystemVaultAdapter(vaultPath);
          const converter = new NoteToRDFConverter(vaultAdapter);
          triples = await converter.convertVault();
        }

        const tripleStore = new InMemoryTripleStore();
        await tripleStore.addAll(triples);

        const loadDuration = Date.now() - loadStartTime;
        if (outputFormat === "text") {
          const cacheStatus = cacheHit ? " (from cache)" : "";
          console.log(`✅ Loaded ${triples.length} triples in ${loadDuration}ms${cacheStatus}\n`);
          console.log(`🔍 Parsing SPARQL query...`);
        }

        const parser = new SPARQLParser();

        // Scan vault for namespace directories and auto-register prefixes
        const vaultPrefixes = scanVaultNamespaces(vaultPath);
        if (vaultPrefixes.size > 0) {
          parser.setVaultPrefixes(vaultPrefixes);
        }

        const ast = parser.parse(queryString);

        if (outputFormat === "text") {
          console.log(`🔄 Translating to algebra...`);
        }
        const translator = new AlgebraTranslator();
        let algebra = translator.translate(ast);

        // Optimization is only applicable to non-CONSTRUCT queries
        // CONSTRUCT queries have their WHERE clause optimized separately
        if (!options.noOptimize && algebra.type !== "construct") {
          const optimizer = new AlgebraOptimizer();
          algebra = optimizer.optimize(algebra);
        } else if (!options.noOptimize && algebra.type === "construct") {
          // Optimize the WHERE clause inside CONSTRUCT
          const optimizer = new AlgebraOptimizer();
          const constructOp = algebra as ConstructOperation;
          algebra = {
            ...constructOp,
            where: optimizer.optimize(constructOp.where),
          };
        }

        if (options.explain && outputFormat === "text") {
          console.log(`📊 Query Plan:`);
          const serializer = new AlgebraSerializer();
          if (algebra.type === "construct") {
            const constructOp = algebra as ConstructOperation;
            console.log("CONSTRUCT Template:");
            console.log("  (template patterns)");
            console.log("WHERE:");
            console.log(serializer.toString(constructOp.where));
          } else {
            console.log(serializer.toString(algebra));
          }
          console.log();
        }

        const execStartTime = Date.now();
        const executor = new QueryExecutor(tripleStore);

        // Set query timeout if the executor supports it
        if (typeof executor.setTimeout === "function") {
          executor.setTimeout(timeoutMs);
        }

        // Progress indicator for long-running query execution (TTY mode only)
        const progressIndicator = outputFormat === "text"
          ? new ProgressIndicator("Executing query", { delayMs: 2000 })
          : null;

        // Execute based on query type
        if (executor.isConstructQuery(algebra)) {
          // CONSTRUCT query - returns triples
          progressIndicator?.start();
          const resultTriples = await executeWithTimeout(
            executor.executeConstruct(algebra),
            timeoutMs,
            execStartTime,
          );
          const execDuration = Date.now() - execStartTime;
          progressIndicator?.stop();
          const totalDuration = Date.now() - startTime;

          // Cache the CONSTRUCT result for future queries
          if (useQueryResultCache) {
            const triplesFormatter = new TriplesFormatter();
            const cacheableResult = {
              type: "construct",
              count: resultTriples.length,
              triples: JSON.parse(triplesFormatter.formatJson(resultTriples)),
            };
            const queryResultCache = new QueryResultCache();
            await queryResultCache.set(queryString, cacheableResult, cacheTtlSeconds);
          }

          if (outputFormat === "json") {
            // Structured JSON response for MCP tools
            const triplesFormatter = new TriplesFormatter();
            const constructResult: ConstructResult = {
              query: queryString,
              count: resultTriples.length,
              triples: JSON.parse(triplesFormatter.formatJson(resultTriples)),
            };
            const response = ResponseBuilder.success(constructResult, {
              durationMs: totalDuration,
              itemCount: resultTriples.length,
              loadDurationMs: loadDuration,
              execDurationMs: execDuration,
              triplesScanned: triples.length,
              cacheHit,
              queryResultCacheHit: false,
            });
            console.log(JSON.stringify(response, null, 2));
          } else {
            // Text mode output
            console.log(`✅ Generated ${resultTriples.length} triple(s) in ${execDuration}ms\n`);

            if (resultTriples.length > 0) {
              formatConstructResults(resultTriples, options.format);
            } else {
              console.log("No triples generated.");
            }

            if (options.stats) {
              console.log(`\n📊 Execution Statistics:`);
              console.log(`  Vault loading: ${loadDuration}ms${cacheHit ? " (from cache)" : ""}`);
              console.log(`  Query execution: ${execDuration}ms`);
              console.log(`  Total time: ${totalDuration}ms`);
              console.log(`  Triples scanned: ${triples.length}`);
              console.log(`  Triples generated: ${resultTriples.length}`);
              if (options.useCache) {
                console.log(`  Triple cache: ${cacheHit ? "HIT" : "MISS (rebuilt)"}`);
              }
              if (useQueryResultCache) {
                console.log(`  Query result cache: MISS (cached for next run)`);
              }
            }
          }
        } else {
          // SELECT query - returns solution mappings
          progressIndicator?.start();
          const results = await executeWithTimeout(
            executor.executeAll(algebra),
            timeoutMs,
            execStartTime,
          );
          const execDuration = Date.now() - execStartTime;
          progressIndicator?.stop();
          const totalDuration = Date.now() - startTime;

          // Cache the SELECT result for future queries
          const bindings = results.map((r) => r.toJSON());
          if (useQueryResultCache) {
            const cacheableResult = {
              type: "select",
              count: results.length,
              bindings,
            };
            const queryResultCache = new QueryResultCache();
            await queryResultCache.set(queryString, cacheableResult, cacheTtlSeconds);
          }

          if (outputFormat === "json") {
            // Structured JSON response for MCP tools
            const queryResult: QueryResult = {
              query: queryString,
              count: results.length,
              bindings,
            };
            const response = ResponseBuilder.success(queryResult, {
              durationMs: totalDuration,
              itemCount: results.length,
              loadDurationMs: loadDuration,
              execDurationMs: execDuration,
              triplesScanned: triples.length,
              cacheHit,
              queryResultCacheHit: false,
            });
            console.log(JSON.stringify(response, null, 2));
          } else {
            // Text mode output
            console.log(`✅ Found ${results.length} result(s) in ${execDuration}ms\n`);

            if (results.length > 0) {
              formatSelectResults(results, options.format);
            } else {
              console.log("No results found.");
            }

            if (options.stats) {
              console.log(`\n📊 Execution Statistics:`);
              console.log(`  Vault loading: ${loadDuration}ms${cacheHit ? " (from cache)" : ""}`);
              console.log(`  Query execution: ${execDuration}ms`);
              console.log(`  Total time: ${totalDuration}ms`);
              console.log(`  Triples scanned: ${triples.length}`);
              console.log(`  Results returned: ${results.length}`);
              if (options.useCache) {
                console.log(`  Triple cache: ${cacheHit ? "HIT" : "MISS (rebuilt)"}`);
              }
              if (useQueryResultCache) {
                console.log(`  Query result cache: MISS (cached for next run)`);
              }
            }
          }
        }
      } catch (error) {
        // Enhance SPARQL-specific errors with better messages and suggestions
        const enhancer = new SPARQLErrorEnhancer();
        const errorType = enhancer.classifyError(error as Error);

        // Only enhance SPARQL-related errors (syntax, prefix, timeout)
        if (errorType !== "unknown") {
          const enhanced = enhancer.enhanceError(error as Error, queryString);

          if (outputFormat === "json") {
            const response = ResponseBuilder.error(
              ErrorCode.VALIDATION_INVALID_FORMAT,
              enhanced.message,
              ExitCodes.INVALID_ARGUMENTS,
              {
                context: {
                  errorType: enhanced.type,
                  suggestions: enhanced.suggestions,
                  line: enhanced.line,
                  column: enhanced.column,
                  queryContext: enhanced.context ? {
                    startLine: enhanced.context.startLine,
                    endLine: enhanced.context.endLine,
                    errorLine: enhanced.context.errorLine,
                  } : undefined,
                },
                recovery: {
                  message: enhanced.suggestions?.[0] || "Check query syntax",
                },
              }
            );
            console.log(JSON.stringify(response, null, 2));
            process.exit(ExitCodes.INVALID_ARGUMENTS);
          } else {
            // Text mode - show enhanced error with formatting
            console.error(enhancer.formatForText(enhanced));
            process.exit(ExitCodes.INVALID_ARGUMENTS);
          }
        }

        // Fall back to default error handling for non-SPARQL errors
        ErrorHandler.handle(error as Error);
      }
    });
}

function loadQuery(queryArg: string): string {
  if (queryArg.includes("SELECT") || queryArg.includes("CONSTRUCT")) {
    return queryArg;
  }

  const filePath = resolve(queryArg);
  if (existsSync(filePath)) {
    return readFileSync(filePath, "utf-8");
  }

  return queryArg;
}

/**
 * Execute dry-run mode: validate query syntax without loading vault or executing.
 * This is useful for checking query syntax before running expensive operations.
 *
 * When --explain is also set, provides comprehensive query analysis including:
 * - Prefixes used
 * - Variables selected
 * - Triple pattern count
 * - Complexity estimation
 * - Query plan (algebra)
 */
async function executeDryRun(
  queryString: string,
  options: SparqlQueryOptions,
  outputFormat: OutputFormat
): Promise<void> {
  // Use QueryAnalyzer for comprehensive analysis when --explain is set
  if (options.explain) {
    const analyzer = new QueryAnalyzer();
    const result = await analyzer.analyze(queryString, {
      includeAlgebraPlan: true,
      optimize: !options.noOptimize,
    });

    if (outputFormat === "json") {
      // JSON response for MCP tools with full analysis
      const response = ResponseBuilder.success(result);
      console.log(JSON.stringify(response, null, 2));
    } else {
      // Text mode output with formatted analysis
      if (result.valid) {
        console.log(`✅ Query syntax is valid\n`);
        console.log(analyzer.formatAnalysis(result, "text"));
      } else {
        console.log(analyzer.formatAnalysis(result, "text"));
        process.exit(ExitCodes.INVALID_ARGUMENTS);
      }
    }
    return;
  }

  // Simple validation without full analysis
  const parser = new SPARQLParser();

  try {
    // Parse query to validate syntax
    const ast = parser.parse(queryString);

    // Translate to algebra (validates query structure)
    const translator = new AlgebraTranslator();
    let algebra = translator.translate(ast);

    // Optimize if requested (validates optimization rules)
    if (!options.noOptimize && algebra.type !== "construct") {
      const optimizer = new AlgebraOptimizer();
      algebra = optimizer.optimize(algebra);
    } else if (!options.noOptimize && algebra.type === "construct") {
      const optimizer = new AlgebraOptimizer();
      const constructOp = algebra as ConstructOperation;
      algebra = {
        ...constructOp,
        where: optimizer.optimize(constructOp.where),
      };
    }

    if (outputFormat === "json") {
      // JSON response for MCP tools
      const response = ResponseBuilder.success({
        valid: true,
        queryType: getQueryType(ast),
        message: "Query syntax is valid",
      });
      console.log(JSON.stringify(response, null, 2));
    } else {
      // Text mode output
      console.log(`✅ Query syntax is valid`);
      console.log(`   Query type: ${getQueryType(ast)}`);
    }
  } catch (error) {
    // Handle parse errors with enhanced information
    const enhancer = new SPARQLErrorEnhancer();
    const enhanced = enhancer.enhanceError(error as Error, queryString);

    if (outputFormat === "json") {
      const response = ResponseBuilder.error(
        ErrorCode.VALIDATION_INVALID_FORMAT,
        enhanced.message,
        ExitCodes.INVALID_ARGUMENTS,
        {
          context: {
            valid: false,
            errorType: enhanced.type,
            suggestions: enhanced.suggestions,
            line: enhanced.line,
            column: enhanced.column,
            queryContext: enhanced.context ? {
              startLine: enhanced.context.startLine,
              endLine: enhanced.context.endLine,
              errorLine: enhanced.context.errorLine,
            } : undefined,
          },
          recovery: {
            message: enhanced.suggestions?.[0] || "Check query syntax",
          },
        }
      );
      console.log(JSON.stringify(response, null, 2));
    } else {
      console.error(enhancer.formatForText(enhanced));
    }
    process.exit(ExitCodes.INVALID_ARGUMENTS);
  }
}

/**
 * Get the query type from a parsed AST.
 */
function getQueryType(ast: any): string {
  if (ast.type === "update") {
    return "UPDATE";
  }
  if ("queryType" in ast) {
    return ast.queryType as string;
  }
  return "UNKNOWN";
}

function formatSelectResults(results: SolutionMapping[], format: string): void {
  switch (format) {
    case "json":
      const jsonFormatter = new JsonFormatter();
      console.log(jsonFormatter.format(results));
      break;

    case "csv":
      const csvFormatter = new CsvFormatter();
      console.log(csvFormatter.format(results));
      break;

    case "table":
    default:
      const tableFormatter = new TableFormatter();
      console.log(tableFormatter.format(results));
      break;
  }
}

function formatConstructResults(triples: Triple[], format: string): void {
  const formatter = new TriplesFormatter();

  switch (format) {
    case "json":
      console.log(formatter.formatJson(triples));
      break;

    case "ntriples":
      console.log(formatter.formatNTriples(triples));
      break;

    case "table":
    default:
      console.log(formatter.formatTable(triples));
      break;
  }
}

/**
 * Format cached SELECT results for text output.
 * Bindings are already serialized JSON from the cache.
 */
function formatCachedSelectResults(bindings: unknown[], format: string): void {
  switch (format) {
    case "json":
      console.log(JSON.stringify(bindings, null, 2));
      break;

    case "csv":
      // Convert bindings to CSV format
      if (bindings.length === 0) {
        console.log("");
        return;
      }
      const headers = Object.keys(bindings[0] as Record<string, unknown>);
      console.log(headers.join(","));
      for (const row of bindings) {
        const values = headers.map(h => {
          const val = (row as Record<string, unknown>)[h];
          if (val === null || val === undefined) return "";
          return String(val).includes(",") ? `"${val}"` : String(val);
        });
        console.log(values.join(","));
      }
      break;

    case "table":
    default:
      // Simple table format for cached results
      if (bindings.length === 0) {
        console.log("No results.");
        return;
      }
      const cols = Object.keys(bindings[0] as Record<string, unknown>);
      console.log(cols.join("\t"));
      console.log(cols.map(() => "---").join("\t"));
      for (const row of bindings) {
        const values = cols.map(c => String((row as Record<string, unknown>)[c] ?? ""));
        console.log(values.join("\t"));
      }
      break;
  }
}

/**
 * Format cached CONSTRUCT results for text output.
 * Triples are already serialized JSON from the cache.
 */
function formatCachedConstructResults(triples: unknown[], format: string): void {
  switch (format) {
    case "json":
      console.log(JSON.stringify(triples, null, 2));
      break;

    case "ntriples":
      // Convert to N-Triples format
      for (const triple of triples as Array<{ subject: string; predicate: string; object: string }>) {
        console.log(`<${triple.subject}> <${triple.predicate}> ${formatNTriplesObject(triple.object)} .`);
      }
      break;

    case "table":
    default:
      // Simple table format
      console.log("Subject\tPredicate\tObject");
      console.log("---\t---\t---");
      for (const triple of triples as Array<{ subject: string; predicate: string; object: string }>) {
        console.log(`${triple.subject}\t${triple.predicate}\t${triple.object}`);
      }
      break;
  }
}

/**
 * Format an object value for N-Triples output.
 * Uses NTriplesFormatter utility for proper string escaping.
 * Fixes code scanning alert js/incomplete-sanitization (Issue #2226).
 */
function formatNTriplesObject(obj: string): string {
  return NTriplesFormatter.formatObject(obj);
}
