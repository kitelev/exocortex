/**
 * SHACL Validation Module
 *
 * Provides SHACL validation for RDF data against shape definitions.
 *
 * @see https://github.com/kitelev/exocortex/issues/1435
 * @module services/shacl
 * @since 1.4.0
 */

export { ShaclValidator } from "./ShaclValidator";
export type { ValidationResult, ValidationViolation } from "./ShaclValidator";
export { COMMAND_SHAPE_TURTLE, COMMAND_SHAPE_DEFINITION } from "./shapes/CommandShape";
