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
import { ProgressIndicator } from "../utils/ProgressIndicator.js";
import { QueryAnalyzer } from "../utils/QueryAnalyzer.js";

export interface SparqlQueryOptions {
  vault: string;
  format: "table" | "json" | "csv" | "ntriples";
  output?: OutputFormat;
  explain?: boolean;
  dryRun?: boolean;
  stats?: boolean;
  noOptimize?: boolean;
  useCache?: boolean;
  timeout?: string;
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
    .argument("<query>", "SPARQL query string or path to .sparql file")
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option("--format <type>", "Output format: table|json|csv|ntriples", "table")
    .option("--output <type>", "Response format: text|json (for MCP tools)", "text")
    .option("--timeout <duration>", "Query timeout (e.g., 30s, 5000ms)", "30s")
    .option("--dry-run", "Validate query syntax without executing (no vault loading)")
    .option("--explain", "Show optimized query plan")
    .option("--stats", "Show execution statistics")
    .option("--no-optimize", "Disable query optimization")
    .option("--use-cache", "Use persistent cache (faster for repeated queries)")
    .action(async (queryArg: string, options: SparqlQueryOptions) => {
      const outputFormat = (options.output || "text") as OutputFormat;
      ErrorHandler.setFormat(outputFormat);

      try {
        const startTime = Date.now();

        // Parse timeout
        const timeoutMs = parseTimeout(options.timeout || "30s");

        const queryString = loadQuery(queryArg);

        // Dry-run mode: validate syntax only, no vault loading
        if (options.dryRun) {
          await executeDryRun(queryString, options, outputFormat);
          return;
        }

        const vaultPath = resolve(options.vault);
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
                console.log(`  Cache: ${cacheHit ? "HIT" : "MISS (rebuilt)"}`);
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

          if (outputFormat === "json") {
            // Structured JSON response for MCP tools
            const bindings = results.map((r) => r.toJSON());
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
                console.log(`  Cache: ${cacheHit ? "HIT" : "MISS (rebuilt)"}`);
              }
            }
          }
        }
      } catch (error) {
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
    // Handle parse errors with detailed information
    if (error instanceof SPARQLParseError) {
      const locationInfo = error.line !== undefined
        ? ` at line ${error.line}${error.column !== undefined ? `, column ${error.column}` : ""}`
        : "";

      if (outputFormat === "json") {
        const response = ResponseBuilder.error(
          ErrorCode.VALIDATION_INVALID_FORMAT,
          error.message,
          ExitCodes.INVALID_ARGUMENTS,
          {
            context: {
              valid: false,
              line: error.line,
              column: error.column,
            },
          }
        );
        console.log(JSON.stringify(response, null, 2));
      } else {
        console.error(`❌ Syntax error${locationInfo}:`);
        console.error(`   ${error.message}`);
      }
      process.exit(ExitCodes.INVALID_ARGUMENTS);
    }
    throw error;
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
