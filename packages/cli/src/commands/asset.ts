import { Command } from "commander";
import { resolve } from "path";
import { existsSync } from "fs";
import {
  InMemoryTripleStore,
  SPARQLParser,
  AlgebraTranslator,
  AlgebraOptimizer,
  QueryExecutor,
  NoteToRDFConverter,
  type SolutionMapping,
} from "exocortex";
import { FileSystemVaultAdapter } from "../adapters/FileSystemVaultAdapter.js";
import { TableFormatter } from "../formatters/TableFormatter.js";
import { ErrorHandler, type OutputFormat } from "../utils/ErrorHandler.js";
import { VaultNotFoundError, FileNotFoundError } from "../utils/errors/index.js";
import { ResponseBuilder } from "../responses/index.js";

/**
 * Options for asset relation commands
 */
export interface AssetRelationsOptions {
  file: string;
  vault: string;
  format: "table" | "json";
  output?: OutputFormat;
  predicate?: string;
}

/**
 * Relation result for a single inbound or outbound link
 */
export interface RelationResult {
  source?: string;
  sourceUri?: string;
  target?: string;
  targetUri?: string;
  predicate: string;
  predicateLabel?: string;
}

/**
 * Complete asset relations response
 */
export interface AssetRelationsResult {
  file: string;
  assetUri: string;
  inbound: RelationResult[];
  outbound: RelationResult[];
}

// SPARQL query prefixes
const SPARQL_PREFIXES = `
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX dcterms: <http://purl.org/dc/terms/>
`;

/**
 * SPARQL query to get inbound relations (backlinks) - assets that reference this asset
 */
const INBOUND_RELATIONS_QUERY = `
${SPARQL_PREFIXES}
SELECT ?source ?sourceLabel ?predicate ?predicateLabel WHERE {
  ?source ?predicate <ASSET_URI> .
  ?source exo:Asset_label ?sourceLabel .
  OPTIONAL { ?predicate rdfs:label ?predicateLabel }
  FILTER(STRSTARTS(STR(?predicate), "https://exocortex.my/ontology/"))
}
ORDER BY ?sourceLabel
`;

/**
 * SPARQL query to get outbound relations (references) - assets this asset references
 */
const OUTBOUND_RELATIONS_QUERY = `
${SPARQL_PREFIXES}
SELECT ?target ?targetLabel ?predicate ?predicateLabel WHERE {
  <ASSET_URI> ?predicate ?target .
  ?target exo:Asset_label ?targetLabel .
  OPTIONAL { ?predicate rdfs:label ?predicateLabel }
  FILTER(STRSTARTS(STR(?predicate), "https://exocortex.my/ontology/"))
}
ORDER BY ?targetLabel
`;

/**
 * Initialize triple store with vault data
 */
async function initializeTripleStore(
  vaultPath: string,
  outputFormat: OutputFormat
): Promise<{ tripleStore: InMemoryTripleStore; triplesCount: number }> {
  const vaultAdapter = new FileSystemVaultAdapter(vaultPath);
  const converter = new NoteToRDFConverter(vaultAdapter);

  if (outputFormat === "text") {
    console.log(`📦 Loading vault: ${vaultPath}...`);
  }

  const triples = await converter.convertVault();
  const tripleStore = new InMemoryTripleStore();
  await tripleStore.addAll(triples);

  if (outputFormat === "text") {
    console.log(`✅ Loaded ${triples.length} triples\n`);
  }

  return { tripleStore, triplesCount: triples.length };
}

/**
 * Execute a SPARQL query and return results
 */
async function executeQuery(
  tripleStore: InMemoryTripleStore,
  queryString: string
): Promise<SolutionMapping[]> {
  const parser = new SPARQLParser();
  const ast = parser.parse(queryString);

  const translator = new AlgebraTranslator();
  let algebra = translator.translate(ast);

  const optimizer = new AlgebraOptimizer();
  algebra = optimizer.optimize(algebra);

  const executor = new QueryExecutor(tripleStore);
  return await executor.executeAll(algebra);
}

/**
 * Convert SolutionMapping results to relation objects
 */
