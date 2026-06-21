import { QuotedTriple } from "../../../../src/domain/models/rdf/QuotedTriple";
import { IRI } from "../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../src/domain/models/rdf/Literal";
import { BlankNode } from "../../../../src/domain/models/rdf/BlankNode";

describe("QuotedTriple", () => {
  describe("constructor", () => {
    it("should create quoted triple with IRI subject, predicate, and object", () => {
      const subject = new IRI("http://example.com/Alice");
      const predicate = new IRI("http://example.com/knows");
      const object = new IRI("http://example.com/Bob");

      const qt = new QuotedTriple(subject, predicate, object);

      expect(qt.subject).toBe(subject);
      expect(qt.predicate).toBe(predicate);
      expect(qt.object).toBe(object);
    });

    it("should create quoted triple with Literal object", () => {
      const subject = new IRI("http://example.com/Alice");
      const predicate = new IRI("http://example.com/name");
      const object = new Literal("Alice");

      const qt = new QuotedTriple(subject, predicate, object);

      expect(qt.subject).toBe(subject);
      expect(qt.predicate).toBe(predicate);
      expect(qt.object).toBe(object);
    });

    it("should create quoted triple with BlankNode subject", () => {
      const subject = new BlankNode("b1");
      const predicate = new IRI("http://example.com/type");
      const object = new IRI("http://example.com/Person");

      const qt = new QuotedTriple(subject, predicate, object);

      expect(qt.subject).toBe(subject);
      expect(qt.predicate).toBe(predicate);
      expect(qt.object).toBe(object);
    });

    it("should create quoted triple with BlankNode object", () => {
      const subject = new IRI("http://example.com/Alice");
      const predicate = new IRI("http://example.com/knows");
      const object = new BlankNode("b1");

      const qt = new QuotedTriple(subject, predicate, object);

      expect(qt.subject).toBe(subject);
      expect(qt.predicate).toBe(predicate);
      expect(qt.object).toBe(object);
    });

    it("should create nested quoted triple (quoted triple as subject)", () => {
      const innerSubject = new IRI("http://example.com/Alice");
      const innerPredicate = new IRI("http://example.com/knows");
      const innerObject = new IRI("http://example.com/Bob");
      const innerQt = new QuotedTriple(innerSubject, innerPredicate, innerObject);

      const outerPredicate = new IRI("http://example.com/source");
      const outerObject = new IRI("http://example.com/Wikipedia");

      const outerQt = new QuotedTriple(innerQt, outerPredicate, outerObject);

      expect(outerQt.subject).toBe(innerQt);
      expect(outerQt.subject).toBeInstanceOf(QuotedTriple);
      expect(outerQt.predicate).toBe(outerPredicate);
      expect(outerQt.object).toBe(outerObject);
    });

    it("should create nested quoted triple (quoted triple as object)", () => {
      const innerSubject = new IRI("http://example.com/Alice");
      const innerPredicate = new IRI("http://example.com/knows");
      const innerObject = new IRI("http://example.com/Bob");
      const innerQt = new QuotedTriple(innerSubject, innerPredicate, innerObject);

      const outerSubject = new IRI("http://example.com/document1");
      const outerPredicate = new IRI("http://example.com/asserts");

      const outerQt = new QuotedTriple(outerSubject, outerPredicate, innerQt);

      expect(outerQt.subject).toBe(outerSubject);
      expect(outerQt.predicate).toBe(outerPredicate);
      expect(outerQt.object).toBe(innerQt);
      expect(outerQt.object).toBeInstanceOf(QuotedTriple);
    });
  });

  describe("termType", () => {
    it("should return 'QuotedTriple' as termType", () => {
      const subject = new IRI("http://example.com/Alice");
      const predicate = new IRI("http://example.com/knows");
      const object = new IRI("http://example.com/Bob");

      const qt = new QuotedTriple(subject, predicate, object);

      expect(qt.termType).toBe("QuotedTriple");
    });
  });

  describe("equals", () => {
    it("should return true for identical quoted triples with IRI nodes", () => {
      const subject1 = new IRI("http://example.com/Alice");
      const predicate1 = new IRI("http://example.com/knows");
      const object1 = new IRI("http://example.com/Bob");

      const subject2 = new IRI("http://example.com/Alice");
      const predicate2 = new IRI("http://example.com/knows");
      const object2 = new IRI("http://example.com/Bob");

      const qt1 = new QuotedTriple(subject1, predicate1, object1);
      const qt2 = new QuotedTriple(subject2, predicate2, object2);

      expect(qt1.equals(qt2)).toBe(true);
      expect(qt2.equals(qt1)).toBe(true);
    });

    it("should return true for quoted triples with equal Literals", () => {
      const subject = new IRI("http://example.com/Alice");
      const predicate = new IRI("http://example.com/name");
      const object1 = new Literal("Alice");
      const object2 = new Literal("Alice");

      const qt1 = new QuotedTriple(subject, predicate, object1);
      const qt2 = new QuotedTriple(subject, predicate, object2);

      expect(qt1.equals(qt2)).toBe(true);
    });

    it("should return true for quoted triples with equal BlankNodes", () => {
      const subject1 = new BlankNode("b1");
      const subject2 = new BlankNode("b1");
      const predicate = new IRI("http://example.com/type");
      const object = new IRI("http://example.com/Person");

      const qt1 = new QuotedTriple(subject1, predicate, object);
      const qt2 = new QuotedTriple(subject2, predicate, object);

      expect(qt1.equals(qt2)).toBe(true);
    });

    it("should return false for different subjects", () => {
      const subject1 = new IRI("http://example.com/Alice");
      const subject2 = new IRI("http://example.com/Bob");
      const predicate = new IRI("http://example.com/knows");
      const object = new IRI("http://example.com/Charlie");

      const qt1 = new QuotedTriple(subject1, predicate, object);
      const qt2 = new QuotedTriple(subject2, predicate, object);

      expect(qt1.equals(qt2)).toBe(false);
    });

    it("should return false for different predicates", () => {
      const subject = new IRI("http://example.com/Alice");
      const predicate1 = new IRI("http://example.com/knows");
      const predicate2 = new IRI("http://example.com/likes");
      const object = new IRI("http://example.com/Bob");

      const qt1 = new QuotedTriple(subject, predicate1, object);
      const qt2 = new QuotedTriple(subject, predicate2, object);

      expect(qt1.equals(qt2)).toBe(false);
    });

    it("should return false for different objects", () => {
      const subject = new IRI("http://example.com/Alice");
      const predicate = new IRI("http://example.com/knows");
      const object1 = new IRI("http://example.com/Bob");
      const object2 = new IRI("http://example.com/Charlie");

      const qt1 = new QuotedTriple(subject, predicate, object1);
      const qt2 = new QuotedTriple(subject, predicate, object2);

      expect(qt1.equals(qt2)).toBe(false);
    });

    it("should return false for different subject types (IRI vs BlankNode)", () => {
      const subject1 = new IRI("http://example.com/Alice");
      const subject2 = new BlankNode("alice");
      const predicate = new IRI("http://example.com/knows");
      const object = new IRI("http://example.com/Bob");

      const qt1 = new QuotedTriple(subject1, predicate, object);
      const qt2 = new QuotedTriple(subject2, predicate, object);

      expect(qt1.equals(qt2)).toBe(false);
    });

    it("should return false for different object types (IRI vs Literal)", () => {
      const subject = new IRI("http://example.com/Alice");
      const predicate = new IRI("http://example.com/value");
      const object1 = new IRI("http://example.com/item");
      const object2 = new Literal("item");

      const qt1 = new QuotedTriple(subject, predicate, object1);
      const qt2 = new QuotedTriple(subject, predicate, object2);

      expect(qt1.equals(qt2)).toBe(false);
    });

    it("should return true for equal nested quoted triples", () => {
      const inner1 = new QuotedTriple(
        new IRI("http://example.com/Alice"),
        new IRI("http://example.com/knows"),
        new IRI("http://example.com/Bob")
      );
      const inner2 = new QuotedTriple(
        new IRI("http://example.com/Alice"),
        new IRI("http://example.com/knows"),
        new IRI("http://example.com/Bob")
      );

      const outer1 = new QuotedTriple(
        inner1,
        new IRI("http://example.com/source"),
        new IRI("http://example.com/Wikipedia")
      );
      const outer2 = new QuotedTriple(
        inner2,
        new IRI("http://example.com/source"),
        new IRI("http://example.com/Wikipedia")
      );

      expect(outer1.equals(outer2)).toBe(true);
    });

    it("should return false for different nested quoted triples", () => {
      const inner1 = new QuotedTriple(
        new IRI("http://example.com/Alice"),
        new IRI("http://example.com/knows"),
        new IRI("http://example.com/Bob")
      );
      const inner2 = new QuotedTriple(
        new IRI("http://example.com/Alice"),
        new IRI("http://example.com/likes"),
        new IRI("http://example.com/Bob")
      );

      const outer1 = new QuotedTriple(
        inner1,
        new IRI("http://example.com/source"),
        new IRI("http://example.com/Wikipedia")
      );
      const outer2 = new QuotedTriple(
        inner2,
        new IRI("http://example.com/source"),
        new IRI("http://example.com/Wikipedia")
      );

      expect(outer1.equals(outer2)).toBe(false);
    });
  });

  describe("toString", () => {
    it("should return RDF-Star Turtle syntax for IRI quoted triple", () => {
      const subject = new IRI("http://example.com/Alice");
      const predicate = new IRI("http://example.com/knows");
      const object = new IRI("http://example.com/Bob");

      const qt = new QuotedTriple(subject, predicate, object);

      const result = qt.toString();
      expect(result).toMatch(/^<< /);
      expect(result).toMatch(/ >>$/);
      expect(result).toContain("<http://example.com/Alice>");
      expect(result).toContain("<http://example.com/knows>");
      expect(result).toContain("<http://example.com/Bob>");
    });

    it("should return RDF-Star Turtle syntax with Literal object", () => {
      const subject = new IRI("http://example.com/Alice");
      const predicate = new IRI("http://example.com/name");
      const object = new Literal("Alice");

      const qt = new QuotedTriple(subject, predicate, object);

      const result = qt.toString();
      expect(result).toMatch(/^<< /);
      expect(result).toMatch(/ >>$/);
      expect(result).toContain("<http://example.com/Alice>");
      expect(result).toContain("<http://example.com/name>");
      expect(result).toContain('"Alice"');
    });

    it("should return RDF-Star Turtle syntax with BlankNode", () => {
      const subject = new BlankNode("b1");
      const predicate = new IRI("http://example.com/type");
      const object = new IRI("http://example.com/Person");

      const qt = new QuotedTriple(subject, predicate, object);

      const result = qt.toString();
      expect(result).toMatch(/^<< /);
      expect(result).toMatch(/ >>$/);
      expect(result).toContain("_:b1");
      expect(result).toContain("<http://example.com/type>");
      expect(result).toContain("<http://example.com/Person>");
    });

    it("should return nested RDF-Star Turtle syntax for nested quoted triple", () => {
      const inner = new QuotedTriple(
        new IRI("http://example.com/Alice"),
        new IRI("http://example.com/knows"),
        new IRI("http://example.com/Bob")
      );

      const outer = new QuotedTriple(
        inner,
        new IRI("http://example.com/source"),
        new IRI("http://example.com/Wikipedia")
      );

      const result = outer.toString();

      // Should have nested << >> structure
      expect(result.match(/<</g)?.length).toBe(2);
      expect(result.match(/>>/g)?.length).toBe(2);
      expect(result).toContain("<http://example.com/Alice>");
      expect(result).toContain("<http://example.com/knows>");
      expect(result).toContain("<http://example.com/Bob>");
      expect(result).toContain("<http://example.com/source>");
      expect(result).toContain("<http://example.com/Wikipedia>");
    });

    it("should return deeply nested RDF-Star Turtle syntax (3 levels)", () => {
      const level1 = new QuotedTriple(
        new IRI("http://example.com/Alice"),
        new IRI("http://example.com/knows"),
        new IRI("http://example.com/Bob")
      );

      const level2 = new QuotedTriple(
        level1,
        new IRI("http://example.com/source"),
        new IRI("http://example.com/Wikipedia")
      );

      const level3 = new QuotedTriple(
        level2,
        new IRI("http://example.com/confidence"),
        new Literal("0.95")
      );

      const result = level3.toString();

      // Should have 3 levels of << >> structure
      expect(result.match(/<</g)?.length).toBe(3);
      expect(result.match(/>>/g)?.length).toBe(3);
    });
  });

  describe("type safety", () => {
    it("should only accept valid subject types (IRI, BlankNode, QuotedTriple)", () => {
      // TypeScript enforces this at compile time via QuotedSubject type
      // This test verifies the types are correctly defined

      const iriSubject = new IRI("http://example.com/Alice");
      const blankNodeSubject = new BlankNode("b1");
      const quotedTripleSubject = new QuotedTriple(
        new IRI("http://example.com/A"),
        new IRI("http://example.com/B"),
        new IRI("http://example.com/C")
      );
      const predicate = new IRI("http://example.com/p");
      const object = new IRI("http://example.com/o");

      // All valid subject types
      expect(() => new QuotedTriple(iriSubject, predicate, object)).not.toThrow();
      expect(() => new QuotedTriple(blankNodeSubject, predicate, object)).not.toThrow();
      expect(() => new QuotedTriple(quotedTripleSubject, predicate, object)).not.toThrow();

      // Literal is not a valid subject type (enforced at compile time)
      // const literalSubject = new Literal("invalid");
      // new QuotedTriple(literalSubject, predicate, object); // TypeScript error
    });

    it("should accept all valid object types (IRI, BlankNode, Literal, QuotedTriple)", () => {
      const subject = new IRI("http://example.com/Alice");
      const predicate = new IRI("http://example.com/p");

      const iriObject = new IRI("http://example.com/o");
      const blankNodeObject = new BlankNode("b1");
      const literalObject = new Literal("value");
      const quotedTripleObject = new QuotedTriple(
        new IRI("http://example.com/A"),
        new IRI("http://example.com/B"),
        new IRI("http://example.com/C")
      );

      // All valid object types
      expect(() => new QuotedTriple(subject, predicate, iriObject)).not.toThrow();
      expect(() => new QuotedTriple(subject, predicate, blankNodeObject)).not.toThrow();
      expect(() => new QuotedTriple(subject, predicate, literalObject)).not.toThrow();
      expect(() => new QuotedTriple(subject, predicate, quotedTripleObject)).not.toThrow();
    });
  });

  describe("RDF-Star use cases", () => {
    it("should model statement annotation (source)", () => {
      // Model: "Alice knows Bob" according to Wikipedia
      const statement = new QuotedTriple(
        new IRI("http://example.com/Alice"),
        new IRI("http://example.com/knows"),
        new IRI("http://example.com/Bob")
      );

      const annotation = new QuotedTriple(
        statement,
        new IRI("http://example.com/source"),
        new IRI("http://example.com/Wikipedia")
      );

      expect(annotation.subject).toBe(statement);
      expect(annotation.predicate.value).toBe("http://example.com/source");
      expect((annotation.object as IRI).value).toBe("http://example.com/Wikipedia");
    });

    it("should model statement annotation (confidence)", () => {
      // Model: "Alice knows Bob" with 95% confidence
      const statement = new QuotedTriple(
        new IRI("http://example.com/Alice"),
        new IRI("http://example.com/knows"),
        new IRI("http://example.com/Bob")
      );

      const annotation = new QuotedTriple(
        statement,
        new IRI("http://example.com/confidence"),
        new Literal("0.95")
      );

      expect(annotation.subject).toBe(statement);
      expect(annotation.predicate.value).toBe("http://example.com/confidence");
      expect((annotation.object as Literal).value).toBe("0.95");
    });

    it("should model provenance chain", () => {
      // Statement: Alice knows Bob
      const statement = new QuotedTriple(
        new IRI("http://example.com/Alice"),
        new IRI("http://example.com/knows"),
        new IRI("http://example.com/Bob")
      );

      // Wikipedia claims the statement
      const wikiClaim = new QuotedTriple(
        new IRI("http://example.com/Wikipedia"),
        new IRI("http://example.com/claims"),
        statement
      );

      // Research paper cites Wikipedia's claim
      const paperCitation = new QuotedTriple(
        new IRI("http://example.com/ResearchPaper"),
        new IRI("http://example.com/cites"),
        wikiClaim
      );

      expect(paperCitation.object).toBe(wikiClaim);
      expect((paperCitation.object as QuotedTriple).object).toBe(statement);
    });
  });
});
