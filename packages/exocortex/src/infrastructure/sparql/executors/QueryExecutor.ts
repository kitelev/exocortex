import type { ITripleStore } from "../../../interfaces/ITripleStore";
import type {
  AlgebraOperation,
  BGPOperation,
  FilterOperation,
  JoinOperation,
  LeftJoinOperation,
  UnionOperation,
  MinusOperation,
  ValuesOperation,
  ProjectOperation,
  OrderByOperation,
  SliceOperation,
  DistinctOperation,
  ReducedOperation,
  GroupOperation,
  ExtendOperation,
  SubqueryOperation,
  ConstructOperation,
  AskOperation,
  ServiceOperation,
  GraphOperation,
} from "../algebra/AlgebraOperation";
import type { SolutionMapping } from "../SolutionMapping";
import type { Triple } from "../../../domain/models/rdf/Triple";
import { BGPExecutor } from "./BGPExecutor";
import { FilterExecutor } from "./FilterExecutor";
import { OptionalExecutor } from "./OptionalExecutor";
import { UnionExecutor } from "./UnionExecutor";
import { MinusExecutor } from "./MinusExecutor";
import { ValuesExecutor } from "./ValuesExecutor";
import { AggregateExecutor } from "./AggregateExecutor";
import { ConstructExecutor } from "./ConstructExecutor";
import { ServiceExecutor, ServiceExecutorConfig } from "./ServiceExecutor";
import { GraphExecutor } from "./GraphExecutor";
import { SPARQLGenerator } from "../algebra/SPARQLGenerator";
import { IRI } from "../../../domain/models/rdf/IRI";

export class QueryExecutorError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, cause ? { cause } : undefined);
    this.name = "QueryExecutorError";
  }
}

/**
 * Executes SPARQL algebra operations against a triple store.
 * Coordinates all specialized executors (BGP, Filter, Join, etc.)
 * to produce query results.
 */
/**
 * Configuration options for QueryExecutor.
 */
export interface QueryExecutorConfig {
  /**
   * Configuration for the ServiceExecutor (federated queries).
   */
  serviceConfig?: ServiceExecutorConfig;
}

export class QueryExecutor {
  private readonly tripleStore: ITripleStore;
  private readonly bgpExecutor: BGPExecutor;
  private readonly filterExecutor: FilterExecutor;
  private readonly optionalExecutor: OptionalExecutor;
  private readonly unionExecutor: UnionExecutor;
  private readonly minusExecutor: MinusExecutor;
  private readonly valuesExecutor: ValuesExecutor;
  private readonly aggregateExecutor: AggregateExecutor;
  private readonly constructExecutor: ConstructExecutor;
  private readonly serviceExecutor: ServiceExecutor;
  private readonly graphExecutor: GraphExecutor;
  private readonly sparqlGenerator: SPARQLGenerator;

  /** Current graph context for GRAPH clause execution */
  private currentGraphContext?: IRI;

  constructor(tripleStore: ITripleStore, config: QueryExecutorConfig = {}) {
    this.tripleStore = tripleStore;
    this.bgpExecutor = new BGPExecutor(tripleStore);
    this.filterExecutor = new FilterExecutor();
    this.optionalExecutor = new OptionalExecutor();
    this.unionExecutor = new UnionExecutor();
    this.minusExecutor = new MinusExecutor();
    this.valuesExecutor = new ValuesExecutor();
    this.aggregateExecutor = new AggregateExecutor();
    this.constructExecutor = new ConstructExecutor();
    this.serviceExecutor = new ServiceExecutor(config.serviceConfig);
    this.graphExecutor = new GraphExecutor(tripleStore);
    this.sparqlGenerator = new SPARQLGenerator();

    // Set up EXISTS evaluator for FilterExecutor
    this.filterExecutor.setExistsEvaluator(async (pattern, solution) => {
      return this.evaluateExistsPattern(pattern, solution);
    });

    // Set up triple store for UUID lookup functions (exo:byUUID)
    this.filterExecutor.setTripleStore(tripleStore);
  }

