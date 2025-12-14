import { Literal } from "../../../../src/domain/models/rdf/Literal";
import { IRI } from "../../../../src/domain/models/rdf/IRI";

describe("Literal", () => {
  describe("constructor", () => {
    it("should create simple string literal", () => {
      const literal = new Literal("Hello World");
      expect(literal.value).toBe("Hello World");
      expect(literal.datatype).toBeUndefined();
      expect(literal.language).toBeUndefined();
    });

    it("should create literal with datatype", () => {
      const datatype = new IRI("http://www.w3.org/2001/XMLSchema#integer");
      const literal = new Literal("42", datatype);
      expect(literal.value).toBe("42");
      expect(literal.datatype).toBe(datatype);
      expect(literal.language).toBeUndefined();
    });

    it("should create literal with language tag", () => {
      const literal = new Literal("Hello", undefined, "en");
      expect(literal.value).toBe("Hello");
      expect(literal.datatype).toBeUndefined();
      expect(literal.language).toBe("en");
    });

    it("should throw error for empty value", () => {
      expect(() => new Literal("")).toThrow("Literal value cannot be empty");
    });

    it("should throw error when both datatype and language are provided", () => {
      const datatype = new IRI("http://www.w3.org/2001/XMLSchema#string");
      expect(() => new Literal("value", datatype, "en")).toThrow(
        "Literal cannot have both datatype and language tag"
      );
    });

    it("should normalize language tag to lowercase", () => {
      const literal = new Literal("Hello", undefined, "EN-US");
      expect(literal.language).toBe("en-us");
    });
  });

  describe("equals", () => {
    it("should return true for identical simple literals", () => {
      const lit1 = new Literal("test");
      const lit2 = new Literal("test");
      expect(lit1.equals(lit2)).toBe(true);
    });

    it("should return false for different values", () => {
      const lit1 = new Literal("test1");
      const lit2 = new Literal("test2");
      expect(lit1.equals(lit2)).toBe(false);
    });

    it("should return true for literals with same datatype", () => {
      const datatype = new IRI("http://www.w3.org/2001/XMLSchema#integer");
      const lit1 = new Literal("42", datatype);
      const lit2 = new Literal("42", datatype);
      expect(lit1.equals(lit2)).toBe(true);
    });

    it("should return false for same value but different datatypes", () => {
      const dt1 = new IRI("http://www.w3.org/2001/XMLSchema#integer");
      const dt2 = new IRI("http://www.w3.org/2001/XMLSchema#decimal");
      const lit1 = new Literal("42", dt1);
      const lit2 = new Literal("42", dt2);
      expect(lit1.equals(lit2)).toBe(false);
    });

    // RDF 1.1 semantics: plain literals and xsd:string literals are equivalent
    // https://www.w3.org/TR/rdf11-concepts/#section-Graph-Literal
    it("should treat plain literal as equal to xsd:string literal (RDF 1.1)", () => {
      const xsdString = new IRI("http://www.w3.org/2001/XMLSchema#string");
      const plain = new Literal("test");
      const typed = new Literal("test", xsdString);
      expect(plain.equals(typed)).toBe(true);
      expect(typed.equals(plain)).toBe(true);
    });

    it("should treat two xsd:string literals as equal", () => {
      const xsdString = new IRI("http://www.w3.org/2001/XMLSchema#string");
      const lit1 = new Literal("test", xsdString);
      const lit2 = new Literal("test", xsdString);
      expect(lit1.equals(lit2)).toBe(true);
    });

    it("should not treat xsd:string as equal to other datatypes", () => {
      const xsdString = new IRI("http://www.w3.org/2001/XMLSchema#string");
      const xsdInteger = new IRI("http://www.w3.org/2001/XMLSchema#integer");
      const stringLit = new Literal("42", xsdString);
      const integerLit = new Literal("42", xsdInteger);
      expect(stringLit.equals(integerLit)).toBe(false);
    });

    it("should return true for literals with same language", () => {
      const lit1 = new Literal("Hello", undefined, "en");
      const lit2 = new Literal("Hello", undefined, "en");
      expect(lit1.equals(lit2)).toBe(true);
    });

    it("should return false for same value but different languages", () => {
      const lit1 = new Literal("Hello", undefined, "en");
      const lit2 = new Literal("Hello", undefined, "fr");
      expect(lit1.equals(lit2)).toBe(false);
    });
  });

  describe("toString", () => {
    it("should return simple literal as quoted string", () => {
      const literal = new Literal("test");
      expect(literal.toString()).toBe('"test"');
    });

    it("should return literal with datatype", () => {
      const datatype = new IRI("http://www.w3.org/2001/XMLSchema#integer");
      const literal = new Literal("42", datatype);
      expect(literal.toString()).toBe(
        '"42"^^<http://www.w3.org/2001/XMLSchema#integer>'
      );
    });

    it("should return literal with language tag", () => {
      const literal = new Literal("Hello", undefined, "en");
      expect(literal.toString()).toBe('"Hello"@en');
    });
  });

  describe("XSD datatypes", () => {
    it("should work with xsd:string", () => {
      const datatype = new IRI("http://www.w3.org/2001/XMLSchema#string");
      const literal = new Literal("test", datatype);
      expect(literal.value).toBe("test");
    });

    it("should work with xsd:integer", () => {
      const datatype = new IRI("http://www.w3.org/2001/XMLSchema#integer");
      const literal = new Literal("123", datatype);
      expect(literal.value).toBe("123");
    });

    it("should work with xsd:boolean", () => {
      const datatype = new IRI("http://www.w3.org/2001/XMLSchema#boolean");
      const literal = new Literal("true", datatype);
      expect(literal.value).toBe("true");
    });

    it("should work with xsd:dateTime", () => {
      const datatype = new IRI("http://www.w3.org/2001/XMLSchema#dateTime");
      const literal = new Literal("2025-11-01T00:00:00Z", datatype);
      expect(literal.value).toBe("2025-11-01T00:00:00Z");
    });
  });
});
