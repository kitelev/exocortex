/**
 * Commands Module - RDF-driven command system
 *
 * This module exports the RDF-driven command registry. Commands are defined
 * in the RDF triple store and loaded dynamically via SPARQL queries.
 *
 * @since 2.0.0 - Migrated from legacy CommandRegistry to RdfCommandRegistry
 * @see RdfCommandRegistry
 */

export type { ICommand } from "./ICommand";
export { RdfCommandRegistry } from "./RdfCommandRegistry";
export type { RdfCommand, ParsedHotkey } from "./RdfCommandRegistry";
