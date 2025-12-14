import { Triple } from "../../../domain/models/rdf/Triple";

export interface NTriplesSerializeOptions {
  newline?: string;
}

export class NTriplesSerializer {
  serialize(triples: Triple[], options: NTriplesSerializeOptions = {}): string {
    const newline = options.newline ?? "\n";

    if (triples.length === 0) {
      return "";
    }

    return triples.map((triple) => triple.toString()).join(newline) + newline;
  }

  serializeChunk(triples: Triple[], newline: string): string {
    if (triples.length === 0) {
      return "";
    }

    return triples.map((triple) => triple.toString()).join(newline) + newline;
  }
}
