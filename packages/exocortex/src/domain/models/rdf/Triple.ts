import { IRI } from "./IRI";
import { Literal } from "./Literal";
import { BlankNode } from "./BlankNode";

export type Subject = IRI | BlankNode;
export type Predicate = IRI;
export type Object = IRI | BlankNode | Literal;

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

  private equalsNode(a: IRI | BlankNode | Literal, b: IRI | BlankNode | Literal): boolean {
    if (a instanceof IRI && b instanceof IRI) {
      return a.equals(b);
    }

    if (a instanceof BlankNode && b instanceof BlankNode) {
      return a.equals(b);
    }

    if (a instanceof Literal && b instanceof Literal) {
      return a.equals(b);
    }

    return false;
  }

  toString(): string {
    const subjectStr = this.nodeToString(this._subject);
    const predicateStr = `<${this._predicate.value}>`;
    const objectStr = this.nodeToString(this._object);

    return `${subjectStr} ${predicateStr} ${objectStr} .`;
  }

  private nodeToString(node: IRI | BlankNode | Literal): string {
    if (node instanceof IRI) {
      return `<${node.value}>`;
    }

    if (node instanceof BlankNode) {
      return node.toString();
    }

    if (node instanceof Literal) {
      return node.toString();
    }

    return "";
  }
}
