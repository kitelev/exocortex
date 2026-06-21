import {
  Literal,
  parseLanguageTag,
  createDirectionalLiteral,
  createLiteralFromLanguageTag,
} from "../../../../src/domain/models/rdf/Literal";
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

  describe("SPARQL 1.2 directional literals", () => {
    describe("constructor with direction", () => {
      it("should create directional literal with rtl direction", () => {
        const literal = new Literal("مرحبا", undefined, "ar", "rtl");
        expect(literal.value).toBe("مرحبا");
        expect(literal.language).toBe("ar");
        expect(literal.direction).toBe("rtl");
        expect(literal.hasDirection()).toBe(true);
      });

      it("should create directional literal with ltr direction", () => {
        const literal = new Literal("Hello", undefined, "en", "ltr");
        expect(literal.value).toBe("Hello");
        expect(literal.language).toBe("en");
        expect(literal.direction).toBe("ltr");
        expect(literal.hasDirection()).toBe(true);
      });

      it("should create literal with language but no direction", () => {
        const literal = new Literal("Hello", undefined, "en");
        expect(literal.language).toBe("en");
        expect(literal.direction).toBeUndefined();
        expect(literal.hasDirection()).toBe(false);
      });

      it("should throw error when direction provided without language", () => {
        expect(() => new Literal("Hello", undefined, undefined, "ltr")).toThrow(
          "Literal cannot have direction without language tag"
        );
      });

    });

    describe("equals with direction", () => {
      it("should return true for literals with same direction", () => {
        const lit1 = new Literal("مرحبا", undefined, "ar", "rtl");
        const lit2 = new Literal("مرحبا", undefined, "ar", "rtl");
        expect(lit1.equals(lit2)).toBe(true);
      });

      it("should return false for same value/language but different direction", () => {
        const lit1 = new Literal("Hello", undefined, "en", "ltr");
        const lit2 = new Literal("Hello", undefined, "en", "rtl");
        expect(lit1.equals(lit2)).toBe(false);
      });

      it("should return false when one has direction and other does not", () => {
        const withDir = new Literal("Hello", undefined, "en", "ltr");
        const withoutDir = new Literal("Hello", undefined, "en");
        expect(withDir.equals(withoutDir)).toBe(false);
        expect(withoutDir.equals(withDir)).toBe(false);
      });
    });

    describe("toString with direction", () => {
      it("should serialize directional literal with lang--dir format", () => {
        const literal = new Literal("مرحبا", undefined, "ar", "rtl");
        expect(literal.toString()).toBe('"مرحبا"@ar--rtl');
      });

      it("should serialize ltr directional literal", () => {
        const literal = new Literal("Hello", undefined, "en", "ltr");
        expect(literal.toString()).toBe('"Hello"@en--ltr');
      });

      it("should not include direction in toString if not present", () => {
        const literal = new Literal("Hello", undefined, "en");
        expect(literal.toString()).toBe('"Hello"@en');
      });
    });
  });

  describe("parseLanguageTag", () => {
    it("should parse simple language tag without direction", () => {
      const result = parseLanguageTag("en");
      expect(result.language).toBe("en");
      expect(result.direction).toBeUndefined();
    });

    it("should parse language tag with rtl direction", () => {
      const result = parseLanguageTag("ar--rtl");
      expect(result.language).toBe("ar");
      expect(result.direction).toBe("rtl");
    });

    it("should parse language tag with ltr direction", () => {
      const result = parseLanguageTag("en--ltr");
      expect(result.language).toBe("en");
      expect(result.direction).toBe("ltr");
    });

    it("should parse complex language tag with direction", () => {
      const result = parseLanguageTag("en-US--ltr");
      expect(result.language).toBe("en-us");
      expect(result.direction).toBe("ltr");
    });

    it("should normalize language to lowercase", () => {
      const result = parseLanguageTag("EN-US--ltr");
      expect(result.language).toBe("en-us");
    });

    it("should treat invalid direction as part of language tag", () => {
      const result = parseLanguageTag("en--invalid");
      expect(result.language).toBe("en--invalid");
      expect(result.direction).toBeUndefined();
    });

    it("should handle tag with multiple dashes in language part", () => {
      const result = parseLanguageTag("zh-Hans-CN--ltr");
      expect(result.language).toBe("zh-hans-cn");
      expect(result.direction).toBe("ltr");
    });
  });

  describe("createDirectionalLiteral", () => {
    it("should create directional literal with rtl", () => {
      const literal = createDirectionalLiteral("مرحبا", "ar", "rtl");
      expect(literal.value).toBe("مرحبا");
      expect(literal.language).toBe("ar");
      expect(literal.direction).toBe("rtl");
    });

    it("should create directional literal with ltr", () => {
      const literal = createDirectionalLiteral("Hello", "en", "ltr");
      expect(literal.value).toBe("Hello");
      expect(literal.language).toBe("en");
      expect(literal.direction).toBe("ltr");
    });

    it("should create literal without direction when not specified", () => {
      const literal = createDirectionalLiteral("Hello", "en");
      expect(literal.language).toBe("en");
      expect(literal.direction).toBeUndefined();
    });
  });

  describe("createLiteralFromLanguageTag", () => {
    it("should create literal from tag with direction", () => {
      const literal = createLiteralFromLanguageTag("مرحبا", "ar--rtl");
      expect(literal.value).toBe("مرحبا");
      expect(literal.language).toBe("ar");
      expect(literal.direction).toBe("rtl");
    });

    it("should create literal from tag without direction", () => {
      const literal = createLiteralFromLanguageTag("Hello", "en");
      expect(literal.value).toBe("Hello");
      expect(literal.language).toBe("en");
      expect(literal.direction).toBeUndefined();
    });

    it("should create literal from complex tag with direction", () => {
      const literal = createLiteralFromLanguageTag("你好", "zh-Hans--ltr");
      expect(literal.value).toBe("你好");
      expect(literal.language).toBe("zh-hans");
      expect(literal.direction).toBe("ltr");
    });
  });
});
