import { Command } from "commander";
import { existsSync } from "fs";
import { resolve } from "path";
import {
  InMemoryTripleStore,
  NoteToRDFConverter,
  Triple,
  type NamedQueryRunner,
  type NamedQueryContext,
  type SolutionMapping,
  type ExoQLEvalResult,
} from "@kitelev/exocortex-core";
import { FileSystemVaultAdapter } from "../adapters/FileSystemVaultAdapter.js";
import { ErrorHandler, type OutputFormat } from "../utils/ErrorHandler.js";
import { ExitCodes } from "../utils/ExitCodes.js";
import { ErrorCode } from "../responses/index.js";
import { VaultNotFoundError } from "../utils/errors/index.js";
import { ResponseBuilder } from "../responses/index.js";
import { CacheManager } from "../cache/CacheManager.js";
import { buildNamedQueryRunner } from "../services/NamedQueryCliRunner.js";

/**
 * Canonical `query__NamedQuery` UIDs backing schema introspection (req
 * 2678df55 — homoiconic read axis). The SPARQL bodies live in vault assets
 * (`exoas-public/exoql`); this command resolves them by UID and executes them
 * read-only through `NamedQueryRunner`, then formats the rows with the in-code
 * ASCII-table formatter (`extractLocalName` truncation). Editing an asset's
 * ```sparql body changes what `classes`/`describe-class` prints — no code
 * change. `run-query <uid>` executes any NamedQuery standalone.
 */
const INTROSPECT_CLASSES_QUERY_UID = "b6aa1da9-96b9-4066-99a9-f81cc8b316aa";
const INTROSPECT_CLASS_COUNT_QUERY_UID = "5ba1031d-2c6e-4528-ab81-fb768d8e061a";
const INTROSPECT_CLASS_PROPERTIES_QUERY_UID =
  "efb7bb79-6378-44b0-b1ca-9a27e3eeb684";

export interface ClassesCommandOptions {
  vault: string;
  format: "table" | "json";
  output?: OutputFormat;
  useCache?: boolean;
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
      "Alias `describe-class` is provided per #3043 RFC §B (schema introspection). " +
      "Introspection SPARQL is read from vault query__NamedQuery assets (req 2678df55).",
    )
    .argument("[class-name]", "Optional class name to show details (e.g., ems__Task)")
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option("--format <type>", "Output format: table|json", "table")
    .option("--output <type>", "Response format: text|json (for MCP tools)", "text")
    .option("--use-cache", "Use persistent cache (faster for repeated queries)")
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

        const useCacheEffective = options.useCache ?? false;

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
          triples = await converter.convertVault();
        }

        const tripleStore = new InMemoryTripleStore();
        await tripleStore.addAll(triples);

        const loadDuration = Date.now() - startTime;
        if (outputFormat === "text") {
          const cacheStatus = cacheHit ? " (from cache)" : "";
          console.log(`✅ Loaded ${triples.length} triples in ${loadDuration}ms${cacheStatus}\n`);
        }

        // req 2678df55 — read the introspection SPARQL from vault query__NamedQuery
        // assets instead of hardcoding it in this command. The formatter stays here.
        const runner = buildNamedQueryRunner(tripleStore, vaultPath);

        if (className) {
          // Show details for specific class
          await showClassDetails(runner, className, options, outputFormat);
        } else {
          // List all classes
          await listAllClasses(runner, options, outputFormat);
        }
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });
}

/**
 * Narrow a NamedQuery result to its SELECT rows, or fail loud with a clear
 * message when the introspection query asset is missing / not a SELECT.
 */
function requireSelectRows(
  result: ExoQLEvalResult | null,
  uid: string,
): SolutionMapping[] {
  if (result === null) {
    ErrorHandler.handleWithMessage(
      `Introspection query__NamedQuery asset "${uid}" not found in the vault ` +
        "(no asset with that UID, or it has no ```sparql code-block). The " +
        "`classes` command reads its SPARQL from vault query assets (req 2678df55).",
      ExitCodes.FILE_NOT_FOUND,
      ErrorCode.VALIDATION_FILE_NOT_FOUND,
    );
  }
  if (result.kind !== "select") {
    ErrorHandler.handleWithMessage(
      `Introspection query "${uid}" is an ${result.kind} query; expected SELECT.`,
      ExitCodes.INVALID_ARGUMENTS,
      ErrorCode.VALIDATION_INVALID_ARGUMENTS,
    );
  }
  return result.rows;
}

/**
 * Extract a numeric count from a COUNT-aggregate binding (#3859). The bound term
 * is a typed `Literal` whose `.toString()` serialises as `"3093"^^<xsd:integer>`
 * (parseInt-hostile — the leading quote yields NaN); `.value` is the lexical
 * form `3093`. Falls back to 0 for a missing / non-numeric term.
 */
export function parseCount(term: unknown): number {
  const v = (term as { value?: unknown } | null | undefined)?.value;
  const n = typeof v === "string" ? parseInt(v, 10) : NaN;
  return Number.isNaN(n) ? 0 : n;
}

async function listAllClasses(
  runner: NamedQueryRunner,
  options: ClassesCommandOptions,
  outputFormat: OutputFormat
): Promise<void> {
  const result = await runner.run(INTROSPECT_CLASSES_QUERY_UID);
  const rows = requireSelectRows(result, INTROSPECT_CLASSES_QUERY_UID);

  const classes: { name: string; count: number }[] = rows.map((row) => {
    const classIri = row.get("class");
    const countValue = row.get("count");
    return {
      name: classIri ? extractLocalName(classIri.toString()) : "unknown",
      count: parseCount(countValue),
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
  runner: NamedQueryRunner,
  className: string,
  options: ClassesCommandOptions,
  outputFormat: OutputFormat
): Promise<void> {
  // $className bound as a literal param, substituted by NamedQueryRunner before
  // parse (engine-controlled substitution, read-only). Both introspection
  // queries live in vault query__NamedQuery assets (req 2678df55).
  const context: NamedQueryContext = {
    params: { className: { value: className, kind: "literal" } },
  };

  const countResult = await runner.run(INTROSPECT_CLASS_COUNT_QUERY_UID, context);
  const countRows = requireSelectRows(
    countResult,
    INTROSPECT_CLASS_COUNT_QUERY_UID,
  );
  const instanceCount =
    countRows.length > 0 ? parseCount(countRows[0].get("count")) : 0;

  const propsResult = await runner.run(
    INTROSPECT_CLASS_PROPERTIES_QUERY_UID,
    context,
  );
  const propsRows = requireSelectRows(
    propsResult,
    INTROSPECT_CLASS_PROPERTIES_QUERY_UID,
  );

  const properties: PropertyInfo[] = propsRows.map((row) => {
    const propIri = row.get("property");
    const usageValue = row.get("usageCount");
    return {
      name: propIri ? extractLocalName(propIri.toString()) : "unknown",
      usageCount: parseCount(usageValue),
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