  /**
   * Evaluate an EXISTS pattern with current solution bindings.
   * Returns true if the pattern produces at least one result when
   * variables bound in the solution are substituted.
   */
  private async evaluateExistsPattern(
    pattern: AlgebraOperation,
    solution: SolutionMapping
  ): Promise<boolean> {
    // Execute the pattern and check if any result is found
    // The pattern is evaluated against the full triple store,
    // but we need to join with current bindings
    for await (const result of this.execute(pattern)) {
      // Check if result is compatible with current solution
      const merged = solution.merge(result);
      if (merged !== null) {
        return true; // Found at least one compatible result
      }
    }
    return false;
  }

  /**
   * Execute an algebra operation and return solution mappings.
   */
  async executeAll(operation: AlgebraOperation): Promise<SolutionMapping[]> {
    const results: SolutionMapping[] = [];
    for await (const solution of this.execute(operation)) {
      results.push(solution);
    }
    return results;
  }

  /**
   * Execute an algebra operation and stream solution mappings.
   */
  async *execute(operation: AlgebraOperation): AsyncIterableIterator<SolutionMapping> {
    switch (operation.type) {
      case "bgp":
        yield* this.executeBGP(operation);
        break;

      case "filter":
        yield* this.executeFilter(operation);
        break;

      case "join":
        yield* this.executeJoin(operation);
        break;

      case "leftjoin":
        yield* this.executeLeftJoin(operation);
        break;

      case "union":
        yield* this.executeUnion(operation);
        break;

      case "minus":
        yield* this.executeMinus(operation);
        break;

      case "values":
        yield* this.executeValues(operation);
        break;

      case "project":
        yield* this.executeProject(operation);
        break;

      case "orderby":
        yield* this.executeOrderBy(operation);
        break;

      case "slice":
        yield* this.executeSlice(operation);
        break;

      case "distinct":
        yield* this.executeDistinct(operation);
        break;

      case "reduced":
        yield* this.executeReduced(operation);
        break;

      case "group":
        yield* this.executeGroup(operation);
        break;

      case "extend":
        yield* this.executeExtend(operation);
        break;

      case "subquery":
        yield* this.executeSubquery(operation);
        break;

      case "service":
        yield* this.executeService(operation);
        break;

      case "graph":
        yield* this.executeGraph(operation);
        break;

      default:
        throw new QueryExecutorError(`Unknown operation type: ${(operation as any).type}`);
    }
  }

  private async *executeBGP(operation: BGPOperation): AsyncIterableIterator<SolutionMapping> {
    yield* this.bgpExecutor.execute(operation);
  }

  private async *executeFilter(operation: FilterOperation): AsyncIterableIterator<SolutionMapping> {
    const inputSolutions = this.execute(operation.input);
    yield* this.filterExecutor.execute(operation, inputSolutions);
  }

  private async *executeJoin(operation: JoinOperation): AsyncIterableIterator<SolutionMapping> {
    // Collect left solutions
    const leftSolutions: SolutionMapping[] = [];
    for await (const solution of this.execute(operation.left)) {
      leftSolutions.push(solution);
    }

    // For each left solution, execute right and merge compatible
    for (const leftSolution of leftSolutions) {
      for await (const rightSolution of this.execute(operation.right)) {
        const merged = leftSolution.merge(rightSolution);
        if (merged !== null) {
          yield merged;
        }
      }
    }
  }

  private async *executeLeftJoin(operation: LeftJoinOperation): AsyncIterableIterator<SolutionMapping> {
    // Collect solutions from both sides
    const leftSolutions: SolutionMapping[] = [];
    for await (const solution of this.execute(operation.left)) {
      leftSolutions.push(solution);
    }

    const rightSolutions: SolutionMapping[] = [];
    for await (const solution of this.execute(operation.right)) {
      rightSolutions.push(solution);
    }

    // Use OptionalExecutor for left join semantics
    async function* leftGen() {
      for (const s of leftSolutions) yield s;
    }
    async function* rightGen() {
      for (const s of rightSolutions) yield s;
    }

    yield* this.optionalExecutor.execute(leftGen(), rightGen());
  }

