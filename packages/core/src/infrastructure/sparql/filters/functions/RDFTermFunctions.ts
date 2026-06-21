import type { RDFTerm } from "./types";

import { IRI } from "../../../../domain/models/rdf/IRI";
import { Literal } from "../../../../domain/models/rdf/Literal";
import { BlankNode } from "../../../../domain/models/rdf/BlankNode";
import { QuotedTriple } from "../../../../domain/models/rdf/QuotedTriple";
import { v4 as uuidv4 } from "uuid";

export class RDFTermFunctions {

  static datatype(term: RDFTerm | undefined): IRI {
    if (term === undefined) {
      throw new Error("DATATYPE: argument is undefined");
    }

    if (term instanceof Literal) {
      if (term.datatype) {
        return term.datatype;
      }
      if (term.language) {
        return new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#langString");
      }
      return new IRI("http://www.w3.org/2001/XMLSchema#string");
    }

    throw new Error("DATATYPE: argument must be a literal");
  }

  static bound(term: RDFTerm | undefined): boolean {
    return term !== undefined;
  }

  static isIRI(term: RDFTerm | undefined): boolean {
    if (term === undefined) {
      return false;
    }
    return term instanceof IRI;
  }

  static isBlank(term: RDFTerm | undefined): boolean {
    if (term === undefined) {
      return false;
    }
    return term instanceof BlankNode;
  }

  static isLiteral(term: RDFTerm | undefined): boolean {
    if (term === undefined) {
      return false;
    }
    return term instanceof Literal;
  }

  /**
   * SPARQL 1.2 isTRIPLE type checking function (RDF-Star).
   * https://w3c.github.io/sparql-12/spec/
   *
   * Returns true if the term is a QuotedTriple, false otherwise.
   * This function is used to filter queries to only process quoted triples.
   *
   * @param term - RDF term to check
   * @returns true if term is a QuotedTriple, false otherwise
   *
   * @example
   * ```sparql
   * # Filter for quoted triples
   * SELECT ?s ?p ?o WHERE {
   *   ?s ?p ?o .
   *   FILTER(isTRIPLE(?o))
   * }
   * ```
   *
   * @example
   * ```sparql
   * # Type checking in BIND
   * BIND(isTRIPLE(<< :Alice :knows :Bob >>) AS ?isTriple)  # true
   * BIND(isTRIPLE(:Alice) AS ?isTriple)                    # false
   * BIND(isTRIPLE("text") AS ?isTriple)                    # false
   * ```
   */
  static isTriple(term: RDFTerm | QuotedTriple | undefined): boolean {
    if (term === undefined) {
      return false;
    }
    return term instanceof QuotedTriple;
  }

  /**
   * SPARQL 1.1 isNumeric function.
   * https://www.w3.org/TR/sparql11-query/#func-isNumeric
   *
   * Returns true if the term is a numeric literal (xsd:integer, xsd:decimal,
   * xsd:float, xsd:double, or derived numeric types).
   *
   * @param term - RDF term to check
   * @returns true if term is a numeric literal, false otherwise
   */
  /**
   * SPARQL 1.2 hasLANGDIR function.
   * https://w3c.github.io/sparql-12/spec/
   *
   * Returns true if the literal has both a language tag AND a base direction
   * (i.e., is a directional language-tagged literal).
   *
   * A directional literal has format: `"value"@lang--dir` where dir is "ltr" or "rtl".
   *
   * @param term - RDF term to check
   * @returns true if term is a literal with both language tag and direction, false otherwise
   *
   * @example
   * // Directional literal with ltr direction
   * hasLANGDIR("Hello"@en--ltr) → true
   *
   * // Directional literal with rtl direction
   * hasLANGDIR("مرحبا"@ar--rtl) → true
   *
   * // Non-directional language-tagged literal
   * hasLANGDIR("Hello"@en) → false
   *
   * // Plain literal (no language tag)
   * hasLANGDIR("Hello") → false
   *
   * // IRI (not a literal)
   * hasLANGDIR(<http://example.org>) → false
   */
  static hasLangdir(term: RDFTerm | undefined): boolean {
    if (term === undefined) {
      return false;
    }

    if (!(term instanceof Literal)) {
      return false;
    }

    // Must have both language AND direction to return true
    return !!term.language && !!term.direction;
  }

