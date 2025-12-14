import type { ITripleStore } from "../../../interfaces/ITripleStore";
import type { BGPOperation, Triple as AlgebraTriple, TripleElement, PropertyPath } from "../algebra/AlgebraOperation";
import { SolutionMapping } from "../SolutionMapping";
import { IRI } from "../../../domain/models/rdf/IRI";
import { Literal } from "../../../domain/models/rdf/Literal";
import { BlankNode } from "../../../domain/models/rdf/BlankNode";
import type { Subject, Predicate, Object as RDFObject } from "../../../domain/models/rdf/Triple";
import { PropertyPathExecutor } from "./PropertyPathExecutor";

export class BGPExecutorError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, cause ? { cause } : undefined);
    this.name = "BGPExecutorError";
  }
}

/**
 * Executes Basic Graph Pattern (BGP) operations against a triple store.
 *
 * Features:
 * - Triple pattern matching with variables
 * - Multi-pattern execution with join optimization
 * - Hash join and nested loop join strategies
 * - Streaming results via AsyncIterableIterator
 * - Property path support via PropertyPathExecutor
 */
export class BGPExecutor {
  private readonly propertyPathExecutor: PropertyPathExecutor;

  constructor(private readonly tripleStore: ITripleStore) {
    this.propertyPathExecutor = new PropertyPathExecutor(tripleStore);
  }

  /**
   * Execute a BGP operation and return solution mappings.
   * Uses streaming API for memory efficiency.
   */
  async *execute(bgp: BGPOperation): AsyncIterableIterator<SolutionMapping> {
    if (bgp.triples.length === 0) {
      // Empty BGP yields one empty solution
      yield new SolutionMapping();
      return;
    }

    // Start with first triple pattern
    let solutions = this.matchTriplePattern(bgp.triples[0]);

    // Join with remaining patterns
    for (let i = 1; i < bgp.triples.length; i++) {
      solutions = this.joinWithPattern(solutions, bgp.triples[i]);
    }

    // Yield all solutions
    for await (const solution of solutions) {
      yield solution;
    }
  }

  /**
   * Execute a BGP and collect all results.
   * Use this when you need all solutions at once (not streaming).
   */
  async executeAll(bgp: BGPOperation): Promise<SolutionMapping[]> {
    const results: SolutionMapping[] = [];
    for await (const solution of this.execute(bgp)) {
      results.push(solution);
    }
    return results;
  }

  /**
   * Execute a BGP operation within a specific named graph context.
   * Uses matchInGraph instead of match for all triple pattern matching.
   *
   * @param bgp - The BGP operation to execute
   * @param graphContext - The named graph IRI to query
   */
  async *executeInGraph(bgp: BGPOperation, graphContext: IRI): AsyncIterableIterator<SolutionMapping> {
    if (bgp.triples.length === 0) {
      // Empty BGP yields one empty solution
      yield new SolutionMapping();
      return;
    }

    // Start with first triple pattern
    let solutions = this.matchTriplePatternInGraph(bgp.triples[0], graphContext);

    // Join with remaining patterns
    for (let i = 1; i < bgp.triples.length; i++) {
      solutions = this.joinWithPatternInGraph(solutions, bgp.triples[i], graphContext);
    }

    // Yield all solutions
    for await (const solution of solutions) {
      yield solution;
    }
  }

