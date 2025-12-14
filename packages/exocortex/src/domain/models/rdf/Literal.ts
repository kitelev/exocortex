import { IRI } from "./IRI";

/** XSD string datatype URI for RDF 1.1 compatibility */
const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";

export class Literal {
  private readonly _value: string;
  private readonly _datatype?: IRI;
  private readonly _language?: string;

  constructor(value: string, datatype?: IRI, language?: string) {
    if (value.length === 0) {
      throw new Error("Literal value cannot be empty");
    }

    if (datatype && language) {
      throw new Error("Literal cannot have both datatype and language tag");
    }

    this._value = value;
    this._datatype = datatype;
    this._language = language ? language.toLowerCase() : undefined;
  }

  get value(): string {
    return this._value;
  }

  get datatype(): IRI | undefined {
    return this._datatype;
  }

  get language(): string | undefined {
    return this._language;
  }

  /**
   * Check if this literal equals another literal.
   *
   * Per RDF 1.1 semantics, plain literals (no datatype) are equivalent to
   * xsd:string typed literals. This method treats them as equal.
   *
   * @see https://www.w3.org/TR/rdf11-concepts/#section-Graph-Literal
   */
  equals(other: Literal): boolean {
    if (this._value !== other._value) {
      return false;
    }

    // Language-tagged literals must match exactly
    if (this._language !== other._language) {
      return false;
    }

    // Handle datatype comparison with RDF 1.1 xsd:string equivalence
    const thisDatatype = this.normalizedDatatype();
    const otherDatatype = other.normalizedDatatype();

    if (thisDatatype && otherDatatype) {
      return thisDatatype === otherDatatype;
    }

    // Both are null (plain literal or xsd:string) = equal
    return thisDatatype === otherDatatype;
  }

  /**
   * Get normalized datatype for equality comparison.
   * Returns null for plain literals and xsd:string (they are equivalent).
   * Returns the datatype URI string for other typed literals.
   */
  private normalizedDatatype(): string | null {
    if (!this._datatype) {
      return null;
    }
    // Treat xsd:string as equivalent to plain literal (no datatype)
    if (this._datatype.value === XSD_STRING) {
      return null;
    }
    return this._datatype.value;
  }

  toString(): string {
    let result = `"${this._value}"`;

    if (this._datatype) {
      result += `^^<${this._datatype.value}>`;
    } else if (this._language) {
      result += `@${this._language}`;
    }

    return result;
  }
}
