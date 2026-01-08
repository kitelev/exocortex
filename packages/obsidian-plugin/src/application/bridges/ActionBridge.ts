/**
 * ActionBridge - Adapter for RDF-to-ActionInterpreter mapping
 *
 * Maps RDF action definitions (from RdfCommandRegistry) to ActionInterpreter's
 * ActionDefinition type. This bridges the gap between RDF-based command definitions
 * and the core action execution engine.
 *
 * @see https://github.com/kitelev/exocortex/issues/1997
 * @module application/bridges
 * @since 13.302.0
 */

import { ActionDefinition } from "exocortex";

/**
 * RDF action definition as extracted from the triple store.
 *
 * Represents an action loaded from RDF with its full namespace URI type
 * and associated parameters.
 *
 * @example
 * ```typescript
 * const rdfAction: RdfAction = {
 *   type: "https://exocortex.my/ontology/exo-ui#CreateAssetAction",
 *   params: { assetClass: "Task", location: "/Projects" }
 * };
 * ```
 */
export interface RdfAction {
  /** Full URI type from RDF (e.g., https://exocortex.my/ontology/exo-ui#CreateAssetAction) */
  type: string;

  /** Action parameters from RDF triples */
  params: Record<string, unknown>;
}

/**
 * Error thrown when an RDF action type cannot be mapped to ActionInterpreter.
 *
 * This error indicates that the RDF action type is not one of the 8 Fixed Verbs
 * supported by ActionInterpreter.
 */
export class ActionMappingError extends Error {
  override name = "ActionMappingError";

  constructor(actionType: string) {
    super(`Unknown action type: ${actionType}`);
  }
}

/**
 * ActionBridge - Adapter between RDF action definitions and ActionInterpreter
 *
 * Converts full RDF URI types to ActionInterpreter's prefixed format (exo-ui:*)
 * and validates that only supported Fixed Verb types are used.
 *
 * Architecture:
 * - Layer: Application (Adapter between Presentation → Domain)
 * - Pattern: Adapter (GoF), Dependency Inversion (SOLID)
 *
 * @example
 * ```typescript
 * const bridge = new ActionBridge();
 * const definition = bridge.toActionDefinition({
 *   type: "https://exocortex.my/ontology/exo-ui#CreateAssetAction",
 *   params: { assetClass: "Task" }
 * });
 * // definition = { type: "exo-ui:CreateAssetAction", params: { assetClass: "Task" } }
 * ```
 */
export class ActionBridge {
  /**
   * Namespace URI for exo-ui ontology
   */
  private static readonly EXO_UI_NS = "https://exocortex.my/ontology/exo-ui#";

  /**
   * Supported action types (8 Fixed Verbs from ActionInterpreter)
   */
  private static readonly SUPPORTED_TYPES = new Set([
    "CreateAssetAction",
    "UpdatePropertyAction",
    "NavigateAction",
    "ExecuteSPARQLAction",
    "ShowModalAction",
    "TriggerHookAction",
    "CustomHandlerAction",
    "CompositeAction",
  ]);

  /**
   * Convert RDF action definition to ActionInterpreter's ActionDefinition.
   *
   * Maps the full RDF URI type to the prefixed format expected by ActionInterpreter
   * (e.g., "exo-ui:CreateAssetAction") and passes through all parameters.
   *
   * @param rdfAction - RDF action definition with full URI type
   * @returns ActionDefinition with prefixed type for ActionInterpreter
   * @throws ActionMappingError if the action type is not a supported Fixed Verb
   */
  toActionDefinition(rdfAction: RdfAction): ActionDefinition {
    const { type, params } = rdfAction;

    // Validate the type starts with exo-ui namespace
    if (!type.startsWith(ActionBridge.EXO_UI_NS)) {
      throw new ActionMappingError(type);
    }

    // Extract the action type name (e.g., "CreateAssetAction")
    const actionTypeName = type.substring(ActionBridge.EXO_UI_NS.length);

    // Validate it's one of the 8 Fixed Verbs
    if (!ActionBridge.SUPPORTED_TYPES.has(actionTypeName)) {
      throw new ActionMappingError(type);
    }

    // Map to ActionInterpreter's prefixed format
    return {
      type: `exo-ui:${actionTypeName}`,
      params,
    };
  }
}
