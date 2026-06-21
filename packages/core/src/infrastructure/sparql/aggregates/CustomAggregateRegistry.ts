import { Literal } from "../../../domain/models/rdf/Literal";
import { IRI } from "../../../domain/models/rdf/IRI";

/**
 * State maintained by a custom aggregate during accumulation.
 * Each aggregate can define its own state structure.
 */
export interface AggregateState {
  [key: string]: unknown;
}

/**
 * RDF Term type - union of types that can be bound in SPARQL results.
 */
export type Term = Literal | IRI | string | number | boolean | null | undefined;

/**
 * Interface for custom aggregate functions.
 *
 * SPARQL 1.2 allows defining custom aggregate functions beyond the built-in
 * SUM, AVG, COUNT, MIN, MAX, GROUP_CONCAT, SAMPLE.
 *
 * A custom aggregate must implement three phases:
 * 1. init() - Create initial accumulator state
 * 2. step() - Update state with each value in the group
 * 3. finalize() - Compute final result from accumulated state
 *
 * Example usage:
 * ```sparql
 * PREFIX agg: <http://example.org/aggregates/>
 *
 * SELECT ?category (agg:median(?price) AS ?medianPrice)
 * WHERE {
 *   ?product :category ?category ;
 *            :price ?price .
 * }
 * GROUP BY ?category
 * ```
 */
export interface CustomAggregate {
  /**
   * Initialize the accumulator state for a new group.
   * Called once at the start of processing each group.
   *
   * @returns Initial state object for accumulation
   */
  init(): AggregateState;

  /**
   * Process a single value from the group.
   * Called for each bound value in the group.
   *
   * @param state - Current accumulator state
   * @param value - The term to accumulate (may be null/undefined for unbound)
   */
  step(state: AggregateState, value: Term): void;

  /**
   * Compute the final aggregate result from accumulated state.
   * Called once after all values have been processed.
   *
   * @param state - Final accumulator state
   * @returns The aggregate result as a Literal
   */
  finalize(state: AggregateState): Literal;
}

/**
 * Error thrown when a custom aggregate operation fails.
 */
export class CustomAggregateError extends Error {
  constructor(message: string, public readonly iri?: string) {
    super(message);
    this.name = "CustomAggregateError";
  }
}

/**
 * Registry for custom aggregate functions.
 *
 * This registry allows runtime registration of custom aggregates that can be
 * used in SPARQL queries. Custom aggregates are identified by their IRI.
 *
 * Example:
 * ```typescript
 * const registry = CustomAggregateRegistry.getInstance();
 *
 * registry.register("http://example.org/aggregates/median", {
 *   init: () => ({ values: [] }),
 *   step: (state, value) => {
 *     if (value !== null && value !== undefined) {
 *       state.values.push(getNumericValue(value));
 *     }
 *   },
 *   finalize: (state) => {
 *     const sorted = state.values.sort((a, b) => a - b);
 *     const mid = Math.floor(sorted.length / 2);
 *     const median = sorted.length % 2 !== 0
 *       ? sorted[mid]
 *       : (sorted[mid - 1] + sorted[mid]) / 2;
 *     return createDecimalLiteral(median);
 *   }
 * });
 * ```
 */
export class CustomAggregateRegistry {
  private static instance: CustomAggregateRegistry | null = null;
  private readonly aggregates = new Map<string, CustomAggregate>();

  /**
   * Get the singleton instance of the registry.
   * Creates the instance if it doesn't exist.
   */
  static getInstance(): CustomAggregateRegistry {
    if (!CustomAggregateRegistry.instance) {
      CustomAggregateRegistry.instance = new CustomAggregateRegistry();
    }
    return CustomAggregateRegistry.instance;
  }

  /**
   * Reset the singleton instance (mainly for testing).
   */
  static resetInstance(): void {
    if (CustomAggregateRegistry.instance) {
      CustomAggregateRegistry.instance.clear();
    }
    CustomAggregateRegistry.instance = null;
  }

  /**
   * Register a custom aggregate function.
   *
   * @param iri - The IRI identifying the aggregate function
   * @param aggregate - The aggregate implementation
   * @throws CustomAggregateError if IRI is already registered
   */
  register(iri: string, aggregate: CustomAggregate): void {
    if (!iri || typeof iri !== "string") {
      throw new CustomAggregateError("Aggregate IRI must be a non-empty string");
    }
    if (!aggregate || typeof aggregate.init !== "function" ||
        typeof aggregate.step !== "function" ||
        typeof aggregate.finalize !== "function") {
      throw new CustomAggregateError(
        "Aggregate must implement init(), step(), and finalize() methods",
        iri
      );
    }
    if (this.aggregates.has(iri)) {
      throw new CustomAggregateError(
        `Aggregate with IRI "${iri}" is already registered`,
        iri
      );
    }
    this.aggregates.set(iri, aggregate);
  }

  /**
   * Unregister a custom aggregate function.
   *
   * @param iri - The IRI of the aggregate to remove
   * @returns true if the aggregate was removed, false if it wasn't registered
   */
  unregister(iri: string): boolean {
    return this.aggregates.delete(iri);
  }

  /**
   * Get a registered custom aggregate by IRI.
   *
   * @param iri - The IRI of the aggregate
   * @returns The aggregate implementation or undefined if not found
   */
  get(iri: string): CustomAggregate | undefined {
    return this.aggregates.get(iri);
  }

  /**
   * Check if a custom aggregate is registered.
   *
   * @param iri - The IRI to check
   * @returns true if registered, false otherwise
   */
  has(iri: string): boolean {
    return this.aggregates.has(iri);
  }

  /**
   * Get all registered aggregate IRIs.
   *
   * @returns Array of registered IRIs
   */
  getRegisteredIris(): string[] {
    return Array.from(this.aggregates.keys());
  }

  /**
   * Clear all registered aggregates.
   */
  clear(): void {
    this.aggregates.clear();
  }

  /**
   * Get the number of registered aggregates.
   */
  get size(): number {
    return this.aggregates.size;
  }
}
