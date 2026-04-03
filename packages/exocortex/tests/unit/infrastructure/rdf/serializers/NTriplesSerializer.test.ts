import { describe, it, expect } from "@jest/globals";
import { NTriplesSerializer } from "../../../../../src/infrastructure/rdf/serializers/NTriplesSerializer";
import { Triple } from "../../../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../../src/domain/models/rdf/Literal";

describe("NTriplesSerializer", () => {
  let serializer: NTriplesSerializer;

  beforeEach(() => {
    serializer = new NTriplesSerializer();
  });

  const createTriple = (s: string, p: string, o: string) =>
    new Triple(new IRI(s), new IRI(p), new IRI(o));

  describe("serialize", () => {
    it("should return empty string for empty array", () => {
      expect(serializer.serialize([])).toBe("");
    });

    it("should serialize a single triple with default newline", () => {
      const triple = createTriple(
        "http://example.org/s",
        "http://example.org/p",
        "http://example.org/o",
      );
      const result = serializer.serialize([triple]);
      expect(result).toContain("<http://example.org/s>");
      expect(result).toContain("<http://example.org/p>");
      expect(result).toContain("<http://example.org/o>");
      expect(result.endsWith("\n")).toBe(true);
    });

    it("should serialize multiple triples", () => {
      const triples = [
        createTriple("http://ex.org/s1", "http://ex.org/p1", "http://ex.org/o1"),
        createTriple("http://ex.org/s2", "http://ex.org/p2", "http://ex.org/o2"),
      ];
      const result = serializer.serialize(triples);
      expect(result).toContain("s1");
      expect(result).toContain("s2");
    });

    it("should use custom newline", () => {
      const triple = createTriple(
        "http://example.org/s",
        "http://example.org/p",
        "http://example.org/o",
      );
      const result = serializer.serialize([triple], { newline: "\r\n" });
      expect(result.endsWith("\r\n")).toBe(true);
    });

    it("should serialize triple with literal object", () => {
      const triple = new Triple(
        new IRI("http://example.org/s"),
        new IRI("http://example.org/p"),
        new Literal("Hello World"),
      );
      const result = serializer.serialize([triple]);
      expect(result).toContain("Hello World");
    });
  });

  describe("serializeChunk", () => {
    it("should return empty string for empty array", () => {
      expect(serializer.serializeChunk([], "\n")).toBe("");
    });

    it("should serialize a chunk of triples", () => {
      const triples = [
        createTriple("http://ex.org/s1", "http://ex.org/p1", "http://ex.org/o1"),
      ];
      const result = serializer.serializeChunk(triples, "\n");
      expect(result).toContain("s1");
      expect(result.endsWith("\n")).toBe(true);
    });

    it("should use the provided newline character", () => {
      const triples = [
        createTriple("http://ex.org/s", "http://ex.org/p", "http://ex.org/o"),
      ];
      const result = serializer.serializeChunk(triples, "\r\n");
      expect(result.endsWith("\r\n")).toBe(true);
    });
  });
});
