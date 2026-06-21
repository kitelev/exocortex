export class BlankNode {
  private static counter = 0;
  private readonly _id: string;

  constructor(id: string) {
    const trimmed = id.trim();

    if (trimmed.length === 0) {
      throw new Error("BlankNode id cannot be empty");
    }

    this._id = trimmed;
  }

  get id(): string {
    return this._id;
  }

  equals(other: BlankNode): boolean {
    return this._id === other._id;
  }

  toString(): string {
    return `_:${this._id}`;
  }

  static generateId(): string {
    return `b${++BlankNode.counter}`;
  }

  static create(): BlankNode {
    return new BlankNode(BlankNode.generateId());
  }
}
