/**
 * Exo 0.0.3 File Format Support
 *
 * This module provides types, parsers, and utilities for working with
 * the Exo 0.0.3 file format where each RDF triple is stored as a separate file.
 *
 * @packageDocumentation
 */

// Types and constants
export {
  Exo003MetadataType,
  ALLOWED_PROPERTIES,
  REQUIRED_PROPERTIES,
  DEFAULT_LANGUAGE_TAG,
  UUID_URL_NAMESPACE,
} from "./types";

export type {
  Exo003BaseMetadata,
  Exo003NamespaceMetadata,
  Exo003AnchorMetadata,
  Exo003BlankNodeMetadata,
  Exo003StatementMetadata,
  Exo003BodyMetadata,
  Exo003Metadata,
} from "./types";

// UUID Generator
export { Exo003UUIDGenerator } from "./UUIDGenerator";

// Parser and Validator
export { Exo003Parser } from "./Exo003Parser";
export type { Exo003ParseResult, Exo003ValidationResult } from "./Exo003Parser";