function mapToRelations(
  results: SolutionMapping[],
  direction: "inbound" | "outbound"
): RelationResult[] {
  return results.map(r => {
    const bindings = r.toJSON() as Record<string, string | undefined>;

    if (direction === "inbound") {
      return {
        source: bindings.sourceLabel,
        sourceUri: bindings.source,
        predicate: bindings.predicate || "",
        predicateLabel: bindings.predicateLabel,
      };
    } else {
      return {
        target: bindings.targetLabel,
        targetUri: bindings.target,
        predicate: bindings.predicate || "",
        predicateLabel: bindings.predicateLabel,
      };
    }
  });
}

/**
 * Get asset URI from file path
 */
function getAssetUri(vaultPath: string, filePath: string): string {
  // Normalize the file path
  const normalizedPath = filePath.startsWith("/")
    ? filePath
    : resolve(vaultPath, filePath);

  // Use file:// URI scheme for local files
  return `file://${normalizedPath}`;
}

/**
 * Format output as table
 */
function formatAsTable(
  result: AssetRelationsResult,
  showInbound: boolean,
  showOutbound: boolean
): void {
  if (showInbound && result.inbound.length > 0) {
    console.log("📥 Inbound Relations (Backlinks):\n");
    const tableData = result.inbound.map(r => ({
      Source: r.source || "Unknown",
      Predicate: r.predicateLabel || r.predicate,
    }));
    const formatter = new TableFormatter();
    const mappings = tableData.map(row => {
      const m = new Map<string, unknown>();
      m.set("Source", row.Source);
      m.set("Predicate", row.Predicate);
      return m as unknown as SolutionMapping;
    });
    console.log(formatter.format(mappings));
  } else if (showInbound) {
    console.log("📥 No inbound relations found.\n");
  }

  if (showOutbound && result.outbound.length > 0) {
    console.log("📤 Outbound Relations (References):\n");
    const tableData = result.outbound.map(r => ({
      Target: r.target || "Unknown",
      Predicate: r.predicateLabel || r.predicate,
    }));
    const formatter = new TableFormatter();
    const mappings = tableData.map(row => {
      const m = new Map<string, unknown>();
      m.set("Target", row.Target);
      m.set("Predicate", row.Predicate);
      return m as unknown as SolutionMapping;
    });
    console.log(formatter.format(mappings));
  } else if (showOutbound) {
    console.log("📤 No outbound relations found.\n");
  }
}

/**
 * Format output as JSON
 */
function formatAsJson(
  result: AssetRelationsResult,
  showInbound: boolean,
  showOutbound: boolean,
  outputFormat: OutputFormat
): void {
  const output: Partial<AssetRelationsResult> = {
    file: result.file,
    assetUri: result.assetUri,
  };

  if (showInbound) {
    output.inbound = result.inbound;
  }
  if (showOutbound) {
    output.outbound = result.outbound;
  }

  if (outputFormat === "json") {
    // Structured response for MCP tools
    const response = ResponseBuilder.success(output, {
      itemCount: (output.inbound?.length || 0) + (output.outbound?.length || 0),
    });
    console.log(JSON.stringify(response, null, 2));
  } else {
    console.log(JSON.stringify(output, null, 2));
  }
}

/**
 * Core logic for executing asset relation queries
 */
async function executeAssetRelations(
  options: AssetRelationsOptions,
  showInbound: boolean,
  showOutbound: boolean,
  predicateFilter?: string
): Promise<void> {
  const outputFormat = (options.output || "text") as OutputFormat;
  ErrorHandler.setFormat(outputFormat);

  try {
    const vaultPath = resolve(options.vault);
    if (!existsSync(vaultPath)) {
      throw new VaultNotFoundError(vaultPath);
    }

    const filePath = resolve(vaultPath, options.file);
    if (!existsSync(filePath)) {
      throw new FileNotFoundError(filePath);
    }

    const { tripleStore } = await initializeTripleStore(vaultPath, outputFormat);

    // Construct asset URI
    const assetUri = getAssetUri(vaultPath, options.file);

    if (outputFormat === "text") {
      console.log(`🔍 Querying relations for: ${options.file}`);
      console.log(`   Asset URI: ${assetUri}\n`);
    }

    const result: AssetRelationsResult = {
      file: options.file,
      assetUri,
      inbound: [],
      outbound: [],
    };

    // Query inbound relations
    if (showInbound) {
      let inboundQuery = INBOUND_RELATIONS_QUERY.replace(/ASSET_URI/g, assetUri);
      if (predicateFilter) {
        // Add predicate filter
        inboundQuery = inboundQuery.replace(
          "FILTER(STRSTARTS",
          `FILTER(?predicate = <${predicateFilter}>) FILTER(STRSTARTS`
        );
      }
      const inboundResults = await executeQuery(tripleStore, inboundQuery);
      result.inbound = mapToRelations(inboundResults, "inbound");
    }

    // Query outbound relations
    if (showOutbound) {
      let outboundQuery = OUTBOUND_RELATIONS_QUERY.replace(/ASSET_URI/g, assetUri);
      if (predicateFilter) {
        // Add predicate filter
        outboundQuery = outboundQuery.replace(
          "FILTER(STRSTARTS",
          `FILTER(?predicate = <${predicateFilter}>) FILTER(STRSTARTS`
        );
      }
      const outboundResults = await executeQuery(tripleStore, outboundQuery);
      result.outbound = mapToRelations(outboundResults, "outbound");
    }

    // Output results
    if (options.format === "json" || outputFormat === "json") {
      formatAsJson(result, showInbound, showOutbound, outputFormat);
    } else {
      formatAsTable(result, showInbound, showOutbound);
    }

  } catch (error) {
    ErrorHandler.handle(error as Error);
  }
}

