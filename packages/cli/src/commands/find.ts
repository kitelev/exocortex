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
  class?: string;
}

/**
 * Commander.js accumulator for repeatable --also flag.
 */
function collectAlso(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

const FIND_ALIAS_SPARQL_PRED = "https://exocortex.my/ontology/find#Alias_sparql";
const EXO_ASSET_LABEL_PRED = "https://exocortex.my/ontology/exo#Asset_label";

function nodeValue(node: unknown): string {
  if (node && typeof node === "object" && "value" in (node as Record<string, unknown>)) {
    const v = (node as { value: unknown }).value;
    return typeof v === "string" ? v : String(v);
  }
  return String(node);
}

/**
 * Look up the SPARQL WHERE-fragment of a find__Alias by its exo:Asset_label.
 *
 * Each find__Alias instance carries:
 *   - exo:Asset_label "<label>"        — the human-readable alias name (`class`, `folder`, ...)
 *   - find:Alias_sparql "<fragment>"   — WHERE-fragment that binds ?path and consumes ?value
 *
 * Returns the fragment string, or null if no alias with that label is found.
 * Throws if multiple aliases share the same label (ambiguous).
 */
async function resolveAliasFragment(
  tripleStore: InMemoryTripleStore,
  aliasLabel: string,
): Promise<string | null> {
  const labelTriples = await tripleStore.match(undefined, undefined, undefined);
  const aliasSubjectsByLabel: string[] = [];
  for (const t of labelTriples) {
    const pred = nodeValue(t.predicate);
    if (pred !== EXO_ASSET_LABEL_PRED) continue;
    const obj = nodeValue(t.object);
    if (obj !== aliasLabel) continue;
    aliasSubjectsByLabel.push(nodeValue(t.subject));
  }
  if (aliasSubjectsByLabel.length === 0) return null;

  const fragments: string[] = [];
  for (const subj of aliasSubjectsByLabel) {
    for (const t of labelTriples) {
      const pred = nodeValue(t.predicate);
      if (pred !== FIND_ALIAS_SPARQL_PRED) continue;
      if (nodeValue(t.subject) !== subj) continue;
      fragments.push(nodeValue(t.object));
    }
  }
  if (fragments.length === 0) return null;
  if (fragments.length > 1) {
    throw new InvalidArgumentsError(
      `Ambiguous find__Alias "${aliasLabel}" — ${fragments.length} instances define a sparql fragment`,
      `Ensure exactly one find__Alias asset has exo:Asset_label "${aliasLabel}"`,
    );
  }
  return fragments[0];
}

const SLUG_RE = /^([a-z][a-zA-Z0-9]*)__([A-Za-z0-9_]+)$/;
const ONTOLOGY_BASE = "https://exocortex.my/ontology/";

/**
 * Substitute occurrences of the SPARQL variable `?value` in a fragment.
 *
 * If `value` matches the Exocortex slug pattern `<prefix>__<LocalName>`
 * (e.g. `ems__Task`, `inbox__Role`), substitute as a full IRI in angle
 * brackets — `<https://exocortex.my/ontology/ems#Task>`. Otherwise substitute
 * as an RDF literal in double quotes. Word-boundary aware to avoid clobbering
 * `?valueX`.
 */
function bindValueLiteral(fragment: string, value: string): string {
  const slugMatch = SLUG_RE.exec(value);
  if (slugMatch) {
    const iri = `<${ONTOLOGY_BASE}${slugMatch[1]}#${slugMatch[2]}>`;
    return fragment.replace(/\?value\b/g, iri);
  }
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return fragment.replace(/\?value\b/g, `"${escaped}"`);
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
    .option(
      "--class <value>",
      "Filter by class label via find__Alias 'class' (e.g. ems__Task)",
    )
    .action(async (options: FindOptions) => {
      ErrorHandler.setFormat("text" as OutputFormat);

      try {
        if (options.sparql && options.class) {
          throw new InvalidArgumentsError(
            "--sparql and --class are mutually exclusive",
            "Pass either a raw --sparql query or a find__Alias-backed flag like --class",
          );
        }
        if (!options.sparql && !options.class) {
          throw new InvalidArgumentsError(
            "one of --sparql <query> or --class <value> is required",
            'exocortex find --class ems__Task   OR   exocortex find --sparql "SELECT ?path WHERE { ... }"',
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

        let rawQuery: string;
        if (options.class) {
          const fragment = await resolveAliasFragment(tripleStore, "class");
          if (fragment === null) {
            throw new InvalidArgumentsError(
              'No find__Alias with exo:Asset_label "class" was found in the vault',
              "Seed a find__Alias asset (label=class) or fall back to exocortex find --sparql",
            );
          }
          const bound = bindValueLiteral(fragment, options.class);
          rawQuery = `SELECT ?path WHERE { ${bound} }`;
        } else {
          rawQuery = options.sparql!;
        }

        let queryString = transformShorthandNotation(rawQuery);
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
