import { Triple } from "../../../domain/models/rdf/Triple";
import { IRI } from "../../../domain/models/rdf/IRI";
import { BlankNode } from "../../../domain/models/rdf/BlankNode";
import { Literal } from "../../../domain/models/rdf/Literal";
import { Namespace } from "../../../domain/models/rdf/Namespace";

export interface JSONLDSerializeOptions {
  context?: Record<string, string>;
  pretty?: boolean;
  indent?: number;
}

export interface JSONLDNode {
  "@id": string;
  [key: string]: unknown;
}

export interface JSONLDDocument {
  "@context": Record<string, string>;
  "@graph": JSONLDNode[];
}

const DEFAULT_CONTEXT: Record<string, string> = {
  rdf: Namespace.RDF.iri.value,
  rdfs: Namespace.RDFS.iri.value,
  owl: Namespace.OWL.iri.value,
  xsd: Namespace.XSD.iri.value,
  exo: Namespace.EXO.iri.value,
  ems: Namespace.EMS.iri.value,
};

export class JSONLDSerializer {
  toDocument(triples: Triple[], options: JSONLDSerializeOptions = {}): JSONLDDocument {
    const context = {
      ...DEFAULT_CONTEXT,
      ...(options.context ?? {}),
    };

    const nodes = new Map<string, JSONLDNode>();

    for (const triple of triples) {
      const subjectId = this.subjectToId(triple.subject);
      const predicateKey = this.compactIri(triple.predicate.value, context);
      const objectValue = this.objectToJSONLD(triple.object, context);

      const node = nodes.get(subjectId) ?? { "@id": subjectId };
      const existingValue = node[predicateKey];

      if (existingValue === undefined) {
        node[predicateKey] = objectValue;
      } else if (Array.isArray(existingValue)) {
        existingValue.push(objectValue);
      } else {
        node[predicateKey] = [existingValue, objectValue];
      }

      nodes.set(subjectId, node);
    }

    return {
      "@context": context,
      "@graph": Array.from(nodes.values()),
    };
  }

  serialize(triples: Triple[], options: JSONLDSerializeOptions = {}): string {
    const document = this.toDocument(triples, options);
    const indent = options.pretty ? options.indent ?? 2 : undefined;
    return JSON.stringify(document, null, indent);
  }

  private subjectToId(subject: Triple["subject"]): string {
    if (subject instanceof IRI) {
      return subject.value;
    }

    if (subject instanceof BlankNode) {
      return `_:${subject.id}`;
    }

    return String(subject);
  }

  private compactIri(iri: string, context: Record<string, string>): string {
    for (const [prefix, namespace] of Object.entries(context)) {
      if (iri.startsWith(namespace)) {
        const local = iri.slice(namespace.length);
        if (local.length > 0) {
          return `${prefix}:${local}`;
        }
      }
    }

    return iri;
  }

  private objectToJSONLD(object: Triple["object"], context: Record<string, string>): unknown {
    if (object instanceof IRI) {
      return { "@id": object.value };
    }

    if (object instanceof BlankNode) {
      return { "@id": `_:${object.id}` };
    }

    if (object instanceof Literal) {
      const literal: Record<string, string> = {
        "@value": object.value,
      };

      if (object.datatype) {
        literal["@type"] = this.compactIri(object.datatype.value, context);
      } else if (object.language) {
        literal["@language"] = object.language;
      }

      return literal;
    }

    return object;
  }
}
