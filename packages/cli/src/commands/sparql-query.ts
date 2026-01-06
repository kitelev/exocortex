import { Command } from "commander";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import {
  InMemoryTripleStore,
  SPARQLParser,
  AlgebraTranslator,
  AlgebraOptimizer,
  AlgebraSerializer,
  QueryExecutor,
  NoteToRDFConverter,
  Triple,
  type SolutionMapping,
  type AlgebraOperation,
  type ConstructOperation,
} from "exocortex";
import { FileSystemVaultAdapter } from "../adapters/FileSystemVaultAdapter.js";
import { TableFormatter } from "../formatters/TableFormatter.js";
import { JsonFormatter } from "../formatters/JsonFormatter.js";
import { TriplesFormatter } from "../formatters/TriplesFormatter.js";
import { ErrorHandler, type OutputFormat } from "../utils/ErrorHandler.js";
import { VaultNotFoundError } from "../utils/errors/index.js";
import { ResponseBuilder, type QueryResult, type ConstructResult } from "../responses/index.js";

export interface SparqlQueryOptions {
  vault: string;
  folder?: string;
  format: "table" | "json" | "csv" | "ntriples";
  output?: OutputFormat;
  explain?: boolean;
  stats?: boolean;
  noOptimize?: boolean;
}

export function sparqlQueryCommand(): Command {
  return new Command("query")
    .description("Execute SPARQL query against Obsidian vault")
    .argument("<query>", "SPARQL query string or path to .sparql file")
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option("--folder <path>", "Limit indexing to specific folder (relative to vault root)")
    .option("--format <type>", "Output format: table|json|csv|ntriples", "table")
    .option("--output <type>", "Response format: text|json (for MCP tools)", "text")
    .option("--explain", "Show optimized query plan")
    .option("--stats", "Show execution statistics")
    .option("--no-optimize", "Disable query optimization")
    .action(async (queryArg: string, options: SparqlQueryOptions) => {
      const outputFormat = (options.output || "text") as OutputFormat;
      ErrorHandler.setFormat(outputFormat);

      try {
        const startTime = Date.now();

        const queryString = loadQuery(queryArg);

        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath)) {
          throw new VaultNotFoundError(vaultPath);
        }

        // Only show progress in text mode
        if (outputFormat === "text") {
          const folderInfo = options.folder ? ` (folder: ${options.folder})` : "";
          console.log(`📦 Loading vault: ${vaultPath}${folderInfo}...`);
        }
        const loadStartTime = Date.now();

        const vaultAdapter = new FileSystemVaultAdapter(vaultPath, options.folder);
        const converter = new NoteToRDFConverter(vaultAdapter);
        const triples = await converter.convertVault();

        const tripleStore = new InMemoryTripleStore();
        await tripleStore.addAll(triples);

        const loadDuration = Date.now() - loadStartTime;
        if (outputFormat === "text") {
          console.log(`✅ Loaded ${triples.length} triples in ${loadDuration}ms\n`);
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

        if (outputFormat === "text") {
          console.log(`🎯 Executing query...`);
        }
        const execStartTime = Date.now();

        const executor = new QueryExecutor(tripleStore);

        // Execute based on query type
        if (executor.isConstructQuery(algebra)) {
          // CONSTRUCT query - returns triples
          const resultTriples = await executor.executeConstruct(algebra);
          const execDuration = Date.now() - execStartTime;
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
              console.log(`  Vault loading: ${loadDuration}ms`);
              console.log(`  Query execution: ${execDuration}ms`);
              console.log(`  Total time: ${totalDuration}ms`);
              console.log(`  Triples scanned: ${triples.length}`);
              console.log(`  Triples generated: ${resultTriples.length}`);
            }
          }
        } else {
          // SELECT query - returns solution mappings
          const results = await executor.executeAll(algebra);
          const execDuration = Date.now() - execStartTime;
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
              console.log(`  Vault loading: ${loadDuration}ms`);
              console.log(`  Query execution: ${execDuration}ms`);
              console.log(`  Total time: ${totalDuration}ms`);
              console.log(`  Triples scanned: ${triples.length}`);
              console.log(`  Results returned: ${results.length}`);
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

function formatSelectResults(results: SolutionMapping[], format: string): void {
  switch (format) {
    case "json":
      const jsonFormatter = new JsonFormatter();
      console.log(jsonFormatter.format(results));
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
