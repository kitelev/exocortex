import { Triple } from "../../domain/models/rdf/Triple";
import { IRI } from "../../domain/models/rdf/IRI";
import { Literal } from "../../domain/models/rdf/Literal";
import { BlankNode } from "../../domain/models/rdf/BlankNode";
import { Namespace } from "../../domain/models/rdf/Namespace";
import { ITripleStore } from "../../interfaces/ITripleStore";
import { TurtleSerializer } from "./serializers/TurtleSerializer";
import { NTriplesSerializer } from "./serializers/NTriplesSerializer";
import { JSONLDDocument, JSONLDSerializer } from "./serializers/JSONLDSerializer";
import { TurtleParseOptions, TurtleParser } from "./parsers/TurtleParser";
import { NTriplesParseOptions, NTriplesParser } from "./parsers/NTriplesParser";

export type RDFSerializationFormat = "turtle" | "n-triples" | "json-ld";

export interface RDFSerializeOptions {
  prefixes?: Record<string, string>;
  includeDefaultPrefixes?: boolean;
  newline?: string;
  pretty?: boolean;
  indent?: number;
}

export interface RDFStreamOptions extends RDFSerializeOptions {
  batchSize?: number;
}

export interface RDFDeserializeOptions {
  prefixes?: Record<string, string>;
  strict?: boolean;
  mode?: "append" | "replace";
}

const DEFAULT_BATCH_SIZE = 1024;
const DEFAULT_NEWLINE = "\n";

const DEFAULT_PREFIXES: Record<string, string> = {
  rdf: Namespace.RDF.iri.value,
  rdfs: Namespace.RDFS.iri.value,
  owl: Namespace.OWL.iri.value,
  xsd: Namespace.XSD.iri.value,
  exo: Namespace.EXO.iri.value,
  ems: Namespace.EMS.iri.value,
};

export class RDFSerializer {
  private readonly turtleSerializer = new TurtleSerializer();
  private readonly nTriplesSerializer = new NTriplesSerializer();
  private readonly jsonldSerializer = new JSONLDSerializer();
  private readonly turtleParser = new TurtleParser();
  private readonly nTriplesParser = new NTriplesParser();

  constructor(private readonly store: ITripleStore) {}

  async serialize(format: RDFSerializationFormat, options: RDFSerializeOptions = {}): Promise<string> {
    const triples = await this.store.match();
    return this.serializeTriples(triples, format, options);
  }

  serializeTriples(triples: Triple[], format: RDFSerializationFormat, options: RDFSerializeOptions = {}): string {
    switch (format) {
      case "turtle":
        return this.turtleSerializer.serialize(triples, {
          prefixes: options.prefixes,
          includeDefaultPrefixes: options.includeDefaultPrefixes,
          newline: options.newline,
        });
      case "n-triples":
        return this.nTriplesSerializer.serialize(triples, {
          newline: options.newline,
        });
      case "json-ld":
        return this.jsonldSerializer.serialize(triples, {
          context: options.prefixes,
          pretty: options.pretty,
          indent: options.indent,
        });
      default:
        throw new Error(`Unsupported serialization format: ${format}`);
    }
  }

  stream(format: RDFSerializationFormat, options: RDFStreamOptions = {}): AsyncIterableIterator<string> {
    const newline = options.newline ?? DEFAULT_NEWLINE;
    const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    const includeDefaultPrefixes = options.includeDefaultPrefixes;
    const contextPrefixes = options.prefixes;
    const self = this;

    let initialized = false;
    let headerQueue: string[] = [];
    let triples: Triple[] = [];
    let cursor = 0;

    const ensureInitialized = async () => {
      if (initialized) {
        return;
      }

      triples = await self.store.match();

      if (format === "json-ld") {
        const document = self.jsonldSerializer.toDocument(triples, {
          context: contextPrefixes,
          pretty: false,
        });
        headerQueue.push(...self.buildJsonLdChunks(document));
      } else if (format === "turtle") {
        const header = self.turtleSerializer.serializePrefixes(
          self.composePrefixes(contextPrefixes, includeDefaultPrefixes),
          newline
        );

        if (header) {
          headerQueue.push(`${header}${newline}${newline}`);
        }
      }

      initialized = true;
    };

    const iterator: AsyncIterableIterator<string> = {
      async next() {
        await ensureInitialized();

        if (headerQueue.length > 0) {
          const value = headerQueue.shift() as string;
          return { value, done: false };
        }

        if (format === "json-ld") {
          return { value: undefined, done: true };
        }

        if (cursor >= triples.length) {
          return { value: undefined, done: true };
        }

        const slice = triples.slice(cursor, cursor + batchSize);
        cursor += slice.length;

        let chunk = "";

        if (format === "turtle") {
          const formatted = self.turtleSerializer.serializeTriplesOnly(slice, newline);
          if (formatted) {
            chunk = `${formatted}${newline}`;
          }
        } else if (format === "n-triples") {
          chunk = self.nTriplesSerializer.serializeChunk(slice, newline);
        }

        if (!chunk) {
          return this.next();
        }

        return { value: chunk, done: false };
      },

      async return() {
        headerQueue = [];
        triples = [];
        cursor = 0;
        return { value: undefined, done: true };
      },

      [Symbol.asyncIterator]() {
        return this;
      },
    };

    return iterator;
  }

