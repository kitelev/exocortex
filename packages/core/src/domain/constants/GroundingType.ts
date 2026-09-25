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
   * Replace EXACTLY ONE value of an array-typed frontmatter property.
   *
   * ⛔ The guarantee is NOT unconditional, and an earlier revision of this
   * comment stated it as if it were ("leaving its co-values and their order
   * untouched", full stop). One measured qualification remains:
   *
   * - The list can SHRINK BY ONE: when `replaceToExpression` already appears
   *   elsewhere in the list, the `from` item is dropped rather than duplicated
   *   (set semantics, matching `property_append`'s dedup). Order of the
   *   surviving items is preserved, their count is not.
   *
   * ⛤ A SECOND qualification stood here until issue #4314 and is now **lifted**:
   * co-values used to survive only for the two-space list-item shape, because
   * `FrontmatterService.parseObject` matched items with `/^ {2}- (.*)$/` and any
   * other line ended the array — so a block-scalar item, a nested map or an
   * interleaved comment dropped every item after it from the READ, and this type
   * wrote the truncation back. `parseObject` now carries such a continuation on
   * the item it belongs to and reads column-0 and flow-style lists as lists, so
   * co-values survive on every shape measured across the three canonical vaults.
   * What it still does NOT do is re-emit an interleaved `#` comment: a comment is
   * not a value, and rewriting the property drops it (as it did before).
   *
   * Reads `targetProperty`,
   * `replaceFromExpression` (the value to find) and `replaceToExpression` (the
   * value to put in its place); both are resolved via `substituteVariables`.
   *
   * Requirement `02de55a4-0a07-4347-b434-bb4a48eb0163` (issue #4308). The three
   * existing list primitives all operate on the property as a WHOLE —
   * `property_set` replaces the value, `property_delete` removes the property,
   * `property_append` only adds — so swapping one element of a multi-value list
   * had no sanctioned path. Measured 2026-09-20: 103 of 644 property
   * definitions across the three canonical vaults (15 %) carry two or more
   * classes in `exo__Instance_class`, so a whole-value replace would silently
   * drop their co-classes.
   *
   * ⛔ A `replaceFromExpression` that is absent from the list is a REFUSAL, not
   * an append — otherwise this type degenerates into `property_append` on every
   * miss and silently produces the very state it exists to prevent.
   */
  PROPERTY_REPLACE = "property_replace",
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
  /**
   * Apply a workflow transition. Reads target asset's class, resolves the
   * default Workflow via WorkflowResolver, finds the matching
   * WorkflowTransition (from=current status, isRollback=direction match),
   * applies status mutation, and executes the transition's postActions
   * sequentially.
   *
   * Reads `direction` (`"forward"` default, or `"rollback"`). Status
   * mutation + postActions are runtime-resolved against vault Workflow ABox
   * — no hardcoded targetProperty / targetValueRef on the grounding.
   *
   * RFC 36347daf Phase 2 — homoiconic workflow definitions.
   */
  WORKFLOW_TRANSITION = "workflow_transition",
  /**
   * Copy a body template's resolved markdown into the body of the target
   * (typically a just-created asset inside a composite). Reads the template
   * markdown from `bodyTemplate` (inline literal) OR `templateRef` (UID of an
   * `exotemplate__Template` asset, loaded via the injected TemplateLoaderPort),
   * resolves `$token` markers via the shared SubstitutionResolverRegistry, and
   * replaces the target file's body (frontmatter preserved).
   *
   * Homoiconic templating subproject 17f58ebe, Веха 3 — the body-copy primitive
   * (`create_instance` writes an empty body). Composable as one step of a
   * `composite` grounding; when it follows a `create_instance` step it writes
   * into the newly created asset (the composite threads the created file's path
   * to subsequent `body_template` steps).
   */
  BODY_TEMPLATE = "body_template",
}