  private async *executeUnion(operation: UnionOperation): AsyncIterableIterator<SolutionMapping> {
    // Collect solutions from both sides
    const leftSolutions: SolutionMapping[] = [];
    for await (const solution of this.execute(operation.left)) {
      leftSolutions.push(solution);
    }

    const rightSolutions: SolutionMapping[] = [];
    for await (const solution of this.execute(operation.right)) {
      rightSolutions.push(solution);
    }

    // Use UnionExecutor
    async function* leftGen() {
      for (const s of leftSolutions) yield s;
    }
    async function* rightGen() {
      for (const s of rightSolutions) yield s;
    }

    yield* this.unionExecutor.execute(leftGen(), rightGen());
  }

  private async *executeMinus(operation: MinusOperation): AsyncIterableIterator<SolutionMapping> {
    // Collect solutions from both sides
    const leftSolutions: SolutionMapping[] = [];
    for await (const solution of this.execute(operation.left)) {
      leftSolutions.push(solution);
    }

    const rightSolutions: SolutionMapping[] = [];
    for await (const solution of this.execute(operation.right)) {
      rightSolutions.push(solution);
    }

    // Use MinusExecutor for set difference
    async function* leftGen() {
      for (const s of leftSolutions) yield s;
    }
    async function* rightGen() {
      for (const s of rightSolutions) yield s;
    }

    yield* this.minusExecutor.execute(leftGen(), rightGen());
  }

  private async *executeValues(operation: ValuesOperation): AsyncIterableIterator<SolutionMapping> {
    yield* this.valuesExecutor.execute(operation);
  }

  private async *executeProject(operation: ProjectOperation): AsyncIterableIterator<SolutionMapping> {
    // Project passes through to input, variable filtering happens at result formatting
    for await (const solution of this.execute(operation.input)) {
      yield solution;
    }
  }

  private async *executeOrderBy(operation: OrderByOperation): AsyncIterableIterator<SolutionMapping> {
    // Collect all solutions for sorting
    const solutions: SolutionMapping[] = [];
    for await (const solution of this.execute(operation.input)) {
      solutions.push(solution);
    }

    // Sort by comparators
    solutions.sort((a, b) => {
      for (const comparator of operation.comparators) {
        const aValue = this.getExpressionValue(comparator.expression, a);
        const bValue = this.getExpressionValue(comparator.expression, b);

        let comparison = 0;
        if (aValue === undefined && bValue === undefined) {
          comparison = 0;
        } else if (aValue === undefined) {
          comparison = 1; // undefined values go last
        } else if (bValue === undefined) {
          comparison = -1;
        } else if (typeof aValue === "number" && typeof bValue === "number") {
          comparison = aValue - bValue;
        } else {
          comparison = String(aValue).localeCompare(String(bValue));
        }

        if (comparator.descending) {
          comparison = -comparison;
        }

        if (comparison !== 0) {
          return comparison;
        }
      }
      return 0;
    });

    for (const solution of solutions) {
      yield solution;
    }
  }

  private async *executeSlice(operation: SliceOperation): AsyncIterableIterator<SolutionMapping> {
    let count = 0;
    const offset = operation.offset ?? 0;
    const limit = operation.limit;

    for await (const solution of this.execute(operation.input)) {
      if (count >= offset) {
        if (limit !== undefined && count - offset >= limit) {
          break;
        }
        yield solution;
      }
      count++;
    }
  }

  private async *executeDistinct(operation: DistinctOperation): AsyncIterableIterator<SolutionMapping> {
    const seen = new Set<string>();

    for await (const solution of this.execute(operation.input)) {
      const key = this.getSolutionKey(solution);
      if (!seen.has(key)) {
        seen.add(key);
        yield solution;
      }
    }
  }