  async load(input: string, format: RDFSerializationFormat, options: RDFDeserializeOptions = {}): Promise<number> {
    const triples = this.parse(input, format, options);

    if (options.mode !== "append") {
      await this.store.clear();
    }

    await this.store.addAll(triples);
    return triples.length;
  }

  parse(input: string, format: RDFSerializationFormat, options: RDFDeserializeOptions = {}): Triple[] {
    switch (format) {
      case "turtle":
        return this.turtleParser.parse(input, this.buildTurtleParseOptions(options));
      case "n-triples":
        return this.nTriplesParser.parse(input, this.buildNTriplesParseOptions(options));
      case "json-ld":
        return this.parseJsonLd(input, options);
      default:
        throw new Error(`Unsupported serialization format: ${format}`);
    }
  }

  private buildTurtleParseOptions(options: RDFDeserializeOptions): TurtleParseOptions {
    return {
      prefixes: this.composePrefixes(options.prefixes, true),
      strict: options.strict,
    };
  }

  private buildNTriplesParseOptions(options: RDFDeserializeOptions): NTriplesParseOptions {
    return {
      prefixes: this.composePrefixes(options.prefixes, true),
      strict: options.strict,
    };
  }

  private composePrefixes(prefixes: Record<string, string> | undefined, includeDefault?: boolean): Record<string, string> {
    return includeDefault ?? true
      ? {
          ...DEFAULT_PREFIXES,
          ...(prefixes ?? {}),
        }
      : {
          ...(prefixes ?? {}),
        };
  }

  private parseJsonLd(input: string, options: RDFDeserializeOptions): Triple[] {
    let parsed: unknown;

    try {
      parsed = JSON.parse(input);
    } catch (error) {
      throw new Error(`Invalid JSON-LD document: ${(error as Error).message}`);
    }

    const baseContext = this.composePrefixes(options.prefixes, true);
    const documentContext = this.extractContext(parsed);
    const context = {
      ...baseContext,
      ...documentContext,
    };

    const graph = this.extractGraph(parsed);
    const triples: Triple[] = [];

    graph.forEach((node, index) => {
      if (!node || typeof node !== "object" || Array.isArray(node)) {
        throw new Error(`Invalid JSON-LD node at index ${index}`);
      }

      const subject = this.parseSubjectFromNode(node, context, index);
      const nodeEntries = Object.entries(node as Record<string, unknown>);

      for (const [property, value] of nodeEntries) {
        if (property === "@id" || property === "@context") {
          continue;
        }

        if (property === "@type") {
          this.collectTypeTriples(subject, value, triples, context);
          continue;
        }

        const predicate = this.expandTerm(property, context);
        const predicateIri = new IRI(predicate);

        this.collectTriplesForValue(subject, predicateIri, value, triples, context);
      }
    });

    return triples;
  }

  private extractContext(document: unknown): Record<string, string> {
    if (!document || typeof document !== "object" || Array.isArray(document)) {
      return {};
    }

    const context = (document as Record<string, unknown>)["@context"];
    if (!context || typeof context !== "object" || Array.isArray(context)) {
      return {};
    }

    const result: Record<string, string> = {};

    Object.entries(context as Record<string, unknown>).forEach(([key, value]) => {
      if (typeof value === "string") {
        result[key] = value;
      }
    });

    return result;
  }

  private extractGraph(document: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(document)) {
      return document as Array<Record<string, unknown>>;
    }

    if (!document || typeof document !== "object") {
      return [];
    }

    const graph = (document as Record<string, unknown>)["@graph"];

    if (Array.isArray(graph)) {
      return graph as Array<Record<string, unknown>>;
    }

