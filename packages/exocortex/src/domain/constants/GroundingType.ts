/**
 * Types of grounding actions for dynamic commands (RFC-009 Section 4.2.3).
 *
 * Determines how a command modifies the target asset when executed.
 */
export enum GroundingType {
  /** Full SPARQL UPDATE query (maximum flexibility) */
  SPARQL_UPDATE = "sparql_update",
  /** Remove a single frontmatter property */
  PROPERTY_DELETE = "property_delete",
  /** Set a single frontmatter property to a value */
  PROPERTY_SET = "property_set",
  /** Sequential execution of multiple grounding steps */
  COMPOSITE = "composite",
  /** Delegate to a registered service by ID */
  SERVICE_CALL = "service_call",
  /** Create a new instance file from a prototype (RFC-016) */
  CREATE_INSTANCE = "create_instance",
}
