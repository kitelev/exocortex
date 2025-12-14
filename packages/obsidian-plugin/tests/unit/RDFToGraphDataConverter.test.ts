import { RDFToGraphDataConverter } from "../../src/application/utils/RDFToGraphDataConverter";
import type { Triple, GraphData, GraphNode, GraphEdge } from "exocortex";

describe("RDFToGraphDataConverter", () => {
  describe("convert", () => {
    it("should convert empty triple array to empty graph data", () => {
      const triples: Triple[] = [];
      const result: GraphData = RDFToGraphDataConverter.convert(triples);

      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
    });

    it("should create nodes from subject and object IRIs", () => {
      const triples: Triple[] = [
        {
          subject: { toString: () => "https://example.org/note1" } as any,
          predicate: { toString: () => "https://example.org/relatesTo" } as any,
          object: { toString: () => "https://example.org/note2" } as any,
        },
      ];

      const result: GraphData = RDFToGraphDataConverter.convert(triples);

      expect(result.nodes).toHaveLength(2);
      expect(result.nodes[0].path).toBe("https://example.org/note1");
      expect(result.nodes[1].path).toBe("https://example.org/note2");
    });

    it("should create edges between IRI nodes", () => {
      const triples: Triple[] = [
        {
          subject: { toString: () => "https://example.org/note1" } as any,
          predicate: { toString: () => "https://example.org/relatesTo" } as any,
          object: { toString: () => "https://example.org/note2" } as any,
        },
      ];

      const result: GraphData = RDFToGraphDataConverter.convert(triples);

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].source).toBe("https://example.org/note1");
      expect(result.edges[0].target).toBe("https://example.org/note2");
      expect(result.edges[0].type).toBe("forward-link");
    });

    it("should not create duplicate nodes for same IRI", () => {
      const triples: Triple[] = [
        {
          subject: { toString: () => "https://example.org/note1" } as any,
          predicate: { toString: () => "https://example.org/relatesTo" } as any,
          object: { toString: () => "https://example.org/note2" } as any,
        },
        {
          subject: { toString: () => "https://example.org/note1" } as any,
          predicate: { toString: () => "https://example.org/alsoRelatesTo" } as any,
          object: { toString: () => "https://example.org/note3" } as any,
        },
      ];

      const result: GraphData = RDFToGraphDataConverter.convert(triples);

      expect(result.nodes).toHaveLength(3);
      const paths = result.nodes.map((n) => n.path);
      expect(paths).toContain("https://example.org/note1");
      expect(paths).toContain("https://example.org/note2");
      expect(paths).toContain("https://example.org/note3");
    });

    it("should resolve labels from rdfs:label predicates", () => {
      const triples: Triple[] = [
        {
          subject: { toString: () => "https://example.org/note1" } as any,
          predicate: { toString: () => "http://www.w3.org/2000/01/rdf-schema#label" } as any,
          object: { toString: () => '"My Note Title"' } as any,
        },
        {
          subject: { toString: () => "https://example.org/note1" } as any,
          predicate: { toString: () => "https://example.org/relatesTo" } as any,
          object: { toString: () => "https://example.org/note2" } as any,
        },
      ];

      const result: GraphData = RDFToGraphDataConverter.convert(triples);

      const node1 = result.nodes.find((n) => n.path === "https://example.org/note1");
      expect(node1).toBeDefined();
      expect(node1?.label).toBe("My Note Title");
      expect(node1?.title).toBe("My Note Title");
    });

    it("should resolve types from rdf:type predicates", () => {
      const triples: Triple[] = [
        {
          subject: { toString: () => "https://example.org/note1" } as any,
          predicate: { toString: () => "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" } as any,
          object: { toString: () => "https://example.org/ontology/Task" } as any,
        },
        {
          subject: { toString: () => "https://example.org/note1" } as any,
          predicate: { toString: () => "https://example.org/relatesTo" } as any,
          object: { toString: () => "https://example.org/note2" } as any,
        },
      ];

      const result: GraphData = RDFToGraphDataConverter.convert(triples);

      const node1 = result.nodes.find((n) => n.path === "https://example.org/note1");
      expect(node1).toBeDefined();
      expect(node1?.assetClass).toBe("Task");
    });

    it("should use basename as fallback for label and title", () => {
      const triples: Triple[] = [
        {
          subject: { toString: () => "https://example.org/path/to/note1" } as any,
          predicate: { toString: () => "https://example.org/relatesTo" } as any,
          object: { toString: () => "https://example.org/note2" } as any,
        },
      ];

      const result: GraphData = RDFToGraphDataConverter.convert(triples);

      const node1 = result.nodes.find((n) => n.path === "https://example.org/path/to/note1");
      expect(node1).toBeDefined();
      expect(node1?.label).toBe("note1");
      expect(node1?.title).toBe("note1");
    });

    it("should not create edges for literal objects", () => {
      const triples: Triple[] = [
        {
          subject: { toString: () => "https://example.org/note1" } as any,
          predicate: { toString: () => "https://example.org/hasValue" } as any,
          object: { toString: () => '"Some literal value"' } as any,
        },
      ];

      const result: GraphData = RDFToGraphDataConverter.convert(triples);

      expect(result.nodes).toHaveLength(1);
      expect(result.edges).toHaveLength(0);
    });

    it("should handle complex graph with multiple nodes and edges", () => {
      const triples: Triple[] = [
        {
          subject: { toString: () => "https://example.org/note1" } as any,
          predicate: { toString: () => "http://www.w3.org/2000/01/rdf-schema#label" } as any,
          object: { toString: () => '"Note One"' } as any,
        },
        {
          subject: { toString: () => "https://example.org/note2" } as any,
          predicate: { toString: () => "http://www.w3.org/2000/01/rdf-schema#label" } as any,
          object: { toString: () => '"Note Two"' } as any,
        },
        {
          subject: { toString: () => "https://example.org/note3" } as any,
          predicate: { toString: () => "http://www.w3.org/2000/01/rdf-schema#label" } as any,
          object: { toString: () => '"Note Three"' } as any,
        },
        {
          subject: { toString: () => "https://example.org/note1" } as any,
          predicate: { toString: () => "https://example.org/relatesTo" } as any,
          object: { toString: () => "https://example.org/note2" } as any,
        },
        {
          subject: { toString: () => "https://example.org/note1" } as any,
          predicate: { toString: () => "https://example.org/relatesTo" } as any,
          object: { toString: () => "https://example.org/note3" } as any,
        },
        {
          subject: { toString: () => "https://example.org/note2" } as any,
          predicate: { toString: () => "https://example.org/relatesTo" } as any,
          object: { toString: () => "https://example.org/note3" } as any,
        },
      ];

      const result: GraphData = RDFToGraphDataConverter.convert(triples);

      expect(result.nodes).toHaveLength(3);
      expect(result.edges).toHaveLength(3);

      const node1 = result.nodes.find((n) => n.path === "https://example.org/note1");
      expect(node1?.label).toBe("Note One");

      const node2 = result.nodes.find((n) => n.path === "https://example.org/note2");
      expect(node2?.label).toBe("Note Two");

      const node3 = result.nodes.find((n) => n.path === "https://example.org/note3");
      expect(node3?.label).toBe("Note Three");
    });

    it("should handle labels with language tags", () => {
      const triples: Triple[] = [
        {
          subject: { toString: () => "https://example.org/note1" } as any,
          predicate: { toString: () => "http://www.w3.org/2000/01/rdf-schema#label" } as any,
          object: { toString: () => '"My Note"@en' } as any,
        },
      ];

      const result: GraphData = RDFToGraphDataConverter.convert(triples);

      const node1 = result.nodes.find((n) => n.path === "https://example.org/note1");
      expect(node1?.label).toBe("My Note");
    });

    it("should handle labels with datatype IRIs", () => {
      const triples: Triple[] = [
        {
          subject: { toString: () => "https://example.org/note1" } as any,
          predicate: { toString: () => "http://www.w3.org/2000/01/rdf-schema#label" } as any,
          object: { toString: () => '"My Note"^^<http://www.w3.org/2001/XMLSchema#string>' } as any,
        },
      ];

      const result: GraphData = RDFToGraphDataConverter.convert(triples);

      const node1 = result.nodes.find((n) => n.path === "https://example.org/note1");
      expect(node1?.label).toBe("My Note");
    });

    it("should set isArchived to false for all nodes", () => {
      const triples: Triple[] = [
        {
          subject: { toString: () => "https://example.org/note1" } as any,
          predicate: { toString: () => "https://example.org/relatesTo" } as any,
          object: { toString: () => "https://example.org/note2" } as any,
        },
      ];

      const result: GraphData = RDFToGraphDataConverter.convert(triples);

      result.nodes.forEach((node) => {
        expect(node.isArchived).toBe(false);
      });
    });
  });

  describe("extractIRI", () => {
    it("should extract IRI from angle brackets", () => {
      const iri = (RDFToGraphDataConverter as any).extractIRI("<https://example.org/note1>");
      expect(iri).toBe("https://example.org/note1");
    });

    it("should return null for literals", () => {
      const iri = (RDFToGraphDataConverter as any).extractIRI('"Some literal"');
      expect(iri).toBeNull();
    });

    it("should return null for blank nodes", () => {
      const iri = (RDFToGraphDataConverter as any).extractIRI("_:b1");
      expect(iri).toBeNull();
    });

    it("should return null for invalid formats", () => {
      const iri = (RDFToGraphDataConverter as any).extractIRI("invalid");
      expect(iri).toBeNull();
    });

    it("should handle empty string", () => {
      const iri = (RDFToGraphDataConverter as any).extractIRI("");
      expect(iri).toBeNull();
    });
  });

  describe("extractLiteral", () => {
    it("should extract simple literal value", () => {
      const literal = (RDFToGraphDataConverter as any).extractLiteral('"Hello World"');
      expect(literal).toBe("Hello World");
    });

    it("should extract literal with language tag", () => {
      const literal = (RDFToGraphDataConverter as any).extractLiteral('"Hello"@en');
      expect(literal).toBe("Hello");
    });

    it("should extract literal with datatype IRI", () => {
      const literal = (RDFToGraphDataConverter as any).extractLiteral('"42"^^<http://www.w3.org/2001/XMLSchema#integer>');
      expect(literal).toBe("42");
    });

    it("should return null for IRIs", () => {
      const literal = (RDFToGraphDataConverter as any).extractLiteral("<https://example.org/note1>");
      expect(literal).toBeNull();
    });

    it("should return null for invalid formats", () => {
      const literal = (RDFToGraphDataConverter as any).extractLiteral("invalid");
      expect(literal).toBeNull();
    });

    it("should handle empty string", () => {
      const literal = (RDFToGraphDataConverter as any).extractLiteral("");
      expect(literal).toBeNull();
    });
  });

  describe("extractBasename", () => {
    it("should extract basename from IRI with slash separator", () => {
      const basename = (RDFToGraphDataConverter as any).extractBasename("https://example.org/path/to/note1");
      expect(basename).toBe("note1");
    });

    it("should extract basename from IRI with hash separator", () => {
      const basename = (RDFToGraphDataConverter as any).extractBasename("https://example.org/ontology#Task");
      expect(basename).toBe("Task");
    });

    it("should extract basename from IRI with mixed separators", () => {
      const basename = (RDFToGraphDataConverter as any).extractBasename("https://example.org/path/to#fragment");
      expect(basename).toBe("fragment");
    });

    it("should return full IRI if no separator found", () => {
      const basename = (RDFToGraphDataConverter as any).extractBasename("simple-iri");
      expect(basename).toBe("simple-iri");
    });

    it("should return full IRI if last part is empty", () => {
      const basename = (RDFToGraphDataConverter as any).extractBasename("https://example.org/");
      expect(basename).toBe("https://example.org/");
    });

    it("should handle empty string", () => {
      const basename = (RDFToGraphDataConverter as any).extractBasename("");
      expect(basename).toBe("");
    });
  });

  describe("isPlainIRI", () => {
    it("should return true for valid plain IRI", () => {
      const result = (RDFToGraphDataConverter as any).isPlainIRI("https://example.org/note1");
      expect(result).toBe(true);
    });

    it("should return true for http IRI", () => {
      const result = (RDFToGraphDataConverter as any).isPlainIRI("http://example.org/note1");
      expect(result).toBe(true);
    });

    it("should return true for obsidian IRI", () => {
      const result = (RDFToGraphDataConverter as any).isPlainIRI("obsidian://vault/note");
      expect(result).toBe(true);
    });

    it("should return false for literal", () => {
      const result = (RDFToGraphDataConverter as any).isPlainIRI('"Some literal"');
      expect(result).toBe(false);
    });

    it("should return false for blank node", () => {
      const result = (RDFToGraphDataConverter as any).isPlainIRI("_:b1");
      expect(result).toBe(false);
    });

    it("should return false for IRI with angle brackets", () => {
      const result = (RDFToGraphDataConverter as any).isPlainIRI("<https://example.org/note1>");
      expect(result).toBe(false);
    });

    it("should return false for invalid format", () => {
      const result = (RDFToGraphDataConverter as any).isPlainIRI("invalid-string");
      expect(result).toBe(false);
    });

    it("should return false for empty string", () => {
      const result = (RDFToGraphDataConverter as any).isPlainIRI("");
      expect(result).toBe(false);
    });
  });

  describe("createNode", () => {
    it("should create node with IRI as path and basename as label/title", () => {
      const node = (RDFToGraphDataConverter as any).createNode("https://example.org/path/to/note1");

      expect(node.path).toBe("https://example.org/path/to/note1");
      expect(node.label).toBe("note1");
      expect(node.title).toBe("note1");
      expect(node.isArchived).toBe(false);
    });

    it("should create node with full IRI if no basename extractable", () => {
      const node = (RDFToGraphDataConverter as any).createNode("simple-iri");

      expect(node.path).toBe("simple-iri");
      expect(node.label).toBe("simple-iri");
      expect(node.title).toBe("simple-iri");
    });
  });
});
