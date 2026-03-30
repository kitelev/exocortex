/**
 * Property constants for dynamic command ontology classes (RFC-009 Section 4.5).
 *
 * These constants define the frontmatter property names used by
 * exocmd__Command, exocmd__Precondition, exocmd__Grounding,
 * and exocmd__CommandBinding assets.
 */

/** Properties for exocmd__Command assets */
export const CommandProperty = {
  /** Lucide icon name for the command button */
  ICON: "exocmd__Command_icon",
  /** Reference to a Precondition asset (wikilink) */
  PRECONDITION: "exocmd__Command_precondition",
  /** Reference to a Grounding asset (wikilink) */
  GROUNDING: "exocmd__Command_grounding",
  /** Text shown in confirmation dialog before execution */
  CONFIRM_MESSAGE: "exocmd__Command_confirmMessage",
  /** Text shown after successful execution */
  SUCCESS_MESSAGE: "exocmd__Command_successMessage",
  /** Category for grouping: "maintenance", "status", "planning" */
  CATEGORY: "exocmd__Command_category",
} as const;

/** Properties for exocmd__Precondition assets */
export const PreconditionProperty = {
  /** SPARQL ASK query that determines command visibility */
  SPARQL_ASK: "exocmd__Precondition_sparqlAsk",
} as const;

/** Properties for exocmd__Grounding assets */
export const GroundingProperty = {
  /** Grounding type: sparql_update | property_delete | property_set | composite | service_call */
  TYPE: "exocmd__Grounding_type",
  /** SPARQL UPDATE query (for sparql_update type) */
  SPARQL_UPDATE: "exocmd__Grounding_sparqlUpdate",
  /** Frontmatter property name to modify (for property_delete / property_set) */
  TARGET_PROPERTY: "exocmd__Grounding_targetProperty",
  /** Value to set (for property_set type) */
  TARGET_VALUE: "exocmd__Grounding_targetValue",
  /** Ordered array of Grounding asset references (for composite type) */
  STEPS: "exocmd__Grounding_steps",
} as const;

/** Properties for exocmd__CommandBinding assets */
export const CommandBindingProperty = {
  /** Reference to the Command asset (wikilink) */
  COMMAND: "exocmd__CommandBinding_command",
  /** Apply to all assets of this class (wikilink) */
  TARGET_CLASS: "exocmd__CommandBinding_targetClass",
  /** Apply to all instances of this prototype (wikilink) */
  TARGET_PROTOTYPE: "exocmd__CommandBinding_targetPrototype",
  /** Apply to a specific asset (wikilink) */
  TARGET_ASSET: "exocmd__CommandBinding_targetAsset",
  /** Where to render: "column" | "inline" | "hover" | "contextMenu" */
  POSITION: "exocmd__CommandBinding_position",
  /** Sort order among buttons (default: 100) */
  ORDER: "exocmd__CommandBinding_order",
  /** Button group name for grouping related commands */
  GROUP: "exocmd__CommandBinding_group",
  /** Override command-level precondition for this binding (wikilink) */
  PRECONDITION: "exocmd__CommandBinding_precondition",
} as const;
