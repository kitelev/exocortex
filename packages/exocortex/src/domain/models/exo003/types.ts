/**
 * Exo 0.0.3 File Format Types
 *
 * In Exo 0.0.3, each RDF triple is stored as a separate file.
 * This architectural change provides:
 * - Granular version control - Each statement tracked independently
 * - Conflict-free collaboration - Multiple users can modify different aspects simultaneously
 * - Clear semantic structure - File type determines RDF meaning
 * - Optimized for Obsidian - Native integration with vault file system
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
 */
export interface Exo003BaseMetadata {
  /** Unique identifier for this file (UUID v5) */
  exo__Asset_uid: string;

  /** Creation timestamp in local format (YYYY-MM-DDTHH:mm:ss) */
  exo__Asset_createdAt: string;

  /** The metadata type determining how this file is interpreted */
  exo__metadataType: Exo003MetadataType;

  /** Reference to the namespace this asset belongs to */
  exo__Asset_isDefinedBy?: string;
}

/**
 * Metadata for namespace files.
 * Defines prefix-to-URI mappings for the knowledge base.
 */
export interface Exo003NamespaceMetadata extends Exo003BaseMetadata {
  exo__metadataType: Exo003MetadataType.Namespace;

  /** The namespace prefix (e.g., "exo", "ems", "foaf") */
  exo__Namespace_prefix: string;

  /** The full URI for this namespace */
  exo__Namespace_uri: string;
}

/**
 * Metadata for anchor files (named resources).
 * Represents a resource with a globally unique URI.
 */
export interface Exo003AnchorMetadata extends Exo003BaseMetadata {
  exo__metadataType: Exo003MetadataType.Anchor;

  /** The local name within the namespace (e.g., "Person", "Task") */
  exo__Anchor_localName: string;

  /** Human-readable label for this anchor */
  exo__Asset_label?: string;
}

/**
 * Metadata for blank node files (anonymous resources).
 * Represents a resource without a global identifier.
 */
export interface Exo003BlankNodeMetadata extends Exo003BaseMetadata {
  exo__metadataType: Exo003MetadataType.BlankNode;

  /** The blank node identifier (local to this knowledge base) */
  exo__BlankNode_id: string;

  /** Human-readable label for this blank node */
  exo__Asset_label?: string;
}

/**
 * Metadata for statement files (RDF triples).
 * Represents a single subject-predicate-object triple.
 */
export interface Exo003StatementMetadata extends Exo003BaseMetadata {
  exo__metadataType: Exo003MetadataType.Statement;

  /** Reference to the subject (anchor, blank node, or statement file) */
  exo__Statement_subject: string;

  /** Reference to the predicate (anchor file representing a property) */
  exo__Statement_predicate: string;

  /** Reference to the object (anchor, blank node, statement, or body file) */
  exo__Statement_object: string;
}

/**
 * Metadata for body files (literal content).
 * Contains textual content and optional language/datatype information.
 */
export interface Exo003BodyMetadata extends Exo003BaseMetadata {
  exo__metadataType: Exo003MetadataType.Body;

  /** The XSD datatype URI (if typed literal) */
  exo__Body_datatype?: string;

  /** Language tag (if language-tagged string, defaults to "ru") */
  exo__Body_language?: string;

  /** Base direction for bidirectional text ("ltr" or "rtl") */
  exo__Body_direction?: "ltr" | "rtl";
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
 */
export const ALLOWED_PROPERTIES: Record<Exo003MetadataType, readonly string[]> = {
  [Exo003MetadataType.Namespace]: [
    "exo__Asset_uid",
    "exo__Asset_createdAt",
    "exo__metadataType",
    "exo__Asset_isDefinedBy",
    "exo__Namespace_prefix",
    "exo__Namespace_uri",
  ] as const,

  [Exo003MetadataType.Anchor]: [
    "exo__Asset_uid",
    "exo__Asset_createdAt",
    "exo__metadataType",
    "exo__Asset_isDefinedBy",
    "exo__Anchor_localName",
    "exo__Asset_label",
    "aliases",
  ] as const,

  [Exo003MetadataType.BlankNode]: [
    "exo__Asset_uid",
    "exo__Asset_createdAt",
    "exo__metadataType",
    "exo__Asset_isDefinedBy",
    "exo__BlankNode_id",
    "exo__Asset_label",
    "aliases",
  ] as const,

  [Exo003MetadataType.Statement]: [
    "exo__Asset_uid",
    "exo__Asset_createdAt",
    "exo__metadataType",
    "exo__Asset_isDefinedBy",
    "exo__Statement_subject",
    "exo__Statement_predicate",
    "exo__Statement_object",
  ] as const,

  [Exo003MetadataType.Body]: [
    "exo__Asset_uid",
    "exo__Asset_createdAt",
    "exo__metadataType",
    "exo__Asset_isDefinedBy",
    "exo__Body_datatype",
    "exo__Body_language",
    "exo__Body_direction",
  ] as const,
};

/**
 * Required frontmatter properties for each metadata type.
 */
export const REQUIRED_PROPERTIES: Record<Exo003MetadataType, readonly string[]> = {
  [Exo003MetadataType.Namespace]: [
    "exo__Asset_uid",
    "exo__Asset_createdAt",
    "exo__metadataType",
    "exo__Namespace_prefix",
    "exo__Namespace_uri",
  ] as const,

  [Exo003MetadataType.Anchor]: [
    "exo__Asset_uid",
    "exo__Asset_createdAt",
    "exo__metadataType",
    "exo__Anchor_localName",
  ] as const,

  [Exo003MetadataType.BlankNode]: [
    "exo__Asset_uid",
    "exo__Asset_createdAt",
    "exo__metadataType",
    "exo__BlankNode_id",
  ] as const,

  [Exo003MetadataType.Statement]: [
    "exo__Asset_uid",
    "exo__Asset_createdAt",
    "exo__metadataType",
    "exo__Statement_subject",
    "exo__Statement_predicate",
    "exo__Statement_object",
  ] as const,

  [Exo003MetadataType.Body]: [
    "exo__Asset_uid",
    "exo__Asset_createdAt",
    "exo__metadataType",
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
