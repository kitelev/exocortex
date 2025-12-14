import { ITripleStore, ITransaction } from "../../../src/interfaces/ITripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { BlankNode } from "../../../src/domain/models/rdf/BlankNode";

class MockTripleStore implements ITripleStore {
  private triples: Map<string, Triple> = new Map();
  private transaction: MockTransaction | null = null;

  async add(triple: Triple): Promise<void> {
    this.triples.set(this.getKey(triple), triple);
  }

  async remove(triple: Triple): Promise<boolean> {
    const key = this.getKey(triple);
    if (this.triples.has(key)) {
      this.triples.delete(key);
      return true;
    }
    return false;
  }

  async has(triple: Triple): Promise<boolean> {
    return this.triples.has(this.getKey(triple));
  }

  async match(
    subject?: typeof triple.subject,
    predicate?: typeof triple.predicate,
    object?: typeof triple.object
  ): Promise<Triple[]> {
    const results: Triple[] = [];

    for (const triple of this.triples.values()) {
      if (subject && !this.nodeEquals(triple.subject, subject)) continue;
      if (predicate && !triple.predicate.equals(predicate)) continue;
      if (object && !this.nodeEquals(triple.object, object)) continue;
      results.push(triple);
    }

    return results;
  }

  async addAll(triples: Triple[]): Promise<void> {
    for (const triple of triples) {
      await this.add(triple);
    }
  }

  async removeAll(triples: Triple[]): Promise<number> {
    let count = 0;
    for (const triple of triples) {
      if (await this.remove(triple)) {
        count++;
      }
    }
    return count;
  }

  async clear(): Promise<void> {
    this.triples.clear();
  }

  async count(): Promise<number> {
    return this.triples.size;
  }

  async subjects(): Promise<Array<typeof triple.subject>> {
    const subjects = new Set<typeof triple.subject>();
    for (const triple of this.triples.values()) {
      subjects.add(triple.subject);
    }
    return Array.from(subjects);
  }

  async predicates(): Promise<Array<typeof triple.predicate>> {
    const predicates = new Set<typeof triple.predicate>();
    for (const triple of this.triples.values()) {
      predicates.add(triple.predicate);
    }
    return Array.from(predicates);
  }

  async objects(): Promise<Array<typeof triple.object>> {
    const objects = new Set<typeof triple.object>();
    for (const triple of this.triples.values()) {
      objects.add(triple.object);
    }
    return Array.from(objects);
  }

  async beginTransaction(): Promise<ITransaction> {
    this.transaction = new MockTransaction(this);
    return this.transaction;
  }

  private getKey(triple: Triple): string {
    return triple.toString();
  }

  private nodeEquals(a: any, b: any): boolean {
    if (a instanceof IRI && b instanceof IRI) return a.equals(b);
    if (a instanceof BlankNode && b instanceof BlankNode) return a.equals(b);
    if (a instanceof Literal && b instanceof Literal) return a.equals(b);
    return false;
  }
}

class MockTransaction implements ITransaction {
  private operations: Array<{ type: "add" | "remove"; triple: Triple }> = [];
  private committed = false;
  private rolledBack = false;

  constructor(private store: MockTripleStore) {}

  async add(triple: Triple): Promise<void> {
    this.operations.push({ type: "add", triple });
  }

  async remove(triple: Triple): Promise<boolean> {
    this.operations.push({ type: "remove", triple });
    return true;
  }

  async commit(): Promise<void> {
    if (this.committed) throw new Error("Transaction already committed");
    if (this.rolledBack) throw new Error("Transaction already rolled back");

    for (const op of this.operations) {
      if (op.type === "add") {
        await this.store.add(op.triple);
      } else {
        await this.store.remove(op.triple);
      }
    }

    this.committed = true;
  }

  async rollback(): Promise<void> {
    if (this.committed) throw new Error("Transaction already committed");
    if (this.rolledBack) throw new Error("Transaction already rolled back");

    this.operations = [];
    this.rolledBack = true;
  }
}

