import { Command } from "commander";
import { existsSync, writeFileSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import {
  InMemoryTripleStore,
  NoteToRDFConverter,
  RDFSerializer,
  Namespace,
  IRI,
  Triple,
  type RDFSerializationFormat,
} from "exocortex";
import { FileSystemVaultAdapter } from "../adapters/FileSystemVaultAdapter.js";
import { ErrorHandler, type OutputFormat } from "../utils/ErrorHandler.js";
import {
  VaultNotFoundError,
  InvalidArgumentsError,
  OperationFailedError,
} from "../utils/errors/index.js";

export type ConvertFormat = "turtle" | "ntriples" | "jsonld";

export interface ConvertCommandOptions {
  vault: string;
  format: ConvertFormat;
  out?: string;
  filter?: string;
  output?: OutputFormat;
}

const FORMAT_MAP: Record<ConvertFormat, RDFSerializationFormat> = {
  turtle: "turtle",
  ntriples: "n-triples",
  jsonld: "json-ld",
};

export const RDF_TYPE_IRI = new IRI(`${Namespace.RDF.iri.value}type`);

export const KNOWN_NAMESPACES: Namespace[] = [
  Namespace.RDF,
  Namespace.RDFS,
  Namespace.OWL,
  Namespace.XSD,
  Namespace.EXO,
  Namespace.EMS,
  Namespace.EXOCMD,
  Namespace.IMS,
  Namespace.ZTLK,
  Namespace.PTMS,
  Namespace.LIT,
  Namespace.INBOX,
];

/**
 * Resolve a user-supplied class filter string to a full IRI.
 *
 * Accepts shorthand (`ems__Task` → `https://.../ems#Task`), prefixed
 * (`ems:Task` → same), or a full IRI (passed through unchanged).
 */
export function resolveClassIri(filter: string): IRI {
  const trimmed = filter.trim();

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return new IRI(trimmed);
  }

  const doubleUnderscoreMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9]*)__(.+)$/);
  if (doubleUnderscoreMatch) {
    const [, prefix, local] = doubleUnderscoreMatch;
    const ns = KNOWN_NAMESPACES.find((n) => n.prefix === prefix);
    if (ns) return ns.term(local);
  }

  const colonMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9]*):(.+)$/);
  if (colonMatch) {
    const [, prefix, local] = colonMatch;
    const ns = KNOWN_NAMESPACES.find((n) => n.prefix === prefix);
    if (ns) return ns.term(local);
  }

  throw new InvalidArgumentsError(
    `Unable to resolve class filter "${filter}" to an IRI.`,
    'Use shorthand like "ems__Task", prefixed like "ems:Task", or a full IRI.',
  );
}

/**
 * Filter the triple list to keep only triples whose subject is an instance of
 * the given class. The target subjects are discovered by `?s rdf:type <class>`.
 */
export function filterByClass(triples: Triple[], classIri: IRI): Triple[] {
  const matchingSubjects = new Set<string>();
  for (const t of triples) {
    if (!t.predicate.equals(RDF_TYPE_IRI)) continue;
    if (t.object instanceof IRI && t.object.equals(classIri)) {
      matchingSubjects.add(t.subject.toString());
    }
  }

  if (matchingSubjects.size === 0) return [];

  return triples.filter((t) => matchingSubjects.has(t.subject.toString()));
}

export function convertCommand(): Command {
  return new Command("convert")
    .description("Dump vault graph as RDF (Turtle/N-Triples/JSON-LD)")
    .option(
      "--format <type>",
      "Serialization format: turtle|ntriples|jsonld",
      "turtle",
    )
    .option(
      "--out <path>",
      "Write serialized output to file (default: stdout)",
    )
    .option(
      "--filter <class>",
      "Keep only instances of the given class (e.g. ems__Task, ems:Task, or full IRI)",
    )
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option(
      "--output <type>",
      "Response format for errors: text|json (for MCP tools)",
      "text",
    )
    .action(async (options: ConvertCommandOptions) => {
      const outputFormat = (options.output || "text") as OutputFormat;
      ErrorHandler.setFormat(outputFormat);

      try {
        const rdfFormat = FORMAT_MAP[options.format];
        if (!rdfFormat) {
          throw new InvalidArgumentsError(
            `Unknown format: "${options.format}". Expected one of turtle|ntriples|jsonld.`,
            'exocortex convert --format turtle --out vault.ttl',
          );
        }

        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath)) {
          throw new VaultNotFoundError(vaultPath);
        }

        if (outputFormat === "text" && !options.out) {
          // Stay silent on stdout when serializing — the payload goes there.
        } else if (outputFormat === "text") {
          console.error(`📦 Loading vault: ${vaultPath}...`);
        }

        const vaultAdapter = new FileSystemVaultAdapter(vaultPath);
        const converter = new NoteToRDFConverter(vaultAdapter);
        let triples = await converter.convertVault();

        if (options.filter) {
          const classIri = resolveClassIri(options.filter);
          triples = filterByClass(triples, classIri);
        }

        const store = new InMemoryTripleStore();
        await store.addAll(triples);

        const serializer = new RDFSerializer(store);
        const payload = serializer.serializeTriples(triples, rdfFormat, {
          pretty: rdfFormat === "json-ld",
          indent: 2,
        });

        if (options.out) {
          const outPath = resolve(options.out);
          try {
            mkdirSync(dirname(outPath), { recursive: true });
            writeFileSync(outPath, payload, "utf-8");
          } catch (err) {
            throw new OperationFailedError(
              "convert",
              `failed to write output to ${outPath}: ${(err as Error).message}`,
              "Check destination directory exists and is writable.",
              { outPath },
            );
          }

          if (outputFormat === "text") {
            console.error(
              `✅ Wrote ${triples.length} triple(s) to ${outPath} (${options.format}).`,
            );
          }
        } else {
          process.stdout.write(payload);
          if (!payload.endsWith("\n")) process.stdout.write("\n");
        }
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });
}