  /**
   * Execute REDUCED modifier.
   * SPARQL 1.1 spec (Section 15.3) allows implementations to eliminate
   * some or all duplicates. This implementation treats REDUCED identically
   * to DISTINCT (full duplicate elimination) which is allowed by spec.
   */
  private async *executeReduced(operation: ReducedOperation): AsyncIterableIterator<SolutionMapping> {
    // Per SPARQL 1.1 spec, REDUCED may eliminate duplicates but is not required to.
    // We choose to eliminate all duplicates (same as DISTINCT) for simplicity.
    const seen = new Set<string>();

    for await (const solution of this.execute(operation.input)) {
      const key = this.getSolutionKey(solution);
      if (!seen.has(key)) {
        seen.add(key);
        yield solution;
      }
    }
  }

  private async *executeGroup(operation: GroupOperation): AsyncIterableIterator<SolutionMapping> {
    // Collect all input solutions
    const inputSolutions: SolutionMapping[] = [];
    for await (const solution of this.execute(operation.input)) {
      inputSolutions.push(solution);
    }

    // Use AggregateExecutor to compute grouped results
    const results = this.aggregateExecutor.execute(operation, inputSolutions);
    for (const result of results) {
      yield result;
    }
  }

  private async *executeExtend(operation: ExtendOperation): AsyncIterableIterator<SolutionMapping> {
    for await (const solution of this.execute(operation.input)) {
      const clone = solution.clone();
      const value = this.evaluateExtendExpression(operation.expression, solution);
      if (value !== undefined) {
        clone.set(operation.variable, value);
      }
      yield clone;
    }
  }

  /**
   * Execute a subquery.
   * Subqueries are complete SELECT queries that produce solution mappings
   * which are then joined with the outer query. The inner query is executed
   * independently and its results are yielded back to be processed by the
   * outer query's join/pattern matching.
   */
  private async *executeSubquery(operation: SubqueryOperation): AsyncIterableIterator<SolutionMapping> {
    // Execute the inner query and yield its results
    // The inner query has already been translated to algebra (project, filter, etc.)
    // so we just recursively execute it
    yield* this.execute(operation.query);
  }

  /**
   * Execute a SERVICE operation for federated queries.
   *
   * SERVICE clauses allow querying remote SPARQL endpoints. The inner pattern
   * is converted to a SPARQL query string, sent to the remote endpoint via HTTP,
   * and the results are converted to SolutionMappings for joining with local patterns.
   *
   * SILENT mode: When silent is true, errors from the remote endpoint are
   * suppressed and an empty result set is returned instead of failing.
   *
   * SPARQL 1.1 Federated Query specification:
   * https://www.w3.org/TR/sparql11-federated-query/
   */
  private async *executeService(operation: ServiceOperation): AsyncIterableIterator<SolutionMapping> {
    yield* this.serviceExecutor.execute(operation, (pattern) => {
      return this.sparqlGenerator.generateSelect(pattern);
    });
  }

  /**
   * Execute a GRAPH operation for named graph queries.
   *
   * GRAPH clauses restrict pattern matching to a specific named graph.
   * When the graph name is a variable, it iterates over all named graphs
   * and binds the variable to each graph's IRI.
   *
   * SPARQL 1.1 spec Section 13.3:
   * https://www.w3.org/TR/sparql11-query/#queryDataset
   */
  private async *executeGraph(operation: GraphOperation): AsyncIterableIterator<SolutionMapping> {
    // Create a pattern executor that respects graph context
    const executePatternInGraph = async function* (
      this: QueryExecutor,
      pattern: AlgebraOperation,
      graphContext?: IRI
    ): AsyncIterableIterator<SolutionMapping> {
      // Save current graph context
      const previousContext = this.currentGraphContext;
      this.currentGraphContext = graphContext;

      try {
        // Execute the pattern
        // For BGP operations, we need to match in the specific graph
        if (pattern.type === "bgp" && graphContext && this.tripleStore.matchInGraph) {
          yield* this.executeBGPInGraph(pattern, graphContext);
        } else {
          yield* this.execute(pattern);
        }
      } finally {
        // Restore previous graph context
        this.currentGraphContext = previousContext;
      }
    }.bind(this);

    yield* this.graphExecutor.execute(operation, executePatternInGraph);
  }

