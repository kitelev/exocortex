/**
 * ConditionTypes - Type definitions for Condition evaluation system
 *
 * Provides type-safe interfaces for the ConditionEvaluator.
 * Conditions are used for button visibility logic in the RDF-driven UI.
 *
 * @see /Users/kitelev/vault-2025/03 Knowledge/concepts/RDF-Driven Architecture Implementation Plan (Note).md
 * Phase 3: ConditionEvaluator (lines 1643-1713)
 *
 * Issue #1412: Implement ConditionEvaluator
 * @see https://github.com/kitelev/exocortex/issues/1412
 */

/**
 * Definition of a condition loaded from RDF.
 *
 * Conditions can be:
 * - SPARQL ASK query (sparql property)
 * - Simple class check (assetClass property)
 * - Property existence/value check (hasProperty + optional propertyValue)
 * - Logical operators (not, and, or with nested condition URIs)
 *
 * @example SPARQL condition
 * ```typescript
 * const condition: ConditionDefinition = {
 *   sparql: "ASK { ?asset a ems:Task . ?asset ems:Task_status 'active' }"
 * };
 * ```
 *
 * @example Class check condition
 * ```typescript
 * const condition: ConditionDefinition = {
 *   assetClass: "https://exocortex.my/ontology/ems#Task"
 * };
 * ```
 *
 * @example Property value check
 * ```typescript
 * const condition: ConditionDefinition = {
 *   hasProperty: "https://exocortex.my/ontology/ems#Task_status",
 *   propertyValue: "active"
 * };
 * ```
 *
 * @example Logical NOT condition
 * ```typescript
 * const condition: ConditionDefinition = {
 *   not: "https://exocortex.my/conditions/is-completed"
 * };
 * ```
 */
export interface ConditionDefinition {
  /** SPARQL ASK query (use ?asset as placeholder for current asset) */
  sparql?: string;

  /** Asset class URI to check (e.g., ems:Task) */
  assetClass?: string;

  /** Property URI to check for existence/value */
  hasProperty?: string;

  /** Expected property value (if checking specific value) */
  propertyValue?: string | number | boolean;

  /** URI of condition to negate (NOT operator) */
  not?: string;

  /** URIs of conditions that must all be true (AND operator) */
  and?: string[];

  /** URIs of conditions where at least one must be true (OR operator) */
  or?: string[];
}

/**
 * Namespace URI for exo-ui ontology conditions
 */
export const EXO_UI_CONDITION_NS = "https://exocortex.my/ontology/exo-ui#";

/**
 * RDF predicates used in condition definitions
 */
export const CONDITION_PREDICATES = {
  /** SPARQL query predicate */
  SPARQL: `${EXO_UI_CONDITION_NS}condition_sparql`,

  /** Asset class predicate */
  ASSET_CLASS: `${EXO_UI_CONDITION_NS}condition_assetClass`,

  /** Has property predicate */
  HAS_PROPERTY: `${EXO_UI_CONDITION_NS}condition_hasProperty`,

  /** Property value predicate */
  PROPERTY_VALUE: `${EXO_UI_CONDITION_NS}condition_propertyValue`,

  /** NOT operator predicate */
  NOT: `${EXO_UI_CONDITION_NS}condition_not`,

  /** AND operator predicate */
  AND: `${EXO_UI_CONDITION_NS}condition_and`,

  /** OR operator predicate */
  OR: `${EXO_UI_CONDITION_NS}condition_or`,
} as const;