    return [document as Record<string, unknown>];
  }

  private parseSubjectFromNode(node: Record<string, unknown>, context: Record<string, string>, index: number): Triple["subject"] {
    const idValue = node["@id"];

    if (typeof idValue === "string") {
      if (idValue.startsWith("_:")) {
        return new BlankNode(idValue.slice(2));
      }

      if (this.isAbsoluteIri(idValue)) {
        return new IRI(idValue);
      }

      const expanded = this.expandTerm(idValue, context);
      return new IRI(expanded);
    }

    return new BlankNode(`jsonld_${index}`);
  }

  private collectTypeTriples(
    subject: Triple["subject"],
    value: unknown,
    triples: Triple[],
    context: Record<string, string>
  ): void {
    const typePredicate = Namespace.RDF.term("type");
    const types = Array.isArray(value) ? value : [value];

    types.forEach((entry) => {
      if (typeof entry !== "string") {
        throw new Error("Invalid @type value in JSON-LD node");
      }

      const expanded = this.expandTerm(entry, context);
      triples.push(new Triple(subject, typePredicate, new IRI(expanded)));
    });
  }

  private collectTriplesForValue(
    subject: Triple["subject"],
    predicate: IRI,
    rawValue: unknown,
    triples: Triple[],
    context: Record<string, string>
  ): void {
    if (rawValue === null || rawValue === undefined) {
      return;
    }

    if (Array.isArray(rawValue)) {
      rawValue.forEach((entry) =>
        this.collectTriplesForValue(subject, predicate, entry, triples, context)
      );
      return;
    }

    if (typeof rawValue === "object") {
      const obj = rawValue as Record<string, unknown>;

      if (typeof obj["@id"] === "string") {
        const object = this.parseIdNode(obj["@id"], context);
        triples.push(new Triple(subject, predicate, object));
        return;
      }

      if (obj["@value"] !== undefined) {
        const literal = this.parseLiteralObject(obj, context);
        triples.push(new Triple(subject, predicate, literal));
        return;
      }
    }

    if (typeof rawValue === "string") {
      triples.push(new Triple(subject, predicate, new Literal(rawValue)));
      return;
    }

    if (typeof rawValue === "number") {
      const datatype = Number.isInteger(rawValue)
        ? Namespace.XSD.term("integer")
        : Namespace.XSD.term("decimal");
      triples.push(
        new Triple(subject, predicate, new Literal(rawValue.toString(), datatype))
      );
      return;
    }

    if (typeof rawValue === "boolean") {
      const datatype = Namespace.XSD.term("boolean");
      triples.push(
        new Triple(subject, predicate, new Literal(rawValue.toString(), datatype))
      );
      return;
    }

    throw new Error("Unsupported JSON-LD value encountered");
  }

  private parseIdNode(value: string, context: Record<string, string>): Triple["object"] {
    if (value.startsWith("_:")) {
      return new BlankNode(value.slice(2));
    }

    if (this.isAbsoluteIri(value)) {
      return new IRI(value);
    }

    const expanded = this.expandTerm(value, context);
    return new IRI(expanded);
  }

  private parseLiteralObject(obj: Record<string, unknown>, context: Record<string, string>): Literal {
    const rawValue = obj["@value"];

    if (typeof rawValue !== "string") {
      throw new Error("JSON-LD literal values must be strings");
    }

    if (typeof obj["@language"] === "string") {
      return new Literal(rawValue, undefined, obj["@language"]);
    }

    if (typeof obj["@type"] === "string") {
      const expanded = this.expandTerm(obj["@type"], context);
      return new Literal(rawValue, new IRI(expanded));
    }

    return new Literal(rawValue);
  }

  private expandTerm(term: string, context: Record<string, string>): string {
    if (this.isAbsoluteIri(term)) {
      return term;
    }

    const separatorIndex = term.indexOf(":");

    if (separatorIndex > 0) {
      const prefix = term.slice(0, separatorIndex);
      const localName = term.slice(separatorIndex + 1);
      const base = context[prefix];

      if (!base) {
        throw new Error(`Unknown prefix "${prefix}" in JSON-LD document`);
      }

      return `${base}${localName}`;
    }

    const vocab = context["@vocab"];
    if (vocab) {
      return `${vocab}${term}`;
    }

    throw new Error(`Unable to expand JSON-LD term "${term}"`);
  }

  private isAbsoluteIri(value: string): boolean {
    return /^[a-z][a-z0-9+.-]*:/i.test(value);
  }

  private buildJsonLdChunks(document: JSONLDDocument): string[] {
    const chunks: string[] = [];
    const contextString = JSON.stringify(document["@context"]);
    chunks.push(`{"@context":${contextString},"@graph":[`);

    document["@graph"].forEach((node, index) => {
      const nodeString = JSON.stringify(node);
      if (index > 0) {
        chunks.push(`,${nodeString}`);
      } else {
        chunks.push(nodeString);
      }
    });

    chunks.push("]}\n");
    return chunks;
  }
}
