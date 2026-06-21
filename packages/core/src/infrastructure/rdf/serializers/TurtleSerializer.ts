import { Triple } from "../../../domain/models/rdf/Triple";
import { Namespace } from "../../../domain/models/rdf/Namespace";
import { NTriplesSerializer } from "./NTriplesSerializer";

export interface TurtleSerializeOptions {
  prefixes?: Record<string, string>;
  includeDefaultPrefixes?: boolean;
  newline?: string;
}

const DEFAULT_PREFIXES: Record<string, string> = {
  rdf: Namespace.RDF.iri.value,
  rdfs: Namespace.RDFS.iri.value,
  owl: Namespace.OWL.iri.value,
  xsd: Namespace.XSD.iri.value,
  exo: Namespace.EXO.iri.value,
  ems: Namespace.EMS.iri.value,
};

export class TurtleSerializer {
  private readonly nTriplesSerializer = new NTriplesSerializer();

  serialize(triples: Triple[], options: TurtleSerializeOptions = {}): string {
    const newline = options.newline ?? "\n";

    const prefixes = this.composePrefixes(options);
    const prefixSection = this.serializePrefixes(prefixes, newline);
    const tripleSection = this.nTriplesSerializer
      .serialize(triples, { newline })
      .trimEnd();

    if (!prefixSection) {
      return tripleSection ? `${tripleSection}${newline}` : "";
    }

    if (!tripleSection) {
      return `${prefixSection}${newline}`;
    }

    return `${prefixSection}${newline}${newline}${tripleSection}${newline}`;
  }

  serializePrefixes(prefixes: Record<string, string>, newline: string): string {
    const entries = Object.entries(prefixes);

    if (entries.length === 0) {
      return "";
    }

    return entries
      .map(([prefix, iri]) => `@prefix ${prefix}: <${iri}> .`)
      .join(newline);
  }

  private composePrefixes(options: TurtleSerializeOptions): Record<string, string> {
    const includeDefault = options.includeDefaultPrefixes ?? true;
    return includeDefault
      ? {
          ...DEFAULT_PREFIXES,
          ...(options.prefixes ?? {}),
        }
      : {
          ...(options.prefixes ?? {}),
        };
  }

  serializeTriplesOnly(triples: Triple[], newline: string): string {
    return this.nTriplesSerializer
      .serializeChunk(triples, newline)
      .trimEnd();
  }
}
