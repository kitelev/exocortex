import { IRI } from "./IRI";
import { Literal } from "./Literal";
import { BlankNode } from "./BlankNode";
import type { QuotedTriple } from "./QuotedTriple";

/**
 * RDF Subject types.
 * In RDF-Star, subjects can also include QuotedTriple (statements about statements).
 */
export type Subject = IRI | BlankNode | QuotedTriple;

/**
 * RDF Predicate type (always IRI).
 */
export type Predicate = IRI;

/**
 * RDF Object types.
 * In RDF-Star, objects can also include QuotedTriple (statements about statements).
 */
export type Object = IRI | BlankNode | Literal | QuotedTriple;

export class Triple {
  private readonly _subject: Subject;
  private readonly _predicate: Predicate;
  private readonly _object: Object;

  constructor(subject: Subject, predicate: Predicate, object: Object) {
    this._subject = subject;
    this._predicate = predicate;
    this._object = object;
  }

  get subject(): Subject {
    return this._subject;
  }

  get predicate(): Predicate {
    return this._predicate;
  }

  get object(): Object {
    return this._object;
  }

  equals(other: Triple): boolean {
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

  private equalsNode(a: Subject | Object, b: Subject | Object): boolean {
    if (a instanceof IRI && b instanceof IRI) {
      return a.equals(b);
    }

    if (a instanceof BlankNode && b instanceof BlankNode) {
      return a.equals(b);
    }

    if (a instanceof Literal && b instanceof Literal) {
      return a.equals(b);
    }

    // Handle QuotedTriple - check for termType since we can't use instanceof
    // due to potential circular dependency issues at runtime
    if (this.isQuotedTriple(a) && this.isQuotedTriple(b)) {
      return a.equals(b);
    }

    return false;
  }

  /**
   * Type guard to check if a node is a QuotedTriple.
   * Uses duck typing to avoid circular dependency issues.
   */
  private isQuotedTriple(node: Subject | Object): node is QuotedTriple {
    return (
      typeof node === "object" &&
      node !== null &&
      "termType" in node &&
      (node as { termType: string }).termType === "QuotedTriple"
    );
  }

  toString(): string {
    const subjectStr = this.nodeToString(this._subject);
    const predicateStr = `<${this._predicate.value}>`;
    const objectStr = this.nodeToString(this._object);

    return `${subjectStr} ${predicateStr} ${objectStr} .`;
  }

  private nodeToString(node: Subject | Object): string {
    if (node instanceof IRI) {
      return `<${node.value}>`;
    }

    if (node instanceof BlankNode) {
      return node.toString();
    }

    if (node instanceof Literal) {
      return node.toString();
    }

    // Handle QuotedTriple using duck typing
    if (this.isQuotedTriple(node)) {
      return node.toString();
    }

    return "";
  }
}
