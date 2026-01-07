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
export { BUTTON_SHAPE_TURTLE, BUTTON_SHAPE_DEFINITION } from "./shapes/ButtonShape";
export {
  ACTION_SHAPE_TURTLE,
  ACTION_SUBCLASS_SHAPES_TURTLE,
  ALL_ACTION_SHAPES_TURTLE,
  ACTION_SHAPE_DEFINITION,
  UPDATE_PROPERTY_ACTION_SHAPE_DEFINITION,
  CREATE_ASSET_ACTION_SHAPE_DEFINITION,
  EXECUTE_SPARQL_ACTION_SHAPE_DEFINITION,
  COMPOSITE_ACTION_SHAPE_DEFINITION,
  SHOW_MODAL_ACTION_SHAPE_DEFINITION,
  CUSTOM_HANDLER_ACTION_SHAPE_DEFINITION,
  NAVIGATE_ACTION_SHAPE_DEFINITION,
  TRIGGER_HOOK_ACTION_SHAPE_DEFINITION,
} from "./shapes/ActionShape";
