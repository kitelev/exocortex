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

    const metadataType = frontmatter["exo__metadataType"] as Exo003MetadataType;

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

    // Check for metadataType
    if (!frontmatter["exo__metadataType"]) {
      errors.push("Missing required property: exo__metadataType");
      return { valid: false, errors, warnings };
    }

    const metadataType = frontmatter["exo__metadataType"] as string;

    // Validate metadataType is a known type
    if (!Object.values(Exo003MetadataType).includes(metadataType as Exo003MetadataType)) {
      errors.push(
        `Invalid exo__metadataType: ${metadataType}. Valid types: ${Object.values(
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
      exo__Asset_uid: frontmatter["exo__Asset_uid"] as string,
      exo__Asset_createdAt: frontmatter["exo__Asset_createdAt"] as string,
      exo__metadataType: type,
      exo__Asset_isDefinedBy: frontmatter["exo__Asset_isDefinedBy"] as string | undefined,
    };

    switch (type) {
      case Exo003MetadataType.Namespace:
        return {
          ...base,
          exo__metadataType: Exo003MetadataType.Namespace,
          exo__Namespace_prefix: frontmatter["exo__Namespace_prefix"] as string,
          exo__Namespace_uri: frontmatter["exo__Namespace_uri"] as string,
        } satisfies Exo003NamespaceMetadata;

      case Exo003MetadataType.Anchor:
        return {
          ...base,
          exo__metadataType: Exo003MetadataType.Anchor,
          exo__Anchor_localName: frontmatter["exo__Anchor_localName"] as string,
          exo__Asset_label: frontmatter["exo__Asset_label"] as string | undefined,
        } satisfies Exo003AnchorMetadata;

      case Exo003MetadataType.BlankNode:
        return {
          ...base,
          exo__metadataType: Exo003MetadataType.BlankNode,
          exo__BlankNode_id: frontmatter["exo__BlankNode_id"] as string,
          exo__Asset_label: frontmatter["exo__Asset_label"] as string | undefined,
        } satisfies Exo003BlankNodeMetadata;

      case Exo003MetadataType.Statement:
        return {
          ...base,
          exo__metadataType: Exo003MetadataType.Statement,
          exo__Statement_subject: frontmatter["exo__Statement_subject"] as string,
          exo__Statement_predicate: frontmatter["exo__Statement_predicate"] as string,
          exo__Statement_object: frontmatter["exo__Statement_object"] as string,
        } satisfies Exo003StatementMetadata;

      case Exo003MetadataType.Body:
        return {
          ...base,
          exo__metadataType: Exo003MetadataType.Body,
          exo__Body_datatype: frontmatter["exo__Body_datatype"] as string | undefined,
          exo__Body_language: frontmatter["exo__Body_language"] as string | undefined,
          exo__Body_direction: frontmatter["exo__Body_direction"] as "ltr" | "rtl" | undefined,
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
    const prefix = frontmatter["exo__Namespace_prefix"];
    const uri = frontmatter["exo__Namespace_uri"];

    if (prefix && typeof prefix !== "string") {
      errors.push("exo__Namespace_prefix must be a string");
    } else if (prefix && !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(prefix as string)) {
      errors.push(
        "exo__Namespace_prefix must start with a letter and contain only letters, numbers, underscores, and hyphens"
      );
    }

    if (uri && typeof uri !== "string") {
      errors.push("exo__Namespace_uri must be a string");
    } else if (uri) {
      try {
        new IRI(uri as string);
      } catch {
        errors.push(`exo__Namespace_uri is not a valid IRI: ${uri}`);
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
    const localName = frontmatter["exo__Anchor_localName"];

    if (localName !== undefined && localName !== null && typeof localName !== "string") {
      errors.push("exo__Anchor_localName must be a string");
    } else if (typeof localName === "string" && localName.trim().length === 0) {
      errors.push("exo__Anchor_localName cannot be empty");
    }
  }

  /**
   * Validate blank node-specific properties.
   */
  private static validateBlankNodeMetadata(
    frontmatter: Record<string, unknown>,
    errors: string[]
  ): void {
    const id = frontmatter["exo__BlankNode_id"];

    if (id !== undefined && id !== null && typeof id !== "string") {
      errors.push("exo__BlankNode_id must be a string");
    } else if (typeof id === "string" && id.trim().length === 0) {
      errors.push("exo__BlankNode_id cannot be empty");
    }
  }

  /**
   * Validate statement-specific properties.
   */
  private static validateStatementMetadata(
    frontmatter: Record<string, unknown>,
    errors: string[]
  ): void {
    const subject = frontmatter["exo__Statement_subject"];
    const predicate = frontmatter["exo__Statement_predicate"];
    const object = frontmatter["exo__Statement_object"];

    // Subject, predicate, and object should be wikilinks or URIs
    for (const [name, value] of [
      ["exo__Statement_subject", subject],
      ["exo__Statement_predicate", predicate],
      ["exo__Statement_object", object],
    ]) {
      if (value && typeof value !== "string") {
        errors.push(`${name} must be a string`);
      }
    }
  }

  /**
   * Validate body-specific properties.
   */
  private static validateBodyMetadata(
    frontmatter: Record<string, unknown>,
    errors: string[],
    warnings: string[]
  ): void {
    const datatype = frontmatter["exo__Body_datatype"];
    const language = frontmatter["exo__Body_language"];
    const direction = frontmatter["exo__Body_direction"];

    // Cannot have both datatype and language
    if (datatype && language) {
      errors.push("Body cannot have both exo__Body_datatype and exo__Body_language");
    }

    // Direction requires language
    if (direction && !language) {
      errors.push("exo__Body_direction requires exo__Body_language to be set");
    }

    // Validate direction value
    if (direction && direction !== "ltr" && direction !== "rtl") {
      errors.push('exo__Body_direction must be "ltr" or "rtl"');
    }

    // Validate datatype is a valid IRI
    if (datatype && typeof datatype === "string") {
      try {
        new IRI(datatype);
      } catch {
        errors.push(`exo__Body_datatype is not a valid IRI: ${datatype}`);
      }
    }

    // Warn if no language or datatype (will use default language)
    if (!datatype && !language) {
      warnings.push(
        `No language or datatype specified. Will use default language tag: @${DEFAULT_LANGUAGE_TAG}`
      );
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
    const subjectRef = resolveReference(metadata.exo__Statement_subject);
    let subject: Subject;
    if (subjectRef.type === "iri") {
      subject = new IRI(subjectRef.value);
    } else if (subjectRef.type === "blank") {
      subject = new BlankNode(subjectRef.value);
    } else {
      throw new Error("Statement subject cannot be a literal");
    }

    // Resolve predicate (must be IRI)
    const predicateRef = resolveReference(metadata.exo__Statement_predicate);
    if (predicateRef.type !== "iri") {
      throw new Error("Statement predicate must be an IRI");
    }
    const predicate: Predicate = new IRI(predicateRef.value);

    // Resolve object
    const objectRef = resolveReference(metadata.exo__Statement_object);
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
   * @param metadata - The body metadata
   * @param content - The literal content from the file body
   * @returns A Literal with appropriate language/datatype
   */
  static toLiteral(metadata: Exo003BodyMetadata, content: string): Literal {
    if (metadata.exo__Body_datatype) {
      return new Literal(content, new IRI(metadata.exo__Body_datatype));
    }

    const language = metadata.exo__Body_language || DEFAULT_LANGUAGE_TAG;
    return createDirectionalLiteral(content, language, metadata.exo__Body_direction);
  }

  /**
   * Check if a frontmatter object is valid Exo 0.0.3 format.
   *
   * @param frontmatter - The frontmatter to check
   * @returns True if this is valid Exo 0.0.3 format
   */
  static isExo003Format(frontmatter: Record<string, unknown>): boolean {
    const metadataType = frontmatter["exo__metadataType"];
    return (
      typeof metadataType === "string" &&
      Object.values(Exo003MetadataType).includes(metadataType as Exo003MetadataType)
    );
  }

  /**
   * Generate deterministic UUID for metadata.
   *
   * @param metadata - The metadata to generate UUID for
   * @param namespaceUri - The namespace URI for anchors
   * @returns Generated UUID
   */
  static generateUUID(metadata: Exo003Metadata, namespaceUri?: string): string {
    switch (metadata.exo__metadataType) {
      case Exo003MetadataType.Namespace:
        return Exo003UUIDGenerator.generateNamespaceUUID(
          (metadata as Exo003NamespaceMetadata).exo__Namespace_uri
        );

      case Exo003MetadataType.Anchor:
        if (!namespaceUri) {
          throw new Error("Namespace URI required for anchor UUID generation");
        }
        return Exo003UUIDGenerator.generateAssetUUID(
          namespaceUri,
          (metadata as Exo003AnchorMetadata).exo__Anchor_localName
        );

      case Exo003MetadataType.BlankNode:
        return Exo003UUIDGenerator.generateBlankNodeUUID(
          (metadata as Exo003BlankNodeMetadata).exo__BlankNode_id
        );

      case Exo003MetadataType.Statement: {
        const stmt = metadata as Exo003StatementMetadata;
        return Exo003UUIDGenerator.generateStatementUUID(
          stmt.exo__Statement_subject,
          stmt.exo__Statement_predicate,
          stmt.exo__Statement_object
        );
      }

      case Exo003MetadataType.Body: {
        const body = metadata as Exo003BodyMetadata;
        return Exo003UUIDGenerator.generateBodyUUID("", {
          language: body.exo__Body_language,
          direction: body.exo__Body_direction,
          datatype: body.exo__Body_datatype,
        });
      }
    }
  }
}
