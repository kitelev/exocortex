import { IRI } from "./IRI";

/** XSD string datatype URI for RDF 1.1 compatibility */
const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";

/** Valid base directions for SPARQL 1.2 directional language tags */
export type BaseDirection = "ltr" | "rtl";

/**
 * Result of parsing a directional language tag.
 * Format: `lang--dir` (e.g., `ar--rtl`, `en--ltr`)
 */
export interface ParsedLanguageTag {
  language: string;
  direction?: BaseDirection;
}

export class Literal {
  private readonly _value: string;
  private readonly _datatype?: IRI;
  private readonly _language?: string;
  private readonly _direction?: BaseDirection;

  constructor(
    value: string,
    datatype?: IRI,
    language?: string,
    direction?: BaseDirection
  ) {
    if (value.length === 0) {
      throw new Error("Literal value cannot be empty");
    }

    if (datatype && language) {
      throw new Error("Literal cannot have both datatype and language tag");
    }

    if (direction && !language) {
      throw new Error("Literal cannot have direction without language tag");
    }

    if (direction && direction !== "ltr" && direction !== "rtl") {
      throw new Error('Direction must be "ltr" or "rtl"');
    }

    this._value = value;
    this._datatype = datatype;
    this._language = language ? language.toLowerCase() : undefined;
    this._direction = direction;
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
   * Get the base direction for bidirectional text.
   * SPARQL 1.2 extension for directional language tags.
   * @see https://w3c.github.io/rdf-dir-literal/
   */
  get direction(): BaseDirection | undefined {
    return this._direction;
  }

  /**
   * Check if this literal has a direction (is a directional literal).
   */
  hasDirection(): boolean {
    return this._direction !== undefined;
  }

  /**
   * Check if this literal equals another literal.
   *
   * Per RDF 1.1 semantics, plain literals (no datatype) are equivalent to
   * xsd:string typed literals. This method treats them as equal.
   *
   * For SPARQL 1.2 directional literals, direction must also match.
   *
   * @see https://www.w3.org/TR/rdf11-concepts/#section-Graph-Literal
   * @see https://w3c.github.io/rdf-dir-literal/
   */
  equals(other: Literal): boolean {
    if (this._value !== other._value) {
      return false;
    }

    // Language-tagged literals must match exactly
    if (this._language !== other._language) {
      return false;
    }

    // Direction must match for directional literals (SPARQL 1.2)
    if (this._direction !== other._direction) {
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

  /**
   * Serialize the literal to a string representation.
   * For directional literals, uses the format: `"value"@lang--dir`
   */
  toString(): string {
    let result = `"${this._value}"`;

    if (this._datatype) {
      result += `^^<${this._datatype.value}>`;
    } else if (this._language) {
      result += `@${this._language}`;
      if (this._direction) {
        result += `--${this._direction}`;
      }
    }

    return result;
  }
}

/**
 * Parse a language tag that may include a direction suffix.
 * SPARQL 1.2 directional language tags have format: `lang--dir`
 *
 * @param tag - The language tag to parse (e.g., "ar--rtl", "en", "en-US--ltr")
 * @returns Parsed language and optional direction
 *
 * @example
 * parseLanguageTag("ar--rtl") // { language: "ar", direction: "rtl" }
 * parseLanguageTag("en") // { language: "en", direction: undefined }
 * parseLanguageTag("en-US--ltr") // { language: "en-us", direction: "ltr" }
 */
export function parseLanguageTag(tag: string): ParsedLanguageTag {
  const directionSeparator = "--";
  const separatorIndex = tag.lastIndexOf(directionSeparator);

  if (separatorIndex === -1) {
    return { language: tag.toLowerCase() };
  }

  const potentialDirection = tag.substring(
    separatorIndex + directionSeparator.length
  );
  const language = tag.substring(0, separatorIndex);

  // Only recognize "ltr" and "rtl" as valid directions
  if (potentialDirection === "ltr" || potentialDirection === "rtl") {
    return {
      language: language.toLowerCase(),
      direction: potentialDirection,
    };
  }

  // If not a valid direction, treat the whole thing as the language tag
  return { language: tag.toLowerCase() };
}

/**
 * Create a directional literal with language and direction.
 * This is a factory function for creating SPARQL 1.2 directional literals.
 *
 * @param value - The literal value
 * @param language - The language tag (e.g., "ar", "en-US")
 * @param direction - The base direction ("ltr" or "rtl")
 * @returns A new Literal with direction
 *
 * @example
 * createDirectionalLiteral("مرحبا", "ar", "rtl")
 * createDirectionalLiteral("Hello", "en", "ltr")
 */
export function createDirectionalLiteral(
  value: string,
  language: string,
  direction?: BaseDirection
): Literal {
  return new Literal(value, undefined, language, direction);
}

/**
 * Create a literal from a language tag string that may include direction.
 * Parses the tag and creates the appropriate literal.
 *
 * @param value - The literal value
 * @param languageTag - The full language tag (e.g., "ar--rtl", "en-US--ltr")
 * @returns A new Literal, with direction if specified in the tag
 *
 * @example
 * createLiteralFromLanguageTag("مرحبا", "ar--rtl")
 * // Returns: Literal { value: "مرحبا", language: "ar", direction: "rtl" }
 */
export function createLiteralFromLanguageTag(
  value: string,
  languageTag: string
): Literal {
  const { language, direction } = parseLanguageTag(languageTag);
  return new Literal(value, undefined, language, direction);
}
