import { TripleTranslator } from "../../../../../src/infrastructure/sparql/algebra/TripleTranslator";
import { AlgebraTranslatorError } from "../../../../../src/infrastructure/sparql/algebra/AlgebraTranslatorError";
import type { SparqljsPattern, SparqljsTriple, SparqljsTerm, SparqljsPropertyPath } from "../../../../../src/infrastructure/sparql/SparqljsTypes";

describe("TripleTranslator", () => {
  let translator: TripleTranslator;

  beforeEach(() => {
    translator = new TripleTranslator();
  });

  describe("translateBGP", () => {
    it("throws error when pattern has no triples array", () => {
      const pattern = { type: "bgp" } as unknown as SparqljsPattern;
      expect(() => translator.translateBGP(pattern)).toThrow(AlgebraTranslatorError);
      expect(() => translator.translateBGP(pattern)).toThrow("BGP pattern must have triples array");
    });

    it("translates BGP with valid triples", () => {
      const pattern = {
        type: "bgp",
        triples: [
          {
            subject: { termType: "Variable", value: "s" },
            predicate: { termType: "NamedNode", value: "http://example.org/p" },
            object: { termType: "Variable", value: "o" },
          },
        ],
      } as unknown as SparqljsPattern;

      const result = translator.translateBGP(pattern);
      expect(result.type).toBe("bgp");
      expect(result.triples).toHaveLength(1);
    });
  });

  describe("translateTriple", () => {
    it("throws error when triple is missing subject", () => {
      const triple = {
        predicate: { termType: "NamedNode", value: "http://example.org/p" },
        object: { termType: "Variable", value: "o" },
      } as unknown as SparqljsTriple;

      expect(() => translator.translateTriple(triple)).toThrow("Triple must have subject, predicate, and object");
    });

    it("throws error when triple is missing predicate", () => {
      const triple = {
        subject: { termType: "Variable", value: "s" },
        object: { termType: "Variable", value: "o" },
      } as unknown as SparqljsTriple;

      expect(() => translator.translateTriple(triple)).toThrow("Triple must have subject, predicate, and object");
    });

    it("throws error when triple is missing object", () => {
      const triple = {
        subject: { termType: "Variable", value: "s" },
        predicate: { termType: "NamedNode", value: "http://example.org/p" },
      } as unknown as SparqljsTriple;

      expect(() => translator.translateTriple(triple)).toThrow("Triple must have subject, predicate, and object");
    });
  });

  describe("translateConstructTemplate", () => {
    it("returns empty array for null/undefined template", () => {
      expect(translator.translateConstructTemplate(null as unknown as SparqljsTriple[])).toEqual([]);
      expect(translator.translateConstructTemplate(undefined as unknown as SparqljsTriple[])).toEqual([]);
    });

    it("returns empty array for non-array template", () => {
      expect(translator.translateConstructTemplate("not-array" as unknown as SparqljsTriple[])).toEqual([]);
    });

    it("translates valid template triples", () => {
      const template = [
        {
          subject: { termType: "Variable", value: "s" },
          predicate: { termType: "NamedNode", value: "http://example.org/p" },
          object: { termType: "Literal", value: "hello" },
        },
      ] as unknown as SparqljsTriple[];

      const result = translator.translateConstructTemplate(template);
      expect(result).toHaveLength(1);
      expect(result[0].subject).toEqual({ type: "variable", value: "s" });
    });
  });

  describe("translatePredicate", () => {
    it("translates property path predicate", () => {
      const path: SparqljsPropertyPath = {
        type: "path",
        pathType: "/",
        items: [
          { termType: "NamedNode", value: "http://ex.org/a" } as unknown as SparqljsPropertyPath,
          { termType: "NamedNode", value: "http://ex.org/b" } as unknown as SparqljsPropertyPath,
        ],
      } as unknown as SparqljsPropertyPath;

      const result = translator.translatePredicate(path);
      expect(result).toHaveProperty("pathType", "/");
    });

    it("translates simple IRI predicate", () => {
      const pred = { termType: "NamedNode", value: "http://ex.org/p" } as unknown as SparqljsTerm;
      const result = translator.translatePredicate(pred);
      expect(result).toEqual({ type: "iri", value: "http://ex.org/p" });
    });
  });

  describe("translatePropertyPath", () => {
    it("throws when path has no pathType", () => {
      const path = { type: "path", items: [] } as unknown as SparqljsPropertyPath;
      expect(() => translator.translatePropertyPath(path)).toThrow("Property path must have pathType");
    });

    it("throws when path has no items array", () => {
      const path = { type: "path", pathType: "/" } as unknown as SparqljsPropertyPath;
      expect(() => translator.translatePropertyPath(path)).toThrow("Property path must have items array");
    });

    it("translates sequence path (/)", () => {
      const path = {
        type: "path",
        pathType: "/",
        items: [
          { termType: "NamedNode", value: "http://ex.org/a" },
          { termType: "NamedNode", value: "http://ex.org/b" },
        ],
      } as unknown as SparqljsPropertyPath;

      const result = translator.translatePropertyPath(path);
      expect(result.pathType).toBe("/");
      expect(result.items).toHaveLength(2);
    });

    it("translates alternative path (|)", () => {
      const path = {
        type: "path",
        pathType: "|",
        items: [
          { termType: "NamedNode", value: "http://ex.org/a" },
          { termType: "NamedNode", value: "http://ex.org/b" },
        ],
      } as unknown as SparqljsPropertyPath;

      const result = translator.translatePropertyPath(path);
      expect(result.pathType).toBe("|");
    });

    it("translates inverse path (^)", () => {
      const path = {
        type: "path",
        pathType: "^",
        items: [{ termType: "NamedNode", value: "http://ex.org/a" }],
      } as unknown as SparqljsPropertyPath;

      const result = translator.translatePropertyPath(path);
      expect(result.pathType).toBe("^");
      expect(result.items).toHaveLength(1);
    });

    it("throws for inverse path with multiple items", () => {
      const path = {
        type: "path",
        pathType: "^",
        items: [
          { termType: "NamedNode", value: "http://ex.org/a" },
          { termType: "NamedNode", value: "http://ex.org/b" },
        ],
      } as unknown as SparqljsPropertyPath;

      expect(() => translator.translatePropertyPath(path)).toThrow("Inverse path must have exactly one item");
    });

    it("translates one-or-more path (+)", () => {
      const path = {
        type: "path",
        pathType: "+",
        items: [{ termType: "NamedNode", value: "http://ex.org/a" }],
      } as unknown as SparqljsPropertyPath;

      const result = translator.translatePropertyPath(path);
      expect(result.pathType).toBe("+");
    });

    it("throws for one-or-more path with multiple items", () => {
      const path = {
        type: "path",
        pathType: "+",
        items: [
          { termType: "NamedNode", value: "http://ex.org/a" },
          { termType: "NamedNode", value: "http://ex.org/b" },
        ],
      } as unknown as SparqljsPropertyPath;

      expect(() => translator.translatePropertyPath(path)).toThrow("OneOrMore path must have exactly one item");
    });

    it("translates zero-or-more path (*)", () => {
      const path = {
        type: "path",
        pathType: "*",
        items: [{ termType: "NamedNode", value: "http://ex.org/a" }],
      } as unknown as SparqljsPropertyPath;

      const result = translator.translatePropertyPath(path);
      expect(result.pathType).toBe("*");
    });

    it("throws for zero-or-more path with multiple items", () => {
      const path = {
        type: "path",
        pathType: "*",
        items: [
          { termType: "NamedNode", value: "http://ex.org/a" },
          { termType: "NamedNode", value: "http://ex.org/b" },
        ],
      } as unknown as SparqljsPropertyPath;

      expect(() => translator.translatePropertyPath(path)).toThrow("ZeroOrMore path must have exactly one item");
    });

    it("translates zero-or-one path (?)", () => {
      const path = {
        type: "path",
        pathType: "?",
        items: [{ termType: "NamedNode", value: "http://ex.org/a" }],
      } as unknown as SparqljsPropertyPath;

      const result = translator.translatePropertyPath(path);
      expect(result.pathType).toBe("?");
    });

    it("throws for zero-or-one path with multiple items", () => {
      const path = {
        type: "path",
        pathType: "?",
        items: [
          { termType: "NamedNode", value: "http://ex.org/a" },
          { termType: "NamedNode", value: "http://ex.org/b" },
        ],
      } as unknown as SparqljsPropertyPath;

      expect(() => translator.translatePropertyPath(path)).toThrow("ZeroOrOne path must have exactly one item");
    });

    it("throws for unsupported path type", () => {
      const path = {
        type: "path",
        pathType: "~",
        items: [{ termType: "NamedNode", value: "http://ex.org/a" }],
      } as unknown as SparqljsPropertyPath;

      expect(() => translator.translatePropertyPath(path)).toThrow("Unsupported property path type: ~");
    });

    it("translates nested property paths", () => {
      const path = {
        type: "path",
        pathType: "/",
        items: [
          {
            type: "path",
            pathType: "^",
            items: [{ termType: "NamedNode", value: "http://ex.org/a" }],
          },
          { termType: "NamedNode", value: "http://ex.org/b" },
        ],
      } as unknown as SparqljsPropertyPath;

      const result = translator.translatePropertyPath(path);
      expect(result.pathType).toBe("/");
      expect(result.items[0]).toHaveProperty("pathType", "^");
    });
  });

  describe("translatePathItem", () => {
    it("throws for unsupported path item type", () => {
      const item = { type: "unsupported" } as unknown as import("sparqljs").IriTerm;
      expect(() => translator.translatePathItem(item)).toThrow("Unsupported path item type: unsupported");
    });

    it("handles item without type or termType", () => {
      const item = { something: "else" } as unknown as import("sparqljs").IriTerm;
      expect(() => translator.translatePathItem(item)).toThrow("Unsupported path item type: unknown");
    });
  });

  describe("translateTripleElement", () => {
    it("throws for null element", () => {
      expect(() => translator.translateTripleElement(null as unknown as SparqljsTerm))
        .toThrow("Triple element must have termType");
    });

    it("throws for element without termType", () => {
      expect(() => translator.translateTripleElement({} as unknown as SparqljsTerm))
        .toThrow("Triple element must have termType");
    });

    it("translates Variable", () => {
      const elem = { termType: "Variable", value: "x" } as unknown as SparqljsTerm;
      expect(translator.translateTripleElement(elem)).toEqual({ type: "variable", value: "x" });
    });

    it("translates NamedNode", () => {
      const elem = { termType: "NamedNode", value: "http://ex.org/a" } as unknown as SparqljsTerm;
      expect(translator.translateTripleElement(elem)).toEqual({ type: "iri", value: "http://ex.org/a" });
    });

    it("translates Literal without language or datatype", () => {
      const elem = { termType: "Literal", value: "hello" } as unknown as SparqljsTerm;
      const result = translator.translateTripleElement(elem);
      expect(result).toEqual({ type: "literal", value: "hello", datatype: undefined, language: undefined });
    });

    it("translates Literal with datatype", () => {
      const elem = {
        termType: "Literal",
        value: "42",
        datatype: { value: "http://www.w3.org/2001/XMLSchema#integer" },
      } as unknown as SparqljsTerm;
      const result = translator.translateTripleElement(elem);
      expect(result).toHaveProperty("datatype", "http://www.w3.org/2001/XMLSchema#integer");
    });

    it("translates Literal with language and direction", () => {
      translator.setDirectionMappings(new Map([["ar", "rtl"]]));
      const elem = {
        termType: "Literal",
        value: "مرحبا",
        language: "ar",
      } as unknown as SparqljsTerm;

      const result = translator.translateTripleElement(elem);
      expect(result).toHaveProperty("language", "ar");
      expect(result).toHaveProperty("direction", "rtl");
    });

    it("translates Literal with language but no matching direction", () => {
      translator.setDirectionMappings(new Map([["ar", "rtl"]]));
      const elem = {
        termType: "Literal",
        value: "hello",
        language: "en",
      } as unknown as SparqljsTerm;

      const result = translator.translateTripleElement(elem);
      expect(result).toHaveProperty("language", "en");
      expect(result).not.toHaveProperty("direction");
    });

    it("translates BlankNode", () => {
      const elem = { termType: "BlankNode", value: "b0" } as unknown as SparqljsTerm;
      expect(translator.translateTripleElement(elem)).toEqual({ type: "blank", value: "b0" });
    });

    it("translates Quad (quoted triple)", () => {
      const elem = {
        termType: "Quad",
        subject: { termType: "NamedNode", value: "http://ex.org/s" },
        predicate: { termType: "NamedNode", value: "http://ex.org/p" },
        object: { termType: "Literal", value: "val" },
      } as unknown as SparqljsTerm;

      const result = translator.translateTripleElement(elem);
      expect(result).toHaveProperty("type", "quoted");
    });

    it("throws for unsupported termType", () => {
      const elem = { termType: "Unknown" } as unknown as SparqljsTerm;
      expect(() => translator.translateTripleElement(elem)).toThrow("Unsupported term type: Unknown");
    });
  });

  describe("quoted triple edge cases", () => {
    it("throws when quoted triple is missing subject", () => {
      const elem = {
        termType: "Quad",
        predicate: { termType: "NamedNode", value: "http://ex.org/p" },
        object: { termType: "Literal", value: "val" },
      } as unknown as SparqljsTerm;

      expect(() => translator.translateTripleElement(elem))
        .toThrow("Quoted triple must have subject, predicate, and object");
    });

    it("throws when quoted triple predicate is not IRI or Variable", () => {
      const elem = {
        termType: "Quad",
        subject: { termType: "NamedNode", value: "http://ex.org/s" },
        predicate: { termType: "Literal", value: "not-a-predicate" },
        object: { termType: "Literal", value: "val" },
      } as unknown as SparqljsTerm;

      expect(() => translator.translateTripleElement(elem))
        .toThrow("Quoted triple predicate must be IRI or Variable, got: Literal");
    });

    it("throws when quoted triple predicate is null", () => {
      const elem = {
        termType: "Quad",
        subject: { termType: "NamedNode", value: "http://ex.org/s" },
        predicate: null,
        object: { termType: "Literal", value: "val" },
      } as unknown as SparqljsTerm;

      expect(() => translator.translateTripleElement(elem))
        .toThrow("Quoted triple must have subject, predicate, and object");
    });

    it("translates quoted triple with Variable predicate", () => {
      const elem = {
        termType: "Quad",
        subject: { termType: "NamedNode", value: "http://ex.org/s" },
        predicate: { termType: "Variable", value: "p" },
        object: { termType: "Literal", value: "val" },
      } as unknown as SparqljsTerm;

      const result = translator.translateTripleElement(elem);
      expect(result).toHaveProperty("type", "quoted");
      expect((result as any).predicate).toEqual({ type: "variable", value: "p" });
    });
  });
});
