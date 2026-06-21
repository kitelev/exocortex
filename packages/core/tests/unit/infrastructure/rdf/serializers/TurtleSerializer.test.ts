import { describe, it, expect } from "@jest/globals";
import { TurtleSerializer } from "../../../../../src/infrastructure/rdf/serializers/TurtleSerializer";
import { Triple } from "../../../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";

describe("TurtleSerializer", () => {
  let serializer: TurtleSerializer;

  beforeEach(() => {
    serializer = new TurtleSerializer();
  });

  const createTriple = (s: string, p: string, o: string) =>
    new Triple(new IRI(s), new IRI(p), new IRI(o));

  describe("serialize", () => {
    it("should include default prefixes", () => {
      const triple = createTriple(
        "http://example.org/s",
        "http://example.org/p",
        "http://example.org/o",
      );
      const result = serializer.serialize([triple]);
      expect(result).toContain("@prefix rdf:");
      expect(result).toContain("@prefix rdfs:");
      expect(result).toContain("@prefix owl:");
      expect(result).toContain("@prefix xsd:");
    });

    it("should exclude default prefixes when includeDefaultPrefixes is false", () => {
      const triple = createTriple(
        "http://example.org/s",
        "http://example.org/p",
        "http://example.org/o",
      );
      const result = serializer.serialize([triple], {
        includeDefaultPrefixes: false,
      });
      expect(result).not.toContain("@prefix rdf:");
    });

    it("should include custom prefixes", () => {
      const triple = createTriple(
        "http://example.org/s",
        "http://example.org/p",
        "http://example.org/o",
      );
      const result = serializer.serialize([triple], {
        prefixes: { ex: "http://example.org/" },
      });
      expect(result).toContain("@prefix ex:");
    });

    it("should return empty string when no triples and no prefixes", () => {
      const result = serializer.serialize([], {
        includeDefaultPrefixes: false,
      });
      expect(result).toBe("");
    });

    it("should return only prefixes when no triples but has default prefixes", () => {
      const result = serializer.serialize([]);
      expect(result).toContain("@prefix");
      // No triple patterns (lines starting with < rather than @prefix)
      const lines = result.split("\n").filter((l: string) => l.trim().length > 0);
      const nonPrefixLines = lines.filter(
        (l: string) => !l.startsWith("@prefix"),
      );
      expect(nonPrefixLines).toHaveLength(0);
    });

    it("should return triples without prefix section if no prefixes", () => {
      const triple = createTriple(
        "http://example.org/s",
        "http://example.org/p",
        "http://example.org/o",
      );
      const result = serializer.serialize([triple], {
        includeDefaultPrefixes: false,
        prefixes: {},
      });
      expect(result).not.toContain("@prefix");
      expect(result).toContain("<http://example.org/s>");
    });

    it("should use custom newline", () => {
      const triple = createTriple(
        "http://example.org/s",
        "http://example.org/p",
        "http://example.org/o",
      );
      const result = serializer.serialize([triple], { newline: "\r\n" });
      expect(result).toContain("\r\n");
    });
  });

  describe("serializePrefixes", () => {
    it("should return empty string for empty prefixes", () => {
      expect(serializer.serializePrefixes({}, "\n")).toBe("");
    });

    it("should format prefixes correctly", () => {
      const result = serializer.serializePrefixes(
        { ex: "http://example.org/" },
        "\n",
      );
      expect(result).toBe("@prefix ex: <http://example.org/> .");
    });

    it("should join multiple prefixes with newline", () => {
      const result = serializer.serializePrefixes(
        { ex: "http://example.org/", foaf: "http://xmlns.com/foaf/0.1/" },
        "\n",
      );
      expect(result).toContain("@prefix ex:");
      expect(result).toContain("@prefix foaf:");
    });
  });

  describe("serializeTriplesOnly", () => {
    it("should serialize triples without prefixes", () => {
      const triples = [
        createTriple(
          "http://example.org/s",
          "http://example.org/p",
          "http://example.org/o",
        ),
      ];
      const result = serializer.serializeTriplesOnly(triples, "\n");
      expect(result).toContain("<http://example.org/s>");
      expect(result).not.toContain("@prefix");
    });
  });
});
