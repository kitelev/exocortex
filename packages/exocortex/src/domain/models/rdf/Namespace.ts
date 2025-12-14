import { IRI } from "./IRI";

export class Namespace {
  private readonly _prefix: string;
  private readonly _iri: IRI;

  constructor(prefix: string, iri: string) {
    if (prefix.trim().length === 0) {
      throw new Error("Namespace prefix cannot be empty");
    }

    this._prefix = prefix;
    this._iri = new IRI(iri);
  }

  get prefix(): string {
    return this._prefix;
  }

  get iri(): IRI {
    return this._iri;
  }

  term(localName: string): IRI {
    return new IRI(`${this._iri.value}${localName}`);
  }

  expand(prefixedName: string): IRI | null {
    const parts = prefixedName.split(":");
    if (parts.length !== 2) {
      return null;
    }

    const [prefix, localName] = parts;
    if (prefix !== this._prefix) {
      return null;
    }

    return this.term(localName);
  }

  static readonly RDF = new Namespace(
    "rdf",
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
  );

  static readonly RDFS = new Namespace(
    "rdfs",
    "http://www.w3.org/2000/01/rdf-schema#"
  );

  static readonly OWL = new Namespace("owl", "http://www.w3.org/2002/07/owl#");

  static readonly XSD = new Namespace(
    "xsd",
    "http://www.w3.org/2001/XMLSchema#"
  );

  static readonly EXO = new Namespace("exo", "https://exocortex.my/ontology/exo#");

  static readonly EMS = new Namespace("ems", "https://exocortex.my/ontology/ems#");
}
