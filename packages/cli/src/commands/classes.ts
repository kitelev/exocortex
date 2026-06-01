import { Command } from "commander";
import { existsSync } from "fs";
import { resolve } from "path";
import {
  InMemoryTripleStore,
  ExoQLParser,
  ExoQLAlgebraTranslator,
  AlgebraOptimizer,
  ExoQLQueryExecutor,
  NoteToRDFConverter,
  Triple,
  IRI,
} from "exocortex";
import { FileSystemVaultAdapter } from "../adapters/FileSystemVaultAdapter.js";
import { TableFormatter } from "../formatters/TableFormatter.js";
import { ErrorHandler, type OutputFormat } from "../utils/ErrorHandler.js";
import { VaultNotFoundError } from "../utils/errors/index.js";
import { ResponseBuilder } from "../responses/index.js";
import { CacheManager } from "../cache/CacheManager.js";
import { resolveProfileFilter } from "../utils/resolveProfileFilter.js";

export interface ClassesCommandOptions {
  vault: string;
  format: "table" | "json";
  output?: OutputFormat;
  useCache?: boolean;
  /**
   * FocusProfile UID — restricts the RDF graph to the effective AssetSpace
   * set declared by the profile chain (RFC 0a0791c1 Issue #3323).
   */
  profile?: string;
}

interface ClassInfo {
  name: string;
  instanceCount: number;
  properties: PropertyInfo[];
}

interface PropertyInfo {
  name: string;
  usageCount: number;
}

/**
 * Creates the 'classes' command for listing and inspecting RDF classes in the vault.
 */
export function classesCommand(): Command {
  return new Command("classes")
    .alias("describe-class")
    .description(
      "List RDF classes in vault, or describe a class (predicates + counts). " +
      "Alias `describe-class` is provided per #3043 RFC §B (schema introspection).",
    )
    .argument("[class-name]", "Optional class name to show details (e.g., ems__Task)")
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option("--format <type>", "Output format: table|json", "table")
    .option("--output <type>", "Response format: text|json (for MCP tools)", "text")
    .option("--use-cache", "Use persistent cache (faster for repeated queries)")
    .option(
      "--profile <uid>",
      "FocusProfile UID — restrict graph to effective AssetSpace set (RFC 0a0791c1)",
    )
    .action(async (className: string | undefined, options: ClassesCommandOptions) => {
      const outputFormat = (options.output || "text") as OutputFormat;
      ErrorHandler.setFormat(outputFormat);

      try {
        const startTime = Date.now();

        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath)) {
          throw new VaultNotFoundError(vaultPath);
        }

        if (outputFormat === "text") {
          console.log(`📦 Loading vault: ${vaultPath}...`);
        }

        const profileFilter = await resolveProfileFilter({
          profileUid: options.profile,
          primaryVaultPath: vaultPath,
          outputFormat,
        });

        // --profile disables --use-cache (cache is not profile-aware).
        let useCacheEffective = options.useCache ?? false;
        if (useCacheEffective && profileFilter !== null) {
          if (outputFormat === "text") {
            console.log(
              "⚠️  --use-cache disabled because --profile is active (cache is not profile-aware).",
            );
          }
          useCacheEffective = false;
        }

        let triples: Triple[];
        let cacheHit = false;

        if (useCacheEffective) {
          const cacheManager = new CacheManager(vaultPath);
          const cacheResult = await cacheManager.loadOrBuild();
          triples = cacheResult.triples;
          cacheHit = cacheResult.cacheHit;

          if (outputFormat === "text" && cacheHit) {
            console.log(`🚀 Cache hit! Loading from persistent cache...`);
          }
        } else {
          const vaultAdapter = new FileSystemVaultAdapter(vaultPath);
          const converter = new NoteToRDFConverter(vaultAdapter);
          triples = await converter.convertVault(
            profileFilter !== null
              ? {
                  effectiveOntologies: profileFilter.effective,
                  assetSpaceFolderToUid: profileFilter.folderMap,
                }
              : {},
          );
        }

        const tripleStore = new InMemoryTripleStore();
        await tripleStore.addAll(triples);

        const loadDuration = Date.now() - startTime;
        if (outputFormat === "text") {
          const cacheStatus = cacheHit ? " (from cache)" : "";
          console.log(`✅ Loaded ${triples.length} triples in ${loadDuration}ms${cacheStatus}\n`);
        }

        if (className) {
          // Show details for specific class
          await showClassDetails(tripleStore, className, options, outputFormat);
        } else {
          // List all classes
          await listAllClasses(tripleStore, options, outputFormat);
        }
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });
}

