import { NTriplesParser } from "../../../../../src/infrastructure/rdf/parsers/NTriplesParser";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../../src/domain/models/rdf/Literal";
import { BlankNode } from "../../../../../src/domain/models/rdf/BlankNode";

describe("NTriplesParser", () => {
  let parser: NTriplesParser;

  beforeEach(() => {
    parser = new NTriplesParser();
  });

  describe("parse", () => {
    it("should parse basic triple with full IRIs", () => {
      const input = '<http://example.org/s> <http://example.org/p> <http://example.org/o> .';
      const triples = parser.parse(input);
      expect(triples).toHaveLength(1);
      expect(triples[0].subject).toBeInstanceOf(IRI);
      expect((triples[0].subject as IRI).value).toBe("http://example.org/s");
    });

    it("should skip empty lines", () => {
      const input = '\n\n<http://example.org/s> <http://example.org/p> <http://example.org/o> .\n\n';
      const triples = parser.parse(input);
      expect(triples).toHaveLength(1);
    });

    it("should skip comment lines", () => {
      const input = '# This is a comment\n<http://example.org/s> <http://example.org/p> <http://example.org/o> .';
      const triples = parser.parse(input);
      expect(triples).toHaveLength(1);
    });

    it("should parse multiple triples", () => {
      const input = [
        '<http://example.org/s1> <http://example.org/p> <http://example.org/o1> .',
        '<http://example.org/s2> <http://example.org/p> <http://example.org/o2> .',
      ].join("\n");
      const triples = parser.parse(input);
      expect(triples).toHaveLength(2);
    });

    it("should use custom prefixes", () => {
      const input = 'ex:subject ex:predicate ex:object .';
      const triples = parser.parse(input, {
        prefixes: { ex: "http://example.org/" },
      });
      expect(triples).toHaveLength(1);
      expect((triples[0].subject as IRI).value).toBe("http://example.org/subject");
    });

    it("should use default prefixes for rdf, rdfs, owl, xsd, exo, ems", () => {
      const input = 'rdf:type rdf:type rdf:Property .';
      const triples = parser.parse(input);
      expect(triples).toHaveLength(1);
    });

    it("should handle Windows-style line endings (\\r\\n)", () => {
      const input = '<http://example.org/s> <http://example.org/p> <http://example.org/o> .\r\n# comment\r\n';
      const triples = parser.parse(input);
      expect(triples).toHaveLength(1);
    });
  });

  describe("parseLine", () => {
    it("should throw when line missing dot terminator", () => {
      const context = { prefixes: {}, strict: false };
      expect(() => parser.parseLine("missing dot", 1, context)).toThrow("missing '.' terminator");
    });

    it("should throw when unexpected tokens after object", () => {
      const context = { prefixes: { ex: "http://example.org/" }, strict: false };
      expect(() => parser.parseLine("<http://example.org/s> <http://example.org/p> <http://example.org/o> extra .", 1, context)).toThrow("Unexpected tokens after object");
    });
  });

  describe("subject parsing", () => {
    it("should parse IRI subject", () => {
      const input = '<http://example.org/s> <http://example.org/p> <http://example.org/o> .';
      const triples = parser.parse(input);
      expect(triples[0].subject).toBeInstanceOf(IRI);
    });

    it("should parse blank node subject", () => {
      const input = '_:b0 <http://example.org/p> <http://example.org/o> .';
      const triples = parser.parse(input);
      expect(triples[0].subject).toBeInstanceOf(BlankNode);
    });

    it("should parse prefixed name subject", () => {
      const input = 'rdf:type <http://example.org/p> <http://example.org/o> .';
      const triples = parser.parse(input);
      expect(triples[0].subject).toBeInstanceOf(IRI);
    });
  });

  describe("predicate parsing", () => {
    it("should parse IRI predicate", () => {
      const input = '<http://example.org/s> <http://example.org/p> <http://example.org/o> .';
      const triples = parser.parse(input);
      expect(triples[0].predicate).toBeInstanceOf(IRI);
    });

    it("should parse prefixed name predicate", () => {
      const input = '<http://example.org/s> rdf:type <http://example.org/o> .';
      const triples = parser.parse(input);
      expect(triples[0].predicate).toBeInstanceOf(IRI);
    });
  });

  describe("object parsing", () => {
    it("should parse IRI object", () => {
      const input = '<http://example.org/s> <http://example.org/p> <http://example.org/o> .';
      const triples = parser.parse(input);
      expect(triples[0].object).toBeInstanceOf(IRI);
    });

    it("should parse blank node object", () => {
      const input = '<http://example.org/s> <http://example.org/p> _:b0 .';
      const triples = parser.parse(input);
      expect(triples[0].object).toBeInstanceOf(BlankNode);
    });

    it("should parse plain literal object", () => {
      const input = '<http://example.org/s> <http://example.org/p> "hello" .';
      const triples = parser.parse(input);
      expect(triples[0].object).toBeInstanceOf(Literal);
      expect((triples[0].object as Literal).value).toBe("hello");
    });

    it("should parse literal with datatype (IRI form)", () => {
      const input = '<http://example.org/s> <http://example.org/p> "42"^^<http://www.w3.org/2001/XMLSchema#integer> .';
      const triples = parser.parse(input);
      const lit = triples[0].object as Literal;
      expect(lit.value).toBe("42");
      expect(lit.datatype).toBeInstanceOf(IRI);
    });

    it("should parse literal with datatype (prefixed form)", () => {
      const input = '<http://example.org/s> <http://example.org/p> "42"^^xsd:integer .';
      const triples = parser.parse(input);
      const lit = triples[0].object as Literal;
      expect(lit.value).toBe("42");
    });

    it("should parse literal with language tag", () => {
      const input = '<http://example.org/s> <http://example.org/p> "hello"@en .';
      const triples = parser.parse(input);
      const lit = triples[0].object as Literal;
      expect(lit.value).toBe("hello");
      expect(lit.language).toBe("en");
    });

    it("should parse prefixed name object", () => {
      const input = '<http://example.org/s> <http://example.org/p> rdf:type .';
      const triples = parser.parse(input);
      expect(triples[0].object).toBeInstanceOf(IRI);
    });
  });

  describe("escape sequences in literals", () => {
    it("should handle \\t escape", () => {
      const input = '<http://example.org/s> <http://example.org/p> "hello\\tworld" .';
      const triples = parser.parse(input);
      expect((triples[0].object as Literal).value).toBe("hello\tworld");
    });

    it("should handle \\n escape", () => {
      const input = '<http://example.org/s> <http://example.org/p> "hello\\nworld" .';
      const triples = parser.parse(input);
      expect((triples[0].object as Literal).value).toBe("hello\nworld");
    });

    it("should handle \\r escape", () => {
      const input = '<http://example.org/s> <http://example.org/p> "hello\\rworld" .';
      const triples = parser.parse(input);
      expect((triples[0].object as Literal).value).toBe("hello\rworld");
    });

    it("should handle \\b escape", () => {
      const input = '<http://example.org/s> <http://example.org/p> "hello\\bworld" .';
      const triples = parser.parse(input);
      expect((triples[0].object as Literal).value).toBe("hello\bworld");
    });

    it("should handle \\f escape", () => {
      const input = '<http://example.org/s> <http://example.org/p> "hello\\fworld" .';
      const triples = parser.parse(input);
      expect((triples[0].object as Literal).value).toBe("hello\fworld");
    });

    it("should handle escaped quote", () => {
      const input = '<http://example.org/s> <http://example.org/p> "he said \\"hi\\"" .';
      const triples = parser.parse(input);
      expect((triples[0].object as Literal).value).toBe('he said "hi"');
    });

    it("should handle escaped backslash", () => {
      const input = '<http://example.org/s> <http://example.org/p> "path\\\\to" .';
      const triples = parser.parse(input);
      expect((triples[0].object as Literal).value).toBe("path\\to");
    });

    it("should handle \\u unicode escape", () => {
      const input = '<http://example.org/s> <http://example.org/p> "\\u0041BC" .';
      const triples = parser.parse(input);
      expect((triples[0].object as Literal).value).toBe("ABC");
    });

    it("should handle \\U unicode escape", () => {
      const input = '<http://example.org/s> <http://example.org/p> "\\U00000041BC" .';
      const triples = parser.parse(input);
      expect((triples[0].object as Literal).value).toBe("ABC");
    });

    it("should throw for invalid \\u escape", () => {
      const input = '<http://example.org/s> <http://example.org/p> "\\u00GG" .';
      expect(() => parser.parse(input)).toThrow("Invalid \\u escape");
    });

    it("should throw for invalid \\U escape", () => {
      const input = '<http://example.org/s> <http://example.org/p> "\\U0000GGGG" .';
      expect(() => parser.parse(input)).toThrow("Invalid \\U escape");
    });

    it("should throw for unknown escape sequence", () => {
      const input = '<http://example.org/s> <http://example.org/p> "\\x" .';
      expect(() => parser.parse(input)).toThrow("Unknown escape sequence");
    });

    it("should throw for unterminated string literal", () => {
      const input = '<http://example.org/s> <http://example.org/p> "unterminated .';
      expect(() => parser.parse(input)).toThrow("Unterminated string literal");
    });

    it("should throw for escape at end of string", () => {
      const input = '<http://example.org/s> <http://example.org/p> "end\\ .';
      expect(() => parser.parse(input)).toThrow("Invalid escape sequence");
    });
  });

  describe("error handling", () => {
    it("should throw for invalid IRI (missing closing bracket)", () => {
      const input = '<http://example.org/s <http://example.org/p> <http://example.org/o> .';
      expect(() => parser.parse(input)).toThrow("Invalid IRI");
    });

    it("should throw for invalid blank node identifier", () => {
      const context = { prefixes: {}, strict: false };
      expect(() => parser.parseLine("_: <http://example.org/p> <http://example.org/o> .", 1, context)).toThrow("Invalid blank node identifier");
    });

    it("should throw for unknown prefix", () => {
      const input = 'unknown:thing <http://example.org/p> <http://example.org/o> .';
      expect(() => parser.parse(input)).toThrow('Unknown prefix "unknown"');
    });

    it("should throw for invalid language tag", () => {
      const context = { prefixes: {}, strict: false };
      // A language tag that doesn't match the pattern
      expect(() => parser.parseLine('<http://example.org/s> <http://example.org/p> "val"@123 .', 1, context)).toThrow("Invalid language tag");
    });

    it("should throw for invalid token at predicate position", () => {
      const context = { prefixes: {}, strict: false };
      expect(() => parser.parseLine('<http://example.org/s> 123invalid <http://example.org/o> .', 1, context)).toThrow("Invalid token");
    });
  });
});
