import { Command } from "commander";
import { existsSync } from "fs";
import { resolve } from "path";
import {
  InMemoryTripleStore,
  NoteToRDFConverter,
  Triple,
  vaultPathToIRI,
  type NamedQueryContext,
  type NamedQueryParam,
  type ExoQLEvalResult,
} from "@kitelev/exocortex-core";
import { FileSystemVaultAdapter } from "../adapters/FileSystemVaultAdapter.js";
import { TableFormatter } from "../formatters/TableFormatter.js";
import { ErrorHandler, type OutputFormat } from "../utils/ErrorHandler.js";
import { ExitCodes } from "../utils/ExitCodes.js";
import { ErrorCode } from "../responses/index.js";
import { VaultNotFoundError } from "../utils/errors/index.js";
import { ResponseBuilder } from "../responses/index.js";
import { CacheManager } from "../cache/CacheManager.js";
import { buildNamedQueryRunner } from "../services/NamedQueryCliRunner.js";

export interface RunQueryCommandOptions {
  vault: string;
  format: "table" | "json";
  output?: OutputFormat;
  useCache?: boolean;
  currentAsset?: string;
  param: string[];
  paramIri: string[];
}

/** Commander collector for repeatable options. */
function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

/**
 * Parse `name=value` occurrences into the NamedQuery params map.
 * `literals` → literal-kind (escaped `"value"`); `iris` → iri-kind, where the
 * value is a VAULT-RELATIVE path resolved to an `obsidian://vault/...` IRI.
 */
function buildParams(
  literals: string[],
  iris: string[],
): Record<string, NamedQueryParam> | undefined {
  const params: Record<string, NamedQueryParam> = {};
  const add = (raw: string, kind: "iri" | "literal"): void => {
    const eq = raw.indexOf("=");
    if (eq <= 0) {
      throw new Error(
        `Invalid --param "${raw}" — expected name=value.`,
      );
    }
    const name = raw.slice(0, eq);
    const value = raw.slice(eq + 1);
    params[name] = {
      value: kind === "iri" ? vaultPathToIRI(value) : value,
      kind,
    };
  };
  for (const l of literals) add(l, "literal");
  for (const i of iris) add(i, "iri");
  return Object.keys(params).length > 0 ? params : undefined;
}

/**
 * Creates the `run-query <uid>` command (req 2678df55 — read axis).
 *
 * Resolves a `query__NamedQuery` asset by UID and executes its `sparql` body
 * read-only through `NamedQueryRunner`, printing the result (SELECT → table /
 * JSON; ASK → boolean; CONSTRUCT → triples). Context-free by default; accepts
 * `--current-asset` (`$currentAsset`) and repeatable `--param` / `--param-iri`.
 * This is the standalone read-side surface — NamedQueries were previously
 * reachable only from inside preconditions / groundings.
 */
export function runQueryCommand(): Command {
  return new Command("run-query")
    .description(
      "Execute a query__NamedQuery asset (read-only SELECT / ASK / CONSTRUCT) by UID and print its result.",
    )
    .argument("<uid>", "UID of the query__NamedQuery asset to run")
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option("--format <type>", "Output format: table|json", "table")
    .option("--output <type>", "Response format: text|json (for MCP tools)", "text")
    .option("--use-cache", "Use persistent cache (faster for repeated queries)")
    .option(
      "--current-asset <path>",
      "Vault-relative path injected as $currentAsset (an IRI) into the query body",
    )
    .option(
      "--param <name=value>",
      "Literal parameter $<name> substituted as an escaped string. Repeatable.",
      collect,
      [],
    )
    .option(
      "--param-iri <name=path>",
      "IRI parameter $<name>; value is a vault-relative path resolved to an IRI. Repeatable.",
      collect,
      [],
    )
    .action(async (uid: string, options: RunQueryCommandOptions) => {
      const outputFormat = (options.output || "text") as OutputFormat;
      const asJson = outputFormat === "json" || options.format === "json";
      ErrorHandler.setFormat(outputFormat);

      try {
        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath)) {
          throw new VaultNotFoundError(vaultPath);
        }

        if (!asJson) {
          console.log(`📦 Loading vault: ${vaultPath}...`);
        }

        let triples: Triple[];
        if (options.useCache ?? false) {
          const cacheResult = await new CacheManager(vaultPath).loadOrBuild();
          triples = cacheResult.triples;
        } else {
          const converter = new NoteToRDFConverter(
            new FileSystemVaultAdapter(vaultPath),
          );
          triples = await converter.convertVault();
        }
        const tripleStore = new InMemoryTripleStore();
        await tripleStore.addAll(triples);

        const runner = buildNamedQueryRunner(tripleStore, vaultPath);

        const context: NamedQueryContext = {};
        if (options.currentAsset) {
          (context as { currentAsset?: string }).currentAsset = vaultPathToIRI(
            options.currentAsset,
          );
        }
        const params = buildParams(options.param, options.paramIri);
        if (params) {
          (context as { params?: Record<string, NamedQueryParam> }).params =
            params;
        }

        const result = await runner.run(uid, context);
        if (result === null) {
          ErrorHandler.handleWithMessage(
            `No resolvable query__NamedQuery for UID "${uid}" ` +
              "(asset not found, or it has no ```sparql code-block).",
            ExitCodes.FILE_NOT_FOUND,
            ErrorCode.VALIDATION_FILE_NOT_FOUND,
          );
        }

        printResult(result, asJson);
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });
}

function printResult(result: ExoQLEvalResult, asJson: boolean): void {
  if (result.kind === "ask") {
    if (asJson) {
      console.log(
        JSON.stringify(
          ResponseBuilder.success({ kind: "ask", result: result.result }),
          null,
          2,
        ),
      );
    } else {
      console.log(String(result.result));
    }
    return;
  }

  if (result.kind === "construct") {
    const rows = result.triples.map((t: Triple) => ({
      subject: t.subject.toString(),
      predicate: t.predicate.toString(),
      object: t.object.toString(),
    }));
    if (asJson) {
      console.log(
        JSON.stringify(
          ResponseBuilder.success({
            kind: "construct",
            triples: rows,
            count: rows.length,
          }),
          null,
          2,
        ),
      );
    } else {
      console.log(`📊 CONSTRUCT — ${rows.length} triple(s):\n`);
      for (const r of rows) {
        console.log(`${r.subject} ${r.predicate} ${r.object} .`);
      }
    }
    return;
  }

  // SELECT
  if (asJson) {
    const rows = result.rows.map((row) => {
      const obj: Record<string, string | null> = {};
      for (const v of row.variables()) {
        const term = row.get(v);
        obj[v] = term ? term.toString() : null;
      }
      return obj;
    });
    console.log(
      JSON.stringify(
        ResponseBuilder.success({ kind: "select", rows, count: rows.length }),
        null,
        2,
      ),
    );
  } else {
    console.log(new TableFormatter().format(result.rows));
  }
}