async function listAllClasses(
  tripleStore: InMemoryTripleStore,
  options: ClassesCommandOptions,
  outputFormat: OutputFormat
): Promise<void> {
  // SPARQL query to get all classes and their instance counts
  const query = `
    PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
    SELECT ?class (COUNT(?instance) AS ?count)
    WHERE {
      ?instance rdf:type ?class .
    }
    GROUP BY ?class
    ORDER BY DESC(?count)
  `;

  const parser = new ExoQLParser();
  const ast = parser.parse(query);
  const translator = new ExoQLAlgebraTranslator();
  let algebra = translator.translate(ast);
  const optimizer = new AlgebraOptimizer();
  algebra = optimizer.optimize(algebra);

  const executor = new ExoQLQueryExecutor(tripleStore);
  const results = await executor.executeAll(algebra);

  const classes: { name: string; count: number }[] = results.map((result) => {
    const classIri = result.get("class");
    const countValue = result.get("count");
    return {
      name: classIri ? extractLocalName(classIri.toString()) : "unknown",
      count: countValue ? parseInt(countValue.toString(), 10) : 0,
    };
  });

  if (outputFormat === "json" || options.format === "json") {
    const response = ResponseBuilder.success({
      classes,
      totalClasses: classes.length,
    });
    console.log(JSON.stringify(response, null, 2));
  } else {
    console.log(`📊 Found ${classes.length} RDF class(es):\n`);

    if (classes.length === 0) {
      console.log("No classes found in vault.");
      return;
    }

    // Table output
    const maxNameLength = Math.max(...classes.map(c => c.name.length), 10);
    console.log("┌" + "─".repeat(maxNameLength + 2) + "┬" + "─".repeat(12) + "┐");
    console.log("│ " + "Class".padEnd(maxNameLength) + " │ " + "Instances".padEnd(10) + " │");
    console.log("├" + "─".repeat(maxNameLength + 2) + "┼" + "─".repeat(12) + "┤");

    for (const cls of classes) {
      console.log("│ " + cls.name.padEnd(maxNameLength) + " │ " + cls.count.toString().padStart(10) + " │");
    }

    console.log("└" + "─".repeat(maxNameLength + 2) + "┴" + "─".repeat(12) + "┘");
  }
}

async function showClassDetails(
  tripleStore: InMemoryTripleStore,
  className: string,
  options: ClassesCommandOptions,
  outputFormat: OutputFormat
): Promise<void> {
  // First get instance count for this class
  const countQuery = `
    PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
    SELECT (COUNT(?instance) AS ?count)
    WHERE {
      ?instance rdf:type ?class .
      FILTER(CONTAINS(STR(?class), "${className}"))
    }
  `;

  const parser = new ExoQLParser();
  let ast = parser.parse(countQuery);
  let translator = new ExoQLAlgebraTranslator();
  let algebra = translator.translate(ast);
  let optimizer = new AlgebraOptimizer();
  algebra = optimizer.optimize(algebra);

  const executor = new ExoQLQueryExecutor(tripleStore);
  const countResults = await executor.executeAll(algebra);
  const instanceCount = countResults.length > 0
    ? parseInt(countResults[0].get("count")?.toString() || "0", 10)
    : 0;

  // Get properties used by instances of this class
  const propsQuery = `
    PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
    SELECT ?property (COUNT(?value) AS ?usageCount)
    WHERE {
      ?instance rdf:type ?class .
      ?instance ?property ?value .
      FILTER(CONTAINS(STR(?class), "${className}"))
      FILTER(?property != rdf:type)
    }
    GROUP BY ?property
    ORDER BY DESC(?usageCount)
  `;

  ast = parser.parse(propsQuery);
  translator = new ExoQLAlgebraTranslator();
  algebra = translator.translate(ast);
  optimizer = new AlgebraOptimizer();
  algebra = optimizer.optimize(algebra);

  const propsResults = await executor.executeAll(algebra);

  const properties: PropertyInfo[] = propsResults.map((result) => {
    const propIri = result.get("property");
    const usageValue = result.get("usageCount");
    return {
      name: propIri ? extractLocalName(propIri.toString()) : "unknown",
      usageCount: usageValue ? parseInt(usageValue.toString(), 10) : 0,
    };
  });

  const classInfo: ClassInfo = {
    name: className,
    instanceCount,
    properties,
  };

  if (outputFormat === "json" || options.format === "json") {
    const response = ResponseBuilder.success(classInfo);
    console.log(JSON.stringify(response, null, 2));
  } else {
    console.log(`📋 Class: ${className}\n`);
    console.log(`   Instances: ${instanceCount}`);
    console.log(`   Properties: ${properties.length}\n`);

    if (properties.length === 0) {
      console.log("   No properties found.");
      return;
    }

    const maxPropLength = Math.max(...properties.map(p => p.name.length), 10);
    console.log("   ┌" + "─".repeat(maxPropLength + 2) + "┬" + "─".repeat(10) + "┐");
    console.log("   │ " + "Property".padEnd(maxPropLength) + " │ " + "Usage".padEnd(8) + " │");
    console.log("   ├" + "─".repeat(maxPropLength + 2) + "┼" + "─".repeat(10) + "┤");

    for (const prop of properties) {
      console.log("   │ " + prop.name.padEnd(maxPropLength) + " │ " + prop.usageCount.toString().padStart(8) + " │");
    }

    console.log("   └" + "─".repeat(maxPropLength + 2) + "┴" + "─".repeat(10) + "┘");
  }
}

/**
 * Extract the local name from an IRI (the part after # or the last /).
 */
function extractLocalName(iri: string): string {
  // Remove angle brackets if present
  const cleanIri = iri.replace(/^<|>$/g, "");

  // Get local name after # or last /
  const hashIndex = cleanIri.lastIndexOf("#");
  if (hashIndex !== -1) {
    return cleanIri.substring(hashIndex + 1);
  }

  const slashIndex = cleanIri.lastIndexOf("/");
  if (slashIndex !== -1) {
    return cleanIri.substring(slashIndex + 1);
  }

  return cleanIri;
}
