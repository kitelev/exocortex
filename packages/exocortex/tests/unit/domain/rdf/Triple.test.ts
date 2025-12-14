import { Triple } from "../../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../src/domain/models/rdf/Literal";
import { BlankNode } from "../../../../src/domain/models/rdf/BlankNode";
import { Namespace } from "../../../../src/domain/models/rdf/Namespace";

describe("Triple", () => {
  describe("constructor", () => {
    it("should create triple with IRI subject, predicate, and object", () => {
      const subject = new IRI("http://example.com/Alice");
      const predicate = new IRI("http://example.com/knows");
      const object = new IRI("http://example.com/Bob");

      const triple = new Triple(subject, predicate, object);

      expect(triple.subject).toBe(subject);
      expect(triple.predicate).toBe(predicate);
      expect(triple.object).toBe(object);
    });

    it("should create triple with Literal object", () => {
      const subject = new IRI("http://example.com/Alice");
      const predicate = new IRI("http://example.com/name");
      const object = new Literal("Alice");

      const triple = new Triple(subject, predicate, object);

      expect(triple.subject).toBe(subject);
      expect(triple.predicate).toBe(predicate);
      expect(triple.object).toBe(object);
    });

    it("should create triple with BlankNode subject", () => {
      const subject = new BlankNode("b1");
      const predicate = new IRI("http://example.com/name");
      const object = new Literal("Anonymous");

      const triple = new Triple(subject, predicate, object);

      expect(triple.subject).toBe(subject);
      expect(triple.predicate).toBe(predicate);
      expect(triple.object).toBe(object);
    });

    it("should create triple with BlankNode object", () => {
      const subject = new IRI("http://example.com/Alice");
      const predicate = new IRI("http://example.com/knows");
      const object = new BlankNode("b1");

      const triple = new Triple(subject, predicate, object);

      expect(triple.subject).toBe(subject);
      expect(triple.predicate).toBe(predicate);
      expect(triple.object).toBe(object);
    });
  });

  describe("equals", () => {
    it("should return true for identical triples with IRI nodes", () => {
      const subject = new IRI("http://example.com/Alice");
      const predicate = new IRI("http://example.com/knows");
      const object = new IRI("http://example.com/Bob");

      const triple1 = new Triple(subject, predicate, object);
      const triple2 = new Triple(subject, predicate, object);

      expect(triple1.equals(triple2)).toBe(true);
    });

    it("should return true for triples with equal Literals", () => {
      const subject = new IRI("http://example.com/Alice");
      const predicate = new IRI("http://example.com/name");
      const object1 = new Literal("Alice");
      const object2 = new Literal("Alice");

      const triple1 = new Triple(subject, predicate, object1);
      const triple2 = new Triple(subject, predicate, object2);

      expect(triple1.equals(triple2)).toBe(true);
    });

    it("should return false for different subjects", () => {
      const subject1 = new IRI("http://example.com/Alice");
      const subject2 = new IRI("http://example.com/Bob");
      const predicate = new IRI("http://example.com/name");
      const object = new Literal("Test");

      const triple1 = new Triple(subject1, predicate, object);
      const triple2 = new Triple(subject2, predicate, object);

      expect(triple1.equals(triple2)).toBe(false);
    });

    it("should return false for different predicates", () => {
      const subject = new IRI("http://example.com/Alice");
      const predicate1 = new IRI("http://example.com/name");
      const predicate2 = new IRI("http://example.com/age");
      const object = new Literal("Test");

      const triple1 = new Triple(subject, predicate1, object);
      const triple2 = new Triple(subject, predicate2, object);

      expect(triple1.equals(triple2)).toBe(false);
    });

    it("should return false for different objects", () => {
      const subject = new IRI("http://example.com/Alice");
      const predicate = new IRI("http://example.com/name");
      const object1 = new Literal("Alice");
      const object2 = new Literal("Bob");

      const triple1 = new Triple(subject, predicate, object1);
      const triple2 = new Triple(subject, predicate, object2);

      expect(triple1.equals(triple2)).toBe(false);
    });
  });

  describe("toString", () => {
    it("should return N-Triples format for IRI triple", () => {
      const subject = new IRI("http://example.com/Alice");
      const predicate = new IRI("http://example.com/knows");
      const object = new IRI("http://example.com/Bob");

      const triple = new Triple(subject, predicate, object);

      expect(triple.toString()).toBe(
        "<http://example.com/Alice> <http://example.com/knows> <http://example.com/Bob> ."
      );
    });

    it("should return N-Triples format for Literal object", () => {
      const subject = new IRI("http://example.com/Alice");
      const predicate = new IRI("http://example.com/name");
      const object = new Literal("Alice");

      const triple = new Triple(subject, predicate, object);

      expect(triple.toString()).toBe(
        '<http://example.com/Alice> <http://example.com/name> "Alice" .'
      );
    });

    it("should return N-Triples format with BlankNode", () => {
      const subject = new BlankNode("b1");
      const predicate = new IRI("http://example.com/name");
      const object = new Literal("Anonymous");

      const triple = new Triple(subject, predicate, object);

      expect(triple.toString()).toBe('_:b1 <http://example.com/name> "Anonymous" .');
    });
  });

  describe("using Namespaces", () => {
    it("should create triple with RDF type", () => {
      const subject = new IRI("http://example.com/Alice");
      const predicate = Namespace.RDF.term("type");
      const object = new IRI("http://example.com/Person");

      const triple = new Triple(subject, predicate, object);

      expect(triple.predicate.value).toBe(
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"
      );
    });

    it("should create triple with RDFS label", () => {
      const subject = new IRI("http://example.com/Alice");
      const predicate = Namespace.RDFS.term("label");
      const object = new Literal("Alice Smith");

      const triple = new Triple(subject, predicate, object);

      expect(triple.predicate.value).toBe(
        "http://www.w3.org/2000/01/rdf-schema#label"
      );
    });
  });
});
