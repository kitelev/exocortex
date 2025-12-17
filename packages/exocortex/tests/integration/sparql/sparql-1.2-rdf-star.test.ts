/**
 * SPARQL 1.2 RDF-Star Integration Tests
 *
 * Tests for RDF-Star (RDF Reification) features including:
 * - QuotedTriple data model
 * - Structural equality
 * - Nested quoted triples
 * - Serialization
 *
 * Note: Full SPARQL query support for RDF-Star is planned for future releases.
 * Current implementation focuses on the QuotedTriple data model.
 *
 * Issue #994: SPARQL 1.2 Integration Test Suite
 *
 * @see https://w3c.github.io/sparql-12/spec/
 * @see https://w3c.github.io/rdf-star/cg-spec/
 */

import { QuotedTriple } from "../../../src/domain/models/rdf/QuotedTriple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { BlankNode } from "../../../src/domain/models/rdf/BlankNode";

// Namespaces
const EX = "http://example.org/";
const XSD_STRING = new IRI("http://www.w3.org/2001/XMLSchema#string");
const XSD_DECIMAL = new IRI("http://www.w3.org/2001/XMLSchema#decimal");

describe("SPARQL 1.2 RDF-Star Integration Tests", () => {
  describe("QuotedTriple Data Model", () => {
    describe("Basic Construction", () => {
      it("should create a quoted triple with IRI subject, predicate, and object", () => {
        const subject = new IRI(`${EX}Alice`);
        const predicate = new IRI(`${EX}knows`);
        const object = new IRI(`${EX}Bob`);

        const quotedTriple = new QuotedTriple(subject, predicate, object);

        expect(quotedTriple.subject).toBe(subject);
        expect(quotedTriple.predicate).toBe(predicate);
        expect(quotedTriple.object).toBe(object);
        expect(quotedTriple.termType).toBe("QuotedTriple");
      });

      it("should create a quoted triple with Literal object", () => {
        const subject = new IRI(`${EX}Alice`);
        const predicate = new IRI(`${EX}name`);
        const object = new Literal("Alice Smith", XSD_STRING);

        const quotedTriple = new QuotedTriple(subject, predicate, object);

        expect(quotedTriple.subject).toEqual(subject);
        expect(quotedTriple.predicate).toEqual(predicate);
        expect(quotedTriple.object).toEqual(object);
      });

      it("should create a quoted triple with BlankNode subject", () => {
        const subject = new BlankNode("b1");
        const predicate = new IRI(`${EX}type`);
        const object = new IRI(`${EX}Person`);

        const quotedTriple = new QuotedTriple(subject, predicate, object);

        expect(quotedTriple.subject).toBe(subject);
        expect(quotedTriple.predicate).toBe(predicate);
        expect(quotedTriple.object).toBe(object);
      });

      it("should create a quoted triple with BlankNode object", () => {
        const subject = new IRI(`${EX}Alice`);
        const predicate = new IRI(`${EX}relatedTo`);
        const object = new BlankNode("b2");

        const quotedTriple = new QuotedTriple(subject, predicate, object);

        expect(quotedTriple.subject).toBe(subject);
        expect(quotedTriple.object).toBe(object);
      });
    });

    describe("Structural Equality", () => {
      it("should be equal when all components are identical IRIs", () => {
        const qt1 = new QuotedTriple(
          new IRI(`${EX}Alice`),
          new IRI(`${EX}knows`),
          new IRI(`${EX}Bob`)
        );

        const qt2 = new QuotedTriple(
          new IRI(`${EX}Alice`),
          new IRI(`${EX}knows`),
          new IRI(`${EX}Bob`)
        );

        expect(qt1.equals(qt2)).toBe(true);
        expect(qt2.equals(qt1)).toBe(true);
      });

      it("should be equal when all components are identical with Literal object", () => {
        const qt1 = new QuotedTriple(
          new IRI(`${EX}Alice`),
          new IRI(`${EX}age`),
          new Literal("30", XSD_DECIMAL)
        );

        const qt2 = new QuotedTriple(
          new IRI(`${EX}Alice`),
          new IRI(`${EX}age`),
          new Literal("30", XSD_DECIMAL)
        );

        expect(qt1.equals(qt2)).toBe(true);
      });

      it("should not be equal when subjects differ", () => {
        const qt1 = new QuotedTriple(
          new IRI(`${EX}Alice`),
          new IRI(`${EX}knows`),
          new IRI(`${EX}Bob`)
        );

        const qt2 = new QuotedTriple(
          new IRI(`${EX}Charlie`),
          new IRI(`${EX}knows`),
          new IRI(`${EX}Bob`)
        );

        expect(qt1.equals(qt2)).toBe(false);
      });

      it("should not be equal when predicates differ", () => {
        const qt1 = new QuotedTriple(
          new IRI(`${EX}Alice`),
          new IRI(`${EX}knows`),
          new IRI(`${EX}Bob`)
        );

        const qt2 = new QuotedTriple(
          new IRI(`${EX}Alice`),
          new IRI(`${EX}loves`),
          new IRI(`${EX}Bob`)
        );

        expect(qt1.equals(qt2)).toBe(false);
      });

      it("should not be equal when objects differ", () => {
        const qt1 = new QuotedTriple(
          new IRI(`${EX}Alice`),
          new IRI(`${EX}knows`),
          new IRI(`${EX}Bob`)
        );

        const qt2 = new QuotedTriple(
          new IRI(`${EX}Alice`),
          new IRI(`${EX}knows`),
          new IRI(`${EX}Charlie`)
        );

        expect(qt1.equals(qt2)).toBe(false);
      });

      it("should not be equal when types differ (IRI vs BlankNode)", () => {
        const qt1 = new QuotedTriple(
          new IRI(`${EX}Alice`),
          new IRI(`${EX}knows`),
          new IRI(`${EX}Bob`)
        );

        const qt2 = new QuotedTriple(
          new BlankNode("alice"),
          new IRI(`${EX}knows`),
          new IRI(`${EX}Bob`)
        );

        expect(qt1.equals(qt2)).toBe(false);
      });
    });

    describe("Nested Quoted Triples", () => {
      it("should create nested quoted triple (quoted triple as object)", () => {
        // Inner triple: Alice knows Bob
        const innerTriple = new QuotedTriple(
          new IRI(`${EX}Alice`),
          new IRI(`${EX}knows`),
          new IRI(`${EX}Bob`)
        );

        // Outer triple: document1 asserts <Alice knows Bob>
        const outerTriple = new QuotedTriple(
          new IRI(`${EX}document1`),
          new IRI(`${EX}asserts`),
          innerTriple
        );

        expect(outerTriple.object).toBe(innerTriple);
        expect(outerTriple.object).toBeInstanceOf(QuotedTriple);
      });

      it("should create nested quoted triple (quoted triple as subject)", () => {
        // Inner triple: Alice knows Bob
        const innerTriple = new QuotedTriple(
          new IRI(`${EX}Alice`),
          new IRI(`${EX}knows`),
          new IRI(`${EX}Bob`)
        );

        // Outer triple: <Alice knows Bob> source Wikipedia
        const outerTriple = new QuotedTriple(
          innerTriple,
          new IRI(`${EX}source`),
          new IRI(`${EX}Wikipedia`)
        );

        expect(outerTriple.subject).toBe(innerTriple);
        expect(outerTriple.subject).toBeInstanceOf(QuotedTriple);
      });

      it("should compare nested quoted triples for equality", () => {
        const inner1 = new QuotedTriple(
          new IRI(`${EX}Alice`),
          new IRI(`${EX}knows`),
          new IRI(`${EX}Bob`)
        );

        const inner2 = new QuotedTriple(
          new IRI(`${EX}Alice`),
          new IRI(`${EX}knows`),
          new IRI(`${EX}Bob`)
        );

        const outer1 = new QuotedTriple(
          inner1,
          new IRI(`${EX}source`),
          new IRI(`${EX}Wikipedia`)
        );

        const outer2 = new QuotedTriple(
          inner2,
          new IRI(`${EX}source`),
          new IRI(`${EX}Wikipedia`)
        );

        expect(outer1.equals(outer2)).toBe(true);
      });

      it("should handle deeply nested quoted triples (3 levels)", () => {
        // Level 1: Alice knows Bob
        const level1 = new QuotedTriple(
          new IRI(`${EX}Alice`),
          new IRI(`${EX}knows`),
          new IRI(`${EX}Bob`)
        );

        // Level 2: <Alice knows Bob> source Wikipedia
        const level2 = new QuotedTriple(
          level1,
          new IRI(`${EX}source`),
          new IRI(`${EX}Wikipedia`)
        );

        // Level 3: <(<Alice knows Bob> source Wikipedia)> confidence 0.95
        const level3 = new QuotedTriple(
          level2,
          new IRI(`${EX}confidence`),
          new Literal("0.95", XSD_DECIMAL)
        );

        expect(level3.subject).toBeInstanceOf(QuotedTriple);
        const innerSubject = level3.subject as QuotedTriple;
        expect(innerSubject.subject).toBeInstanceOf(QuotedTriple);
      });
    });

    describe("Serialization", () => {
      it("should serialize simple quoted triple to RDF-Star Turtle syntax", () => {
        const qt = new QuotedTriple(
          new IRI(`${EX}Alice`),
          new IRI(`${EX}knows`),
          new IRI(`${EX}Bob`)
        );

        const serialized = qt.toString();

        expect(serialized).toMatch(/^<< /);
        expect(serialized).toMatch(/ >>$/);
        expect(serialized).toContain("<http://example.org/Alice>");
        expect(serialized).toContain("<http://example.org/knows>");
        expect(serialized).toContain("<http://example.org/Bob>");
      });

      it("should serialize quoted triple with Literal object", () => {
        const qt = new QuotedTriple(
          new IRI(`${EX}Alice`),
          new IRI(`${EX}name`),
          new Literal("Alice Smith", XSD_STRING)
        );

        const serialized = qt.toString();

        expect(serialized).toContain("<http://example.org/Alice>");
        expect(serialized).toContain("<http://example.org/name>");
        expect(serialized).toContain("Alice Smith");
      });

      it("should serialize quoted triple with BlankNode", () => {
        const qt = new QuotedTriple(
          new BlankNode("b1"),
          new IRI(`${EX}type`),
          new IRI(`${EX}Person`)
        );

        const serialized = qt.toString();

        expect(serialized).toMatch(/^<< /);
        expect(serialized).toContain("_:b1");
        expect(serialized).toContain("<http://example.org/type>");
        expect(serialized).toContain("<http://example.org/Person>");
      });

      it("should serialize nested quoted triples recursively", () => {
        const inner = new QuotedTriple(
          new IRI(`${EX}Alice`),
          new IRI(`${EX}knows`),
          new IRI(`${EX}Bob`)
        );

        const outer = new QuotedTriple(
          inner,
          new IRI(`${EX}source`),
          new IRI(`${EX}Wikipedia`)
        );

        const serialized = outer.toString();

        // Should have nested << >> structure
        expect(serialized.match(/<</g)?.length).toBe(2);
        expect(serialized.match(/>>/g)?.length).toBe(2);
        expect(serialized).toContain("<http://example.org/Alice>");
        expect(serialized).toContain("<http://example.org/source>");
        expect(serialized).toContain("<http://example.org/Wikipedia>");
      });
    });

    describe("Edge Cases", () => {
      it("should reject empty string literal (per Literal class validation)", () => {
        // The Literal class validates that values cannot be empty
        expect(() => {
          new Literal("", XSD_STRING);
        }).toThrow("Literal value cannot be empty");
      });

      it("should handle literal with special characters", () => {
        const qt = new QuotedTriple(
          new IRI(`${EX}resource`),
          new IRI(`${EX}description`),
          new Literal('Text with "quotes" and \\ backslash', XSD_STRING)
        );

        expect(qt.object).toBeInstanceOf(Literal);
      });

      it("should handle Unicode in literals", () => {
        const qt = new QuotedTriple(
          new IRI(`${EX}resource`),
          new IRI(`${EX}label`),
          new Literal("日本語テキスト 🌍", XSD_STRING)
        );

        expect((qt.object as Literal).value).toBe("日本語テキスト 🌍");
      });

      it("should handle language-tagged literal", () => {
        const qt = new QuotedTriple(
          new IRI(`${EX}resource`),
          new IRI(`${EX}label`),
          new Literal("Hello", undefined, "en")
        );

        expect(qt.object).toBeInstanceOf(Literal);
        expect((qt.object as Literal).language).toBe("en");
      });
    });

    describe("Use Case: Statement Annotation", () => {
      it("should model source annotation for a statement", () => {
        // Model: "Alice knows Bob" according to Wikipedia
        const statement = new QuotedTriple(
          new IRI(`${EX}Alice`),
          new IRI(`${EX}knows`),
          new IRI(`${EX}Bob`)
        );

        const annotation = new QuotedTriple(
          statement,
          new IRI(`${EX}source`),
          new IRI(`${EX}Wikipedia`)
        );

        expect(annotation.subject).toBe(statement);
        expect(annotation.predicate.value).toBe(`${EX}source`);
        expect((annotation.object as IRI).value).toBe(`${EX}Wikipedia`);
      });

      it("should model confidence annotation for a statement", () => {
        // Model: "Alice knows Bob" with 95% confidence
        const statement = new QuotedTriple(
          new IRI(`${EX}Alice`),
          new IRI(`${EX}knows`),
          new IRI(`${EX}Bob`)
        );

        const annotation = new QuotedTriple(
          statement,
          new IRI(`${EX}confidence`),
          new Literal("0.95", XSD_DECIMAL)
        );

        expect(annotation.subject).toBe(statement);
        expect(annotation.predicate.value).toBe(`${EX}confidence`);
        expect((annotation.object as Literal).value).toBe("0.95");
      });

      it("should model multiple annotations for same statement", () => {
        // Model: "Alice knows Bob" with source and timestamp annotations
        const statement = new QuotedTriple(
          new IRI(`${EX}Alice`),
          new IRI(`${EX}knows`),
          new IRI(`${EX}Bob`)
        );

        const sourceAnnotation = new QuotedTriple(
          statement,
          new IRI(`${EX}source`),
          new IRI(`${EX}Wikipedia`)
        );

        const timestampAnnotation = new QuotedTriple(
          statement,
          new IRI(`${EX}timestamp`),
          new Literal("2025-01-15T10:00:00Z", new IRI("http://www.w3.org/2001/XMLSchema#dateTime"))
        );

        // Both annotations reference the same statement
        expect(sourceAnnotation.subject).toBe(statement);
        expect(timestampAnnotation.subject).toBe(statement);
        expect(sourceAnnotation.equals(timestampAnnotation)).toBe(false);
      });
    });

    describe("Use Case: Provenance Tracking", () => {
      it("should model assertion with source document", () => {
        // Document1 claims that Alice knows Bob
        const claim = new QuotedTriple(
          new IRI(`${EX}Alice`),
          new IRI(`${EX}knows`),
          new IRI(`${EX}Bob`)
        );

        const assertion = new QuotedTriple(
          new IRI(`${EX}document1`),
          new IRI(`${EX}claims`),
          claim
        );

        expect((assertion.subject as IRI).value).toBe(`${EX}document1`);
        expect(assertion.predicate.value).toBe(`${EX}claims`);
        expect(assertion.object).toBe(claim);
      });

      it("should model assertion chain (document claims source claims statement)", () => {
        // Core statement: Alice knows Bob
        const statement = new QuotedTriple(
          new IRI(`${EX}Alice`),
          new IRI(`${EX}knows`),
          new IRI(`${EX}Bob`)
        );

        // Wikipedia asserts the statement
        const wikiAssertion = new QuotedTriple(
          new IRI(`${EX}Wikipedia`),
          new IRI(`${EX}asserts`),
          statement
        );

        // Research paper cites Wikipedia's assertion
        const paperCitation = new QuotedTriple(
          new IRI(`${EX}ResearchPaper`),
          new IRI(`${EX}cites`),
          wikiAssertion
        );

        expect(paperCitation.object).toBe(wikiAssertion);
        expect((paperCitation.object as QuotedTriple).object).toBe(statement);
      });
    });

    describe("isTRIPLE Type Checking Function", () => {
      it("should return true for QuotedTriple", () => {
        const { BuiltInFunctions } = require("../../../src/infrastructure/sparql/filters/BuiltInFunctions");

        const quotedTriple = new QuotedTriple(
          new IRI(`${EX}Alice`),
          new IRI(`${EX}knows`),
          new IRI(`${EX}Bob`)
        );

        expect(BuiltInFunctions.isTriple(quotedTriple)).toBe(true);
      });

      it("should return false for IRI", () => {
        const { BuiltInFunctions } = require("../../../src/infrastructure/sparql/filters/BuiltInFunctions");

        const iri = new IRI(`${EX}Alice`);
        expect(BuiltInFunctions.isTriple(iri)).toBe(false);
      });

      it("should return false for Literal", () => {
        const { BuiltInFunctions } = require("../../../src/infrastructure/sparql/filters/BuiltInFunctions");

        const literal = new Literal("test value", XSD_STRING);
        expect(BuiltInFunctions.isTriple(literal)).toBe(false);
      });

      it("should return false for BlankNode", () => {
        const { BuiltInFunctions } = require("../../../src/infrastructure/sparql/filters/BuiltInFunctions");

        const blank = new BlankNode("b1");
        expect(BuiltInFunctions.isTriple(blank)).toBe(false);
      });

      it("should return true for nested QuotedTriple", () => {
        const { BuiltInFunctions } = require("../../../src/infrastructure/sparql/filters/BuiltInFunctions");

        // Inner triple: Alice knows Bob
        const innerTriple = new QuotedTriple(
          new IRI(`${EX}Alice`),
          new IRI(`${EX}knows`),
          new IRI(`${EX}Bob`)
        );

        // Outer triple: << :Alice :knows :Bob >> :source :Wikipedia
        const nestedTriple = new QuotedTriple(
          innerTriple,
          new IRI(`${EX}source`),
          new IRI(`${EX}Wikipedia`)
        );

        expect(BuiltInFunctions.isTriple(nestedTriple)).toBe(true);
        expect(BuiltInFunctions.isTriple(nestedTriple.subject)).toBe(true);
      });
    });
  });
});