  /**
   * Execute a BGP operation within a specific named graph context.
   */
  private async *executeBGPInGraph(
    operation: BGPOperation,
    graphContext: IRI
  ): AsyncIterableIterator<SolutionMapping> {
    // Create a graph-scoped BGPExecutor by using matchInGraph
    // This is a simplified approach - for full support, BGPExecutor would need refactoring
    // For now, we create a temporary store proxy that uses matchInGraph

    // If no triples in the pattern, return empty solution
    if (operation.triples.length === 0) {
      const { SolutionMapping } = await import("../SolutionMapping");
      yield new SolutionMapping();
      return;
    }

    // Execute BGP through the graph-scoped store
    // For simplicity, we'll use the regular BGPExecutor with filtered triples
    // The BGPExecutor will call match() on the store - we need to intercept this

    // Alternative approach: temporarily scope the triple store
    // For MVP, we'll use a simpler approach where GRAPH queries work with
    // the tripleStore.matchInGraph method directly

    // For each triple pattern in the BGP, we need to match against the named graph
    yield* this.bgpExecutor.executeInGraph(operation, graphContext);
  }

  private evaluateExtendExpression(
    expr: ExtendOperation["expression"],
    solution: SolutionMapping
  ): any {
    if (expr.type === "aggregate") {
      // Aggregates in extend are handled at the group level
      return undefined;
    }

    // Use FilterExecutor's evaluateExpression for all other expression types
    // This handles: variable, literal, function (REPLACE, STR, etc.), comparison, logical
    try {
      return this.filterExecutor.evaluateExpression(expr as any, solution);
    } catch {
      return undefined;
    }
  }

  private getExpressionValue(expr: any, solution: SolutionMapping): any {
    if (expr.type === "variable") {
      const term = solution.get(expr.name);
      if (term) {
        return (term as any).value ?? (term as any).id ?? String(term);
      }
      return undefined;
    }
    return expr.value;
  }

  private getSolutionKey(solution: SolutionMapping): string {
    const json = solution.toJSON();
    const keys = Object.keys(json).sort();
    return keys.map((k) => `${k}=${json[k]}`).join("|");
  }

  /**
   * Check if an algebra operation is a CONSTRUCT query.
   */
  isConstructQuery(operation: AlgebraOperation): operation is ConstructOperation {
    return operation.type === "construct";
  }

  /**
   * Execute a CONSTRUCT query and return generated triples.
   * This is the primary method for executing CONSTRUCT queries.
   *
   * @param operation - A CONSTRUCT algebra operation
   * @returns Array of generated RDF triples
   * @throws QueryExecutorError if operation is not a CONSTRUCT
   */
  async executeConstruct(operation: ConstructOperation): Promise<Triple[]> {
    if (operation.type !== "construct") {
      throw new QueryExecutorError("executeConstruct requires a CONSTRUCT operation");
    }

    // Execute the WHERE clause to get solution mappings
    const solutions = await this.executeAll(operation.where);

    // Apply the template to generate triples
    return this.constructExecutor.execute(operation.template, solutions);
  }

  /**
   * Check if an algebra operation is an ASK query.
   */
  isAskQuery(operation: AlgebraOperation): operation is AskOperation {
    return operation.type === "ask";
  }

  /**
   * Execute an ASK query and return boolean result.
   * This is the primary method for executing ASK queries.
   *
   * SPARQL 1.1 spec (Section 16.3): ASK queries test whether a pattern
   * matches and return true if there is at least one solution, false otherwise.
   *
   * @param operation - An ASK algebra operation
   * @returns true if the pattern matches at least one solution, false otherwise
   * @throws QueryExecutorError if operation is not an ASK
   */
  async executeAsk(operation: AskOperation): Promise<boolean> {
    if (operation.type !== "ask") {
      throw new QueryExecutorError("executeAsk requires an ASK operation");
    }

    // Execute the WHERE clause and check if any solution is found
    // Early termination: we only need to know if at least one solution exists
    for await (const _solution of this.execute(operation.where)) {
      return true; // Found at least one solution
    }

    return false; // No solutions found
  }
}
