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
} from "exocortex";
import { FileSystemVaultAdapter } from "../adapters/FileSystemVaultAdapter.js";
import { ErrorHandler, type OutputFormat } from "../utils/ErrorHandler.js";
import { VaultNotFoundError, InvalidArgumentsError } from "../utils/errors/index.js";
import { ExitCodes } from "../utils/ExitCodes.js";
import { scanVaultNamespaces } from "../utils/VaultNamespaceScanner.js";
import {
  injectExocortexPrefixes,
  transformShorthandNotation,
  filterOntologyPrefixes,
} from "../utils/QueryPrefixInjector.js";

export interface FindOptions {
  vault: string;
  also?: string[];
  sparql?: string;
}

/**
 * Commander.js accumulator for repeatable --also flag.
 */
function collectAlso(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

/**
 * RFC 8e83442b (CLI v16) T1.1: `exocortex find` — pipe-friendly file selector.
 *
 * Executes a SPARQL SELECT query that binds `?path` to file IRIs, emits the
 * decoded vault-relative paths one per line on stdout. Designed to compose
 * with `xargs`, `apply`, or any other Unix tool.
 */
export function findCommand(): Command {
  return new Command("find")
    .description("Find vault assets via SPARQL — outputs file paths one per line (RFC 8e83442b T1.1)")
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option("--also <path>", "Additional vault to include (repeatable)", collectAlso, [])
    .option("--sparql <query>", "SPARQL SELECT query (must bind ?path)")
    .action(async (options: FindOptions) => {
      ErrorHandler.setFormat("text" as OutputFormat);

      try {
        if (!options.sparql) {
          throw new InvalidArgumentsError(
            "--sparql <query> is required",
            'exocortex find --sparql "SELECT ?path WHERE { ?path a <https://exocortex.my/ontology/ems#Task> }"',
          );
        }

        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath)) {
          throw new VaultNotFoundError(vaultPath);
        }

        const vaultAdapter = new FileSystemVaultAdapter(vaultPath);
        const converter = new NoteToRDFConverter(vaultAdapter);
        let triples: Triple[] = await converter.convertVault();

        const alsoVaults = options.also || [];
        for (const alsoPath of alsoVaults) {
          const resolvedAlsoPath = resolve(alsoPath);
          if (!existsSync(resolvedAlsoPath)) {
            throw new VaultNotFoundError(resolvedAlsoPath);
          }
          const alsoAdapter = new FileSystemVaultAdapter(resolvedAlsoPath);
          const alsoConverter = new NoteToRDFConverter(alsoAdapter);
          const alsoTriples = await alsoConverter.convertVault();
          triples = triples.concat(alsoTriples);
        }

        const tripleStore = new InMemoryTripleStore();
        await tripleStore.addAll(triples);

        let queryString = transformShorthandNotation(options.sparql);
        queryString = injectExocortexPrefixes(queryString);

        const parser = new ExoQLParser();
        const vaultPrefixes = filterOntologyPrefixes(scanVaultNamespaces(vaultPath));
        for (const alsoPath of alsoVaults) {
          const alsoPrefixes = filterOntologyPrefixes(scanVaultNamespaces(resolve(alsoPath)));
          for (const [prefix, uri] of alsoPrefixes) {
            if (!vaultPrefixes.has(prefix)) {
              vaultPrefixes.set(prefix, uri);
            }
          }
        }
        if (vaultPrefixes.size > 0) {
          parser.setVaultPrefixes(vaultPrefixes);
        }

        const ast = parser.parse(queryString);
        const translator = new ExoQLAlgebraTranslator();
        let algebra = translator.translate(ast);
        if (algebra.type !== "construct") {
          const optimizer = new AlgebraOptimizer();
          algebra = optimizer.optimize(algebra);
        }

        const executor = new ExoQLQueryExecutor(tripleStore);
        const results = await executor.executeAll(algebra);

        const VAULT_IRI_PREFIX = "obsidian://vault/";
        for (const row of results) {
          const binding = row.toJSON() as Record<string, string | undefined>;
          const pathIri = binding["path"];
          if (typeof pathIri !== "string") continue;
          if (!pathIri.startsWith(VAULT_IRI_PREFIX)) continue;
          const encoded = pathIri.slice(VAULT_IRI_PREFIX.length);
          let decoded: string;
          try {
            decoded = decodeURIComponent(encoded);
          } catch {
            decoded = encoded;
          }
          process.stdout.write(decoded + "\n");
        }
      } catch (error) {
        ErrorHandler.handle(error as Error);
        process.exit(ExitCodes.OPERATION_FAILED);
      }
    });
}