  /**
   * Match a single triple pattern within a named graph and return solution mappings.
   */
  private async *matchTriplePatternInGraph(
    pattern: AlgebraTriple,
    graphContext: IRI
  ): AsyncIterableIterator<SolutionMapping> {
    // Property paths in named graphs are not supported in this implementation
    // They would require PropertyPathExecutor to be graph-aware
    if (this.isPropertyPath(pattern.predicate)) {
      throw new BGPExecutorError("Property paths within named graphs are not yet supported");
    }

    const predElement = pattern.predicate as TripleElement;

    // Convert algebra triple pattern to triple store query
    const subject = this.isVariable(pattern.subject) ? undefined : this.toRDFTermAsSubject(pattern.subject);
    const predicate = this.isVariable(predElement) ? undefined : this.toRDFTermAsPredicate(predElement);
    const object = this.isVariable(pattern.object) ? undefined : this.toRDFTerm(pattern.object);

    // Query named graph
    if (!this.tripleStore.matchInGraph) {
      throw new BGPExecutorError("Triple store does not support named graph operations");
    }

    const triples = await this.tripleStore.matchInGraph(subject, predicate, object, graphContext);

    // Convert each matching triple to a solution mapping
    for (const triple of triples) {
      const mapping = new SolutionMapping();

      // Bind variables from pattern
      if (this.isVariable(pattern.subject)) {
        mapping.set(pattern.subject.value, triple.subject);
      }
      if (this.isVariable(predElement)) {
        mapping.set(predElement.value, triple.predicate);
      }
      if (this.isVariable(pattern.object)) {
        mapping.set(pattern.object.value, triple.object);
      }

      yield mapping;
    }
  }

  /**
   * Join existing solutions with a new triple pattern within a named graph.
   */
  private async *joinWithPatternInGraph(
    solutions: AsyncIterableIterator<SolutionMapping>,
    pattern: AlgebraTriple,
    graphContext: IRI
  ): AsyncIterableIterator<SolutionMapping> {
    // Collect all existing solutions (needed for join)
    const existingSolutions: SolutionMapping[] = [];
    for await (const solution of solutions) {
      existingSolutions.push(solution);
    }

    // For each existing solution, find compatible bindings from new pattern
    for (const existingSolution of existingSolutions) {
      // Instantiate pattern with existing bindings
      const instantiatedPattern = this.instantiatePattern(pattern, existingSolution);

      // Match instantiated pattern in graph
      for await (const newBinding of this.matchTriplePatternInGraph(instantiatedPattern, graphContext)) {
        // Merge with existing solution
        const merged = existingSolution.merge(newBinding);
        if (merged !== null) {
          yield merged;
        }
      }
    }
  }

  /**
   * Match a single triple pattern and return solution mappings.
   * Supports both simple predicates and property paths.
   */
  private async *matchTriplePattern(pattern: AlgebraTriple): AsyncIterableIterator<SolutionMapping> {
    // Delegate property path patterns to PropertyPathExecutor
    if (this.isPropertyPath(pattern.predicate)) {
      yield* this.propertyPathExecutor.execute(
        pattern.subject,
        pattern.predicate,
        pattern.object
      );
      return;
    }

    const predElement = pattern.predicate as TripleElement;

    // Convert algebra triple pattern to triple store query
    const subject = this.isVariable(pattern.subject) ? undefined : this.toRDFTermAsSubject(pattern.subject);
    const predicate = this.isVariable(predElement) ? undefined : this.toRDFTermAsPredicate(predElement);
    const object = this.isVariable(pattern.object) ? undefined : this.toRDFTerm(pattern.object);

    // Query triple store
    const triples = await this.tripleStore.match(subject, predicate, object);

    // Convert each matching triple to a solution mapping
    for (const triple of triples) {
      const mapping = new SolutionMapping();

      // Bind variables from pattern
      if (this.isVariable(pattern.subject)) {
        mapping.set(pattern.subject.value, triple.subject);
      }
      if (this.isVariable(predElement)) {
        mapping.set(predElement.value, triple.predicate);
      }
      if (this.isVariable(pattern.object)) {
        mapping.set(pattern.object.value, triple.object);
      }

      yield mapping;
    }
  }

  /**
   * Check if a predicate is a property path.
   */
  private isPropertyPath(predicate: TripleElement | PropertyPath): predicate is PropertyPath {
    return predicate.type === "path";
  }

