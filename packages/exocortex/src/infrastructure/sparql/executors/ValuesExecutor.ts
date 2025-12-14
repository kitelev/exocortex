import type { ValuesOperation, ValuesBinding, IRI as AlgebraIRI, Literal as AlgebraLiteral } from "../algebra/AlgebraOperation";
import { SolutionMapping } from "../SolutionMapping";
import { IRI } from "../../../domain/models/rdf/IRI";
import { Literal } from "../../../domain/models/rdf/Literal";
import type { Subject, Predicate, Object as RDFObject } from "../../../domain/models/rdf/Triple";

export class ValuesExecutorError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, cause ? { cause } : undefined);
    this.name = "ValuesExecutorError";
  }
}

/**
 * Executes VALUES operations for inline data injection.
 *
 * VALUES creates solution mappings from explicit inline data, behaving
 * like a virtual table that is joined with the rest of the query.
 *
 * Features:
 * - Single variable VALUES: VALUES ?status { "active" "pending" }
 * - Multi-variable VALUES: VALUES (?name ?role) { ("Alice" "admin") ("Bob" "editor") }
 * - UNDEF support: Variables can be undefined in specific rows
 * - IRI and Literal values
 *
 * Example:
 * ```sparql
 * SELECT ?task ?status WHERE {
 *   VALUES ?status { "active" "pending" "blocked" }
 *   ?task ems:status ?status .
 * }
 * ```
 *
 * Cross-product joins:
 * ```sparql
 * SELECT ?year ?month WHERE {
 *   VALUES ?year { 2023 2024 2025 }
 *   VALUES ?month { 1 2 3 4 5 6 7 8 9 10 11 12 }
 * }
 * ```
 */
export class ValuesExecutor {
  /**
   * Execute a VALUES operation and return solution mappings.
   * Each binding in the operation becomes one solution mapping.
   */
  async *execute(operation: ValuesOperation): AsyncIterableIterator<SolutionMapping> {
    if (operation.bindings.length === 0) {
      // Empty VALUES yields no solutions (unlike empty BGP which yields one empty solution)
      // This is SPARQL 1.1 semantics - VALUES with no data eliminates results
      return;
    }

    for (const binding of operation.bindings) {
      yield this.createSolutionMapping(binding);
    }
  }

  /**
   * Execute VALUES and collect all results.
   * Use this when you need all solutions at once (not streaming).
   */
  async executeAll(operation: ValuesOperation): Promise<SolutionMapping[]> {
    const results: SolutionMapping[] = [];
    for await (const solution of this.execute(operation)) {
      results.push(solution);
    }
    return results;
  }

  /**
   * Create a SolutionMapping from a VALUES binding.
   * Each variable in the binding becomes a bound variable in the solution.
   * UNDEF values (absent keys) are simply not added to the mapping.
   */
  private createSolutionMapping(binding: ValuesBinding): SolutionMapping {
    const solution = new SolutionMapping();

    for (const [varName, value] of Object.entries(binding)) {
      const rdfTerm = this.toRDFTerm(value);
      solution.set(varName, rdfTerm);
    }

    return solution;
  }

  /**
   * Convert an algebra term (IRI or Literal) to an RDF term.
   */
  private toRDFTerm(term: AlgebraIRI | AlgebraLiteral): Subject | Predicate | RDFObject {
    if (term.type === "iri") {
      return new IRI(term.value);
    } else if (term.type === "literal") {
      return new Literal(
        term.value,
        term.datatype ? new IRI(term.datatype) : undefined,
        term.language
      );
    }
    throw new ValuesExecutorError(`Unknown term type: ${(term as any).type}`);
  }
}
