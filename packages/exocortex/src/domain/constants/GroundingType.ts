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
  /**
   * Append a value to an array-typed frontmatter property with Set-based dedup.
   * Reads `targetProperty` (array property) and `appendExpression` (resolved
   * via substituteVariables — supports `$target.<prop>` dotted-property
   * access). RFC 918a2b65 Phase 4 typed predicate (canonical).
   *
   * Issue #3132 — Declarative replacement for `service_call` /
   * `copyLabelToAliases` (Homoiconicity Invariant Q1: user-configurable
   * semantics belong in RDF, not TypeScript).
   */
  PROPERTY_APPEND = "property_append",
  /**
   * Increment an integer frontmatter property by `incrementBy` (default 1).
   * Reads `targetProperty` (integer property) and `incrementBy` (xsd:integer,
   * supports negative values). Missing property is treated as 0.
   *
   * Issue #3134 — Declarative replacement for `service_call` /
   * `incrementVotes` (Homoiconicity Invariant Q1). Fails fast when target
   * value is not parseable as an integer.
   */
  PROPERTY_INCREMENT = "property_increment",
  /**
   * Shift a datetime frontmatter property by an ISO-8601 duration literal.
   * Reads `targetProperty` (xsd:dateTime property) and `shiftDelta` (ISO-8601
   * duration string, e.g. "P1D", "-PT2H", "P1M"; supports both
   * xsd:dayTimeDuration and xsd:yearMonthDuration shapes).
   *
   * Issue #3134 — Declarative replacement for `service_call` / `shiftDay`
   * (Homoiconicity Invariant Q1). Fails fast on non-datetime current value
   * or invalid duration literal. Output is formatted via
   * DateFormatter.toLocalTimestamp (no TZ suffix, matching the
   * BehavioralRule for ems__Effort_*Timestamp properties).
   */
  PROPERTY_SHIFT = "property_shift",
}
