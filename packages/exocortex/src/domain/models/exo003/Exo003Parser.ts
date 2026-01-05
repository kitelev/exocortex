import {
  Exo003MetadataType,
  Exo003Metadata,
  Exo003NamespaceMetadata,
  Exo003AnchorMetadata,
  Exo003BlankNodeMetadata,
  Exo003StatementMetadata,
  Exo003BodyMetadata,
  ALLOWED_PROPERTIES,
  REQUIRED_PROPERTIES,
  DEFAULT_LANGUAGE_TAG,
} from "./types";
// Note: DEFAULT_LANGUAGE_TAG is still used for toLiteral() when inferring language from TBox
import { Exo003UUIDGenerator } from "./UUIDGenerator";
import { IRI } from "../rdf/IRI";
import { Literal, createDirectionalLiteral } from "../rdf/Literal";
import { BlankNode } from "../rdf/BlankNode";
import { Triple, Subject, Predicate, Object as RDFObject } from "../rdf/Triple";

/**
 * Result of parsing an Exo 0.0.3 file.
 */
export interface Exo003ParseResult {
  /** Whether parsing succeeded */
  success: boolean;

  /** The parsed metadata (if successful) */
  metadata?: Exo003Metadata;

  /** The body content of the file (for Body type) */
  bodyContent?: string;

  /** Validation errors (if unsuccessful) */
  errors?: string[];
}

/**
 * Result of validating Exo 0.0.3 frontmatter.
 */
export interface Exo003ValidationResult {
  /** Whether validation passed */
  valid: boolean;

  /** List of validation errors */
  errors: string[];

  /** List of warnings (non-fatal issues) */
  warnings: string[];
}

/**
 * Parser and validator for Exo 0.0.3 file format.
 *
 * This class provides methods to:
 * - Parse frontmatter into typed metadata objects
 * - Validate frontmatter against allowed/required properties
 * - Convert metadata back to RDF triples
 */
