import { SolutionMapping } from "../../../../src/infrastructure/sparql/SolutionMapping";
import { IRI } from "../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../src/domain/models/rdf/Literal";
import { BlankNode } from "../../../../src/domain/models/rdf/BlankNode";

describe("SolutionMapping", () => {
  let iri1: IRI;
  let iri2: IRI;
  let literal1: Literal;
  let literal2: Literal;
  let blank1: BlankNode;

  beforeEach(() => {
    iri1 = new IRI("http://example.org/resource1");
    iri2 = new IRI("http://example.org/resource2");
    literal1 = new Literal("value1");
    literal2 = new Literal("value2");
    blank1 = new BlankNode("b1");
  });

  describe("Basic Operations", () => {
    it("should create empty mapping", () => {
      const mapping = new SolutionMapping();
      expect(mapping.size()).toBe(0);
      expect(mapping.variables()).toEqual([]);
    });

    it("should set and get bindings", () => {
      const mapping = new SolutionMapping();
      mapping.set("x", iri1);
      mapping.set("y", literal1);

      expect(mapping.get("x")).toBe(iri1);
      expect(mapping.get("y")).toBe(literal1);
      expect(mapping.get("z")).toBeUndefined();
    });

    it("should check if variable is bound", () => {
      const mapping = new SolutionMapping();
      mapping.set("x", iri1);

      expect(mapping.has("x")).toBe(true);
      expect(mapping.has("y")).toBe(false);
    });

    it("should return all variable names", () => {
      const mapping = new SolutionMapping();
      mapping.set("x", iri1);
      mapping.set("y", literal1);
      mapping.set("z", blank1);

      const variables = mapping.variables();
      expect(variables).toHaveLength(3);
      expect(variables).toContain("x");
      expect(variables).toContain("y");
      expect(variables).toContain("z");
    });

    it("should get all bindings as Map", () => {
      const mapping = new SolutionMapping();
      mapping.set("x", iri1);
      mapping.set("y", literal1);

      const bindings = mapping.getBindings();
      expect(bindings.size).toBe(2);
      expect(bindings.get("x")).toBe(iri1);
      expect(bindings.get("y")).toBe(literal1);
    });

    it("should return size of mapping", () => {
      const mapping = new SolutionMapping();
      expect(mapping.size()).toBe(0);

      mapping.set("x", iri1);
      expect(mapping.size()).toBe(1);

      mapping.set("y", literal1);
      expect(mapping.size()).toBe(2);
    });
  });

  describe("Compatibility", () => {
    it("should be compatible with empty mapping", () => {
      const mapping1 = new SolutionMapping();
      mapping1.set("x", iri1);

      const mapping2 = new SolutionMapping();

      expect(mapping1.isCompatibleWith(mapping2)).toBe(true);
      expect(mapping2.isCompatibleWith(mapping1)).toBe(true);
    });

    it("should be compatible when no overlapping variables", () => {
      const mapping1 = new SolutionMapping();
      mapping1.set("x", iri1);

      const mapping2 = new SolutionMapping();
      mapping2.set("y", iri2);

      expect(mapping1.isCompatibleWith(mapping2)).toBe(true);
      expect(mapping2.isCompatibleWith(mapping1)).toBe(true);
    });

    it("should be compatible when overlapping variables have same values", () => {
      const mapping1 = new SolutionMapping();
      mapping1.set("x", iri1);
      mapping1.set("y", literal1);

      const mapping2 = new SolutionMapping();
      mapping2.set("x", iri1);
      mapping2.set("z", iri2);

      expect(mapping1.isCompatibleWith(mapping2)).toBe(true);
      expect(mapping2.isCompatibleWith(mapping1)).toBe(true);
    });

    it("should be incompatible when overlapping variables have different values", () => {
      const mapping1 = new SolutionMapping();
      mapping1.set("x", iri1);

      const mapping2 = new SolutionMapping();
      mapping2.set("x", iri2);

      expect(mapping1.isCompatibleWith(mapping2)).toBe(false);
      expect(mapping2.isCompatibleWith(mapping1)).toBe(false);
    });

    it("should be incompatible with multiple conflicting variables", () => {
      const mapping1 = new SolutionMapping();
      mapping1.set("x", iri1);
      mapping1.set("y", literal1);

      const mapping2 = new SolutionMapping();
      mapping2.set("x", iri1); // same
      mapping2.set("y", literal2); // different

      expect(mapping1.isCompatibleWith(mapping2)).toBe(false);
    });
  });

  describe("Merge", () => {
    it("should merge with empty mapping", () => {
      const mapping1 = new SolutionMapping();
      mapping1.set("x", iri1);

      const mapping2 = new SolutionMapping();

      const merged = mapping1.merge(mapping2);
      expect(merged).not.toBeNull();
      expect(merged!.size()).toBe(1);
      expect(merged!.get("x")).toBe(iri1);
    });

    it("should merge non-overlapping mappings", () => {
      const mapping1 = new SolutionMapping();
      mapping1.set("x", iri1);

      const mapping2 = new SolutionMapping();
      mapping2.set("y", iri2);

      const merged = mapping1.merge(mapping2);
      expect(merged).not.toBeNull();
      expect(merged!.size()).toBe(2);
      expect(merged!.get("x")).toBe(iri1);
      expect(merged!.get("y")).toBe(iri2);
    });

    it("should merge compatible overlapping mappings", () => {
      const mapping1 = new SolutionMapping();
      mapping1.set("x", iri1);
      mapping1.set("y", literal1);

      const mapping2 = new SolutionMapping();
      mapping2.set("x", iri1); // same value
      mapping2.set("z", iri2);

      const merged = mapping1.merge(mapping2);
      expect(merged).not.toBeNull();
      expect(merged!.size()).toBe(3);
      expect(merged!.get("x")).toBe(iri1);
      expect(merged!.get("y")).toBe(literal1);
      expect(merged!.get("z")).toBe(iri2);
    });

    it("should return null for incompatible mappings", () => {
      const mapping1 = new SolutionMapping();
      mapping1.set("x", iri1);

      const mapping2 = new SolutionMapping();
      mapping2.set("x", iri2);

      const merged = mapping1.merge(mapping2);
      expect(merged).toBeNull();
    });

    it("should not modify original mappings when merging", () => {
      const mapping1 = new SolutionMapping();
      mapping1.set("x", iri1);

      const mapping2 = new SolutionMapping();
      mapping2.set("y", iri2);

      const merged = mapping1.merge(mapping2);

      expect(mapping1.size()).toBe(1);
      expect(mapping1.has("y")).toBe(false);
      expect(mapping2.size()).toBe(1);
      expect(mapping2.has("x")).toBe(false);
      expect(merged!.size()).toBe(2);
    });
  });

  describe("Clone", () => {
    it("should create independent copy", () => {
      const original = new SolutionMapping();
      original.set("x", iri1);
      original.set("y", literal1);

      const cloned = original.clone();

      expect(cloned.size()).toBe(2);
      expect(cloned.get("x")).toBe(iri1);
      expect(cloned.get("y")).toBe(literal1);

      // Modify clone should not affect original
      cloned.set("z", iri2);
      expect(original.has("z")).toBe(false);
      expect(cloned.has("z")).toBe(true);
    });
  });

  describe("Serialization", () => {
    it("should convert to JSON", () => {
      const mapping = new SolutionMapping();
      mapping.set("x", iri1);
      mapping.set("y", literal1);

      const json = mapping.toJSON();
      expect(json).toEqual({
        x: iri1.toString(),
        y: literal1.toString(),
      });
    });

    it("should handle empty mapping in JSON", () => {
      const mapping = new SolutionMapping();
      const json = mapping.toJSON();
      expect(json).toEqual({});
    });
  });

  describe("Constructor with Initial Bindings", () => {
    it("should create mapping from existing Map", () => {
      const bindings = new Map<string, IRI | Literal>();
      bindings.set("x", iri1);
      bindings.set("y", literal1);

      const mapping = new SolutionMapping(bindings);
      expect(mapping.size()).toBe(2);
      expect(mapping.get("x")).toBe(iri1);
      expect(mapping.get("y")).toBe(literal1);
    });

    it("should create independent copy from initial bindings", () => {
      const bindings = new Map<string, IRI>();
      bindings.set("x", iri1);

      const mapping = new SolutionMapping(bindings);

      // Modify original should not affect mapping
      bindings.set("y", iri2);
      expect(mapping.has("y")).toBe(false);
    });
  });

  describe("RDF 1.1 Literal Equality (Issue #607)", () => {
    const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";
    const XSD_INTEGER = "http://www.w3.org/2001/XMLSchema#integer";

    it("should treat plain literal and xsd:string typed literal as equal", () => {
      // This is the core issue: VALUES creates plain literals,
      // but triple stores often return xsd:string typed literals
      const plainLiteral = new Literal("Поспать 2025-11-01");
      const typedLiteral = new Literal("Поспать 2025-11-01", new IRI(XSD_STRING));

      const mapping1 = new SolutionMapping();
      mapping1.set("label", plainLiteral);

      const mapping2 = new SolutionMapping();
      mapping2.set("label", typedLiteral);

      // They should be compatible for join operations
      expect(mapping1.isCompatibleWith(mapping2)).toBe(true);
      expect(mapping2.isCompatibleWith(mapping1)).toBe(true);

      // And should merge successfully
      const merged = mapping1.merge(mapping2);
      expect(merged).not.toBeNull();
    });

    it("should correctly join VALUES bindings with BGP results", () => {
      // Simulate VALUES clause: VALUES ?label { 'Label1' 'Label2' }
      const valuesLiteral = new Literal("Label1"); // Plain literal from VALUES

      // Simulate BGP result: ?s exo:Asset_label ?label -> "Label1"^^xsd:string
      const bgpLiteral = new Literal("Label1", new IRI(XSD_STRING));

      const valuesSolution = new SolutionMapping();
      valuesSolution.set("label", valuesLiteral);

      const bgpSolution = new SolutionMapping();
      bgpSolution.set("s", new IRI("http://example.org/task1"));
      bgpSolution.set("label", bgpLiteral);

      // Join should work - this is the bug fix
      const merged = valuesSolution.merge(bgpSolution);
      expect(merged).not.toBeNull();
      expect(merged!.get("s")!.toString()).toBe("<http://example.org/task1>");
      expect((merged!.get("label") as Literal).value).toBe("Label1");
    });

    it("should not treat literals with different datatypes as equal", () => {
      const stringLiteral = new Literal("42", new IRI(XSD_STRING));
      const integerLiteral = new Literal("42", new IRI(XSD_INTEGER));

      const mapping1 = new SolutionMapping();
      mapping1.set("x", stringLiteral);

      const mapping2 = new SolutionMapping();
      mapping2.set("x", integerLiteral);

      expect(mapping1.isCompatibleWith(mapping2)).toBe(false);
      expect(mapping1.merge(mapping2)).toBeNull();
    });

    it("should not treat literals with different values as equal", () => {
      const literal1 = new Literal("Поспать 2025-11-01");
      const literal2 = new Literal("Поспать 2025-11-02");

      const mapping1 = new SolutionMapping();
      mapping1.set("label", literal1);

      const mapping2 = new SolutionMapping();
      mapping2.set("label", literal2);

      expect(mapping1.isCompatibleWith(mapping2)).toBe(false);
      expect(mapping1.merge(mapping2)).toBeNull();
    });

    it("should not treat literals with different language tags as equal", () => {
      const enLiteral = new Literal("hello", undefined, "en");
      const frLiteral = new Literal("hello", undefined, "fr");

      const mapping1 = new SolutionMapping();
      mapping1.set("label", enLiteral);

      const mapping2 = new SolutionMapping();
      mapping2.set("label", frLiteral);

      expect(mapping1.isCompatibleWith(mapping2)).toBe(false);
      expect(mapping1.merge(mapping2)).toBeNull();
    });

    it("should not treat IRI and Literal as equal even with same string value", () => {
      const iri = new IRI("http://example.org/value");
      const literal = new Literal("http://example.org/value");

      const mapping1 = new SolutionMapping();
      mapping1.set("x", iri);

      const mapping2 = new SolutionMapping();
      mapping2.set("x", literal);

      expect(mapping1.isCompatibleWith(mapping2)).toBe(false);
      expect(mapping1.merge(mapping2)).toBeNull();
    });

    it("should treat identical BlankNodes as equal", () => {
      const blank1 = new BlankNode("b1");
      const blank2 = new BlankNode("b1");

      const mapping1 = new SolutionMapping();
      mapping1.set("x", blank1);

      const mapping2 = new SolutionMapping();
      mapping2.set("x", blank2);

      expect(mapping1.isCompatibleWith(mapping2)).toBe(true);
      expect(mapping1.merge(mapping2)).not.toBeNull();
    });

    it("should not treat different BlankNodes as equal", () => {
      const blank1 = new BlankNode("b1");
      const blank2 = new BlankNode("b2");

      const mapping1 = new SolutionMapping();
      mapping1.set("x", blank1);

      const mapping2 = new SolutionMapping();
      mapping2.set("x", blank2);

      expect(mapping1.isCompatibleWith(mapping2)).toBe(false);
      expect(mapping1.merge(mapping2)).toBeNull();
    });
  });
});
