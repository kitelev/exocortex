import type { ITripleStore } from "../../../interfaces/ITripleStore";
import type {
  AlgebraOperation,
  BGPOperation,
  FilterOperation,
  JoinOperation,
  LeftJoinOperation,
  LateralJoinOperation,
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

export class ExoQLQueryExecutor {
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

      case "lateraljoin":
        yield* this.executeLateralJoin(operation);
        break;

      case "service":
        yield* this.executeService(operation);
        break;

      case "graph":
        yield* this.executeGraph(operation);
        break;

      default:
        throw new QueryExecutorError(`Unknown operation type: ${(operation as { type: string }).type}`);
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

    if (leftSolutions.length === 0) {
      return;
    }

    // Find shared variables between left results and right operation
    const leftVars = new Set<string>();
    for (const sol of leftSolutions) {
      for (const v of sol.variables()) {
        leftVars.add(v);
      }
    }
    const rightVars = this.collectOperationVariables(operation.right);
    const hasSharedVars = [...leftVars].some(v => rightVars.has(v));

    if (hasSharedVars) {
      // BIND JOIN: substitute shared variable bindings into right operand
      // before execution, enabling index lookups in the triple store.
      // Turns O(N*M) into O(N*selectivity) for cross-BGP joins.
      for (const leftSolution of leftSolutions) {
        const boundRight = this.substituteVariables(operation.right, leftSolution);
        for await (const rightSolution of this.execute(boundRight)) {
          const merged = leftSolution.merge(rightSolution);
          if (merged !== null) {
            yield merged;
          }
        }
      }
    } else {
      // HASH JOIN: no shared variables, collect right solutions once
      // then cross-product merge. Avoids re-executing right for each left.
      const rightSolutions: SolutionMapping[] = [];
      for await (const solution of this.execute(operation.right)) {
        rightSolutions.push(solution);
      }
      for (const leftSolution of leftSolutions) {
        for (const rightSolution of rightSolutions) {
          const merged = leftSolution.merge(rightSolution);
          if (merged !== null) {
            yield merged;
          }
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
    const { SolutionMapping: SM } = await import("../SolutionMapping");
    const projectedVars = new Set(operation.variables);
    for await (const solution of this.execute(operation.input)) {
      const projected = new SM();
      for (const variable of solution.variables()) {
        if (projectedVars.has(variable)) {
          const value = solution.get(variable);
          if (value !== undefined) {
            projected.set(variable, value);
          }
        }
      }
      yield projected;
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

    // Apply HAVING filter if present
    if (operation.having && operation.having.length > 0) {
      for (const result of results) {
        // All HAVING conditions must be true
        const passesHaving = operation.having.every((expr) => {
          const value = this.filterExecutor.evaluateExpression(expr, result);
          return value === true;
        });
        if (passesHaving) {
          yield result;
        }
      }
    } else {
      for (const result of results) {
        yield result;
      }
    }
  }

  private async *executeExtend(operation: ExtendOperation): AsyncIterableIterator<SolutionMapping> {
    for await (const solution of this.execute(operation.input)) {
      const clone = solution.clone();
      const value = this.evaluateExtendExpression(operation.expression, solution);
      if (value !== undefined) {
        clone.set(operation.variable, value as Parameters<SolutionMapping["set"]>[1]);
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
   * Execute a LATERAL join operation (SPARQL 1.2).
   *
   * LATERAL joins enable correlated subqueries where the inner query can
   * reference variables from the outer query. For each solution from the
   * outer (left) pattern, the inner (right) subquery is executed with
   * the outer bindings substituted, and the results are joined.
   *
   * This is fundamentally different from regular joins where both sides
   * are evaluated independently. LATERAL evaluation is:
   * 1. Execute left pattern to get outer solutions
   * 2. For each outer solution:
   *    a. Substitute outer variables in the inner pattern
   *    b. Execute the substituted inner pattern
   *    c. Join each inner result with the outer solution
   *
   * Use case: "top N per group" patterns
   * ```sparql
   * SELECT ?person ?topFriend WHERE {
   *   ?person a :Person .
   *   LATERAL {
   *     SELECT ?friend WHERE {
   *       ?person :knows ?friend .
   *     }
   *     ORDER BY DESC(?score)
   *     LIMIT 1
   *   }
   * }
   * ```
   *
   * SPARQL 1.2 spec: https://w3c.github.io/sparql-12/spec/
   */
  private async *executeLateralJoin(operation: LateralJoinOperation): AsyncIterableIterator<SolutionMapping> {
    // Collect all left (outer) solutions
    const leftSolutions: SolutionMapping[] = [];
    for await (const solution of this.execute(operation.left)) {
      leftSolutions.push(solution);
    }

    // For each outer solution, execute the inner pattern with substituted bindings
    for (const outerSolution of leftSolutions) {
      // Substitute outer variable bindings in the inner pattern
      // This is the key to correlated subqueries - the inner pattern
      // sees concrete values from the outer binding
      const substitutedPattern = this.substituteVariables(operation.right, outerSolution);

      // Execute the substituted inner subquery
      for await (const innerSolution of this.execute(substitutedPattern)) {
        // Merge the outer and inner solutions
        const merged = outerSolution.merge(innerSolution);
        if (merged !== null) {
          yield merged;
        }
      }
    }
  }

  /**
   * Substitute variable references in an algebra operation with concrete values
   * from a solution mapping. This is used for LATERAL join execution.
   *
   * @param operation - The algebra operation to substitute variables in
   * @param bindings - The solution mapping providing variable bindings
   * @returns A new operation with variables replaced by concrete values
   */
  private substituteVariables(operation: AlgebraOperation, bindings: SolutionMapping): AlgebraOperation {
    // Deep clone and substitute - using JSON for simplicity
    const cloned = JSON.parse(JSON.stringify(operation));
    return this.substituteInOperation(cloned, bindings);
  }

  /**
   * Recursively substitute variables in an operation with values from bindings.
   */
  private substituteInOperation(op: AlgebraOperation, bindings: SolutionMapping): AlgebraOperation {
    if (!op || typeof op !== 'object') {
      return op as AlgebraOperation;
    }

    // Use a mutable record view for generic property access across all operation types
    const opRecord = op as unknown as Record<string, unknown>;

    // Handle triple patterns in BGP
    if (op.type === 'bgp' && op.triples) {
      op.triples = op.triples.map((triple) => this.substituteInTriple(triple as unknown as Record<string, unknown>, bindings) as typeof triple);
      return op;
    }

    // Recursively process nested operations
    if (opRecord.input) {
      opRecord.input = this.substituteInOperation(opRecord.input as AlgebraOperation, bindings);
    }
    if (opRecord.left) {
      opRecord.left = this.substituteInOperation(opRecord.left as AlgebraOperation, bindings);
    }
    if (opRecord.right) {
      opRecord.right = this.substituteInOperation(opRecord.right as AlgebraOperation, bindings);
    }
    if (opRecord.pattern) {
      opRecord.pattern = this.substituteInOperation(opRecord.pattern as AlgebraOperation, bindings);
    }
    if (opRecord.query) {
      opRecord.query = this.substituteInOperation(opRecord.query as AlgebraOperation, bindings);
    }
    if (opRecord.where) {
      opRecord.where = this.substituteInOperation(opRecord.where as AlgebraOperation, bindings);
    }

    // Substitute variables in filter expressions (handles EXISTS/NOT EXISTS patterns)
    if (opRecord.expression) {
      this.substituteInExpression(opRecord.expression as Record<string, unknown>, bindings);
    }

    return op;
  }

  /**
   * Recursively substitute variables in filter expressions.
   * Primarily needed to handle EXISTS/NOT EXISTS patterns which contain
   * AlgebraOperations that need variable substitution for bind join correctness.
   */
  private substituteInExpression(expr: Record<string, unknown>, bindings: SolutionMapping): void {
    if (!expr || typeof expr !== 'object') return;

    // Handle EXISTS/NOT EXISTS patterns
    if (expr.type === 'exists' && expr.pattern) {
      expr.pattern = this.substituteInOperation(expr.pattern as AlgebraOperation, bindings);
    }

    // Recurse into sub-expressions
    if (expr.left) this.substituteInExpression(expr.left as Record<string, unknown>, bindings);
    if (expr.right) this.substituteInExpression(expr.right as Record<string, unknown>, bindings);
    if (expr.operands) {
      for (const op of expr.operands as Record<string, unknown>[]) {
        this.substituteInExpression(op, bindings);
      }
    }
    if (expr.args) {
      for (const arg of expr.args as Record<string, unknown>[]) {
        this.substituteInExpression(arg, bindings);
      }
    }
    if (expr.expression) {
      this.substituteInExpression(expr.expression as Record<string, unknown>, bindings);
    }
    if (expr.list) {
      for (const item of expr.list as Record<string, unknown>[]) {
        this.substituteInExpression(item, bindings);
      }
    }
  }

  /**
   * Substitute variables in a triple pattern with values from bindings.
   */
  private substituteInTriple(triple: Record<string, unknown>, bindings: SolutionMapping): unknown {
    return {
      subject: this.substituteInTripleElement(triple.subject as Record<string, unknown>, bindings),
      predicate: triple.predicate, // Predicate paths are not substituted
      object: this.substituteInTripleElement(triple.object as Record<string, unknown>, bindings),
    };
  }

  /**
   * Substitute a variable in a triple element if it has a binding.
   */
  private substituteInTripleElement(element: Record<string, unknown>, bindings: SolutionMapping): unknown {
    if (element && element.type === 'variable') {
      const value = bindings.get(element.value as string);
      if (value != null) {
        const valueRecord = value as unknown as Record<string, unknown>;
        // Convert RDF term to algebra representation
        if (value instanceof IRI || valueRecord.termType === 'NamedNode') {
          return { type: 'iri', value: (value as { value: string }).value };
        }
        // Handle Literal
        if (valueRecord.termType === 'Literal' || typeof valueRecord.value === 'string') {
          return {
            type: 'literal',
            value: valueRecord.value,
            datatype: (valueRecord.datatype as Record<string, unknown>)?.value ?? (valueRecord._datatype as Record<string, unknown>)?.value,
            language: valueRecord.language ?? valueRecord._language,
          };
        }
      }
    }
    return element;
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
      this: ExoQLQueryExecutor,
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
  ): unknown {
    if (expr.type === "aggregate") {
      // Aggregates in extend are handled at the group level
      return undefined;
    }

    // Use FilterExecutor's evaluateExpression for all other expression types
    // This handles: variable, literal, function (REPLACE, STR, etc.), comparison, logical
    try {
      return this.filterExecutor.evaluateExpression(expr, solution);
    } catch {
      return undefined;
    }
  }

  private getExpressionValue(expr: import("../algebra/AlgebraOperation").Expression, solution: SolutionMapping): unknown {
    if (expr.type === "variable") {
      const term = solution.get(expr.name);
      if (term) {
        return (term as { value?: string; id?: string }).value ?? (term as { value?: string; id?: string }).id ?? String(term);
      }
      return undefined;
    }
    if (expr.type === "literal") {
      return expr.value;
    }
    return undefined;
  }

  /**
   * Collect all variable names referenced in an algebra operation.
   * Used to find shared variables between join operands for bind join optimization.
   */
  private collectOperationVariables(operation: unknown): Set<string> {
    const vars = new Set<string>();
    this.collectVarsFromOperation(operation, vars);
    return vars;
  }

  private collectVarsFromOperation(operation: unknown, vars: Set<string>): void {
    if (!operation || typeof operation !== 'object') return;
    const op = operation as Record<string, unknown>;

    // Collect from BGP triple patterns
    if (op.type === 'bgp' && op.triples) {
      for (const triple of op.triples as Record<string, unknown>[]) {
        this.collectVarsFromElement(triple.subject, vars);
        if ((triple.predicate as Record<string, unknown>)?.type !== 'path') {
          this.collectVarsFromElement(triple.predicate, vars);
        }
        this.collectVarsFromElement(triple.object, vars);
      }
    }

    // Collect from VALUES
    if (op.type === 'values' && op.variables) {
      for (const v of op.variables as string[]) {
        vars.add(v);
      }
    }

    // Collect from filter expressions
    if (op.expression) {
      this.collectVarsFromExpressionTree(op.expression, vars);
    }

    // Collect from extend variable
    if (op.type === 'extend' && op.variable) {
      vars.add(op.variable as string);
    }

    // Recurse into nested operations
    if (op.input) this.collectVarsFromOperation(op.input, vars);
    if (op.left) this.collectVarsFromOperation(op.left, vars);
    if (op.right) this.collectVarsFromOperation(op.right, vars);
    if (op.pattern) this.collectVarsFromOperation(op.pattern, vars);
    if (op.query) this.collectVarsFromOperation(op.query, vars);
    if (op.where) this.collectVarsFromOperation(op.where, vars);
  }

  private collectVarsFromElement(element: unknown, vars: Set<string>): void {
    if (!element || typeof element !== 'object') return;
    const el = element as Record<string, unknown>;
    if (el.type === 'variable') {
      vars.add(el.value as string);
    }
    // Handle quoted triples
    if (el.type === 'quoted') {
      this.collectVarsFromElement(el.subject, vars);
      this.collectVarsFromElement(el.predicate, vars);
      this.collectVarsFromElement(el.object, vars);
    }
  }

  private collectVarsFromExpressionTree(expr: unknown, vars: Set<string>): void {
    if (!expr || typeof expr !== 'object') return;
    const e = expr as Record<string, unknown>;
    if (e.type === 'variable' && e.name) {
      vars.add(e.name as string);
    }
    // Handle EXISTS patterns
    if (e.type === 'exists' && e.pattern) {
      this.collectVarsFromOperation(e.pattern, vars);
    }
    if (e.left) this.collectVarsFromExpressionTree(e.left, vars);
    if (e.right) this.collectVarsFromExpressionTree(e.right, vars);
    if (e.operands) {
      for (const op of e.operands as unknown[]) {
        this.collectVarsFromExpressionTree(op, vars);
      }
    }
    if (e.args) {
      for (const arg of e.args as unknown[]) {
        this.collectVarsFromExpressionTree(arg, vars);
      }
    }
    if (e.expression) {
      this.collectVarsFromExpressionTree(e.expression, vars);
    }
    if (e.list) {
      for (const item of e.list as unknown[]) {
        this.collectVarsFromExpressionTree(item, vars);
      }
    }
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

/** @deprecated Use ExoQLQueryExecutor instead. Will be removed in a future release. */
export { ExoQLQueryExecutor as QueryExecutor };