  static isNumeric(term: RDFTerm | undefined): boolean {
    if (term === undefined) {
      return false;
    }

    if (!(term instanceof Literal)) {
      return false;
    }

    const datatype = term.datatype?.value;
    if (!datatype) {
      return false;
    }

    // XSD numeric types per SPARQL 1.1 spec section 17.4.2.4
    const numericTypes = [
      "http://www.w3.org/2001/XMLSchema#integer",
      "http://www.w3.org/2001/XMLSchema#decimal",
      "http://www.w3.org/2001/XMLSchema#float",
      "http://www.w3.org/2001/XMLSchema#double",
      // Derived integer types (all are subtypes of xsd:integer)
      "http://www.w3.org/2001/XMLSchema#nonPositiveInteger",
      "http://www.w3.org/2001/XMLSchema#negativeInteger",
      "http://www.w3.org/2001/XMLSchema#long",
      "http://www.w3.org/2001/XMLSchema#int",
      "http://www.w3.org/2001/XMLSchema#short",
      "http://www.w3.org/2001/XMLSchema#byte",
      "http://www.w3.org/2001/XMLSchema#nonNegativeInteger",
      "http://www.w3.org/2001/XMLSchema#unsignedLong",
      "http://www.w3.org/2001/XMLSchema#unsignedInt",
      "http://www.w3.org/2001/XMLSchema#unsignedShort",
      "http://www.w3.org/2001/XMLSchema#unsignedByte",
      "http://www.w3.org/2001/XMLSchema#positiveInteger",
    ];

    return numericTypes.includes(datatype);
  }

  // XSD Type Casting Functions
  // https://www.w3.org/TR/sparql11-query/#FunctionMapping

