import { ResultSerializer } from "../../../../../src/infrastructure/sparql/serializers/ResultSerializer";
import { SolutionMapping } from "../../../../../src/infrastructure/sparql/SolutionMapping";
import { Literal, createDirectionalLiteral } from "../../../../../src/domain/models/rdf/Literal";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";
import { BlankNode } from "../../../../../src/domain/models/rdf/BlankNode";

describe("ResultSerializer", () => {
  let serializer: ResultSerializer;

  beforeEach(() => {
    serializer = new ResultSerializer();
  });

  describe("JSON serialization", () => {
    it("should serialize empty results", () => {
      const result = serializer.serializeJSON([]);
      const parsed = JSON.parse(result);

      expect(parsed.head.vars).toEqual([]);
      expect(parsed.results.bindings).toEqual([]);
    });

    it("should serialize simple literal", () => {
      const mapping = new SolutionMapping();
      mapping.set("label", new Literal("Hello World"));

      const result = serializer.serializeJSON([mapping]);
      const parsed = JSON.parse(result);

      expect(parsed.head.vars).toContain("label");
      expect(parsed.results.bindings[0].label).toEqual({
        type: "literal",
        value: "Hello World",
      });
    });

    it("should serialize IRI", () => {
      const mapping = new SolutionMapping();
      mapping.set("resource", new IRI("http://example.org/resource"));

      const result = serializer.serializeJSON([mapping]);
      const parsed = JSON.parse(result);

      expect(parsed.results.bindings[0].resource).toEqual({
        type: "uri",
        value: "http://example.org/resource",
      });
    });

    it("should serialize blank node", () => {
      const mapping = new SolutionMapping();
      mapping.set("node", new BlankNode("b1"));

      const result = serializer.serializeJSON([mapping]);
      const parsed = JSON.parse(result);

      expect(parsed.results.bindings[0].node).toEqual({
        type: "bnode",
        value: "b1",
      });
    });

    it("should serialize literal with datatype", () => {
      const mapping = new SolutionMapping();
      mapping.set(
        "count",
        new Literal("42", new IRI("http://www.w3.org/2001/XMLSchema#integer"))
      );

      const result = serializer.serializeJSON([mapping]);
      const parsed = JSON.parse(result);

      expect(parsed.results.bindings[0].count).toEqual({
        type: "literal",
        value: "42",
        datatype: "http://www.w3.org/2001/XMLSchema#integer",
      });
    });

    it("should serialize literal with language tag", () => {
      const mapping = new SolutionMapping();
      mapping.set("name", new Literal("Hola", undefined, "es"));

      const result = serializer.serializeJSON([mapping]);
      const parsed = JSON.parse(result);

      expect(parsed.results.bindings[0].name).toEqual({
        type: "literal",
        value: "Hola",
        "xml:lang": "es",
      });
    });

    describe("directional literals (SPARQL 1.2)", () => {
      it("should serialize directional literal with rtl direction", () => {
        const mapping = new SolutionMapping();
        mapping.set("greeting", createDirectionalLiteral("مرحبا", "ar", "rtl"));

        const result = serializer.serializeJSON([mapping]);
        const parsed = JSON.parse(result);

        expect(parsed.results.bindings[0].greeting).toEqual({
          type: "literal",
          value: "مرحبا",
          "xml:lang": "ar",
          direction: "rtl",
        });
      });

      it("should serialize directional literal with ltr direction", () => {
        const mapping = new SolutionMapping();
        mapping.set("text", createDirectionalLiteral("Hello", "en", "ltr"));

        const result = serializer.serializeJSON([mapping]);
        const parsed = JSON.parse(result);

        expect(parsed.results.bindings[0].text).toEqual({
          type: "literal",
          value: "Hello",
          "xml:lang": "en",
          direction: "ltr",
        });
      });

      it("should not include direction for non-directional language literals", () => {
        const mapping = new SolutionMapping();
        mapping.set("text", new Literal("Hello", undefined, "en"));

        const result = serializer.serializeJSON([mapping]);
        const parsed = JSON.parse(result);

        const binding = parsed.results.bindings[0].text;
        expect(binding["xml:lang"]).toBe("en");
        expect(binding.direction).toBeUndefined();
      });

      it("should serialize multiple directional literals with different directions", () => {
        const mapping = new SolutionMapping();
        mapping.set("arabic", createDirectionalLiteral("مرحبا", "ar", "rtl"));
        mapping.set("english", createDirectionalLiteral("Hello", "en", "ltr"));

        const result = serializer.serializeJSON([mapping]);
        const parsed = JSON.parse(result);

        expect(parsed.results.bindings[0].arabic.direction).toBe("rtl");
        expect(parsed.results.bindings[0].english.direction).toBe("ltr");
      });
    });

    it("should respect pretty option", () => {
      const mapping = new SolutionMapping();
      mapping.set("x", new Literal("test"));

      const prettyResult = serializer.serializeJSON([mapping], { pretty: true });
      const compactResult = serializer.serializeJSON([mapping], { pretty: false });

      expect(prettyResult.includes("\n")).toBe(true);
      expect(compactResult.includes("\n")).toBe(false);
    });
  });

  describe("XML serialization", () => {
    it("should serialize empty results", () => {
      const result = serializer.serializeXML([]);

      expect(result).toContain('<?xml version="1.0"?>');
      expect(result).toContain("<head>");
      expect(result).toContain("<results>");
      expect(result).not.toContain("<variable");
    });

    it("should serialize IRI", () => {
      const mapping = new SolutionMapping();
      mapping.set("s", new IRI("http://example.org/resource"));

      const result = serializer.serializeXML([mapping]);

      expect(result).toContain('<variable name="s"/>');
      expect(result).toContain('<binding name="s">');
      expect(result).toContain("<uri>http://example.org/resource</uri>");
    });

    it("should serialize blank node", () => {
      const mapping = new SolutionMapping();
      mapping.set("node", new BlankNode("b1"));

      const result = serializer.serializeXML([mapping]);

      expect(result).toContain("<bnode>b1</bnode>");
    });

    it("should serialize literal with language tag", () => {
      const mapping = new SolutionMapping();
      mapping.set("label", new Literal("Hello", undefined, "en"));

      const result = serializer.serializeXML([mapping]);

      expect(result).toContain('xml:lang="en"');
      expect(result).toContain("Hello</literal>");
    });

    describe("directional literals (SPARQL 1.2)", () => {
      it("should serialize directional literal with direction attribute", () => {
        const mapping = new SolutionMapping();
        mapping.set("greeting", createDirectionalLiteral("مرحبا", "ar", "rtl"));

        const result = serializer.serializeXML([mapping]);

        expect(result).toContain('xml:lang="ar"');
        expect(result).toContain('direction="rtl"');
        expect(result).toContain("مرحبا</literal>");
      });

      it("should not include direction attribute for non-directional literals", () => {
        const mapping = new SolutionMapping();
        mapping.set("text", new Literal("Hello", undefined, "en"));

        const result = serializer.serializeXML([mapping]);

        expect(result).toContain('xml:lang="en"');
        expect(result).not.toContain('direction="');
      });
    });

    it("should escape XML special characters", () => {
      const mapping = new SolutionMapping();
      mapping.set("text", new Literal("a < b & c > d"));

      const result = serializer.serializeXML([mapping]);

      expect(result).toContain("&lt;");
      expect(result).toContain("&amp;");
      expect(result).toContain("&gt;");
    });
  });

  describe("CSV serialization", () => {
    it("should serialize empty results", () => {
      const result = serializer.serializeCSV([]);
      expect(result).toBe("");
    });

    it("should serialize simple values", () => {
      const mapping = new SolutionMapping();
      mapping.set("a", new Literal("value1"));
      mapping.set("b", new Literal("value2"));

      const result = serializer.serializeCSV([mapping]);
      const lines = result.split("\n");

      expect(lines[0]).toBe("a,b");
      expect(lines[1]).toBe("value1,value2");
    });

    it("should serialize IRI in CSV", () => {
      const mapping = new SolutionMapping();
      mapping.set("uri", new IRI("http://example.org/resource"));

      const result = serializer.serializeCSV([mapping]);
      const lines = result.split("\n");

      expect(lines[1]).toBe("http://example.org/resource");
    });

    it("should escape commas in CSV values", () => {
      const mapping = new SolutionMapping();
      mapping.set("text", new Literal("hello, world"));

      const result = serializer.serializeCSV([mapping]);
      const lines = result.split("\n");

      expect(lines[1]).toBe('"hello, world"');
    });

    describe("directional literals (SPARQL 1.2)", () => {
      it("should serialize directional literal with lang--dir syntax", () => {
        const mapping = new SolutionMapping();
        mapping.set("greeting", createDirectionalLiteral("مرحبا", "ar", "rtl"));

        const result = serializer.serializeCSV([mapping]);
        const lines = result.split("\n");

        expect(lines[1]).toBe("مرحبا@ar--rtl");
      });

      it("should serialize ltr directional literal", () => {
        const mapping = new SolutionMapping();
        mapping.set("text", createDirectionalLiteral("Hello", "en", "ltr"));

        const result = serializer.serializeCSV([mapping]);
        const lines = result.split("\n");

        expect(lines[1]).toBe("Hello@en--ltr");
      });

      it("should not include direction for non-directional literals", () => {
        const mapping = new SolutionMapping();
        mapping.set("text", new Literal("Hello", undefined, "en"));

        const result = serializer.serializeCSV([mapping]);
        const lines = result.split("\n");

        expect(lines[1]).toBe("Hello@en");
      });
    });
  });

  describe("Turtle serialization", () => {
    it("should serialize empty results", () => {
      const result = serializer.serializeTurtle([]);

      expect(result).toContain("# SPARQL Results - 0 solution(s)");
    });

    it("should serialize IRI in angle brackets", () => {
      const mapping = new SolutionMapping();
      mapping.set("uri", new IRI("http://example.org/resource"));

      const result = serializer.serializeTurtle([mapping]);

      expect(result).toContain("?uri = <http://example.org/resource>");
    });

    it("should serialize blank node with _: prefix", () => {
      const mapping = new SolutionMapping();
      mapping.set("node", new BlankNode("b1"));

      const result = serializer.serializeTurtle([mapping]);

      expect(result).toContain("?node = _:b1");
    });

    it("should serialize quoted string literal", () => {
      const mapping = new SolutionMapping();
      mapping.set("name", new Literal("Hello"));

      const result = serializer.serializeTurtle([mapping]);

      expect(result).toContain('?name = "Hello"');
    });

    it("should serialize literal with language tag", () => {
      const mapping = new SolutionMapping();
      mapping.set("text", new Literal("Bonjour", undefined, "fr"));

      const result = serializer.serializeTurtle([mapping]);

      expect(result).toContain('?text = "Bonjour"@fr');
    });

    describe("directional literals (SPARQL 1.2)", () => {
      it("should serialize directional literal with @lang--dir syntax", () => {
        const mapping = new SolutionMapping();
        mapping.set("greeting", createDirectionalLiteral("مرحبا", "ar", "rtl"));

        const result = serializer.serializeTurtle([mapping]);

        expect(result).toContain('?greeting = "مرحبا"@ar--rtl');
      });

      it("should serialize ltr directional literal", () => {
        const mapping = new SolutionMapping();
        mapping.set("text", createDirectionalLiteral("Hello", "en", "ltr"));

        const result = serializer.serializeTurtle([mapping]);

        expect(result).toContain('?text = "Hello"@en--ltr');
      });

      it("should not include direction suffix for non-directional literals", () => {
        const mapping = new SolutionMapping();
        mapping.set("text", new Literal("Hello", undefined, "en"));

        const result = serializer.serializeTurtle([mapping]);

        expect(result).toContain('?text = "Hello"@en');
        expect(result).not.toContain("--ltr");
        expect(result).not.toContain("--rtl");
      });
    });

    it("should serialize literal with datatype", () => {
      const mapping = new SolutionMapping();
      mapping.set(
        "count",
        new Literal("42", new IRI("http://www.w3.org/2001/XMLSchema#integer"))
      );

      const result = serializer.serializeTurtle([mapping]);

      expect(result).toContain(
        '?count = "42"^^<http://www.w3.org/2001/XMLSchema#integer>'
      );
    });
  });

  describe("toJSONResultSet", () => {
    it("should produce valid SPARQL Results JSON structure", () => {
      const mapping1 = new SolutionMapping();
      mapping1.set("s", new IRI("http://example.org/a"));
      mapping1.set("p", new IRI("http://example.org/prop"));

      const mapping2 = new SolutionMapping();
      mapping2.set("s", new IRI("http://example.org/b"));
      mapping2.set("p", new IRI("http://example.org/prop2"));

      const result = serializer.toJSONResultSet([mapping1, mapping2]);

      expect(result.head.vars).toContain("s");
      expect(result.head.vars).toContain("p");
      expect(result.results.bindings.length).toBe(2);
    });

    it("should respect variables option", () => {
      const mapping = new SolutionMapping();
      mapping.set("a", new Literal("1"));
      mapping.set("b", new Literal("2"));
      mapping.set("c", new Literal("3"));

      const result = serializer.toJSONResultSet([mapping], {
        variables: ["a", "c"],
      });

      expect(result.head.vars).toEqual(["a", "c"]);
      expect(result.results.bindings[0]).toHaveProperty("a");
      expect(result.results.bindings[0]).toHaveProperty("c");
      expect(result.results.bindings[0]).not.toHaveProperty("b");
    });
  });

  describe("format selection", () => {
    it("should serialize to JSON format", () => {
      const mapping = new SolutionMapping();
      mapping.set("x", new Literal("test"));

      const result = serializer.serialize([mapping], "json");

      expect(result).toContain('"head"');
      expect(result).toContain('"results"');
    });

    it("should serialize to XML format", () => {
      const mapping = new SolutionMapping();
      mapping.set("x", new Literal("test"));

      const result = serializer.serialize([mapping], "xml");

      expect(result).toContain("<?xml");
      expect(result).toContain("<sparql");
    });

    it("should serialize to CSV format", () => {
      const mapping = new SolutionMapping();
      mapping.set("x", new Literal("test"));

      const result = serializer.serialize([mapping], "csv");

      expect(result).toContain("x");
      expect(result).toContain("test");
    });

    it("should serialize to Turtle format", () => {
      const mapping = new SolutionMapping();
      mapping.set("x", new Literal("test"));

      const result = serializer.serialize([mapping], "turtle");

      expect(result).toContain("# SPARQL Results");
      expect(result).toContain('?x = "test"');
    });

    it("should throw error for unsupported format", () => {
      const mapping = new SolutionMapping();
      mapping.set("x", new Literal("test"));

      expect(() =>
        serializer.serialize([mapping], "invalid" as any)
      ).toThrow("Unsupported result format: invalid");
    });
  });
});
