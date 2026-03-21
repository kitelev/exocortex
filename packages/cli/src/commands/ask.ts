import { Command } from "commander";
import { existsSync } from "fs";
import { resolve } from "path";
import {
  InMemoryTripleStore,
  NoteToRDFConverter,
  NLToSPARQLService,
  SPARQLParser,
  AlgebraTranslator,
  AlgebraOptimizer,
  QueryExecutor,
} from "exocortex";
import { FileSystemVaultAdapter } from "../adapters/FileSystemVaultAdapter.js";
import { injectExocortexPrefixes, transformShorthandNotation, filterOntologyPrefixes } from "../utils/QueryPrefixInjector.js";
import { scanVaultNamespaces } from "../utils/VaultNamespaceScanner.js";
import { TableFormatter } from "../formatters/TableFormatter.js";
import { JsonFormatter } from "../formatters/JsonFormatter.js";
import { ErrorHandler, type OutputFormat } from "../utils/ErrorHandler.js";
import { VaultNotFoundError } from "../utils/errors/index.js";
import { ResponseBuilder } from "../responses/index.js";

export interface AskOptions {
  vault: string;
  format: "table" | "json";
  output?: OutputFormat;
  showQuery?: boolean;
  explain?: boolean;
}

/**
 * Result structure for natural language query
 */
interface AskResult {
  /** Original question */
  question: string;
  /** Generated SPARQL query */
  query: string;
  /** Template used */
  template: string | null;
  /** Parameters extracted */
  parameters: Record<string, string>;
  /** Conversion confidence */
  confidence: number;
  /** Explanation */
  explanation: string;
  /** Result count */
  count: number;
  /** Query results */
  bindings: unknown[];
  /** Suggestions for better queries */
  suggestions?: string[];
}

/**
 * Creates the 'ask' command for natural language queries
 *
 * This command converts natural language questions (in Russian or English)
 * to SPARQL queries and executes them against the vault.
 *
 * @example
 * exocortex ask "сколько в среднем занимает утренний душ?"
 * exocortex ask "активные проекты"
 * exocortex ask "последние 10 активностей"
 * exocortex ask "статистика сна за декабрь"
 */
export function askCommand(): Command {
  return new Command("ask")
    .description("Ask a question in natural language about your vault")
    .argument("<question>", "Question in natural language (Russian or English)")
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option("--format <type>", "Output format: table|json", "table")
    .option("--output <type>", "Response format: text|json (for MCP tools)", "text")
    .option("--show-query", "Show the generated SPARQL query")
    .option("--explain", "Show explanation of the query conversion")
    .action(async (question: string, options: AskOptions) => {
      const outputFormat = (options.output || "text") as OutputFormat;
      ErrorHandler.setFormat(outputFormat);

      try {
        const startTime = Date.now();

        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath)) {
          throw new VaultNotFoundError(vaultPath);
        }

        // Initialize NL to SPARQL service
        const nlService = new NLToSPARQLService();

        // Convert natural language to SPARQL
        if (outputFormat === "text") {
          console.log(`🧠 Analyzing question: "${question}"\n`);
        }

        const conversionResult = nlService.convert(question);

        // Show generated query if requested
        if (options.showQuery && outputFormat === "text") {
          console.log("📝 Generated SPARQL Query:");
          console.log("─".repeat(50));
          console.log(conversionResult.query);
          console.log("─".repeat(50));
          console.log();
        }

        // Show explanation if requested
        if (options.explain && outputFormat === "text") {
          console.log(`📖 Explanation: ${conversionResult.explanation}`);
          console.log(`🎯 Confidence: ${(conversionResult.confidence * 100).toFixed(0)}%`);
          if (conversionResult.templateName) {
            console.log(`📋 Template: ${conversionResult.templateName}`);
          }
          if (conversionResult.isFallback) {
            console.log("⚠️  Using fallback generic search query");
          }
          console.log();
        }

        // Load vault and execute query
        if (outputFormat === "text") {
          console.log(`📦 Loading vault: ${vaultPath}...`);
        }
        const loadStartTime = Date.now();

        const vaultAdapter = new FileSystemVaultAdapter(vaultPath);
        const converter = new NoteToRDFConverter(vaultAdapter);
        const triples = await converter.convertVault();

        const tripleStore = new InMemoryTripleStore();
        await tripleStore.addAll(triples);

        const loadDuration = Date.now() - loadStartTime;
        if (outputFormat === "text") {
          console.log(`✅ Loaded ${triples.length} triples in ${loadDuration}ms\n`);
        }

        // Parse and execute SPARQL
        let sparqlQuery = conversionResult.query;
        sparqlQuery = transformShorthandNotation(sparqlQuery);
        sparqlQuery = injectExocortexPrefixes(sparqlQuery);

        const parser = new SPARQLParser();
        const vaultPrefixes = filterOntologyPrefixes(scanVaultNamespaces(vaultPath));
        if (vaultPrefixes.size > 0) {
          parser.setVaultPrefixes(vaultPrefixes);
        }
        const ast = parser.parse(sparqlQuery);

        const translator = new AlgebraTranslator();
        let algebra = translator.translate(ast);

        const optimizer = new AlgebraOptimizer();
        algebra = optimizer.optimize(algebra);

        const execStartTime = Date.now();
        const executor = new QueryExecutor(tripleStore);
        const results = await executor.executeAll(algebra);
        const execDuration = Date.now() - execStartTime;
        const totalDuration = Date.now() - startTime;

        // Get suggestions for improving the query
        const suggestions = nlService.getSuggestions(question);

        if (outputFormat === "json") {
          // Structured JSON response for MCP tools
          const bindings = results.map((r) => r.toJSON());
          const askResult: AskResult = {
            question,
            query: conversionResult.query,
            template: conversionResult.templateName,
            parameters: conversionResult.parameters,
            confidence: conversionResult.confidence,
            explanation: conversionResult.explanation,
            count: results.length,
            bindings,
            suggestions: suggestions.length > 0 ? suggestions : undefined,
          };
          const response = ResponseBuilder.success(askResult, {
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
            formatResults(results, options.format);
          } else {
            console.log("No results found.");
          }

          // Show suggestions
          if (suggestions.length > 0) {
            console.log("\n💡 Suggestions:");
            for (const suggestion of suggestions) {
              console.log(`   • ${suggestion}`);
            }
          }

          // Show alternatives if confidence is low
          if (conversionResult.confidence < 0.6 && conversionResult.alternatives.length > 0) {
            console.log("\n🔄 Alternative queries that might work better:");
            for (let i = 0; i < Math.min(2, conversionResult.alternatives.length); i++) {
              console.log(`   ${i + 1}. ${conversionResult.alternatives[i].split("\n").slice(-3)[0]?.trim() || "..."}`);
            }
          }
        }
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });
}

/**
 * Format query results
 */
function formatResults(
  results: Array<{ toJSON(): Record<string, unknown> }>,
  format: string
): void {
  // Use type assertion since we know the results have the methods we need
  const formattableResults = results as unknown as Array<{
    getVariables(): string[];
    toJSON(): Record<string, unknown>;
  }>;

  switch (format) {
    case "json":
      const jsonFormatter = new JsonFormatter();
      console.log(jsonFormatter.format(formattableResults));
      break;

    case "table":
    default:
      const tableFormatter = new TableFormatter();
      console.log(tableFormatter.format(formattableResults));
      break;
  }
}