describe("ITripleStore contract", () => {
  let store: ITripleStore;
  let triple1: Triple;
  let triple2: Triple;
  let triple3: Triple;

  beforeEach(async () => {
    store = new MockTripleStore();

    const alice = new IRI("http://example.com/Alice");
    const bob = new IRI("http://example.com/Bob");
    const knows = new IRI("http://example.com/knows");
    const name = new IRI("http://example.com/name");

    triple1 = new Triple(alice, knows, bob);
    triple2 = new Triple(alice, name, new Literal("Alice"));
    triple3 = new Triple(bob, name, new Literal("Bob"));
  });

  describe("add", () => {
    it("should add triple to store", async () => {
      await store.add(triple1);

      const has = await store.has(triple1);
      expect(has).toBe(true);
    });

    it("should be idempotent", async () => {
      await store.add(triple1);
      await store.add(triple1);

      const count = await store.count();
      expect(count).toBe(1);
    });
  });

  describe("remove", () => {
    it("should remove existing triple", async () => {
      await store.add(triple1);

      const removed = await store.remove(triple1);
      expect(removed).toBe(true);

      const has = await store.has(triple1);
      expect(has).toBe(false);
    });

    it("should return false for non-existent triple", async () => {
      const removed = await store.remove(triple1);
      expect(removed).toBe(false);
    });
  });

  describe("has", () => {
    it("should return true for existing triple", async () => {
      await store.add(triple1);

      const has = await store.has(triple1);
      expect(has).toBe(true);
    });

    it("should return false for non-existent triple", async () => {
      const has = await store.has(triple1);
      expect(has).toBe(false);
    });
  });

  describe("match", () => {
    beforeEach(async () => {
      await store.addAll([triple1, triple2, triple3]);
    });

    it("should return all triples when no pattern specified", async () => {
      const results = await store.match();
      expect(results.length).toBe(3);
    });

    it("should match by subject", async () => {
      const alice = new IRI("http://example.com/Alice");
      const results = await store.match(alice);

      expect(results.length).toBe(2);
      expect(results).toContainEqual(triple1);
      expect(results).toContainEqual(triple2);
    });

    it("should match by predicate", async () => {
      const name = new IRI("http://example.com/name");
      const results = await store.match(undefined, name);

      expect(results.length).toBe(2);
      expect(results).toContainEqual(triple2);
      expect(results).toContainEqual(triple3);
    });

    it("should match by object", async () => {
      const bob = new IRI("http://example.com/Bob");
      const results = await store.match(undefined, undefined, bob);

      expect(results.length).toBe(1);
      expect(results).toContainEqual(triple1);
    });

    it("should match by subject and predicate", async () => {
      const alice = new IRI("http://example.com/Alice");
      const name = new IRI("http://example.com/name");
      const results = await store.match(alice, name);

      expect(results.length).toBe(1);
      expect(results).toContainEqual(triple2);
    });

    it("should return empty array when no matches", async () => {
      const charlie = new IRI("http://example.com/Charlie");
      const results = await store.match(charlie);

      expect(results).toEqual([]);
    });
  });

  describe("addAll", () => {
    it("should add multiple triples", async () => {
      await store.addAll([triple1, triple2, triple3]);

      const count = await store.count();
      expect(count).toBe(3);
    });

    it("should handle empty array", async () => {
      await store.addAll([]);

      const count = await store.count();
      expect(count).toBe(0);
    });
  });

  describe("removeAll", () => {
    it("should remove multiple triples and return count", async () => {
      await store.addAll([triple1, triple2, triple3]);

      const removed = await store.removeAll([triple1, triple2]);
      expect(removed).toBe(2);

      const count = await store.count();
      expect(count).toBe(1);
    });

    it("should return 0 for non-existent triples", async () => {
      const removed = await store.removeAll([triple1, triple2]);
      expect(removed).toBe(0);
    });
  });

  describe("clear", () => {
    it("should remove all triples", async () => {
      await store.addAll([triple1, triple2, triple3]);

      await store.clear();

      const count = await store.count();
      expect(count).toBe(0);
    });

    it("should work on empty store", async () => {
      await store.clear();

      const count = await store.count();
      expect(count).toBe(0);
    });
  });

  describe("count", () => {
    it("should return 0 for empty store", async () => {
      const count = await store.count();
      expect(count).toBe(0);
    });

    it("should return correct count", async () => {
      await store.addAll([triple1, triple2, triple3]);

      const count = await store.count();
      expect(count).toBe(3);
    });
  });

  describe("subjects", () => {
    it("should return unique subjects", async () => {
      await store.addAll([triple1, triple2]);

      const subjects = await store.subjects();
      expect(subjects.length).toBe(1);
      expect(subjects[0]).toBeInstanceOf(IRI);
    });

    it("should return empty array for empty store", async () => {
      const subjects = await store.subjects();
      expect(subjects).toEqual([]);
    });
  });

  describe("predicates", () => {
    it("should return unique predicates", async () => {
      await store.addAll([triple1, triple2, triple3]);

      const predicates = await store.predicates();
      expect(predicates.length).toBe(2);
      predicates.forEach((p) => expect(p).toBeInstanceOf(IRI));
    });

    it("should return empty array for empty store", async () => {
      const predicates = await store.predicates();
      expect(predicates).toEqual([]);
    });
  });

  describe("objects", () => {
    it("should return unique objects", async () => {
      await store.addAll([triple1, triple2, triple3]);

      const objects = await store.objects();
      expect(objects.length).toBe(3);
    });

    it("should return empty array for empty store", async () => {
      const objects = await store.objects();
      expect(objects).toEqual([]);
    });
  });

  describe("transactions", () => {
    it("should create transaction", async () => {
      const tx = await store.beginTransaction();
      expect(tx).toBeDefined();
    });

    it("should commit transaction", async () => {
      const tx = await store.beginTransaction();
      await tx.add(triple1);
      await tx.add(triple2);
      await tx.commit();

      const count = await store.count();
      expect(count).toBe(2);
    });

    it("should rollback transaction", async () => {
      const tx = await store.beginTransaction();
      await tx.add(triple1);
      await tx.add(triple2);
      await tx.rollback();

      const count = await store.count();
      expect(count).toBe(0);
    });

    it("should not apply changes until commit", async () => {
      const tx = await store.beginTransaction();
      await tx.add(triple1);

      const count = await store.count();
      expect(count).toBe(0);

      await tx.commit();

      const countAfter = await store.count();
      expect(countAfter).toBe(1);
    });
  });
});
