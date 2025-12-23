import {
  RDF_TYPE_PREDICATES,
  NodeStyle,
  EdgeStyle,
  NodeTypeDefinition,
  EdgeTypeDefinition,
  DEFAULT_NODE_STYLE,
  DEFAULT_EDGE_STYLE,
  BUILT_IN_NODE_STYLES,
  BUILT_IN_EDGE_STYLES,
  mergeNodeStyles,
  mergeEdgeStyles,
  extractLocalName,
  isClassType,
  isTypePredicate,
  isSubClassPredicate,
} from "../../../../src/domain/models/GraphTypes";

describe("GraphTypes", () => {
  describe("RDF_TYPE_PREDICATES", () => {
    it("should have correct RDF type URI", () => {
      expect(RDF_TYPE_PREDICATES.RDF_TYPE).toBe(
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"
      );
    });

    it("should have correct RDFS Class URI", () => {
      expect(RDF_TYPE_PREDICATES.RDFS_CLASS).toBe(
        "http://www.w3.org/2000/01/rdf-schema#Class"
      );
    });

    it("should have correct OWL Class URI", () => {
      expect(RDF_TYPE_PREDICATES.OWL_CLASS).toBe(
        "http://www.w3.org/2002/07/owl#Class"
      );
    });

    it("should have correct rdfs:subClassOf URI", () => {
      expect(RDF_TYPE_PREDICATES.RDFS_SUBCLASS_OF).toBe(
        "http://www.w3.org/2000/01/rdf-schema#subClassOf"
      );
    });
  });

  describe("DEFAULT_NODE_STYLE", () => {
    it("should have all required properties", () => {
      expect(DEFAULT_NODE_STYLE.color).toBeDefined();
      expect(DEFAULT_NODE_STYLE.borderColor).toBeDefined();
      expect(DEFAULT_NODE_STYLE.borderWidth).toBeDefined();
      expect(DEFAULT_NODE_STYLE.size).toBeDefined();
      expect(DEFAULT_NODE_STYLE.shape).toBe("circle");
      expect(DEFAULT_NODE_STYLE.opacity).toBe(1);
      expect(DEFAULT_NODE_STYLE.shadow).toBe(false);
      expect(DEFAULT_NODE_STYLE.animation).toBe("none");
    });
  });

  describe("DEFAULT_EDGE_STYLE", () => {
    it("should have all required properties", () => {
      expect(DEFAULT_EDGE_STYLE.color).toBeDefined();
      expect(DEFAULT_EDGE_STYLE.width).toBe(1);
      expect(DEFAULT_EDGE_STYLE.lineStyle).toBe("solid");
      expect(DEFAULT_EDGE_STYLE.arrow).toBe("standard");
      expect(DEFAULT_EDGE_STYLE.curvature).toBe(0);
      expect(DEFAULT_EDGE_STYLE.opacity).toBeDefined();
      expect(DEFAULT_EDGE_STYLE.showLabel).toBe(false);
      expect(DEFAULT_EDGE_STYLE.labelPosition).toBe(0.5);
    });
  });

  describe("BUILT_IN_NODE_STYLES", () => {
    it("should have style for ems__Task", () => {
      expect(BUILT_IN_NODE_STYLES["ems__Task"]).toBeDefined();
      expect(BUILT_IN_NODE_STYLES["ems__Task"].color).toBe("#22c55e");
      expect(BUILT_IN_NODE_STYLES["ems__Task"].shape).toBe("circle");
    });

    it("should have style for ems__Project", () => {
      expect(BUILT_IN_NODE_STYLES["ems__Project"]).toBeDefined();
      expect(BUILT_IN_NODE_STYLES["ems__Project"].color).toBe("#3b82f6");
      expect(BUILT_IN_NODE_STYLES["ems__Project"].shape).toBe("square");
    });

    it("should have style for ems__Area", () => {
      expect(BUILT_IN_NODE_STYLES["ems__Area"]).toBeDefined();
      expect(BUILT_IN_NODE_STYLES["ems__Area"].shape).toBe("hexagon");
    });

    it("should have style for rdfs:Class", () => {
      expect(BUILT_IN_NODE_STYLES[RDF_TYPE_PREDICATES.RDFS_CLASS]).toBeDefined();
      expect(BUILT_IN_NODE_STYLES[RDF_TYPE_PREDICATES.RDFS_CLASS].shape).toBe("diamond");
    });

    it("should have style for owl:Class", () => {
      expect(BUILT_IN_NODE_STYLES[RDF_TYPE_PREDICATES.OWL_CLASS]).toBeDefined();
      expect(BUILT_IN_NODE_STYLES[RDF_TYPE_PREDICATES.OWL_CLASS].shape).toBe("diamond");
    });
  });

  describe("BUILT_IN_EDGE_STYLES", () => {
    it("should have style for rdf:type", () => {
      expect(BUILT_IN_EDGE_STYLES[RDF_TYPE_PREDICATES.RDF_TYPE]).toBeDefined();
      expect(BUILT_IN_EDGE_STYLES[RDF_TYPE_PREDICATES.RDF_TYPE].lineStyle).toBe("dashed");
    });

    it("should have style for rdfs:subClassOf", () => {
      expect(BUILT_IN_EDGE_STYLES[RDF_TYPE_PREDICATES.RDFS_SUBCLASS_OF]).toBeDefined();
      expect(BUILT_IN_EDGE_STYLES[RDF_TYPE_PREDICATES.RDFS_SUBCLASS_OF].arrow).toBe("triangle");
    });

    it("should have style for ems:Effort_parent", () => {
      const parentUri = "https://exocortex.my/ontology/ems#Effort_parent";
      expect(BUILT_IN_EDGE_STYLES[parentUri]).toBeDefined();
    });
  });

  describe("mergeNodeStyles", () => {
    it("should merge two node styles", () => {
      const base: NodeStyle = { color: "#ff0000", size: 20 };
      const override: NodeStyle = { size: 30, shape: "square" };

      const result = mergeNodeStyles(base, override);

      expect(result.color).toBe("#ff0000");
      expect(result.size).toBe(30);
      expect(result.shape).toBe("square");
    });

    it("should not include undefined values from override", () => {
      const base: NodeStyle = { color: "#ff0000", size: 20 };
      const override: NodeStyle = { size: undefined };

      const result = mergeNodeStyles(base, override);

      expect(result.color).toBe("#ff0000");
      expect(result.size).toBe(20); // Not overwritten by undefined
    });

    it("should handle empty override", () => {
      const base: NodeStyle = { color: "#ff0000", size: 20 };
      const override: NodeStyle = {};

      const result = mergeNodeStyles(base, override);

      expect(result.color).toBe("#ff0000");
      expect(result.size).toBe(20);
    });

    it("should handle empty base", () => {
      const base: NodeStyle = {};
      const override: NodeStyle = { color: "#00ff00", size: 25 };

      const result = mergeNodeStyles(base, override);

      expect(result.color).toBe("#00ff00");
      expect(result.size).toBe(25);
    });
  });

  describe("mergeEdgeStyles", () => {
    it("should merge two edge styles", () => {
      const base: EdgeStyle = { color: "#ff0000", width: 2 };
      const override: EdgeStyle = { width: 3, lineStyle: "dashed" };

      const result = mergeEdgeStyles(base, override);

      expect(result.color).toBe("#ff0000");
      expect(result.width).toBe(3);
      expect(result.lineStyle).toBe("dashed");
    });

    it("should not include undefined values from override", () => {
      const base: EdgeStyle = { color: "#ff0000", width: 2 };
      const override: EdgeStyle = { width: undefined };

      const result = mergeEdgeStyles(base, override);

      expect(result.color).toBe("#ff0000");
      expect(result.width).toBe(2);
    });
  });

  describe("extractLocalName", () => {
    it("should extract local name from URI with hash", () => {
      expect(extractLocalName("http://www.w3.org/1999/02/22-rdf-syntax-ns#type")).toBe("type");
    });

    it("should extract local name from URI with slash", () => {
      expect(extractLocalName("http://example.org/ontology/Person")).toBe("Person");
    });

    it("should return full string if no separator", () => {
      expect(extractLocalName("Task")).toBe("Task");
    });

    it("should prefer hash over slash", () => {
      expect(extractLocalName("http://example.org/ns#localName")).toBe("localName");
    });
  });

  describe("isClassType", () => {
    it("should return true for rdfs:Class", () => {
      expect(isClassType(RDF_TYPE_PREDICATES.RDFS_CLASS)).toBe(true);
    });

    it("should return true for owl:Class", () => {
      expect(isClassType(RDF_TYPE_PREDICATES.OWL_CLASS)).toBe(true);
    });

    it("should return false for other URIs", () => {
      expect(isClassType("http://example.org/SomeClass")).toBe(false);
      expect(isClassType(RDF_TYPE_PREDICATES.RDF_TYPE)).toBe(false);
    });
  });

  describe("isTypePredicate", () => {
    it("should return true for rdf:type", () => {
      expect(isTypePredicate(RDF_TYPE_PREDICATES.RDF_TYPE)).toBe(true);
    });

    it("should return false for other predicates", () => {
      expect(isTypePredicate(RDF_TYPE_PREDICATES.RDFS_SUBCLASS_OF)).toBe(false);
      expect(isTypePredicate("http://example.org/somePredicate")).toBe(false);
    });
  });

  describe("isSubClassPredicate", () => {
    it("should return true for rdfs:subClassOf", () => {
      expect(isSubClassPredicate(RDF_TYPE_PREDICATES.RDFS_SUBCLASS_OF)).toBe(true);
    });

    it("should return false for other predicates", () => {
      expect(isSubClassPredicate(RDF_TYPE_PREDICATES.RDF_TYPE)).toBe(false);
      expect(isSubClassPredicate("http://example.org/somePredicate")).toBe(false);
    });
  });

  describe("TypeScript type definitions", () => {
    it("should allow creating NodeTypeDefinition", () => {
      const def: NodeTypeDefinition = {
        uri: "http://example.org/Task",
        label: "Task",
        source: "rdfs:Class",
        style: { color: "#00ff00" },
        priority: 1,
      };

      expect(def.uri).toBe("http://example.org/Task");
      expect(def.source).toBe("rdfs:Class");
    });

    it("should allow creating EdgeTypeDefinition with domain and range", () => {
      const def: EdgeTypeDefinition = {
        uri: "http://example.org/hasParent",
        label: "has parent",
        domain: ["http://example.org/Task"],
        range: ["http://example.org/Project"],
        source: "rdf:type",
        style: { color: "#0000ff" },
        priority: 1,
      };

      expect(def.domain).toContain("http://example.org/Task");
      expect(def.range).toContain("http://example.org/Project");
    });

    it("should support all TypeSource values", () => {
      const sources: Array<NodeTypeDefinition["source"]> = [
        "rdf:type",
        "rdfs:Class",
        "owl:Class",
        "exo:Instance_class",
        "inferred",
        "custom",
      ];

      sources.forEach(source => {
        const def: NodeTypeDefinition = {
          uri: "test",
          label: "test",
          source,
          style: {},
          priority: 1,
        };
        expect(def.source).toBe(source);
      });
    });

    it("should support all node shapes", () => {
      const shapes: Array<NonNullable<NodeStyle["shape"]>> = [
        "circle",
        "square",
        "diamond",
        "triangle",
        "hexagon",
      ];

      shapes.forEach(shape => {
        const style: NodeStyle = { shape };
        expect(style.shape).toBe(shape);
      });
    });

    it("should support all edge line styles", () => {
      const lineStyles: Array<NonNullable<EdgeStyle["lineStyle"]>> = [
        "solid",
        "dashed",
        "dotted",
      ];

      lineStyles.forEach(lineStyle => {
        const style: EdgeStyle = { lineStyle };
        expect(style.lineStyle).toBe(lineStyle);
      });
    });
  });
});