  /**
   * XSD dateTime constructor/cast function.
   * Converts a string value to an xsd:dateTime Literal.
   * Used for dateTime arithmetic: xsd:dateTime(?end) - xsd:dateTime(?start)
   *
   * @param value - String representation of dateTime (ISO 8601 or JS Date format)
   * @returns Literal with xsd:dateTime datatype
   */
  static xsdDateTime(value: string): Literal {
    // Parse the date to validate it
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      throw new Error(`xsd:dateTime: invalid date string '${value}'`);
    }
    // Return as ISO 8601 string with xsd:dateTime datatype
    return new Literal(date.toISOString(), new IRI("http://www.w3.org/2001/XMLSchema#dateTime"));
  }

  /**
   * XSD integer constructor/cast function.
   * Converts a string/number value to an xsd:integer Literal.
   * Used for duration calculations.
   *
   * @param value - String or numeric representation of integer
   * @returns Literal with xsd:integer datatype
   */
  static xsdInteger(value: string): Literal {
    const num = parseInt(value, 10);
    if (isNaN(num)) {
      throw new Error(`xsd:integer: cannot convert '${value}' to integer`);
    }
    return new Literal(String(num), new IRI("http://www.w3.org/2001/XMLSchema#integer"));
  }

  /**
   * XSD decimal constructor/cast function.
   * Converts a string/number value to an xsd:decimal Literal.
   *
   * @param value - String or numeric representation of decimal
   * @returns Literal with xsd:decimal datatype
   */
  static xsdDecimal(value: string): Literal {
    const num = parseFloat(value);
    if (isNaN(num)) {
      throw new Error(`xsd:decimal: cannot convert '${value}' to decimal`);
    }
    return new Literal(String(num), new IRI("http://www.w3.org/2001/XMLSchema#decimal"));
  }

  // SPARQL 1.1 RDF Term Functions
  // https://www.w3.org/TR/sparql11-query/#func-sameTerm

  /**
   * SPARQL 1.1 sameTerm function.
   * Returns true if two RDF terms are exactly identical.
   *
   * Unlike the = operator which performs value-based comparison (e.g.,
   * "42"^^xsd:integer equals "42.0"^^xsd:decimal), sameTerm() checks
   * if two terms are exactly the same RDF term:
   * - Same IRI value for IRIs
   * - Same blank node ID for blank nodes
   * - Same literal value, datatype, AND language tag for literals
   *
   * @see https://www.w3.org/TR/sparql11-query/#func-sameTerm
   *
   * @param term1 - First RDF term
   * @param term2 - Second RDF term
   * @returns true if terms are exactly identical, false otherwise
   */
  static sameTerm(term1: RDFTerm | undefined, term2: RDFTerm | undefined): boolean {
    // Both undefined = same (vacuously)
    if (term1 === undefined && term2 === undefined) {
      return true;
    }

    // One undefined, one not = different
    if (term1 === undefined || term2 === undefined) {
      return false;
    }

    // Different term types = different
    if (term1.constructor !== term2.constructor) {
      return false;
    }

    // Same IRI value
    if (term1 instanceof IRI && term2 instanceof IRI) {
      return term1.value === term2.value;
    }

    // Same blank node ID
    if (term1 instanceof BlankNode && term2 instanceof BlankNode) {
      return term1.id === term2.id;
    }

    // Same literal: value, datatype, AND language must all match exactly
    if (term1 instanceof Literal && term2 instanceof Literal) {
      // Value must match
      if (term1.value !== term2.value) {
        return false;
      }

      // Language must match exactly (both undefined or same string)
      if (term1.language !== term2.language) {
        return false;
      }

      // Datatype must match exactly (both undefined or same IRI value)
      const dt1 = term1.datatype?.value;
      const dt2 = term2.datatype?.value;

      // Unlike Literal.equals(), we do NOT treat plain literal as xsd:string
      // sameTerm() requires exact identity
      return dt1 === dt2;
    }

    return false;
  }

  // SPARQL 1.1 Constructor Functions
  // https://www.w3.org/TR/sparql11-query/#FunctionMapping

  /**
   * SPARQL 1.1 IRI constructor function.
   * https://www.w3.org/TR/sparql11-query/#func-iri
   *
   * Creates an IRI from a string literal or returns the IRI unchanged.
   * URI is a synonym for IRI.
   *
   * @param term - String literal containing the IRI value, or an existing IRI
   * @returns IRI term
   *
   * Examples:
   * - IRI("http://example.org/resource") → <http://example.org/resource>
   * - IRI(<http://example.org/resource>) → <http://example.org/resource>
   */
  static iri(term: RDFTerm | undefined): IRI {
    if (term === undefined) {
      throw new Error("IRI: argument is undefined");
    }

    // If already an IRI, return as-is
    if (term instanceof IRI) {
      return term;
    }

    // If literal, create IRI from value
    if (term instanceof Literal) {
      return new IRI(term.value);
    }

    // Blank nodes cannot be converted to IRIs
    if (term instanceof BlankNode) {
      throw new Error("IRI: cannot convert blank node to IRI");
    }

    throw new Error("IRI: unsupported term type");
  }

  /**
   * SPARQL 1.1 URI constructor function (synonym for IRI).
   * https://www.w3.org/TR/sparql11-query/#func-iri
   *
   * @param term - String literal containing the URI value, or an existing IRI
   * @returns IRI term
   */
  static uri(term: RDFTerm | undefined): IRI {
    return RDFTermFunctions.iri(term);
  }

  /**
   * SPARQL 1.1 BNODE constructor function.
   * https://www.w3.org/TR/sparql11-query/#func-bnode
   *
   * Creates a blank node. If called with no argument or empty argument,
   * generates a unique blank node each call. If called with a string literal,
   * creates a blank node with that label (consistent within query scope).
   *
   * @param label - Optional string literal to use as blank node label
   * @returns BlankNode term
   *
   * Examples:
   * - BNODE() → _:b1 (unique per call)
   * - BNODE("label") → _:label (consistent within query)
   */
  static bnode(label?: RDFTerm  ): BlankNode {
    // No argument - generate unique blank node using UUID (cryptographically secure)
    if (label === undefined) {
      // Use UUID v4 for unique blank node generation - already imported
      const uniqueId = `b${uuidv4().replace(/-/g, "").substring(0, 12)}`;
      return new BlankNode(uniqueId);
    }

    // With literal argument - use as label
    if (label instanceof Literal) {
      return new BlankNode(label.value);
    }

    // Already a blank node - return as is
    if (label instanceof BlankNode) {
      return label;
    }

    throw new Error("BNODE: argument must be a string literal or omitted");
  }

  /**
   * SPARQL 1.1 STRDT constructor function.
   * https://www.w3.org/TR/sparql11-query/#func-strdt
   *
   * Creates a typed literal with specified datatype.
   *
   * @param lexicalForm - String literal containing the lexical form
   * @param datatypeIRI - IRI of the datatype
   * @returns Literal with specified datatype
   *
   * Examples:
   * - STRDT("42", xsd:integer) → "42"^^xsd:integer
   * - STRDT("2025-01-01", xsd:date) → "2025-01-01"^^xsd:date
   */
  static strdt(lexicalForm: RDFTerm | undefined, datatypeIRI: RDFTerm | undefined): Literal {
    if (lexicalForm === undefined) {
      throw new Error("STRDT: lexical form is undefined");
    }

    if (datatypeIRI === undefined) {
      throw new Error("STRDT: datatype IRI is undefined");
    }

    // Get the lexical form string
    let lexicalValue: string;
    if (lexicalForm instanceof Literal) {
      // Must be a simple literal (no language tag, no datatype other than xsd:string)
      if (lexicalForm.language) {
        throw new Error("STRDT: lexical form must not have a language tag");
      }
      lexicalValue = lexicalForm.value;
    } else if (typeof lexicalForm === "string") {
      lexicalValue = lexicalForm;
    } else {
      throw new Error("STRDT: lexical form must be a string literal");
    }

    // Get the datatype IRI
    let datatypeValue: IRI;
    if (datatypeIRI instanceof IRI) {
      datatypeValue = datatypeIRI;
    } else if (datatypeIRI instanceof Literal) {
      datatypeValue = new IRI(datatypeIRI.value);
    } else {
      throw new Error("STRDT: datatype must be an IRI");
    }

    return new Literal(lexicalValue, datatypeValue);
  }

  /**
   * SPARQL 1.1 STRLANG constructor function.
   * https://www.w3.org/TR/sparql11-query/#func-strlang
   *
   * Creates a language-tagged literal.
   *
   * @param lexicalForm - String literal containing the text
   * @param languageTag - String literal containing the language tag
   * @returns Literal with specified language tag
   *
   * Examples:
   * - STRLANG("hello", "en") → "hello"@en
   * - STRLANG("Привет", "ru") → "Привет"@ru
   */
  static strlang(lexicalForm: RDFTerm | undefined, languageTag: RDFTerm | undefined): Literal {
    if (lexicalForm === undefined) {
      throw new Error("STRLANG: lexical form is undefined");
    }

    if (languageTag === undefined) {
      throw new Error("STRLANG: language tag is undefined");
    }

    // Get the lexical form string
    let lexicalValue: string;
    if (lexicalForm instanceof Literal) {
      // Must be a simple literal (no language tag, no datatype other than xsd:string)
      if (lexicalForm.language) {
        throw new Error("STRLANG: lexical form must not already have a language tag");
      }
      lexicalValue = lexicalForm.value;
    } else if (typeof lexicalForm === "string") {
      lexicalValue = lexicalForm;
    } else {
      throw new Error("STRLANG: lexical form must be a string literal");
    }

    // Get the language tag string
    let langValue: string;
    if (languageTag instanceof Literal) {
      langValue = languageTag.value;
    } else if (typeof languageTag === "string") {
      langValue = languageTag;
    } else {
      throw new Error("STRLANG: language tag must be a string literal");
    }

    // Validate language tag is not empty
    if (langValue === "") {
      throw new Error("STRLANG: language tag cannot be empty");
    }

    return new Literal(lexicalValue, undefined, langValue);
  }

  /**
   * SPARQL 1.2 STRLANGDIR constructor function.
   * https://w3c.github.io/sparql-12/spec/
   *
   * Creates a directional language-tagged literal with both language tag
   * and base direction (ltr/rtl) for bidirectional text support.
   *
   * @param lexicalForm - String literal containing the text
   * @param languageTag - String literal containing the language tag
   * @param direction - String literal containing the direction ("ltr" or "rtl")
   * @returns Literal with specified language tag and direction
   *
   * @see https://w3c.github.io/rdf-dir-literal/ - RDF Directional Literals
   *
   * Examples:
   * - STRLANGDIR("Hello", "en", "ltr") → "Hello"@en--ltr
   * - STRLANGDIR("مرحبا", "ar", "rtl") → "مرحبا"@ar--rtl
   * - STRLANGDIR("text", "fr", "xxx") → Error (invalid direction)
   */
  static strlangdir(
    lexicalForm: RDFTerm | undefined,
    languageTag: RDFTerm | undefined,
    direction: RDFTerm | undefined
  ): Literal {
    if (lexicalForm === undefined) {
      throw new Error("STRLANGDIR: lexical form is undefined");
    }

    if (languageTag === undefined) {
      throw new Error("STRLANGDIR: language tag is undefined");
    }

    if (direction === undefined) {
      throw new Error("STRLANGDIR: direction is undefined");
    }

    // Get the lexical form string
    let lexicalValue: string;
    if (lexicalForm instanceof Literal) {
      // Must be a simple literal (no language tag, no datatype other than xsd:string)
      if (lexicalForm.language) {
        throw new Error("STRLANGDIR: lexical form must not already have a language tag");
      }
      lexicalValue = lexicalForm.value;
    } else if (typeof lexicalForm === "string") {
      lexicalValue = lexicalForm;
    } else {
      throw new Error("STRLANGDIR: lexical form must be a string literal");
    }

    // Get the language tag string
    let langValue: string;
    if (languageTag instanceof Literal) {
      langValue = languageTag.value;
    } else if (typeof languageTag === "string") {
      langValue = languageTag;
    } else {
      throw new Error("STRLANGDIR: language tag must be a string literal");
    }

    // Validate language tag is not empty
    if (langValue === "") {
      throw new Error("STRLANGDIR: language tag cannot be empty");
    }

    // Get the direction string
    let dirValue: string;
    if (direction instanceof Literal) {
      dirValue = direction.value.toLowerCase();
    } else {
      throw new Error("STRLANGDIR: direction must be a string literal");
    }

    // Validate direction is 'ltr' or 'rtl'
    if (dirValue !== "ltr" && dirValue !== "rtl") {
      throw new Error(`STRLANGDIR: invalid direction '${dirValue}'. Must be 'ltr' or 'rtl'`);
    }

    return new Literal(lexicalValue, undefined, langValue, dirValue as "ltr" | "rtl");
  }

  /**
   * SPARQL 1.1 UUID constructor function.
   * https://www.w3.org/TR/sparql11-query/#func-uuid
   *
   * Returns a fresh IRI from the UUID URN scheme. Each call returns a
   * different UUID. Uses RFC 4122 UUID format.
   *
   * @returns IRI in the form <urn:uuid:XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX>
   *
   * Examples:
   * - UUID() → <urn:uuid:b7f4e9a2-8c3d-4e5f-a1b2-c3d4e5f6a7b8>
   */
  static uuid(): IRI {
    const uuid = uuidv4();
    return new IRI(`urn:uuid:${uuid}`);
  }

  /**
   * SPARQL 1.1 STRUUID constructor function.
   * https://www.w3.org/TR/sparql11-query/#func-struuid
   *
   * Returns a string that is the UUID of a fresh IRI. Each call returns a
   * different UUID string. Uses RFC 4122 UUID format.
   *
   * @returns String literal containing the UUID (without urn:uuid: prefix)
   *
   * Examples:
   * - STRUUID() → "b7f4e9a2-8c3d-4e5f-a1b2-c3d4e5f6a7b8"
   */
  static struuid(): Literal {
    const uuid = uuidv4();
    return new Literal(uuid);
  }

  /**
   * SPARQL 1.2 TRIPLE constructor function (RDF-Star).
   * https://w3c.github.io/sparql-12/spec/
   *
   * Constructs a quoted triple term from three RDF terms.
   * This is the programmatic way to create RDF-Star triple terms within SPARQL queries.
   *
   * @param subject - IRI, BlankNode, or QuotedTriple (not Literal)
   * @param predicate - Must be an IRI
   * @param object - Any RDF term (IRI, BlankNode, Literal, QuotedTriple)
   * @returns QuotedTriple instance
   * @throws Error if subject is Literal or predicate is not IRI
   *
   * @example
   * ```sparql
   * # Create quoted triple dynamically
   * SELECT (TRIPLE(?s, :knows, ?o) AS ?triple) WHERE {
   *   ?s a :Person .
   *   ?o a :Person .
   * }
   * ```
   *
   * @example
   * ```sparql
   * # Use in BIND to construct reification
   * SELECT ?triple WHERE {
   *   ?s :knows ?o .
   *   BIND(TRIPLE(?s, :knows, ?o) AS ?triple)
   * }
   * ```
   */
  static triple(
    subject: RDFTerm | QuotedTriple | undefined,
    predicate: RDFTerm | undefined,
    object: RDFTerm | QuotedTriple | undefined
  ): QuotedTriple {
    // Validate subject is not undefined
    if (subject === undefined) {
      throw new Error("TRIPLE: subject is undefined");
    }

    // Validate predicate is not undefined
    if (predicate === undefined) {
      throw new Error("TRIPLE: predicate is undefined");
    }

    // Validate object is not undefined
    if (object === undefined) {
      throw new Error("TRIPLE: object is undefined");
    }

    // Validate subject is not a Literal (per RDF-Star spec)
    if (subject instanceof Literal) {
      throw new Error(
        `TRIPLE: subject must be IRI, BlankNode, or QuotedTriple, got Literal`
      );
    }

    // Validate predicate is an IRI
    if (!(predicate instanceof IRI)) {
      const predicateType =
        predicate instanceof Literal
          ? "Literal"
          : predicate instanceof BlankNode
            ? "BlankNode"
            : predicate instanceof QuotedTriple
              ? "QuotedTriple"
              : typeof predicate;
      throw new Error(`TRIPLE: predicate must be IRI, got ${predicateType}`);
    }

    // Cast validated types
    const validSubject = subject as IRI | BlankNode | QuotedTriple;
    const validPredicate = predicate as IRI;
    const validObject = object as IRI | BlankNode | Literal | QuotedTriple;

    return new QuotedTriple(validSubject, validPredicate, validObject);
  }

  /**
   * SPARQL 1.2 SUBJECT accessor function (RDF-Star).
   * https://w3c.github.io/sparql-12/spec/
   *
   * Extracts the subject component from a quoted triple.
   * Returns the subject term, which can be an IRI, BlankNode, or nested QuotedTriple.
   *
   * @param triple - Must be a QuotedTriple
   * @returns The subject term (IRI | BlankNode | QuotedTriple)
   * @throws Error if argument is not a QuotedTriple
   *
   * @example
   * ```sparql
   * # Extract subject from quoted triple
   * SELECT (SUBJECT(?triple) AS ?s) WHERE {
   *   ?source :claims ?triple .
   *   FILTER(isTRIPLE(?triple))
   * }
   * ```
   *
   * @example
   * ```sparql
   * # Use with BIND to decompose triple
   * BIND(TRIPLE(:Alice, :knows, :Bob) AS ?t)
   * BIND(SUBJECT(?t) AS ?subj)
   * # ?subj = :Alice
   * ```
   */
  static subject(triple: RDFTerm | QuotedTriple | undefined): IRI | BlankNode | QuotedTriple {
    if (triple === undefined) {
      throw new Error("SUBJECT: argument is undefined");
    }

    if (!(triple instanceof QuotedTriple)) {
      const termType = triple instanceof IRI
        ? "IRI"
        : triple instanceof Literal
          ? "Literal"
          : triple instanceof BlankNode
            ? "BlankNode"
            : typeof triple;
      throw new Error(`SUBJECT: argument must be QuotedTriple, got ${termType}`);
    }

    return triple.subject;
  }

  /**
   * SPARQL 1.2 PREDICATE accessor function (RDF-Star).
   * https://w3c.github.io/sparql-12/spec/
   *
   * Extracts the predicate component from a quoted triple.
   * Returns an IRI (predicates are always IRIs in RDF).
   *
   * @param triple - Must be a QuotedTriple
   * @returns The predicate IRI
   * @throws Error if argument is not a QuotedTriple
   *
   * @example
   * ```sparql
   * # Extract predicate from quoted triple
   * SELECT (PREDICATE(?triple) AS ?p) WHERE {
   *   ?source :claims ?triple .
   *   FILTER(isTRIPLE(?triple))
   * }
   * ```
   *
   * @example
   * ```sparql
   * # Use with BIND to decompose triple
   * BIND(TRIPLE(:Alice, :knows, :Bob) AS ?t)
   * BIND(PREDICATE(?t) AS ?pred)
   * # ?pred = :knows
   * ```
   */
  static predicate(triple: RDFTerm | QuotedTriple | undefined): IRI {
    if (triple === undefined) {
      throw new Error("PREDICATE: argument is undefined");
    }

    if (!(triple instanceof QuotedTriple)) {
      const termType = triple instanceof IRI
        ? "IRI"
        : triple instanceof Literal
          ? "Literal"
          : triple instanceof BlankNode
            ? "BlankNode"
            : typeof triple;
      throw new Error(`PREDICATE: argument must be QuotedTriple, got ${termType}`);
    }

    return triple.predicate;
  }

  /**
   * SPARQL 1.2 OBJECT accessor function (RDF-Star).
   * https://w3c.github.io/sparql-12/spec/
   *
   * Extracts the object component from a quoted triple.
   * Returns the object term, which can be an IRI, BlankNode, Literal, or nested QuotedTriple.
   *
   * @param triple - Must be a QuotedTriple
   * @returns The object term (IRI | BlankNode | Literal | QuotedTriple)
   * @throws Error if argument is not a QuotedTriple
   *
   * @example
   * ```sparql
   * # Extract object from quoted triple
   * SELECT (OBJECT(?triple) AS ?o) WHERE {
   *   ?source :claims ?triple .
   *   FILTER(isTRIPLE(?triple))
   * }
   * ```
   *
   * @example
   * ```sparql
   * # Use with BIND to decompose triple
   * BIND(TRIPLE(:Alice, :knows, :Bob) AS ?t)
   * BIND(OBJECT(?t) AS ?obj)
   * # ?obj = :Bob
   * ```
   */
  static object(triple: RDFTerm | QuotedTriple | undefined): IRI | BlankNode | Literal | QuotedTriple {
    if (triple === undefined) {
      throw new Error("OBJECT: argument is undefined");
    }

    if (!(triple instanceof QuotedTriple)) {
      const termType = triple instanceof IRI
        ? "IRI"
        : triple instanceof Literal
          ? "Literal"
          : triple instanceof BlankNode
            ? "BlankNode"
            : typeof triple;
      throw new Error(`OBJECT: argument must be QuotedTriple, got ${termType}`);
    }

    return triple.object;
  }
}
