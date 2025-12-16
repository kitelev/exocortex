import { IRI } from "./IRI";
import { Literal } from "./Literal";
import { BlankNode } from "./BlankNode";

/**
 * RDF-Star Subject types for quoted triples.
 * A quoted triple subject can be an IRI, BlankNode, or another QuotedTriple (nested).
 */
export type QuotedSubject = IRI | BlankNode | QuotedTriple;

/**
 * RDF-Star Predicate type for quoted triples (always IRI).
 */
export type QuotedPredicate = IRI;

/**
 * RDF-Star Object types for quoted triples.
 * A quoted triple object can be any RDF term or another QuotedTriple (nested).
 */
export type QuotedObject = IRI | BlankNode | Literal | QuotedTriple;

/**
 * RDF-Star Quoted Triple (SPARQL 1.2)
 *
 * A QuotedTriple represents a triple that can appear in subject or object
 * position of another triple. This enables "statements about statements"
 * - a key feature of RDF-Star.
 *
 * Example usage in SPARQL:
 * ```sparql
 * # Find sources that claim "Alice knows Bob"
 * PREFIX : <http://example.org/>
 * SELECT ?source WHERE {
 *   << :Alice :knows :Bob >> :source ?source .
 * }
 * ```
 *
 * In RDF, this corresponds to:
 * ```turtle
 * << :Alice :knows :Bob >> :source :Wikipedia .
 * ```
 *
 * @see https://w3c.github.io/sparql-12/spec/
 * @see https://w3c.github.io/rdf-star/cg-spec/2021-12-17.html
 */
export class QuotedTriple {
  private readonly _subject: QuotedSubject;
  private readonly _predicate: QuotedPredicate;
  private readonly _object: QuotedObject;

  constructor(subject: QuotedSubject, predicate: QuotedPredicate, object: QuotedObject) {
    this._subject = subject;
    this._predicate = predicate;
    this._object = object;
  }

  get subject(): QuotedSubject {
    return this._subject;
  }

  get predicate(): QuotedPredicate {
    return this._predicate;
  }

  get object(): QuotedObject {
    return this._object;
  }

  /**
   * Check structural equality with another QuotedTriple.
   * Two quoted triples are equal if all their components are equal.
   */
  equals(other: QuotedTriple): boolean {
    if (!this.equalsNode(this._subject, other._subject)) {
      return false;
    }

    if (!this._predicate.equals(other._predicate)) {
      return false;
    }

    if (!this.equalsNode(this._object, other._object)) {
      return false;
    }

    return true;
  }

  private equalsNode(
    a: IRI | BlankNode | Literal | QuotedTriple,
    b: IRI | BlankNode | Literal | QuotedTriple
  ): boolean {
    if (a instanceof IRI && b instanceof IRI) {
      return a.equals(b);
    }

    if (a instanceof BlankNode && b instanceof BlankNode) {
      return a.equals(b);
    }

    if (a instanceof Literal && b instanceof Literal) {
      return a.equals(b);
    }

    if (a instanceof QuotedTriple && b instanceof QuotedTriple) {
      return a.equals(b);
    }

    return false;
  }

  /**
   * Get the term type identifier.
   * Returns "QuotedTriple" for use in term type checking.
   */
  get termType(): string {
    return "QuotedTriple";
  }

  /**
   * Serialize to RDF-Star Turtle syntax.
   * Example: << :Alice :knows :Bob >>
   */
  toString(): string {
    const subjectStr = this.nodeToString(this._subject);
    const predicateStr = `<${this._predicate.value}>`;
    const objectStr = this.nodeToString(this._object);

    return `<< ${subjectStr} ${predicateStr} ${objectStr} >>`;
  }

  private nodeToString(node: IRI | BlankNode | Literal | QuotedTriple): string {
    if (node instanceof IRI) {
      return `<${node.value}>`;
    }

    if (node instanceof BlankNode) {
      return node.toString();
    }

    if (node instanceof Literal) {
      return node.toString();
    }

    if (node instanceof QuotedTriple) {
      return node.toString();
    }

    return "";
  }
}
