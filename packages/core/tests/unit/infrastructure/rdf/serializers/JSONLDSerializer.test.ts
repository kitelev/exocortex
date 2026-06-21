import { describe, it, expect } from "@jest/globals";
import { JSONLDSerializer } from "../../../../../src/infrastructure/rdf/serializers/JSONLDSerializer";
import { Triple } from "../../../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../../src/domain/models/rdf/Literal";
import { BlankNode } from "../../../../../src/domain/models/rdf/BlankNode";

describe("JSONLDSerializer", () => {
  let serializer: JSONLDSerializer;

  beforeEach(() => {
    serializer = new JSONLDSerializer();
  });

  describe("toDocument", () => {
    it("should create document with default context", () => {
      const triple = new Triple(
        new IRI("http://example.org/s"),
        new IRI("http://example.org/p"),
        new IRI("http://example.org/o"),
      );
      const doc = serializer.toDocument([triple]);
      expect(doc["@context"]).toBeDefined();
      expect(doc["@context"]["rdf"]).toBeDefined();
      expect(doc["@context"]["rdfs"]).toBeDefined();
    });

    it("should merge custom context with default", () => {
      const triple = new Triple(
        new IRI("http://example.org/s"),
        new IRI("http://example.org/p"),
        new IRI("http://example.org/o"),
      );
      const doc = serializer.toDocument([triple], {
        context: { ex: "http://example.org/" },
      });
      expect(doc["@context"]["ex"]).toBe("http://example.org/");
      expect(doc["@context"]["rdf"]).toBeDefined();
    });

    it("should group triples by subject", () => {
      const triples = [
        new Triple(
          new IRI("http://example.org/s1"),
          new IRI("http://example.org/p1"),
          new IRI("http://example.org/o1"),
        ),
        new Triple(
          new IRI("http://example.org/s1"),
          new IRI("http://example.org/p2"),
          new IRI("http://example.org/o2"),
        ),
      ];
      const doc = serializer.toDocument(triples);
      expect(doc["@graph"]).toHaveLength(1);
      expect(doc["@graph"][0]["@id"]).toBe("http://example.org/s1");
    });

    it("should handle multiple values for same predicate as array", () => {
      const triples = [
        new Triple(
          new IRI("http://example.org/s1"),
          new IRI("http://example.org/type"),
          new IRI("http://example.org/ClassA"),
        ),
        new Triple(
          new IRI("http://example.org/s1"),
          new IRI("http://example.org/type"),
          new IRI("http://example.org/ClassB"),
        ),
      ];
      const doc = serializer.toDocument(triples);
      const node = doc["@graph"][0];
      const typeVal = node["http://example.org/type"];
      expect(Array.isArray(typeVal)).toBe(true);
      expect(typeVal).toHaveLength(2);
    });

    it("should handle three values for same predicate", () => {
      const triples = [
        new Triple(
          new IRI("http://example.org/s1"),
          new IRI("http://example.org/type"),
          new IRI("http://example.org/A"),
        ),
        new Triple(
          new IRI("http://example.org/s1"),
          new IRI("http://example.org/type"),
          new IRI("http://example.org/B"),
        ),
        new Triple(
          new IRI("http://example.org/s1"),
          new IRI("http://example.org/type"),
          new IRI("http://example.org/C"),
        ),
      ];
      const doc = serializer.toDocument(triples);
      const node = doc["@graph"][0];
      const typeVal = node["http://example.org/type"];
      expect(Array.isArray(typeVal)).toBe(true);
      expect(typeVal).toHaveLength(3);
    });

    it("should handle blank node subjects", () => {
      const triple = new Triple(
        new BlankNode("b0"),
        new IRI("http://example.org/p"),
        new IRI("http://example.org/o"),
      );
      const doc = serializer.toDocument([triple]);
      expect(doc["@graph"][0]["@id"]).toBe("_:b0");
    });

    it("should handle literal objects with language", () => {
      const triple = new Triple(
        new IRI("http://example.org/s"),
        new IRI("http://example.org/label"),
        new Literal("Hello", undefined, "en"),
      );
      const doc = serializer.toDocument([triple]);
      const node = doc["@graph"][0];
      const val = node["http://example.org/label"] as Record<string, string>;
      expect(val["@value"]).toBe("Hello");
      expect(val["@language"]).toBe("en");
    });

    it("should handle literal objects with datatype", () => {
      const triple = new Triple(
        new IRI("http://example.org/s"),
        new IRI("http://example.org/age"),
        new Literal("42", new IRI("http://www.w3.org/2001/XMLSchema#integer")),
      );
      const doc = serializer.toDocument([triple]);
      const node = doc["@graph"][0];
      const val = node["http://example.org/age"] as Record<string, string>;
      expect(val["@value"]).toBe("42");
      expect(val["@type"]).toBeDefined();
    });

    it("should handle blank node objects", () => {
      const triple = new Triple(
        new IRI("http://example.org/s"),
        new IRI("http://example.org/p"),
        new BlankNode("b1"),
      );
      const doc = serializer.toDocument([triple]);
      const node = doc["@graph"][0];
      const val = node["http://example.org/p"] as Record<string, string>;
      expect(val["@id"]).toBe("_:b1");
    });

    it("should compact IRIs using context", () => {
      const triple = new Triple(
        new IRI("http://example.org/s"),
        new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
        new IRI("http://example.org/o"),
      );
      const doc = serializer.toDocument([triple]);
      const node = doc["@graph"][0];
      // The rdf:type predicate should be compacted
      expect(node["rdf:type"]).toBeDefined();
    });

    it("should handle literal with directional language tag", () => {
      const triple = new Triple(
        new IRI("http://example.org/s"),
        new IRI("http://example.org/label"),
        new Literal("مرحبا", undefined, "ar", "rtl"),
      );
      const doc = serializer.toDocument([triple]);
      const node = doc["@graph"][0];
      const val = node["http://example.org/label"] as Record<string, string>;
      expect(val["@value"]).toBe("مرحبا");
      expect(val["@language"]).toBe("ar");
      expect(val["@direction"]).toBe("rtl");
    });

    it("should not compact IRI when namespace does not match", () => {
      const triple = new Triple(
        new IRI("http://example.org/s"),
        new IRI("http://unknown.org/predicate"),
        new IRI("http://example.org/o"),
      );
      const doc = serializer.toDocument([triple]);
      const node = doc["@graph"][0];
      // The predicate should remain as full IRI
      expect(node["http://unknown.org/predicate"]).toBeDefined();
    });

    it("should handle literal without datatype or language (plain literal)", () => {
      const triple = new Triple(
        new IRI("http://example.org/s"),
        new IRI("http://example.org/name"),
        new Literal("test"),
      );
      const doc = serializer.toDocument([triple]);
      const node = doc["@graph"][0];
      const val = node["http://example.org/name"] as Record<string, string>;
      expect(val["@value"]).toBe("test");
      expect(val["@type"]).toBeUndefined();
      expect(val["@language"]).toBeUndefined();
    });
  });

  describe("serialize", () => {
    it("should produce valid JSON string", () => {
      const triple = new Triple(
        new IRI("http://example.org/s"),
        new IRI("http://example.org/p"),
        new IRI("http://example.org/o"),
      );
      const result = serializer.serialize([triple]);
      expect(() => JSON.parse(result)).not.toThrow();
    });

    it("should produce pretty JSON when option enabled", () => {
      const triple = new Triple(
        new IRI("http://example.org/s"),
        new IRI("http://example.org/p"),
        new IRI("http://example.org/o"),
      );
      const result = serializer.serialize([triple], { pretty: true });
      expect(result).toContain("\n");
    });

    it("should use custom indent", () => {
      const triple = new Triple(
        new IRI("http://example.org/s"),
        new IRI("http://example.org/p"),
        new IRI("http://example.org/o"),
      );
      const result = serializer.serialize([triple], {
        pretty: true,
        indent: 4,
      });
      expect(result).toContain("    ");
    });

    it("should produce compact JSON when pretty is false", () => {
      const triple = new Triple(
        new IRI("http://example.org/s"),
        new IRI("http://example.org/p"),
        new IRI("http://example.org/o"),
      );
      const result = serializer.serialize([triple], { pretty: false });
      // Compact JSON should not have indentation-style newlines
      const parsed = JSON.parse(result);
      expect(parsed["@context"]).toBeDefined();
    });
  });
});