export class Exo003Parser {
  /**
   * Parse frontmatter into Exo 0.0.3 metadata.
   *
   * @param frontmatter - The frontmatter object to parse
   * @param bodyContent - Optional body content for Body type files
   * @returns Parse result with metadata or errors
   */
  static parse(
    frontmatter: Record<string, unknown>,
    bodyContent?: string
  ): Exo003ParseResult {
    const validation = this.validate(frontmatter);

    if (!validation.valid) {
      return {
        success: false,
        errors: validation.errors,
      };
    }

    const metadataType = frontmatter["metadata"] as Exo003MetadataType;

    try {
      const metadata = this.parseByType(frontmatter, metadataType);
      return {
        success: true,
        metadata,
        bodyContent: metadataType === Exo003MetadataType.Body ? bodyContent : undefined,
      };
    } catch (error) {
      return {
        success: false,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * Validate frontmatter against Exo 0.0.3 schema.
   *
   * Checks:
   * 1. Required properties are present
   * 2. No forbidden properties are present
   * 3. Property values have correct types
   *
   * @param frontmatter - The frontmatter to validate
   * @returns Validation result with errors and warnings
   */
  static validate(frontmatter: Record<string, unknown>): Exo003ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for metadata type
    if (!frontmatter["metadata"]) {
      errors.push("Missing required property: metadata");
      return { valid: false, errors, warnings };
    }

    const metadataType = frontmatter["metadata"] as string;

    // Validate metadata is a known type
    if (!Object.values(Exo003MetadataType).includes(metadataType as Exo003MetadataType)) {
      errors.push(
        `Invalid metadata: ${metadataType}. Valid types: ${Object.values(
          Exo003MetadataType
        ).join(", ")}`
      );
      return { valid: false, errors, warnings };
    }

    const type = metadataType as Exo003MetadataType;
    const allowedProps = ALLOWED_PROPERTIES[type];
    const requiredProps = REQUIRED_PROPERTIES[type];

    // Check required properties
    for (const prop of requiredProps) {
      if (frontmatter[prop] === undefined || frontmatter[prop] === null) {
        errors.push(`Missing required property: ${prop}`);
      }
    }

    // Check for forbidden properties
    for (const prop of Object.keys(frontmatter)) {
      if (!allowedProps.includes(prop)) {
        errors.push(`Forbidden property for ${type}: ${prop}`);
      }
    }

    // Type-specific validation
    switch (type) {
      case Exo003MetadataType.Namespace:
        this.validateNamespaceMetadata(frontmatter, errors);
        break;
      case Exo003MetadataType.Anchor:
        this.validateAnchorMetadata(frontmatter, errors);
        break;
      case Exo003MetadataType.BlankNode:
        this.validateBlankNodeMetadata(frontmatter, errors);
        break;
      case Exo003MetadataType.Statement:
        this.validateStatementMetadata(frontmatter, errors);
        break;
      case Exo003MetadataType.Body:
        this.validateBodyMetadata(frontmatter, errors, warnings);
        break;
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Parse frontmatter by metadata type.
   */
  private static parseByType(
    frontmatter: Record<string, unknown>,
    type: Exo003MetadataType
  ): Exo003Metadata {
    const base = {
      metadata: type,
      aliases: frontmatter["aliases"] as string[] | undefined,
    };

    switch (type) {
      case Exo003MetadataType.Namespace:
        return {
          ...base,
          metadata: Exo003MetadataType.Namespace,
          uri: frontmatter["uri"] as string,
        } satisfies Exo003NamespaceMetadata;

      case Exo003MetadataType.Anchor:
        return {
          ...base,
          metadata: Exo003MetadataType.Anchor,
          uri: frontmatter["uri"] as string,
        } satisfies Exo003AnchorMetadata;

      case Exo003MetadataType.BlankNode:
        return {
          ...base,
          metadata: Exo003MetadataType.BlankNode,
          uri: frontmatter["uri"] as string,
        } satisfies Exo003BlankNodeMetadata;

      case Exo003MetadataType.Statement:
        return {
          ...base,
          metadata: Exo003MetadataType.Statement,
          subject: frontmatter["subject"] as string,
          predicate: frontmatter["predicate"] as string,
          object: frontmatter["object"] as string,
        } satisfies Exo003StatementMetadata;

      case Exo003MetadataType.Body:
        return {
          ...base,
          metadata: Exo003MetadataType.Body,
          subject: frontmatter["subject"] as string,
          predicate: frontmatter["predicate"] as string,
        } satisfies Exo003BodyMetadata;
    }
  }

  /**
   * Validate namespace-specific properties.
   */
  private static validateNamespaceMetadata(
    frontmatter: Record<string, unknown>,
    errors: string[]
  ): void {
    const uri = frontmatter["uri"];

    if (uri && typeof uri !== "string") {
      errors.push("uri must be a string");
    } else if (uri) {
      try {
        new IRI(uri as string);
      } catch {
        errors.push(`uri is not a valid IRI: ${String(uri)}`);
      }
    }
  }

  /**
   * Validate anchor-specific properties.
   */
  private static validateAnchorMetadata(
    frontmatter: Record<string, unknown>,
    errors: string[]
  ): void {
    const uri = frontmatter["uri"];

    if (uri && typeof uri !== "string") {
      errors.push("uri must be a string");
    } else if (uri) {
      try {
        new IRI(uri as string);
      } catch {
        errors.push(`uri is not a valid IRI: ${String(uri)}`);
      }
    }
  }

  /**
   * Validate blank node-specific properties.
   */
  private static validateBlankNodeMetadata(
    frontmatter: Record<string, unknown>,
    errors: string[]
  ): void {
    const uri = frontmatter["uri"];

    if (uri && typeof uri !== "string") {
      errors.push("uri must be a string");
    } else if (uri) {
      try {
        new IRI(uri as string);
      } catch {
        errors.push(`uri is not a valid IRI: ${String(uri)}`);
      }
    }
  }

  /**
   * Validate statement-specific properties.
   */
  private static validateStatementMetadata(
    frontmatter: Record<string, unknown>,
    errors: string[]
  ): void {
    const subject = frontmatter["subject"];
    const predicate = frontmatter["predicate"];
    const object = frontmatter["object"];

    // Subject, predicate, and object should be wikilinks or URIs
    const entries: [string, unknown][] = [
      ["subject", subject],
      ["predicate", predicate],
      ["object", object],
    ];
    for (const [name, value] of entries) {
      if (value && typeof value !== "string") {
        errors.push(`${name} must be a string`);
      }
    }
  }

  /**
   * Validate body-specific properties.
   *
   * Per specification, body only has: metadata, subject, predicate, aliases
   * No datatype/language/direction in frontmatter - these are derived from TBox.
   */
  private static validateBodyMetadata(
    frontmatter: Record<string, unknown>,
    errors: string[],
    _warnings: string[]
  ): void {
    const subject = frontmatter["subject"];
    const predicate = frontmatter["predicate"];

    // Subject and predicate should be wikilinks or URIs
    if (subject && typeof subject !== "string") {
      errors.push("subject must be a string");
    }
    if (predicate && typeof predicate !== "string") {
      errors.push("predicate must be a string");
    }
  }

  /**
   * Convert an Exo 0.0.3 statement metadata to an RDF Triple.
   *
   * @param metadata - The statement metadata
   * @param resolveReference - Function to resolve wikilink references to URIs
   * @param bodyContent - Optional body content if object is a literal
   * @returns The RDF Triple
   */
  static toTriple(
    metadata: Exo003StatementMetadata,
    resolveReference: (ref: string) => {
      type: "iri" | "blank" | "literal";
      value: string;
      language?: string;
      direction?: "ltr" | "rtl";
      datatype?: string;
    },
    bodyContent?: string
  ): Triple {
    // Resolve subject
    const subjectRef = resolveReference(metadata.subject);
    let subject: Subject;
    if (subjectRef.type === "iri") {
      subject = new IRI(subjectRef.value);
    } else if (subjectRef.type === "blank") {
      subject = new BlankNode(subjectRef.value);
    } else {
      throw new Error("Statement subject cannot be a literal");
    }

    // Resolve predicate (must be IRI)
    const predicateRef = resolveReference(metadata.predicate);
    if (predicateRef.type !== "iri") {
      throw new Error("Statement predicate must be an IRI");
    }
    const predicate: Predicate = new IRI(predicateRef.value);

    // Resolve object
    const objectRef = resolveReference(metadata.object);
    let object: RDFObject;
    if (objectRef.type === "iri") {
      object = new IRI(objectRef.value);
    } else if (objectRef.type === "blank") {
      object = new BlankNode(objectRef.value);
    } else {
      // Literal
      const value = bodyContent || objectRef.value;
      if (objectRef.datatype) {
        object = new Literal(value, new IRI(objectRef.datatype));
      } else {
        const language = objectRef.language || DEFAULT_LANGUAGE_TAG;
        object = createDirectionalLiteral(value, language, objectRef.direction);
      }
    }

    return new Triple(subject, predicate, object);
  }

  /**
   * Create a Literal from Exo 0.0.3 body metadata.
   *
   * Per specification, language/datatype are derived from TBox (rdfs:range),
   * not stored in frontmatter. Default language is @ru.
   *
   * @param _metadata - The body metadata (used for future TBox lookup)
   * @param content - The literal content from the file body
   * @param options - Optional language/datatype from TBox lookup
   * @returns A Literal with appropriate language/datatype
   */
  static toLiteral(
    _metadata: Exo003BodyMetadata,
    content: string,
    options?: { language?: string; datatype?: string; direction?: "ltr" | "rtl" }
  ): Literal {
    if (options?.datatype) {
      return new Literal(content, new IRI(options.datatype));
    }

    const language = options?.language || DEFAULT_LANGUAGE_TAG;
    return createDirectionalLiteral(content, language, options?.direction);
  }

  /**
   * Check if a frontmatter object is valid Exo 0.0.3 format.
   *
   * @param frontmatter - The frontmatter to check
   * @returns True if this is valid Exo 0.0.3 format
   */
  static isExo003Format(frontmatter: Record<string, unknown>): boolean {
    const metadataType = frontmatter["metadata"];
    return (
      typeof metadataType === "string" &&
      Object.values(Exo003MetadataType).includes(metadataType as Exo003MetadataType)
    );
  }

  /**
   * Generate deterministic UUID for metadata.
   *
   * @param metadata - The metadata to generate UUID for
   * @param _namespaceUri - Deprecated, namespace now derived from uri property
   * @returns Generated UUID
   */
  static generateUUID(metadata: Exo003Metadata, _namespaceUri?: string): string {
    switch (metadata.metadata) {
      case Exo003MetadataType.Namespace:
        return Exo003UUIDGenerator.generateNamespaceUUID(
          (metadata as Exo003NamespaceMetadata).uri
        );

      case Exo003MetadataType.Anchor:
        // Anchor has full URI, extract local name from it
        return Exo003UUIDGenerator.generateNamespaceUUID(
          (metadata as Exo003AnchorMetadata).uri
        );

      case Exo003MetadataType.BlankNode:
        // Blank node has full URI
        return Exo003UUIDGenerator.generateNamespaceUUID(
          (metadata as Exo003BlankNodeMetadata).uri
        );

      case Exo003MetadataType.Statement: {
        const stmt = metadata as Exo003StatementMetadata;
        return Exo003UUIDGenerator.generateStatementUUID(
          stmt.subject,
          stmt.predicate,
          stmt.object
        );
      }

      case Exo003MetadataType.Body: {
        const body = metadata as Exo003BodyMetadata;
        // Body UUID based on subject + predicate per spec
        return Exo003UUIDGenerator.generateBodyUUID(body.subject + "|" + body.predicate);
      }
    }
  }
}
