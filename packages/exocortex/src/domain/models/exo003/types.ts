/**
 * Exo 0.0.3 File Format Types
 *
 * In Exo 0.0.3, each RDF triple is stored as a separate file.
 * This architectural change provides:
 * - Granular version control - Each statement tracked independently
 * - Conflict-free collaboration - Multiple users can modify different aspects simultaneously
 * - Clear semantic structure - File type determines RDF meaning
 * - Optimized for Obsidian - Native integration with vault file system
 *
 * ## Strict Frontmatter Allowlist (from specification)
 *
 * **Only these frontmatter properties are allowed:** `metadata`, `uri`, `aliases`, `subject`, `predicate`, `object`
 *
 * Each file type has a strict allowlist:
 *
 * - **namespace**: `metadata`, `uri`, `aliases`
 * - **anchor**: `metadata`, `uri`, `aliases`
 * - **blank_node**: `metadata`, `uri`, `aliases`
 * - **statement**: `metadata`, `subject`, `predicate`, `object`, `aliases`
 * - **body**: `metadata`, `subject`, `predicate`, `aliases` (content in markdown body)
 *
 * Properties like `uid`, `createdAt`, `localName`, `label`, `id`, `datatype`, `language`, `direction`
 * are NOT allowed in frontmatter per specification.
 */

/**
 * Metadata types supported by Exo 0.0.3 file format.
 * Each type represents a different kind of RDF construct stored as a file.
 */
export enum Exo003MetadataType {
  /**
   * Namespace declaration file.
   * Defines a prefix-to-URI mapping used across the knowledge base.
   */
  Namespace = "namespace",

  /**
   * Anchor file - represents a named resource (IRI).
   * Each anchor has a unique URI within its namespace.
   */
  Anchor = "anchor",

  /**
   * Blank node file - represents an anonymous resource.
   * Used for resources that don't have a global identifier.
   */
  BlankNode = "blank_node",

  /**
   * Statement file - represents an RDF triple (subject, predicate, object).
   * The core building block of the knowledge base.
   */
  Statement = "statement",

  /**
   * Body file - contains the textual content of a resource.
   * Used for literals, descriptions, and other text content.
   */
  Body = "body",
}

/**
 * Base interface for all Exo 0.0.3 file metadata.
 *
 * Note: uid and createdAt are NOT stored in frontmatter per specification.
 * They should be stored as RDF statements linking to the file.
 */
export interface Exo003BaseMetadata {
  /** The metadata type determining how this file is interpreted */
  metadata: Exo003MetadataType;

  /** Obsidian aliases for this file (optional) */
  aliases?: string[];
}

/**
 * Metadata for namespace files.
 * Defines prefix-to-URI mappings for the knowledge base.
 *
 * Allowed frontmatter: metadata, uri, aliases
 */
export interface Exo003NamespaceMetadata extends Exo003BaseMetadata {
  metadata: Exo003MetadataType.Namespace;

  /** The full URI for this namespace */
  uri: string;
}

/**
 * Metadata for anchor files (named resources).
 * Represents a resource with a globally unique URI.
 *
 * Allowed frontmatter: metadata, uri, aliases
 */
export interface Exo003AnchorMetadata extends Exo003BaseMetadata {
  metadata: Exo003MetadataType.Anchor;

  /** The full URI for this anchor resource */
  uri: string;
}

/**
 * Metadata for blank node files (anonymous resources).
 * Represents a resource without a global identifier.
 *
 * Allowed frontmatter: metadata, uri, aliases
 */
export interface Exo003BlankNodeMetadata extends Exo003BaseMetadata {
  metadata: Exo003MetadataType.BlankNode;

  /** The URI for this blank node (e.g., blank node identifier in URI form) */
  uri: string;
}

/**
 * Metadata for statement files (RDF triples).
 * Represents a single subject-predicate-object triple.
 *
 * Allowed frontmatter: metadata, subject, predicate, object, aliases
 */
export interface Exo003StatementMetadata extends Exo003BaseMetadata {
  metadata: Exo003MetadataType.Statement;

  /** Reference to the subject (anchor, blank node, or statement file) */
  subject: string;

  /** Reference to the predicate (anchor file representing a property) */
  predicate: string;

  /** Reference to the object (anchor, blank node, statement, or body file) */
  object: string;
}

/**
 * Metadata for body files (literal content).
 * Contains textual content in the markdown body.
 *
 * Allowed frontmatter: metadata, subject, predicate, aliases
 * The actual content is in the markdown body after frontmatter.
 *
 * Note: Language/datatype are derived from TBox (rdfs:range), not stored in frontmatter.
 * Default language is @ru per specification.
 */
export interface Exo003BodyMetadata extends Exo003BaseMetadata {
  metadata: Exo003MetadataType.Body;

  /** Reference to the subject this body belongs to */
  subject: string;

  /** Reference to the predicate this body is the value of */
  predicate: string;
}

/**
 * Union type for all Exo 0.0.3 metadata types.
 */
export type Exo003Metadata =
  | Exo003NamespaceMetadata
  | Exo003AnchorMetadata
  | Exo003BlankNodeMetadata
  | Exo003StatementMetadata
  | Exo003BodyMetadata;

/**
 * Allowed frontmatter properties for each metadata type.
 * Properties not in this list are forbidden and should trigger validation errors.
 *
 * Strict allowlist from specification:
 * Only `metadata`, `uri`, `aliases`, `subject`, `predicate`, `object` are allowed.
 */
export const ALLOWED_PROPERTIES: Record<Exo003MetadataType, readonly string[]> = {
  [Exo003MetadataType.Namespace]: [
    "metadata",
    "uri",
    "aliases",
  ] as const,

  [Exo003MetadataType.Anchor]: [
    "metadata",
    "uri",
    "aliases",
  ] as const,

  [Exo003MetadataType.BlankNode]: [
    "metadata",
    "uri",
    "aliases",
  ] as const,

  [Exo003MetadataType.Statement]: [
    "metadata",
    "subject",
    "predicate",
    "object",
    "aliases",
  ] as const,

  [Exo003MetadataType.Body]: [
    "metadata",
    "subject",
    "predicate",
    "aliases",
  ] as const,
};

/**
 * Required frontmatter properties for each metadata type.
 *
 * Strict requirements from specification:
 * - namespace, anchor, blank_node: metadata, uri
 * - statement: metadata, subject, predicate, object
 * - body: metadata, subject, predicate
 */
export const REQUIRED_PROPERTIES: Record<Exo003MetadataType, readonly string[]> = {
  [Exo003MetadataType.Namespace]: [
    "metadata",
    "uri",
  ] as const,

  [Exo003MetadataType.Anchor]: [
    "metadata",
    "uri",
  ] as const,

  [Exo003MetadataType.BlankNode]: [
    "metadata",
    "uri",
  ] as const,

  [Exo003MetadataType.Statement]: [
    "metadata",
    "subject",
    "predicate",
    "object",
  ] as const,

  [Exo003MetadataType.Body]: [
    "metadata",
    "subject",
    "predicate",
  ] as const,
};

/**
 * Default language tag for literals without explicit language specification.
 */
export const DEFAULT_LANGUAGE_TAG = "ru";

/**
 * UUID v5 namespace for URL-based UUIDs (RFC 4122).
 * Used as the first level of the two-level namespace scheme.
 */
export const UUID_URL_NAMESPACE = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";
