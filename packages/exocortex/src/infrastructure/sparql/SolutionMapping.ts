import type { Subject, Predicate, Object as RDFObject } from "../../domain/models/rdf/Triple";
import { Literal } from "../../domain/models/rdf/Literal";
import { IRI } from "../../domain/models/rdf/IRI";
import { BlankNode } from "../../domain/models/rdf/BlankNode";

/**
 * A solution mapping represents variable bindings from SPARQL query execution.
 * Maps variable names (without '?' prefix) to their bound RDF terms.
 */
export class SolutionMapping {
  private bindings: Map<string, Subject | Predicate | RDFObject>;

  constructor(bindings?: Map<string, Subject | Predicate | RDFObject>) {
    this.bindings = bindings ? new Map(bindings) : new Map();
  }

  /**
   * Get the value bound to a variable
   */
  get(variable: string): Subject | Predicate | RDFObject | undefined {
    return this.bindings.get(variable);
  }

  /**
   * Set a variable binding
   */
  set(variable: string, value: Subject | Predicate | RDFObject): void {
    this.bindings.set(variable, value);
  }

  /**
   * Check if a variable is bound
   */
  has(variable: string): boolean {
    return this.bindings.has(variable);
  }

  /**
   * Get all variable names in this mapping
   */
  variables(): string[] {
    return Array.from(this.bindings.keys());
  }

  /**
   * Get all bindings as a Map
   */
  getBindings(): Map<string, Subject | Predicate | RDFObject> {
    return new Map(this.bindings);
  }

  /**
   * Check if this mapping is compatible with another mapping.
   * Two mappings are compatible if they don't have conflicting bindings
   * for the same variable.
   */
  isCompatibleWith(other: SolutionMapping): boolean {
    for (const [variable, value] of this.bindings.entries()) {
      const otherValue = other.get(variable);
      if (otherValue !== undefined && !this.areEqual(value, otherValue)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Merge this mapping with another mapping.
   * Returns a new SolutionMapping combining both bindings.
   * Returns null if mappings are incompatible.
   */
  merge(other: SolutionMapping): SolutionMapping | null {
    if (!this.isCompatibleWith(other)) {
      return null;
    }

    const merged = new SolutionMapping(this.bindings);
    for (const [variable, value] of other.getBindings().entries()) {
      merged.set(variable, value);
    }

    return merged;
  }

  /**
   * Create a copy of this mapping
   */
  clone(): SolutionMapping {
    return new SolutionMapping(this.bindings);
  }

  /**
   * Check if two RDF terms are equal.
   *
   * For Literals, uses RDF 1.1 semantics where plain literals are equivalent
   * to xsd:string typed literals (both have normalized datatype of null).
   *
   * For IRIs and BlankNodes, uses value comparison.
   */
  private areEqual(a: Subject | Predicate | RDFObject, b: Subject | Predicate | RDFObject): boolean {
    // Both are Literals - use Literal.equals() for proper RDF 1.1 semantics
    if (a instanceof Literal && b instanceof Literal) {
      return a.equals(b);
    }

    // Both are IRIs - compare values
    if (a instanceof IRI && b instanceof IRI) {
      return a.value === b.value;
    }

    // Both are BlankNodes - compare ids
    if (a instanceof BlankNode && b instanceof BlankNode) {
      return a.id === b.id;
    }

    // Different types cannot be equal
    return false;
  }

  /**
   * Convert to a plain object for debugging
   */
  toJSON(): Record<string, string> {
    const obj: Record<string, string> = {};
    for (const [variable, value] of this.bindings.entries()) {
      obj[variable] = value.toString();
    }
    return obj;
  }

  /**
   * Get the size (number of bindings) in this mapping
   */
  size(): number {
    return this.bindings.size;
  }
}