/**
 * Creates the 'asset' command group for asset relation queries
 *
 * @returns Commander Command instance configured for asset operations
 *
 * @example
 * exocortex asset relations --file "03 Knowledge/concepts/my-concept.md"
 * exocortex asset backlinks --file "03 Knowledge/tasks/task.md" --format json
 * exocortex asset references --file "03 Knowledge/concepts/concept.md" --predicate "exo:Asset_relates"
 */
export function assetCommand(): Command {
  const cmd = new Command("asset")
    .description("Asset relation queries (backlinks, references)");

  // Subcommand: relations (both inbound and outbound)
  cmd.addCommand(
    new Command("relations")
      .description("Get all relations (inbound and outbound) for an asset")
      .requiredOption("--file <path>", "Path to asset file (relative to vault root)")
      .option("--vault <path>", "Path to Obsidian vault", process.cwd())
      .option("--format <type>", "Output format: table|json", "table")
      .option("--output <type>", "Response format: text|json (for MCP tools)", "text")
      .action(async (options: AssetRelationsOptions) => {
        await executeAssetRelations(options, true, true);
      })
  );

  // Subcommand: backlinks (inbound only)
  cmd.addCommand(
    new Command("backlinks")
      .description("Get inbound relations (backlinks) for an asset")
      .requiredOption("--file <path>", "Path to asset file (relative to vault root)")
      .option("--vault <path>", "Path to Obsidian vault", process.cwd())
      .option("--format <type>", "Output format: table|json", "table")
      .option("--output <type>", "Response format: text|json (for MCP tools)", "text")
      .action(async (options: AssetRelationsOptions) => {
        await executeAssetRelations(options, true, false);
      })
  );

  // Subcommand: references (outbound only, with predicate filter)
  cmd.addCommand(
    new Command("references")
      .description("Get outbound relations (references) for an asset")
      .requiredOption("--file <path>", "Path to asset file (relative to vault root)")
      .option("--vault <path>", "Path to Obsidian vault", process.cwd())
      .option("--format <type>", "Output format: table|json", "table")
      .option("--output <type>", "Response format: text|json (for MCP tools)", "text")
      .option("--predicate <uri>", "Filter by predicate URI (e.g., exo:Asset_relates)")
      .action(async (options: AssetRelationsOptions) => {
        // Expand prefix if needed
        let predicateFilter = options.predicate;
        if (predicateFilter) {
          predicateFilter = expandPrefixedUri(predicateFilter);
        }
        await executeAssetRelations(options, false, true, predicateFilter);
      })
  );

  return cmd;
}

/**
 * Expand prefixed URI to full URI
 * @public - Exported for testing
 */
export function expandPrefixedUri(prefixedUri: string): string {
  const prefixes: Record<string, string> = {
    "exo:": "https://exocortex.my/ontology/exo#",
    "dcterms:": "http://purl.org/dc/terms/",
    "rdf:": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "rdfs:": "http://www.w3.org/2000/01/rdf-schema#",
  };

  for (const [prefix, fullUri] of Object.entries(prefixes)) {
    if (prefixedUri.startsWith(prefix)) {
      return prefixedUri.replace(prefix, fullUri);
    }
  }

  return prefixedUri;
}