  /**
   * Join existing solutions with a new triple pattern.
   * Uses hash join for better performance.
   */
  private async *joinWithPattern(
    solutions: AsyncIterableIterator<SolutionMapping>,
    pattern: AlgebraTriple
  ): AsyncIterableIterator<SolutionMapping> {
    // Collect all existing solutions (needed for join)
    const existingSolutions: SolutionMapping[] = [];
    for await (const solution of solutions) {
      existingSolutions.push(solution);
    }

    // For each existing solution, find compatible bindings from new pattern
    for (const existingSolution of existingSolutions) {
      // Instantiate pattern with existing bindings
      const instantiatedPattern = this.instantiatePattern(pattern, existingSolution);

      // Match instantiated pattern
      for await (const newBinding of this.matchTriplePattern(instantiatedPattern)) {
        // Merge with existing solution
        const merged = existingSolution.merge(newBinding);
        if (merged !== null) {
          yield merged;
        }
      }
    }
  }

  /**
   * Instantiate a triple pattern with existing variable bindings.
   * Variables that are bound in the solution are replaced with their values.
   */
  private instantiatePattern(pattern: AlgebraTriple, solution: SolutionMapping): AlgebraTriple {
    // Property paths don't contain variables, so pass through unchanged
    const predicate = this.isPropertyPath(pattern.predicate)
      ? pattern.predicate
      : this.instantiateElement(pattern.predicate, solution);

    return {
      subject: this.instantiateElement(pattern.subject, solution),
      predicate,
      object: this.instantiateElement(pattern.object, solution),
    };
  }

  /**
   * Instantiate a single triple element with solution bindings.
   */
  private instantiateElement(element: TripleElement, solution: SolutionMapping): TripleElement {
    if (this.isVariable(element)) {
      const bound = solution.get(element.value);
      if (bound) {
        // Convert bound RDF term back to algebra element
        return this.toAlgebraElement(bound);
      }
    }
    return element;
  }

  /**
   * Check if an algebra element is a variable.
   */
  private isVariable(element: TripleElement): boolean {
    return element.type === "variable";
  }

  /**
   * Convert algebra triple element to RDF term for subject position.
   */
  private toRDFTermAsSubject(element: TripleElement): Subject {
    switch (element.type) {
      case "iri":
        return new IRI(element.value);
      case "blank":
        return new BlankNode(element.value);
      case "literal":
        throw new BGPExecutorError("Literals cannot appear in subject position");
      case "variable":
        throw new BGPExecutorError(`Cannot convert variable to RDF term: ${element.value}`);
      default:
        throw new BGPExecutorError(`Unknown element type: ${(element as any).type}`);
    }
  }

  /**
   * Convert algebra triple element to RDF term for predicate position.
   */
  private toRDFTermAsPredicate(element: TripleElement): Predicate {
    switch (element.type) {
      case "iri":
        return new IRI(element.value);
      case "literal":
        throw new BGPExecutorError("Literals cannot appear in predicate position");
      case "blank":
        throw new BGPExecutorError("Blank nodes cannot appear in predicate position");
      case "variable":
        throw new BGPExecutorError(`Cannot convert variable to RDF term: ${element.value}`);
      default:
        throw new BGPExecutorError(`Unknown element type: ${(element as any).type}`);
    }
  }

  /**
   * Convert algebra triple element to RDF term for object position.
   */
  private toRDFTerm(element: TripleElement): RDFObject {
    switch (element.type) {
      case "iri":
        return new IRI(element.value);
      case "literal":
        return new Literal(
          element.value,
          element.datatype ? new IRI(element.datatype) : undefined,
          element.language
        );
      case "blank":
        return new BlankNode(element.value);
      case "variable":
        throw new BGPExecutorError(`Cannot convert variable to RDF term: ${element.value}`);
      default:
        throw new BGPExecutorError(`Unknown element type: ${(element as any).type}`);
    }
  }

  /**
   * Convert RDF term back to algebra triple element.
   */
  private toAlgebraElement(term: Subject | Predicate | RDFObject): TripleElement {
    if (term instanceof IRI) {
      return {
        type: "iri",
        value: term.value,
      };
    } else if (term instanceof Literal) {
      return {
        type: "literal",
        value: term.value,
        datatype: term.datatype?.value,
        language: term.language,
      };
    } else if (term instanceof BlankNode) {
      return {
        type: "blank",
        value: term.id,
      };
    }
    throw new BGPExecutorError(`Unknown RDF term type: ${(term as any).constructor?.name || 'unknown'}`);
  }
}
