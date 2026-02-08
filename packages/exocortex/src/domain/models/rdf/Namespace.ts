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

  static readonly EXO_UI = new Namespace("exo-ui", "https://exocortex.my/ontology/exo-ui#");

  static readonly EMS_UI = new Namespace("ems-ui", "https://exocortex.my/ontology/ems-ui#");

  /**
   * All known namespaces for prefix resolution
   */
  static readonly ALL: Namespace[] = [
    Namespace.RDF,
    Namespace.RDFS,
    Namespace.OWL,
    Namespace.XSD,
    Namespace.EXO,
    Namespace.EMS,
    Namespace.EXO_UI,
    Namespace.EMS_UI,
  ];

  /**
   * Expand a prefixed name (e.g., "ems:Effort_status") to full IRI
   * @param prefixedName - The prefixed name to expand
   * @returns Full IRI or null if prefix not found
   */
  static expandPrefixedName(prefixedName: string): string | null {
    for (const ns of Namespace.ALL) {
      const expanded = ns.expand(prefixedName);
      if (expanded) {
        return expanded.value;
      }
    }
    return null;
  }
}
