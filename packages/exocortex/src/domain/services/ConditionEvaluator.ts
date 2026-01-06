/**
 * ConditionEvaluator - Evaluates RDF-defined conditions for button visibility
 *
 * Supports multiple condition types:
 * - SPARQL ASK queries
 * - Simple class checks
 * - Property existence/value checks
 * - Logical operators (NOT, AND, OR)
 *
 * @see /Users/kitelev/vault-2025/03 Knowledge/concepts/RDF-Driven Architecture Implementation Plan (Note).md
 * Phase 3: ConditionEvaluator (lines 1643-1713)
 *
 * Issue #1412: Implement ConditionEvaluator
 * @see https://github.com/kitelev/exocortex/issues/1412
 */

import { ITripleStore } from "../../interfaces/ITripleStore";
import { Triple } from "../models/rdf/Triple";
import { IRI } from "../models/rdf/IRI";
import { Literal } from "../models/rdf/Literal";
import {
  ConditionDefinition,
  CONDITION_PREDICATES,
} from "../types/ConditionTypes";

/**
 * RDF type predicate URI
 */
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

/**
 * ConditionEvaluator - evaluates conditions for button visibility logic
 *
 * Conditions are defined in RDF using exo-ui ontology predicates.
 * This class loads condition definitions from the triple store and
 * evaluates them against a given asset.
 *
 * @example
 * ```typescript
 * const evaluator = new ConditionEvaluator(tripleStore);
 *
 * // Check if button should be visible for this asset
 * const isVisible = await evaluator.evaluate(
 *   'https://exocortex.my/conditions/is-active-task',
 *   'https://exocortex.my/assets/task-1'
 * );
 * ```
 */
export class ConditionEvaluator {
  constructor(private tripleStore: ITripleStore) {}

  /**
   * Evaluate condition for given asset
   *
   * @param conditionUri - URI of the condition definition in triple store
   * @param assetUri - URI of the asset to evaluate against
   * @returns true if condition is satisfied, false otherwise
   */
  async evaluate(conditionUri: string, assetUri: string): Promise<boolean> {
    const condition = await this.loadCondition(conditionUri);
    return this.evaluateCondition(condition, assetUri);
  }

  /**
   * Load condition definition from triple store
   *
   * @param conditionUri - URI of the condition
   * @returns Parsed condition definition
   */
  private async loadCondition(conditionUri: string): Promise<ConditionDefinition> {
    const conditionIRI = new IRI(conditionUri);
    const triples = await this.tripleStore.match(conditionIRI, undefined, undefined);

    const condition: ConditionDefinition = {};
    const andConditions: string[] = [];
    const orConditions: string[] = [];

    for (const triple of triples) {
      const predicateValue = this.getPredicateValue(triple);
      const objectValue = this.getObjectValue(triple);

      switch (predicateValue) {
        case CONDITION_PREDICATES.SPARQL:
          condition.sparql = objectValue;
          break;
        case CONDITION_PREDICATES.ASSET_CLASS:
          condition.assetClass = objectValue;
          break;
        case CONDITION_PREDICATES.HAS_PROPERTY:
          condition.hasProperty = objectValue;
          break;
        case CONDITION_PREDICATES.PROPERTY_VALUE:
          condition.propertyValue = objectValue;
          break;
        case CONDITION_PREDICATES.NOT:
          condition.not = objectValue;
          break;
        case CONDITION_PREDICATES.AND:
          andConditions.push(objectValue);
          break;
        case CONDITION_PREDICATES.OR:
          orConditions.push(objectValue);
          break;
      }
    }

    if (andConditions.length > 0) {
      condition.and = andConditions;
    }
    if (orConditions.length > 0) {
      condition.or = orConditions;
    }

    return condition;
  }

  /**
   * Evaluate a condition definition against an asset
   *
   * @param condition - Parsed condition definition
   * @param assetUri - URI of the asset to evaluate
   * @returns true if condition is satisfied
   */
  private async evaluateCondition(
    condition: ConditionDefinition,
    assetUri: string
  ): Promise<boolean> {
    // SPARQL ASK condition
    if (condition.sparql) {
      return this.evaluateSparqlCondition(condition.sparql, assetUri);
    }

    // Simple class check
    if (condition.assetClass) {
      return this.evaluateClassCondition(condition.assetClass, assetUri);
    }

    // Property check (existence or value)
    if (condition.hasProperty) {
      return this.evaluatePropertyCondition(
        condition.hasProperty,
        condition.propertyValue,
        assetUri
      );
    }

    // Logical operators
    if (condition.not) {
      return this.evaluateNotCondition(condition.not, assetUri);
    }

    if (condition.and) {
      return this.evaluateAndCondition(condition.and, assetUri);
    }

    if (condition.or) {
      return this.evaluateOrCondition(condition.or, assetUri);
    }

    // No conditions = always true
    return true;
  }

