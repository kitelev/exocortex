import type { ITripleStore } from "../../../interfaces/ITripleStore";
import type {
  BGPOperation,
  Triple as AlgebraTriple,
  TripleElement,
  PropertyPath,
  QuotedTriple as AlgebraQuotedTriple,
  Variable as AlgebraVariable,
} from "../algebra/AlgebraOperation";
import { SolutionMapping } from "../SolutionMapping";
import { IRI } from "../../../domain/models/rdf/IRI";
import { Literal } from "../../../domain/models/rdf/Literal";
import { BlankNode } from "../../../domain/models/rdf/BlankNode";
import { QuotedTriple } from "../../../domain/models/rdf/QuotedTriple";
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
   * Also supports RDF-Star quoted triples in subject/object positions.
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
    // For quoted triples with variables inside, we need to match against undefined
    // and then filter/bind variables in post-processing
    const subject = this.isVariable(pattern.subject)
      ? undefined
      : (this.isQuotedTriple(pattern.subject) && this.hasVariablesInQuotedTriple(pattern.subject))
        ? undefined  // Can't directly match quoted triples with variables
        : this.toRDFTermAsSubject(pattern.subject);

    const predicate = this.isVariable(predElement) ? undefined : this.toRDFTermAsPredicate(predElement);

    const object = this.isVariable(pattern.object)
      ? undefined
      : (this.isQuotedTriple(pattern.object) && this.hasVariablesInQuotedTriple(pattern.object))
        ? undefined  // Can't directly match quoted triples with variables
        : this.toRDFTerm(pattern.object);

    // Query triple store
    const triples = await this.tripleStore.match(subject, predicate, object);

    // Convert each matching triple to a solution mapping
    for (const triple of triples) {
      const mapping = new SolutionMapping();

      // Bind variables from pattern - handle quoted triples specially
      if (this.isVariable(pattern.subject)) {
        mapping.set(pattern.subject.value, triple.subject);
      } else if (this.isQuotedTriple(pattern.subject)) {
        // Try to match quoted triple pattern against actual subject
        const bindings = this.matchQuotedTriplePattern(pattern.subject, triple.subject);
        if (bindings === null) continue; // No match, skip this triple
        for (const [varName, value] of bindings.entries()) {
          mapping.set(varName, value);
        }
      }

      if (this.isVariable(predElement)) {
        mapping.set(predElement.value, triple.predicate);
      }

      if (this.isVariable(pattern.object)) {
        mapping.set(pattern.object.value, triple.object);
      } else if (this.isQuotedTriple(pattern.object)) {
        // Try to match quoted triple pattern against actual object
        const bindings = this.matchQuotedTriplePattern(pattern.object, triple.object);
        if (bindings === null) continue; // No match, skip this triple
        for (const [varName, value] of bindings.entries()) {
          mapping.set(varName, value);
        }
      }

      yield mapping;
    }
  }

  /**
   * Check if a quoted triple pattern contains any variables.
   */
  private hasVariablesInQuotedTriple(element: AlgebraQuotedTriple): boolean {
    if (this.isVariable(element.subject)) return true;
    if (element.predicate.type === "variable") return true;
    if (this.isVariable(element.object)) return true;

    // Check nested quoted triples
    if (this.isQuotedTriple(element.subject)) {
      if (this.hasVariablesInQuotedTriple(element.subject)) return true;
    }
    if (this.isQuotedTriple(element.object)) {
      if (this.hasVariablesInQuotedTriple(element.object)) return true;
    }

    return false;
  }

  /**
   * Match a quoted triple pattern against an actual RDF term.
   * Returns variable bindings if the pattern matches, or null if it doesn't.
   */
  private matchQuotedTriplePattern(
    pattern: AlgebraQuotedTriple,
    term: Subject | RDFObject
  ): Map<string, Subject | Predicate | RDFObject> | null {
    // Term must be a QuotedTriple to match a quoted triple pattern
    if (!(term instanceof QuotedTriple)) {
      return null;
    }

    const bindings = new Map<string, Subject | Predicate | RDFObject>();

    // Match subject
    if (this.isVariable(pattern.subject)) {
      bindings.set(pattern.subject.value, term.subject);
    } else if (this.isQuotedTriple(pattern.subject)) {
      const nestedBindings = this.matchQuotedTriplePattern(pattern.subject, term.subject);
      if (nestedBindings === null) return null;
      for (const [k, v] of nestedBindings) {
        bindings.set(k, v);
      }
    } else {
      // Concrete value - must match exactly
      if (!this.elementsMatch(pattern.subject, term.subject)) {
        return null;
      }
    }

    // Match predicate
    if (pattern.predicate.type === "variable") {
      bindings.set(pattern.predicate.value, term.predicate);
    } else {
      // Concrete IRI - must match exactly
      if (pattern.predicate.value !== term.predicate.value) {
        return null;
      }
    }

    // Match object
    if (this.isVariable(pattern.object)) {
      bindings.set(pattern.object.value, term.object);
    } else if (this.isQuotedTriple(pattern.object)) {
      const nestedBindings = this.matchQuotedTriplePattern(pattern.object, term.object);
      if (nestedBindings === null) return null;
      for (const [k, v] of nestedBindings) {
        bindings.set(k, v);
      }
    } else {
      // Concrete value - must match exactly
      if (!this.elementsMatch(pattern.object, term.object)) {
        return null;
      }
    }

    return bindings;
  }

  /**
   * Check if a pattern element matches an RDF term (for concrete values).
   */
  private elementsMatch(
    pattern: TripleElement,
    term: Subject | Predicate | RDFObject
  ): boolean {
    switch (pattern.type) {
      case "iri":
        return term instanceof IRI && pattern.value === term.value;
      case "literal":
        if (!(term instanceof Literal)) return false;
        if (pattern.value !== term.value) return false;
        if (pattern.datatype !== term.datatype?.value) return false;
        if (pattern.language !== term.language) return false;
        if (pattern.direction !== term.direction) return false;
        return true;
      case "blank":
        return term instanceof BlankNode && pattern.value === term.id;
      case "quoted":
        if (!(term instanceof QuotedTriple)) return false;
        // For quoted triples without variables, compare structurally
        const patternQt = this.toRDFQuotedTriple(pattern);
        return patternQt.equals(term);
      default:
        return false;
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
   * Handles regular elements and quoted triples with variables inside them.
   */
  private instantiateElement(element: TripleElement, solution: SolutionMapping): TripleElement {
    if (this.isVariable(element)) {
      const bound = solution.get(element.value);
      if (bound) {
        // Convert bound RDF term back to algebra element
        return this.toAlgebraElement(bound);
      }
    }

    // Handle quoted triples - instantiate variables inside them
    if (this.isQuotedTriple(element)) {
      return this.instantiateQuotedTriple(element, solution);
    }

    return element;
  }

  /**
   * Instantiate a quoted triple pattern with solution bindings.
   * Variables inside the quoted triple are replaced with their bound values.
   */
  private instantiateQuotedTriple(
    element: AlgebraQuotedTriple,
    solution: SolutionMapping
  ): AlgebraQuotedTriple {
    const instantiatedSubject = this.instantiateElement(element.subject, solution);
    const instantiatedPredicate = element.predicate.type === "variable"
      ? this.instantiatePredicateVariable(element.predicate, solution)
      : element.predicate;
    const instantiatedObject = this.instantiateElement(element.object, solution);

    return {
      type: "quoted",
      subject: instantiatedSubject,
      predicate: instantiatedPredicate,
      object: instantiatedObject,
    };
  }

  /**
   * Instantiate a variable in predicate position.
   */
  private instantiatePredicateVariable(
    element: { type: "variable"; value: string },
    solution: SolutionMapping
  ): { type: "iri"; value: string } | { type: "variable"; value: string } {
    const bound = solution.get(element.value);
    if (bound && bound instanceof IRI) {
      return { type: "iri", value: bound.value };
    }
    return element;
  }

  /**
   * Check if an algebra element is a variable.
   * TypeScript type guard to narrow the type.
   */
  private isVariable(element: TripleElement): element is AlgebraVariable {
    return element.type === "variable";
  }

  /**
   * Check if an algebra element is a quoted triple (RDF-Star).
   */
  private isQuotedTriple(element: TripleElement): element is AlgebraQuotedTriple {
    return element.type === "quoted";
  }

  /**
   * Convert algebra triple element to RDF term for subject position.
   * In RDF-Star, subjects can include quoted triples.
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
      case "quoted":
        return this.toRDFQuotedTriple(element);
      default:
        throw new BGPExecutorError(`Unknown element type: ${(element as any).type}`);
    }
  }

  /**
   * Convert algebra quoted triple to RDF QuotedTriple.
   * Recursively handles nested quoted triples.
   */
  private toRDFQuotedTriple(element: AlgebraQuotedTriple): QuotedTriple {
    const subject = this.toRDFTermAsSubject(element.subject);
    const predicate = element.predicate.type === "iri"
      ? new IRI(element.predicate.value)
      : (() => { throw new BGPExecutorError("Quoted triple predicate must be IRI"); })();
    const object = this.toRDFTerm(element.object);

    return new QuotedTriple(subject, predicate, object);
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
   * In RDF-Star, objects can include quoted triples.
   */
  private toRDFTerm(element: TripleElement): RDFObject {
    switch (element.type) {
      case "iri":
        return new IRI(element.value);
      case "literal":
        return new Literal(
          element.value,
          element.datatype ? new IRI(element.datatype) : undefined,
          element.language,
          element.direction
        );
      case "blank":
        return new BlankNode(element.value);
      case "variable":
        throw new BGPExecutorError(`Cannot convert variable to RDF term: ${element.value}`);
      case "quoted":
        return this.toRDFQuotedTriple(element);
      default:
        throw new BGPExecutorError(`Unknown element type: ${(element as any).type}`);
    }
  }

  /**
   * Convert RDF term back to algebra triple element.
   * In RDF-Star, this also handles QuotedTriple terms.
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
        direction: term.direction,
      };
    } else if (term instanceof BlankNode) {
      return {
        type: "blank",
        value: term.id,
      };
    } else if (term instanceof QuotedTriple) {
      return this.toAlgebraQuotedTriple(term);
    }
    throw new BGPExecutorError(`Unknown RDF term type: ${(term as any).constructor?.name || 'unknown'}`);
  }

  /**
   * Convert RDF QuotedTriple back to algebra QuotedTriple.
   * Recursively handles nested quoted triples.
   */
  private toAlgebraQuotedTriple(term: QuotedTriple): AlgebraQuotedTriple {
    return {
      type: "quoted",
      subject: this.toAlgebraElement(term.subject),
      predicate: { type: "iri", value: term.predicate.value },
      object: this.toAlgebraElement(term.object),
    };
  }
}