  /**
   * Evaluate SPARQL ASK condition
   * Simplified implementation: parses simple ASK patterns and checks using match()
   */
  private async evaluateSparqlCondition(
    sparqlQuery: string,
    assetUri: string
  ): Promise<boolean> {
    // Replace ?asset placeholder with actual asset URI
    const processedQuery = sparqlQuery.replace(/\?asset/g, `<${assetUri}>`);

    // Parse simple ASK patterns:
    // Pattern 1: ASK { <uri> a <class> }
    // Pattern 2: ASK { <uri> <predicate> 'value' }
    // Pattern 3: ASK { <uri> <predicate> ?var }

    const typePattern = /<([^>]+)>\s+a\s+<([^>]+)>/;
    const typeMatch = processedQuery.match(typePattern);
    if (typeMatch) {
      const [, subjectUri, classUri] = typeMatch;
      return this.evaluateClassCondition(classUri, subjectUri);
    }

    const literalPattern = /<([^>]+)>\s+<([^>]+)>\s+'([^']+)'/;
    const literalMatch = processedQuery.match(literalPattern);
    if (literalMatch) {
      const [, subjectUri, predicateUri, expectedValue] = literalMatch;
      return this.evaluatePropertyCondition(predicateUri, expectedValue, subjectUri);
    }

    const varPattern = /<([^>]+)>\s+<([^>]+)>\s+\?/;
    const varMatch = processedQuery.match(varPattern);
    if (varMatch) {
      const [, subjectUri, predicateUri] = varMatch;
      return this.evaluatePropertyCondition(predicateUri, undefined, subjectUri);
    }

    // Default: no match pattern recognized
    return false;
  }

  /**
   * Evaluate class check condition
   */
  private async evaluateClassCondition(
    expectedClass: string,
    assetUri: string
  ): Promise<boolean> {
    const assetIRI = new IRI(assetUri);
    const typeIRI = new IRI(RDF_TYPE);
    const triples = await this.tripleStore.match(assetIRI, typeIRI, undefined);

    for (const triple of triples) {
      const typeValue = this.getObjectValue(triple);
      if (typeValue === expectedClass) {
        return true;
      }
    }

    return false;
  }

  /**
   * Evaluate property existence or value check
   */
  private async evaluatePropertyCondition(
    propertyUri: string,
    expectedValue: string | number | boolean | undefined,
    assetUri: string
  ): Promise<boolean> {
    const assetIRI = new IRI(assetUri);
    const propertyIRI = new IRI(propertyUri);
    const triples = await this.tripleStore.match(assetIRI, propertyIRI, undefined);

    if (triples.length === 0) {
      return false;
    }

    // If no specific value expected, just check existence
    if (expectedValue === undefined) {
      return true;
    }

    // Check for specific value
    const expectedStr = String(expectedValue);
    for (const triple of triples) {
      const actualValue = this.getObjectValue(triple);
      if (actualValue === expectedStr) {
        return true;
      }
    }

    return false;
  }

  /**
   * Evaluate NOT condition (negation)
   */
  private async evaluateNotCondition(
    innerConditionUri: string,
    assetUri: string
  ): Promise<boolean> {
    const result = await this.evaluate(innerConditionUri, assetUri);
    return !result;
  }

  /**
   * Evaluate AND condition (conjunction)
   * Short-circuits on first false result
   */
  private async evaluateAndCondition(
    conditionUris: string[],
    assetUri: string
  ): Promise<boolean> {
    for (const conditionUri of conditionUris) {
      const result = await this.evaluate(conditionUri, assetUri);
      if (!result) {
        return false; // Short-circuit
      }
    }
    return true;
  }

  /**
   * Evaluate OR condition (disjunction)
   * Short-circuits on first true result
   */
  private async evaluateOrCondition(
    conditionUris: string[],
    assetUri: string
  ): Promise<boolean> {
    for (const conditionUri of conditionUris) {
      const result = await this.evaluate(conditionUri, assetUri);
      if (result) {
        return true; // Short-circuit
      }
    }
    return false;
  }

  /**
   * Extract predicate value from triple
   */
  private getPredicateValue(triple: Triple): string {
    const predicate = triple.predicate;
    return "value" in predicate ? predicate.value : String(predicate);
  }

  /**
   * Extract object value from triple
   */
  private getObjectValue(triple: Triple): string {
    const object = triple.object;
    if (object instanceof IRI) {
      return object.value;
    }
    if (object instanceof Literal) {
      return object.value;
    }
    if ("value" in object && typeof object.value === "string") {
      return object.value;
    }
    return String(object);
  }
}
