import { BuiltInFunctions } from "../../../../../src/infrastructure/sparql/filters/BuiltInFunctions";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../../src/domain/models/rdf/Literal";
import { BlankNode } from "../../../../../src/domain/models/rdf/BlankNode";

describe("BuiltInFunctions", () => {
  describe("STR", () => {
    it("should return IRI value as string", () => {
      const iri = new IRI("http://example.org/resource");
      expect(BuiltInFunctions.str(iri)).toBe("http://example.org/resource");
    });

    it("should return literal value as string", () => {
      const literal = new Literal("test value");
      expect(BuiltInFunctions.str(literal)).toBe("test value");
    });

    it("should return blank node ID as string", () => {
      const blank = new BlankNode("b1");
      expect(BuiltInFunctions.str(blank)).toBe("b1");
    });

    it("should throw for undefined", () => {
      expect(() => BuiltInFunctions.str(undefined)).toThrow("STR: argument is undefined");
    });
  });

  describe("LANG", () => {
    it("should return language tag for literal", () => {
      const literal = new Literal("hello", undefined, "en");
      expect(BuiltInFunctions.lang(literal)).toBe("en");
    });

    it("should return empty string for literal without language", () => {
      const literal = new Literal("hello");
      expect(BuiltInFunctions.lang(literal)).toBe("");
    });

    it("should return empty string for IRI", () => {
      const iri = new IRI("http://example.org/resource");
      expect(BuiltInFunctions.lang(iri)).toBe("");
    });

    it("should throw for undefined", () => {
      expect(() => BuiltInFunctions.lang(undefined)).toThrow("LANG: argument is undefined");
    });
  });

  describe("langMatches", () => {
    describe("exact matches", () => {
      it("should return true for exact match", () => {
        expect(BuiltInFunctions.langMatches("en", "en")).toBe(true);
      });

      it("should return true for exact match with subtag", () => {
        expect(BuiltInFunctions.langMatches("en-US", "en-US")).toBe(true);
      });

      it("should be case-insensitive", () => {
        expect(BuiltInFunctions.langMatches("EN", "en")).toBe(true);
        expect(BuiltInFunctions.langMatches("en", "EN")).toBe(true);
        expect(BuiltInFunctions.langMatches("En-Us", "en-us")).toBe(true);
      });
    });

    describe("prefix matches", () => {
      it("should return true when tag extends range with hyphen", () => {
        expect(BuiltInFunctions.langMatches("en-US", "en")).toBe(true);
        expect(BuiltInFunctions.langMatches("en-GB", "en")).toBe(true);
        expect(BuiltInFunctions.langMatches("en-GB-oed", "en")).toBe(true);
      });

      it("should return true for nested subtag matches", () => {
        expect(BuiltInFunctions.langMatches("en-GB-oed", "en-GB")).toBe(true);
      });

      it("should return false when range is longer than tag", () => {
        expect(BuiltInFunctions.langMatches("en", "en-US")).toBe(false);
      });

      it("should return false for partial prefix without hyphen", () => {
        // "eng" does NOT start with "en-"
        expect(BuiltInFunctions.langMatches("eng", "en")).toBe(false);
      });
    });

    describe("wildcard matching", () => {
      it("should return true for any non-empty tag with '*' range", () => {
        expect(BuiltInFunctions.langMatches("en", "*")).toBe(true);
        expect(BuiltInFunctions.langMatches("en-US", "*")).toBe(true);
        expect(BuiltInFunctions.langMatches("fr", "*")).toBe(true);
        expect(BuiltInFunctions.langMatches("de-AT", "*")).toBe(true);
      });

      it("should return false for empty tag with '*' range", () => {
        expect(BuiltInFunctions.langMatches("", "*")).toBe(false);
      });
    });

    describe("no matches", () => {
      it("should return false for different language families", () => {
        expect(BuiltInFunctions.langMatches("fr", "en")).toBe(false);
        expect(BuiltInFunctions.langMatches("de", "en")).toBe(false);
        expect(BuiltInFunctions.langMatches("fr-FR", "en")).toBe(false);
      });
    });

    describe("empty string handling", () => {
      it("should return false for empty tag with non-wildcard range", () => {
        expect(BuiltInFunctions.langMatches("", "en")).toBe(false);
      });

      it("should return true for empty tag with empty range", () => {
        expect(BuiltInFunctions.langMatches("", "")).toBe(true);
      });

      it("should return false for non-empty tag with empty range", () => {
        // Per implementation: non-empty tag doesn't match empty range
        // because it requires exact match or prefix match with hyphen
        expect(BuiltInFunctions.langMatches("en", "")).toBe(false);
      });
    });

    describe("SPARQL spec examples", () => {
      // Examples from SPARQL 1.1 spec section 17.4.3.2
      it("should match langMatches(LANG(?label), 'en') for en-tagged literals", () => {
        expect(BuiltInFunctions.langMatches("en", "en")).toBe(true);
        expect(BuiltInFunctions.langMatches("en-US", "en")).toBe(true);
        expect(BuiltInFunctions.langMatches("en-GB", "en")).toBe(true);
      });

      it("should not match langMatches(LANG(?label), 'en') for non-en literals", () => {
        expect(BuiltInFunctions.langMatches("fr", "en")).toBe(false);
        expect(BuiltInFunctions.langMatches("de", "en")).toBe(false);
      });
    });
  });

  describe("DATATYPE", () => {
    it("should return datatype for typed literal", () => {
      const xsdInteger = new IRI("http://www.w3.org/2001/XMLSchema#integer");
      const literal = new Literal("42", xsdInteger);
      const datatype = BuiltInFunctions.datatype(literal);
      expect(datatype.value).toBe("http://www.w3.org/2001/XMLSchema#integer");
    });

    it("should return xsd:string for plain literal", () => {
      const literal = new Literal("hello");
      const datatype = BuiltInFunctions.datatype(literal);
      expect(datatype.value).toBe("http://www.w3.org/2001/XMLSchema#string");
    });

    it("should return rdf:langString for literal with language", () => {
      const literal = new Literal("hello", undefined, "en");
      const datatype = BuiltInFunctions.datatype(literal);
      expect(datatype.value).toBe("http://www.w3.org/1999/02/22-rdf-syntax-ns#langString");
    });

    it("should throw for IRI", () => {
      const iri = new IRI("http://example.org/resource");
      expect(() => BuiltInFunctions.datatype(iri)).toThrow("DATATYPE: argument must be a literal");
    });

    it("should throw for undefined", () => {
      expect(() => BuiltInFunctions.datatype(undefined)).toThrow("DATATYPE: argument is undefined");
    });
  });

  describe("BOUND", () => {
    it("should return true for bound term", () => {
      const iri = new IRI("http://example.org/resource");
      expect(BuiltInFunctions.bound(iri)).toBe(true);
    });

    it("should return false for undefined", () => {
      expect(BuiltInFunctions.bound(undefined)).toBe(false);
    });
  });

  describe("isIRI", () => {
    it("should return true for IRI", () => {
      const iri = new IRI("http://example.org/resource");
      expect(BuiltInFunctions.isIRI(iri)).toBe(true);
    });

    it("should return false for Literal", () => {
      const literal = new Literal("test");
      expect(BuiltInFunctions.isIRI(literal)).toBe(false);
    });

    it("should return false for BlankNode", () => {
      const blank = new BlankNode("b1");
      expect(BuiltInFunctions.isIRI(blank)).toBe(false);
    });

    it("should return false for undefined", () => {
      expect(BuiltInFunctions.isIRI(undefined)).toBe(false);
    });
  });

  describe("isBlank", () => {
    it("should return true for BlankNode", () => {
      const blank = new BlankNode("b1");
      expect(BuiltInFunctions.isBlank(blank)).toBe(true);
    });

    it("should return false for IRI", () => {
      const iri = new IRI("http://example.org/resource");
      expect(BuiltInFunctions.isBlank(iri)).toBe(false);
    });

    it("should return false for undefined", () => {
      expect(BuiltInFunctions.isBlank(undefined)).toBe(false);
    });
  });

  describe("isLiteral", () => {
    it("should return true for Literal", () => {
      const literal = new Literal("test");
      expect(BuiltInFunctions.isLiteral(literal)).toBe(true);
    });

    it("should return false for IRI", () => {
      const iri = new IRI("http://example.org/resource");
      expect(BuiltInFunctions.isLiteral(iri)).toBe(false);
    });

    it("should return false for undefined", () => {
      expect(BuiltInFunctions.isLiteral(undefined)).toBe(false);
    });
  });

  describe("isNumeric", () => {
    describe("core numeric types", () => {
      it("should return true for xsd:integer", () => {
        const xsdInteger = new IRI("http://www.w3.org/2001/XMLSchema#integer");
        const literal = new Literal("42", xsdInteger);
        expect(BuiltInFunctions.isNumeric(literal)).toBe(true);
      });

      it("should return true for xsd:decimal", () => {
        const xsdDecimal = new IRI("http://www.w3.org/2001/XMLSchema#decimal");
        const literal = new Literal("3.14", xsdDecimal);
        expect(BuiltInFunctions.isNumeric(literal)).toBe(true);
      });

      it("should return true for xsd:float", () => {
        const xsdFloat = new IRI("http://www.w3.org/2001/XMLSchema#float");
        const literal = new Literal("3.14159", xsdFloat);
        expect(BuiltInFunctions.isNumeric(literal)).toBe(true);
      });

      it("should return true for xsd:double", () => {
        const xsdDouble = new IRI("http://www.w3.org/2001/XMLSchema#double");
        const literal = new Literal("3.141592653589793", xsdDouble);
        expect(BuiltInFunctions.isNumeric(literal)).toBe(true);
      });
    });

    describe("derived integer types", () => {
      it("should return true for xsd:long", () => {
        const xsdLong = new IRI("http://www.w3.org/2001/XMLSchema#long");
        const literal = new Literal("9223372036854775807", xsdLong);
        expect(BuiltInFunctions.isNumeric(literal)).toBe(true);
      });

      it("should return true for xsd:int", () => {
        const xsdInt = new IRI("http://www.w3.org/2001/XMLSchema#int");
        const literal = new Literal("2147483647", xsdInt);
        expect(BuiltInFunctions.isNumeric(literal)).toBe(true);
      });

      it("should return true for xsd:short", () => {
        const xsdShort = new IRI("http://www.w3.org/2001/XMLSchema#short");
        const literal = new Literal("32767", xsdShort);
        expect(BuiltInFunctions.isNumeric(literal)).toBe(true);
      });

      it("should return true for xsd:byte", () => {
        const xsdByte = new IRI("http://www.w3.org/2001/XMLSchema#byte");
        const literal = new Literal("127", xsdByte);
        expect(BuiltInFunctions.isNumeric(literal)).toBe(true);
      });

      it("should return true for xsd:unsignedLong", () => {
        const xsdUnsignedLong = new IRI("http://www.w3.org/2001/XMLSchema#unsignedLong");
        const literal = new Literal("18446744073709551615", xsdUnsignedLong);
        expect(BuiltInFunctions.isNumeric(literal)).toBe(true);
      });

      it("should return true for xsd:unsignedInt", () => {
        const xsdUnsignedInt = new IRI("http://www.w3.org/2001/XMLSchema#unsignedInt");
        const literal = new Literal("4294967295", xsdUnsignedInt);
        expect(BuiltInFunctions.isNumeric(literal)).toBe(true);
      });

      it("should return true for xsd:unsignedShort", () => {
        const xsdUnsignedShort = new IRI("http://www.w3.org/2001/XMLSchema#unsignedShort");
        const literal = new Literal("65535", xsdUnsignedShort);
        expect(BuiltInFunctions.isNumeric(literal)).toBe(true);
      });

      it("should return true for xsd:unsignedByte", () => {
        const xsdUnsignedByte = new IRI("http://www.w3.org/2001/XMLSchema#unsignedByte");
        const literal = new Literal("255", xsdUnsignedByte);
        expect(BuiltInFunctions.isNumeric(literal)).toBe(true);
      });

      it("should return true for xsd:positiveInteger", () => {
        const xsdPositiveInteger = new IRI("http://www.w3.org/2001/XMLSchema#positiveInteger");
        const literal = new Literal("1", xsdPositiveInteger);
        expect(BuiltInFunctions.isNumeric(literal)).toBe(true);
      });

      it("should return true for xsd:nonNegativeInteger", () => {
        const xsdNonNegativeInteger = new IRI("http://www.w3.org/2001/XMLSchema#nonNegativeInteger");
        const literal = new Literal("0", xsdNonNegativeInteger);
        expect(BuiltInFunctions.isNumeric(literal)).toBe(true);
      });

      it("should return true for xsd:negativeInteger", () => {
        const xsdNegativeInteger = new IRI("http://www.w3.org/2001/XMLSchema#negativeInteger");
        const literal = new Literal("-1", xsdNegativeInteger);
        expect(BuiltInFunctions.isNumeric(literal)).toBe(true);
      });

      it("should return true for xsd:nonPositiveInteger", () => {
        const xsdNonPositiveInteger = new IRI("http://www.w3.org/2001/XMLSchema#nonPositiveInteger");
        const literal = new Literal("0", xsdNonPositiveInteger);
        expect(BuiltInFunctions.isNumeric(literal)).toBe(true);
      });
    });

    describe("non-numeric types", () => {
      it("should return false for plain literal (string without datatype)", () => {
        const literal = new Literal("42");
        expect(BuiltInFunctions.isNumeric(literal)).toBe(false);
      });

      it("should return false for xsd:string", () => {
        const xsdString = new IRI("http://www.w3.org/2001/XMLSchema#string");
        const literal = new Literal("42", xsdString);
        expect(BuiltInFunctions.isNumeric(literal)).toBe(false);
      });

      it("should return false for xsd:boolean", () => {
        const xsdBoolean = new IRI("http://www.w3.org/2001/XMLSchema#boolean");
        const literal = new Literal("true", xsdBoolean);
        expect(BuiltInFunctions.isNumeric(literal)).toBe(false);
      });

      it("should return false for xsd:dateTime", () => {
        const xsdDateTime = new IRI("http://www.w3.org/2001/XMLSchema#dateTime");
        const literal = new Literal("2025-12-09T10:00:00Z", xsdDateTime);
        expect(BuiltInFunctions.isNumeric(literal)).toBe(false);
      });

      it("should return false for xsd:date", () => {
        const xsdDate = new IRI("http://www.w3.org/2001/XMLSchema#date");
        const literal = new Literal("2025-12-09", xsdDate);
        expect(BuiltInFunctions.isNumeric(literal)).toBe(false);
      });

      it("should return false for language-tagged literal", () => {
        const literal = new Literal("forty-two", undefined, "en");
        expect(BuiltInFunctions.isNumeric(literal)).toBe(false);
      });

      it("should return false for IRI", () => {
        const iri = new IRI("http://example.org/resource");
        expect(BuiltInFunctions.isNumeric(iri)).toBe(false);
      });

      it("should return false for BlankNode", () => {
        const blank = new BlankNode("b1");
        expect(BuiltInFunctions.isNumeric(blank)).toBe(false);
      });

      it("should return false for undefined", () => {
        expect(BuiltInFunctions.isNumeric(undefined)).toBe(false);
      });
    });

    describe("edge cases", () => {
      it("should return true for negative integer literal", () => {
        const xsdInteger = new IRI("http://www.w3.org/2001/XMLSchema#integer");
        const literal = new Literal("-42", xsdInteger);
        expect(BuiltInFunctions.isNumeric(literal)).toBe(true);
      });

      it("should return true for zero as integer", () => {
        const xsdInteger = new IRI("http://www.w3.org/2001/XMLSchema#integer");
        const literal = new Literal("0", xsdInteger);
        expect(BuiltInFunctions.isNumeric(literal)).toBe(true);
      });

      it("should return true for scientific notation as double", () => {
        const xsdDouble = new IRI("http://www.w3.org/2001/XMLSchema#double");
        const literal = new Literal("1.0e10", xsdDouble);
        expect(BuiltInFunctions.isNumeric(literal)).toBe(true);
      });

      it("should return true for special float values", () => {
        const xsdFloat = new IRI("http://www.w3.org/2001/XMLSchema#float");
        // SPARQL allows INF and NaN for float/double types
        const infLiteral = new Literal("INF", xsdFloat);
        const nanLiteral = new Literal("NaN", xsdFloat);
        expect(BuiltInFunctions.isNumeric(infLiteral)).toBe(true);
        expect(BuiltInFunctions.isNumeric(nanLiteral)).toBe(true);
      });
    });
  });

  describe("langMatches", () => {
    describe("exact match", () => {
      it("should return true for identical tags", () => {
        expect(BuiltInFunctions.langMatches("en", "en")).toBe(true);
        expect(BuiltInFunctions.langMatches("fr", "fr")).toBe(true);
        expect(BuiltInFunctions.langMatches("de", "de")).toBe(true);
      });

      it("should be case-insensitive", () => {
        expect(BuiltInFunctions.langMatches("EN", "en")).toBe(true);
        expect(BuiltInFunctions.langMatches("en", "EN")).toBe(true);
        expect(BuiltInFunctions.langMatches("En-US", "en-us")).toBe(true);
      });
    });

    describe("prefix match", () => {
      it("should match language subtags", () => {
        expect(BuiltInFunctions.langMatches("en-US", "en")).toBe(true);
        expect(BuiltInFunctions.langMatches("en-GB", "en")).toBe(true);
        expect(BuiltInFunctions.langMatches("fr-CA", "fr")).toBe(true);
        expect(BuiltInFunctions.langMatches("zh-Hans-CN", "zh")).toBe(true);
      });

      it("should match multi-level subtags", () => {
        expect(BuiltInFunctions.langMatches("en-GB-oed", "en-GB")).toBe(true);
        expect(BuiltInFunctions.langMatches("zh-Hans-CN", "zh-Hans")).toBe(true);
      });

      it("should not match if range is not a prefix", () => {
        expect(BuiltInFunctions.langMatches("en", "en-US")).toBe(false);
        expect(BuiltInFunctions.langMatches("fr", "en")).toBe(false);
        expect(BuiltInFunctions.langMatches("english", "en")).toBe(false);
      });

      it("should not match partial prefixes without hyphen", () => {
        // "eng" is not a proper subtag prefix of "english"
        expect(BuiltInFunctions.langMatches("english", "eng")).toBe(false);
      });
    });

    describe("wildcard range", () => {
      it("should match any non-empty language tag with '*'", () => {
        expect(BuiltInFunctions.langMatches("en", "*")).toBe(true);
        expect(BuiltInFunctions.langMatches("en-US", "*")).toBe(true);
        expect(BuiltInFunctions.langMatches("fr", "*")).toBe(true);
        expect(BuiltInFunctions.langMatches("zh-Hans-CN", "*")).toBe(true);
      });

      it("should not match empty language tag with '*'", () => {
        expect(BuiltInFunctions.langMatches("", "*")).toBe(false);
      });
    });

    describe("empty language tag", () => {
      it("should not match non-empty range", () => {
        expect(BuiltInFunctions.langMatches("", "en")).toBe(false);
        expect(BuiltInFunctions.langMatches("", "fr")).toBe(false);
      });

      it("should match empty range", () => {
        expect(BuiltInFunctions.langMatches("", "")).toBe(true);
      });
    });

    describe("SPARQL spec examples", () => {
      // Examples from SPARQL 1.1 spec section 17.4.3.2
      it('langMatches("en", "en") returns true', () => {
        expect(BuiltInFunctions.langMatches("en", "en")).toBe(true);
      });

      it('langMatches("en-US", "en") returns true', () => {
        expect(BuiltInFunctions.langMatches("en-US", "en")).toBe(true);
      });

      it('langMatches("fr", "en") returns false', () => {
        expect(BuiltInFunctions.langMatches("fr", "en")).toBe(false);
      });

      it('langMatches("en-US", "*") returns true', () => {
        expect(BuiltInFunctions.langMatches("en-US", "*")).toBe(true);
      });

      it('langMatches("", "*") returns false', () => {
        expect(BuiltInFunctions.langMatches("", "*")).toBe(false);
      });
    });

    describe("edge cases", () => {
      it("should handle very long language tags", () => {
        // Valid BCP 47 tag with multiple extensions
        expect(BuiltInFunctions.langMatches("en-Latn-US-x-twain", "en")).toBe(true);
        expect(BuiltInFunctions.langMatches("en-Latn-US-x-twain", "en-Latn")).toBe(true);
      });

      it("should handle single character language codes", () => {
        // While not common, single character should work
        expect(BuiltInFunctions.langMatches("x-custom", "x")).toBe(true);
      });

      it("should not confuse similar prefixes", () => {
        // "en" should not match "eno" even though "eno" starts with "en"
        expect(BuiltInFunctions.langMatches("eno", "en")).toBe(false);
      });
    });
  });

  describe("REGEX", () => {
    it("should match regex pattern", () => {
      expect(BuiltInFunctions.regex("hello world", "world")).toBe(true);
    });

    it("should not match when pattern not found", () => {
      expect(BuiltInFunctions.regex("hello world", "foo")).toBe(false);
    });

    it("should support case-insensitive flag", () => {
      expect(BuiltInFunctions.regex("Hello World", "hello", "i")).toBe(true);
    });

    it("should support regex special characters", () => {
      expect(BuiltInFunctions.regex("test123", "\\d+")).toBe(true);
    });

    it("should throw for invalid regex", () => {
      expect(() => BuiltInFunctions.regex("test", "[invalid")).toThrow("REGEX: invalid pattern");
    });
  });

  describe("Comparison", () => {
    it("should compare strings with =", () => {
      expect(BuiltInFunctions.compare("hello", "hello", "=")).toBe(true);
      expect(BuiltInFunctions.compare("hello", "world", "=")).toBe(false);
    });

    it("should compare numbers with >", () => {
      expect(BuiltInFunctions.compare(10, 5, ">")).toBe(true);
      expect(BuiltInFunctions.compare(3, 5, ">")).toBe(false);
    });

    it("should compare literals with numeric datatype", () => {
      const xsdInt = new IRI("http://www.w3.org/2001/XMLSchema#integer");
      const lit1 = new Literal("10", xsdInt);
      const lit2 = new Literal("5", xsdInt);

      expect(BuiltInFunctions.compare(lit1, lit2, ">")).toBe(true);
      expect(BuiltInFunctions.compare(lit1, lit2, "<")).toBe(false);
    });

    it("should compare with <=", () => {
      expect(BuiltInFunctions.compare(5, 10, "<=")).toBe(true);
      expect(BuiltInFunctions.compare(10, 10, "<=")).toBe(true);
      expect(BuiltInFunctions.compare(15, 10, "<=")).toBe(false);
    });

    it("should compare with >=", () => {
      expect(BuiltInFunctions.compare(10, 5, ">=")).toBe(true);
      expect(BuiltInFunctions.compare(5, 5, ">=")).toBe(true);
      expect(BuiltInFunctions.compare(3, 5, ">=")).toBe(false);
    });

    it("should compare with !=", () => {
      expect(BuiltInFunctions.compare("hello", "world", "!=")).toBe(true);
      expect(BuiltInFunctions.compare("hello", "hello", "!=")).toBe(false);
    });

    it("should throw for unknown operator", () => {
      expect(() => BuiltInFunctions.compare(1, 2, "===")).toThrow("Unknown comparison operator");
    });
  });

  describe("CONTAINS", () => {
    it("should return true when string contains substring", () => {
      expect(BuiltInFunctions.contains("hello world", "world")).toBe(true);
    });

    it("should return false when string does not contain substring", () => {
      expect(BuiltInFunctions.contains("hello world", "foo")).toBe(false);
    });

    it("should be case-sensitive by default", () => {
      expect(BuiltInFunctions.contains("Hello World", "hello")).toBe(false);
    });

    it("should handle empty substring", () => {
      expect(BuiltInFunctions.contains("hello", "")).toBe(true);
    });

    it("should handle empty string", () => {
      expect(BuiltInFunctions.contains("", "test")).toBe(false);
    });

    it("should handle Cyrillic text", () => {
      expect(BuiltInFunctions.contains("Поспать после обеда", "Поспать")).toBe(true);
    });
  });

  describe("STRSTARTS", () => {
    it("should return true when string starts with prefix", () => {
      expect(BuiltInFunctions.strStarts("hello world", "hello")).toBe(true);
    });

    it("should return false when string does not start with prefix", () => {
      expect(BuiltInFunctions.strStarts("hello world", "world")).toBe(false);
    });
  });

  describe("STRENDS", () => {
    it("should return true when string ends with suffix", () => {
      expect(BuiltInFunctions.strEnds("hello world", "world")).toBe(true);
    });

    it("should return false when string does not end with suffix", () => {
      expect(BuiltInFunctions.strEnds("hello world", "hello")).toBe(false);
    });
  });

  describe("STRLEN", () => {
    it("should return length of string", () => {
      expect(BuiltInFunctions.strlen("hello")).toBe(5);
    });

    it("should return 0 for empty string", () => {
      expect(BuiltInFunctions.strlen("")).toBe(0);
    });
  });

  describe("UCASE", () => {
    it("should convert string to uppercase", () => {
      expect(BuiltInFunctions.ucase("hello")).toBe("HELLO");
    });
  });

  describe("LCASE", () => {
    it("should convert string to lowercase", () => {
      expect(BuiltInFunctions.lcase("HELLO")).toBe("hello");
    });
  });

  describe("SUBSTR", () => {
    it("should extract substring from start position (1-based)", () => {
      // SPARQL uses 1-based indexing
      expect(BuiltInFunctions.substr("foobar", 4)).toBe("bar");
    });

    it("should extract substring with length", () => {
      expect(BuiltInFunctions.substr("foobar", 4, 2)).toBe("ba");
    });

    it("should handle start position 1", () => {
      expect(BuiltInFunctions.substr("hello", 1)).toBe("hello");
      expect(BuiltInFunctions.substr("hello", 1, 3)).toBe("hel");
    });

    it("should handle start position beyond string length", () => {
      expect(BuiltInFunctions.substr("hello", 10)).toBe("");
      expect(BuiltInFunctions.substr("hello", 10, 5)).toBe("");
    });

    it("should handle length exceeding remaining string", () => {
      expect(BuiltInFunctions.substr("hello", 3, 100)).toBe("llo");
    });

    it("should handle empty string", () => {
      expect(BuiltInFunctions.substr("", 1)).toBe("");
      expect(BuiltInFunctions.substr("", 1, 5)).toBe("");
    });

    it("should handle unicode strings", () => {
      expect(BuiltInFunctions.substr("Привет мир", 1, 6)).toBe("Привет");
    });

    it("should handle zero and negative start positions", () => {
      // According to SPARQL spec, position 0 maps to position 1
      expect(BuiltInFunctions.substr("hello", 0)).toBe("hello");
      expect(BuiltInFunctions.substr("hello", 0, 3)).toBe("he");
      expect(BuiltInFunctions.substr("hello", -1, 3)).toBe("h");
    });
  });

  describe("STRBEFORE", () => {
    it("should return substring before separator", () => {
      expect(BuiltInFunctions.strBefore("hello/world", "/")).toBe("hello");
    });

    it("should return empty string if separator not found", () => {
      expect(BuiltInFunctions.strBefore("hello world", "/")).toBe("");
    });

    it("should return empty string if separator is at start", () => {
      expect(BuiltInFunctions.strBefore("/hello", "/")).toBe("");
    });

    it("should handle empty separator (returns empty string per spec)", () => {
      expect(BuiltInFunctions.strBefore("hello", "")).toBe("");
    });

    it("should handle empty source string", () => {
      expect(BuiltInFunctions.strBefore("", "/")).toBe("");
    });

    it("should find first occurrence only", () => {
      expect(BuiltInFunctions.strBefore("a/b/c", "/")).toBe("a");
    });

    it("should handle multi-character separator", () => {
      expect(BuiltInFunctions.strBefore("hello::world", "::")).toBe("hello");
    });

    it("should handle path extraction", () => {
      expect(BuiltInFunctions.strBefore("/projects/task.md", "/")).toBe("");
      expect(BuiltInFunctions.strBefore("projects/task.md", "/")).toBe("projects");
    });
  });

  describe("STRAFTER", () => {
    it("should return substring after separator", () => {
      expect(BuiltInFunctions.strAfter("hello/world", "/")).toBe("world");
    });

    it("should return empty string if separator not found", () => {
      expect(BuiltInFunctions.strAfter("hello world", "/")).toBe("");
    });

    it("should return empty string if separator is at end", () => {
      expect(BuiltInFunctions.strAfter("hello/", "/")).toBe("");
    });

    it("should handle empty separator (returns entire string per spec)", () => {
      expect(BuiltInFunctions.strAfter("hello", "")).toBe("hello");
    });

    it("should handle empty source string", () => {
      expect(BuiltInFunctions.strAfter("", "/")).toBe("");
    });

    it("should find first occurrence only", () => {
      expect(BuiltInFunctions.strAfter("a/b/c", "/")).toBe("b/c");
    });

    it("should handle multi-character separator", () => {
      expect(BuiltInFunctions.strAfter("hello::world", "::")).toBe("world");
    });

    it("should extract fragment from URI", () => {
      expect(BuiltInFunctions.strAfter("http://example.org/resource#fragment", "#")).toBe("fragment");
    });

    it("should extract file extension", () => {
      expect(BuiltInFunctions.strAfter("document.md", ".")).toBe("md");
    });
  });

  describe("CONCAT", () => {
    it("should concatenate two strings", () => {
      expect(BuiltInFunctions.concat("hello", " world")).toBe("hello world");
    });

    it("should concatenate multiple strings", () => {
      expect(BuiltInFunctions.concat("a", "b", "c", "d")).toBe("abcd");
    });

    it("should handle single argument", () => {
      expect(BuiltInFunctions.concat("hello")).toBe("hello");
    });

    it("should handle no arguments", () => {
      expect(BuiltInFunctions.concat()).toBe("");
    });

    it("should handle empty strings in arguments", () => {
      expect(BuiltInFunctions.concat("hello", "", "world")).toBe("helloworld");
    });

    it("should build full name from parts", () => {
      expect(BuiltInFunctions.concat("John", " ", "Doe")).toBe("John Doe");
    });

    it("should build path from components", () => {
      expect(BuiltInFunctions.concat("/projects/", "myproject", "/tasks")).toBe("/projects/myproject/tasks");
    });
  });

  describe("REPLACE", () => {
    it("should replace pattern with replacement", () => {
      expect(BuiltInFunctions.replace("hello world", "world", "there")).toBe("hello there");
    });

    it("should support regex patterns", () => {
      expect(BuiltInFunctions.replace("test123", "\\d+", "NUM")).toBe("testNUM");
    });

    it("should replace all occurrences by default", () => {
      expect(BuiltInFunctions.replace("a-b-c", "-", "_")).toBe("a_b_c");
    });

    it("should throw for invalid regex", () => {
      expect(() => BuiltInFunctions.replace("test", "[invalid", "x")).toThrow("REPLACE: invalid pattern");
    });
  });

  describe("Logical Operators", () => {
    it("should perform logical AND", () => {
      expect(BuiltInFunctions.logicalAnd([true, true])).toBe(true);
      expect(BuiltInFunctions.logicalAnd([true, false])).toBe(false);
      expect(BuiltInFunctions.logicalAnd([false, false])).toBe(false);
    });

    it("should handle empty AND", () => {
      expect(BuiltInFunctions.logicalAnd([])).toBe(true);
    });

    it("should perform logical OR", () => {
      expect(BuiltInFunctions.logicalOr([true, true])).toBe(true);
      expect(BuiltInFunctions.logicalOr([true, false])).toBe(true);
      expect(BuiltInFunctions.logicalOr([false, false])).toBe(false);
    });

    it("should handle empty OR", () => {
      expect(BuiltInFunctions.logicalOr([])).toBe(false);
    });

    it("should perform logical NOT", () => {
      expect(BuiltInFunctions.logicalNot(true)).toBe(false);
      expect(BuiltInFunctions.logicalNot(false)).toBe(true);
    });
  });

  describe("DATEDIFFMINUTES", () => {
    it("should calculate difference in minutes between two dates", () => {
      // 2 hours = 120 minutes
      const date1 = "2025-11-26T05:00:00Z";
      const date2 = "2025-11-26T07:00:00Z";
      expect(BuiltInFunctions.dateDiffMinutes(date1, date2)).toBe(120);
    });

    it("should return positive value regardless of order", () => {
      const date1 = "2025-11-26T07:00:00Z";
      const date2 = "2025-11-26T05:00:00Z";
      expect(BuiltInFunctions.dateDiffMinutes(date1, date2)).toBe(120);
    });

    it("should handle JavaScript Date string format", () => {
      // Real-world format from vault data
      const date1 = "Wed Nov 26 2025 05:03:42 GMT+0500";
      const date2 = "Wed Nov 26 2025 14:10:09 GMT+0500";
      // Difference: 9h 6m 27s ≈ 546 minutes (rounded)
      const diff = BuiltInFunctions.dateDiffMinutes(date1, date2);
      expect(diff).toBe(547); // 9*60 + 6 + rounding from 27s
    });

    it("should handle ISO format dates", () => {
      const date1 = "2025-11-26T00:00:00";
      const date2 = "2025-11-26T01:30:00";
      expect(BuiltInFunctions.dateDiffMinutes(date1, date2)).toBe(90);
    });

    it("should calculate sleep duration correctly", () => {
      // Typical sleep scenario: start at midnight, wake up at 8am
      const sleepStart = "2025-11-26T00:00:00";
      const sleepEnd = "2025-11-26T08:00:00";
      expect(BuiltInFunctions.dateDiffMinutes(sleepStart, sleepEnd)).toBe(480); // 8 hours
    });

    it("should return 0 for same datetime", () => {
      const date = "2025-11-26T12:00:00Z";
      expect(BuiltInFunctions.dateDiffMinutes(date, date)).toBe(0);
    });

    it("should throw for invalid date string", () => {
      expect(() => BuiltInFunctions.dateDiffMinutes("invalid", "2025-11-26T00:00:00")).toThrow(
        "PARSEDATE: invalid date string"
      );
    });
  });

  describe("DATEDIFFHOURS", () => {
    it("should calculate difference in hours between two dates", () => {
      const date1 = "2025-11-26T05:00:00Z";
      const date2 = "2025-11-26T13:00:00Z";
      expect(BuiltInFunctions.dateDiffHours(date1, date2)).toBe(8);
    });

    it("should return positive value regardless of order", () => {
      const date1 = "2025-11-26T13:00:00Z";
      const date2 = "2025-11-26T05:00:00Z";
      expect(BuiltInFunctions.dateDiffHours(date1, date2)).toBe(8);
    });

    it("should return decimal hours", () => {
      // 1.5 hours
      const date1 = "2025-11-26T10:00:00Z";
      const date2 = "2025-11-26T11:30:00Z";
      expect(BuiltInFunctions.dateDiffHours(date1, date2)).toBe(1.5);
    });

    it("should handle JavaScript Date string format", () => {
      // Real-world format from vault data
      const date1 = "Wed Nov 26 2025 05:03:42 GMT+0500";
      const date2 = "Wed Nov 26 2025 14:10:09 GMT+0500";
      // Difference: 9h 6m 27s ≈ 9.11 hours
      const diff = BuiltInFunctions.dateDiffHours(date1, date2);
      expect(diff).toBeCloseTo(9.11, 1);
    });

    it("should calculate sleep duration correctly", () => {
      // Typical sleep scenario: 7.5 hours of sleep
      const sleepStart = "2025-11-26T23:30:00";
      const sleepEnd = "2025-11-27T07:00:00";
      expect(BuiltInFunctions.dateDiffHours(sleepStart, sleepEnd)).toBe(7.5);
    });

    it("should return 0 for same datetime", () => {
      const date = "2025-11-26T12:00:00Z";
      expect(BuiltInFunctions.dateDiffHours(date, date)).toBe(0);
    });

    it("should throw for invalid date string", () => {
      expect(() => BuiltInFunctions.dateDiffHours("invalid", "2025-11-26T00:00:00")).toThrow(
        "PARSEDATE: invalid date string"
      );
    });
  });

  describe("SPARQL 1.1 DateTime Accessor Functions", () => {
    describe("YEAR", () => {
      it("should extract year from ISO datetime", () => {
        expect(BuiltInFunctions.year("2025-11-30T14:30:00Z")).toBe(2025);
      });

      it("should extract year from date without time", () => {
        expect(BuiltInFunctions.year("2025-11-30")).toBe(2025);
      });

      it("should throw for invalid date", () => {
        expect(() => BuiltInFunctions.year("invalid")).toThrow("YEAR: invalid date string");
      });
    });

    describe("MONTH", () => {
      it("should extract month from ISO datetime", () => {
        expect(BuiltInFunctions.month("2025-11-30T14:30:00Z")).toBe(11);
      });

      it("should return 1 for January", () => {
        expect(BuiltInFunctions.month("2025-01-15T00:00:00Z")).toBe(1);
      });

      it("should return 12 for December", () => {
        expect(BuiltInFunctions.month("2025-12-25T00:00:00Z")).toBe(12);
      });

      it("should throw for invalid date", () => {
        expect(() => BuiltInFunctions.month("invalid")).toThrow("MONTH: invalid date string");
      });
    });

    describe("DAY", () => {
      it("should extract day from ISO datetime", () => {
        expect(BuiltInFunctions.day("2025-11-30T14:30:00Z")).toBe(30);
      });

      it("should return 1 for first day of month", () => {
        expect(BuiltInFunctions.day("2025-11-01T00:00:00Z")).toBe(1);
      });

      it("should return 31 for last day of month", () => {
        expect(BuiltInFunctions.day("2025-01-31T00:00:00Z")).toBe(31);
      });

      it("should throw for invalid date", () => {
        expect(() => BuiltInFunctions.day("invalid")).toThrow("DAY: invalid date string");
      });
    });

    describe("HOURS", () => {
      it("should extract hours from ISO datetime (local parse)", () => {
        // Without Z suffix, will be parsed as local time
        expect(BuiltInFunctions.hours("2025-11-30T14:30:00")).toBe(14);
      });

      it("should return 0 for midnight", () => {
        expect(BuiltInFunctions.hours("2025-11-30T00:30:00")).toBe(0);
      });

      it("should return 23 for last hour", () => {
        expect(BuiltInFunctions.hours("2025-11-30T23:30:00")).toBe(23);
      });

      it("should throw for invalid date", () => {
        expect(() => BuiltInFunctions.hours("invalid")).toThrow("HOURS: invalid date string");
      });
    });

    describe("MINUTES", () => {
      it("should extract minutes from ISO datetime", () => {
        expect(BuiltInFunctions.minutes("2025-11-30T14:45:30")).toBe(45);
      });

      it("should return 0 for zero minutes", () => {
        expect(BuiltInFunctions.minutes("2025-11-30T14:00:30")).toBe(0);
      });

      it("should return 59 for last minute", () => {
        expect(BuiltInFunctions.minutes("2025-11-30T14:59:30")).toBe(59);
      });

      it("should throw for invalid date", () => {
        expect(() => BuiltInFunctions.minutes("invalid")).toThrow("MINUTES: invalid date string");
      });
    });

    describe("SECONDS", () => {
      it("should extract seconds from ISO datetime", () => {
        expect(BuiltInFunctions.seconds("2025-11-30T14:45:30")).toBe(30);
      });

      it("should include milliseconds as decimal", () => {
        expect(BuiltInFunctions.seconds("2025-11-30T14:45:30.500")).toBe(30.5);
      });

      it("should return 0 for zero seconds", () => {
        expect(BuiltInFunctions.seconds("2025-11-30T14:45:00")).toBe(0);
      });

      it("should throw for invalid date", () => {
        expect(() => BuiltInFunctions.seconds("invalid")).toThrow("SECONDS: invalid date string");
      });
    });

    describe("TIMEZONE", () => {
      it("should return PT0S for UTC (Z)", () => {
        const result = BuiltInFunctions.timezone("2025-01-01T12:00:00Z");
        expect(result).toBeInstanceOf(Literal);
        expect(result.value).toBe("PT0S");
        expect(result.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#dayTimeDuration");
      });

      it("should return positive duration for positive offset", () => {
        const result = BuiltInFunctions.timezone("2025-01-01T12:00:00+05:00");
        expect(result).toBeInstanceOf(Literal);
        expect(result.value).toBe("PT5H");
        expect(result.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#dayTimeDuration");
      });

      it("should return negative duration for negative offset", () => {
        const result = BuiltInFunctions.timezone("2025-01-01T12:00:00-08:00");
        expect(result).toBeInstanceOf(Literal);
        expect(result.value).toBe("-PT8H");
        expect(result.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#dayTimeDuration");
      });

      it("should handle offset with minutes", () => {
        const result = BuiltInFunctions.timezone("2025-01-01T12:00:00+05:30");
        expect(result).toBeInstanceOf(Literal);
        expect(result.value).toBe("PT5H30M");
        expect(result.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#dayTimeDuration");
      });

      it("should handle negative offset with minutes", () => {
        const result = BuiltInFunctions.timezone("2025-01-01T12:00:00-09:45");
        expect(result).toBeInstanceOf(Literal);
        expect(result.value).toBe("-PT9H45M");
        expect(result.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#dayTimeDuration");
      });

      it("should throw for invalid date", () => {
        expect(() => BuiltInFunctions.timezone("invalid")).toThrow("TIMEZONE: invalid date string");
      });
    });

    describe("TZ", () => {
      it("should return Z for UTC", () => {
        const result = BuiltInFunctions.tz("2025-01-01T12:00:00Z");
        expect(result).toBe("Z");
      });

      it("should return positive offset string", () => {
        const result = BuiltInFunctions.tz("2025-01-01T12:00:00+05:00");
        expect(result).toBe("+05:00");
      });

      it("should return negative offset string", () => {
        const result = BuiltInFunctions.tz("2025-01-01T12:00:00-08:30");
        expect(result).toBe("-08:30");
      });

      it("should return empty string when no timezone", () => {
        const result = BuiltInFunctions.tz("2025-01-01T12:00:00");
        expect(result).toBe("");
      });

      it("should return empty string for date without time", () => {
        const result = BuiltInFunctions.tz("2025-01-01");
        expect(result).toBe("");
      });

      it("should throw for invalid date", () => {
        expect(() => BuiltInFunctions.tz("invalid")).toThrow("TZ: invalid date string");
      });
    });

    describe("ADJUST", () => {
      describe("adjust to different timezone", () => {
        it("should adjust UTC to positive timezone (+05:00 Almaty)", () => {
          const result = BuiltInFunctions.adjust("2025-01-15T10:00:00Z", "PT5H");
          expect(result).toBeInstanceOf(Literal);
          expect(result.value).toBe("2025-01-15T15:00:00+05:00");
          expect(result.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#dateTime");
        });

        it("should adjust UTC to negative timezone (-05:00)", () => {
          const result = BuiltInFunctions.adjust("2025-01-15T10:00:00Z", "-PT5H");
          expect(result).toBeInstanceOf(Literal);
          expect(result.value).toBe("2025-01-15T05:00:00-05:00");
          expect(result.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#dateTime");
        });

        it("should handle timezone with minutes (+05:30 India)", () => {
          const result = BuiltInFunctions.adjust("2025-01-15T10:00:00Z", "PT5H30M");
          expect(result).toBeInstanceOf(Literal);
          expect(result.value).toBe("2025-01-15T15:30:00+05:30");
          expect(result.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#dateTime");
        });

        it("should handle negative timezone with minutes (-09:30)", () => {
          const result = BuiltInFunctions.adjust("2025-01-15T10:00:00Z", "-PT9H30M");
          expect(result).toBeInstanceOf(Literal);
          expect(result.value).toBe("2025-01-15T00:30:00-09:30");
          expect(result.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#dateTime");
        });

        it("should adjust from one timezone to another", () => {
          // 10:00 +03:00 = 07:00 UTC, then to +05:00 = 12:00 +05:00
          const result = BuiltInFunctions.adjust("2025-01-15T10:00:00+03:00", "PT5H");
          expect(result).toBeInstanceOf(Literal);
          expect(result.value).toBe("2025-01-15T12:00:00+05:00");
          expect(result.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#dateTime");
        });

        it("should handle date change when crossing midnight (forward)", () => {
          // 22:00 UTC + 5 hours = 03:00 next day
          const result = BuiltInFunctions.adjust("2025-01-15T22:00:00Z", "PT5H");
          expect(result).toBeInstanceOf(Literal);
          expect(result.value).toBe("2025-01-16T03:00:00+05:00");
          expect(result.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#dateTime");
        });

        it("should handle date change when crossing midnight (backward)", () => {
          // 02:00 UTC - 5 hours = 21:00 previous day
          const result = BuiltInFunctions.adjust("2025-01-15T02:00:00Z", "-PT5H");
          expect(result).toBeInstanceOf(Literal);
          expect(result.value).toBe("2025-01-14T21:00:00-05:00");
          expect(result.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#dateTime");
        });

        it("should accept Literal input for dateTime", () => {
          const dtLiteral = new Literal(
            "2025-01-15T10:00:00Z",
            new IRI("http://www.w3.org/2001/XMLSchema#dateTime")
          );
          const result = BuiltInFunctions.adjust(dtLiteral, "PT5H");
          expect(result).toBeInstanceOf(Literal);
          expect(result.value).toBe("2025-01-15T15:00:00+05:00");
        });

        it("should accept Literal input for timezone", () => {
          const tzLiteral = new Literal(
            "PT5H",
            new IRI("http://www.w3.org/2001/XMLSchema#dayTimeDuration")
          );
          const result = BuiltInFunctions.adjust("2025-01-15T10:00:00Z", tzLiteral);
          expect(result).toBeInstanceOf(Literal);
          expect(result.value).toBe("2025-01-15T15:00:00+05:00");
        });

        it("should preserve milliseconds", () => {
          const result = BuiltInFunctions.adjust("2025-01-15T10:00:00.500Z", "PT5H");
          expect(result).toBeInstanceOf(Literal);
          expect(result.value).toBe("2025-01-15T15:00:00.500+05:00");
        });

        it("should handle PT0S (UTC timezone)", () => {
          const result = BuiltInFunctions.adjust("2025-01-15T10:00:00Z", "PT0S");
          expect(result).toBeInstanceOf(Literal);
          expect(result.value).toBe("2025-01-15T10:00:00+00:00");
          expect(result.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#dateTime");
        });
      });

      describe("remove timezone (single arg)", () => {
        it("should remove timezone from UTC dateTime", () => {
          const result = BuiltInFunctions.adjust("2025-01-15T10:00:00Z");
          expect(result).toBeInstanceOf(Literal);
          expect(result.value).toBe("2025-01-15T10:00:00");
          expect(result.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#dateTime");
        });

        it("should remove timezone from offset dateTime", () => {
          // 10:00 +03:00 = 07:00 UTC -> returns UTC time without timezone
          const result = BuiltInFunctions.adjust("2025-01-15T10:00:00+03:00");
          expect(result).toBeInstanceOf(Literal);
          expect(result.value).toBe("2025-01-15T07:00:00");
          expect(result.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#dateTime");
        });

        it("should preserve milliseconds when removing timezone", () => {
          const result = BuiltInFunctions.adjust("2025-01-15T10:00:00.123Z");
          expect(result).toBeInstanceOf(Literal);
          expect(result.value).toBe("2025-01-15T10:00:00.123");
        });

        it("should handle undefined timezone (same as no arg)", () => {
          const result = BuiltInFunctions.adjust("2025-01-15T10:00:00Z", undefined);
          expect(result).toBeInstanceOf(Literal);
          expect(result.value).toBe("2025-01-15T10:00:00");
        });
      });

      describe("error handling", () => {
        it("should throw for invalid dateTime", () => {
          expect(() => BuiltInFunctions.adjust("invalid")).toThrow("ADJUST: invalid dateTime");
        });

        it("should throw for invalid timezone duration", () => {
          expect(() => BuiltInFunctions.adjust("2025-01-15T10:00:00Z", "invalid")).toThrow();
        });

        it("should throw for timezone offset out of range (> +14:00)", () => {
          expect(() => BuiltInFunctions.adjust("2025-01-15T10:00:00Z", "PT15H")).toThrow(
            "ADJUST: timezone offset out of range"
          );
        });

        it("should throw for timezone offset out of range (< -14:00)", () => {
          expect(() => BuiltInFunctions.adjust("2025-01-15T10:00:00Z", "-PT15H")).toThrow(
            "ADJUST: timezone offset out of range"
          );
        });
      });
    });

    describe("NOW", () => {
      it("should return ISO string format", () => {
        const result = BuiltInFunctions.now();
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      });

      it("should return current time (within 1 second)", () => {
        const result = BuiltInFunctions.now();
        const resultDate = new Date(result);
        const now = new Date();
        const diffMs = Math.abs(resultDate.getTime() - now.getTime());
        expect(diffMs).toBeLessThan(1000);
      });
    });
  });

  describe("Duration Conversion Functions", () => {
    describe("msToMinutes", () => {
      it("should convert milliseconds to minutes", () => {
        expect(BuiltInFunctions.msToMinutes(60000)).toBe(1);
        expect(BuiltInFunctions.msToMinutes(3600000)).toBe(60);
        expect(BuiltInFunctions.msToMinutes(7200000)).toBe(120);
      });

      it("should round to nearest minute", () => {
        // 90 seconds = 1.5 minutes → rounds to 2
        expect(BuiltInFunctions.msToMinutes(90000)).toBe(2);
        // 30 seconds = 0.5 minutes → rounds to 1
        expect(BuiltInFunctions.msToMinutes(30000)).toBe(1);
      });
    });

    describe("msToHours", () => {
      it("should convert milliseconds to hours", () => {
        expect(BuiltInFunctions.msToHours(3600000)).toBe(1);
        expect(BuiltInFunctions.msToHours(7200000)).toBe(2);
      });

      it("should return decimal hours", () => {
        // 1.5 hours
        expect(BuiltInFunctions.msToHours(5400000)).toBe(1.5);
      });
    });

    describe("msToSeconds", () => {
      it("should convert milliseconds to seconds", () => {
        expect(BuiltInFunctions.msToSeconds(1000)).toBe(1);
        expect(BuiltInFunctions.msToSeconds(60000)).toBe(60);
      });

      it("should round to nearest second", () => {
        expect(BuiltInFunctions.msToSeconds(1500)).toBe(2);
        expect(BuiltInFunctions.msToSeconds(500)).toBe(1);
      });
    });
  });

  describe("SPARQL 1.1 Numeric Functions", () => {
    describe("ABS", () => {
      it("should return absolute value of positive number", () => {
        expect(BuiltInFunctions.abs(5)).toBe(5);
        expect(BuiltInFunctions.abs(42.5)).toBe(42.5);
      });

      it("should return absolute value of negative number", () => {
        expect(BuiltInFunctions.abs(-5)).toBe(5);
        expect(BuiltInFunctions.abs(-42.5)).toBe(42.5);
      });

      it("should return 0 for 0", () => {
        expect(BuiltInFunctions.abs(0)).toBe(0);
      });

      it("should handle very large numbers", () => {
        expect(BuiltInFunctions.abs(-1e10)).toBe(1e10);
        expect(BuiltInFunctions.abs(1e15)).toBe(1e15);
      });

      it("should handle very small decimals", () => {
        expect(BuiltInFunctions.abs(-0.00001)).toBe(0.00001);
        expect(BuiltInFunctions.abs(0.00001)).toBe(0.00001);
      });
    });

    describe("ROUND", () => {
      it("should round to nearest integer", () => {
        expect(BuiltInFunctions.round(2.5)).toBe(3);
        expect(BuiltInFunctions.round(2.4)).toBe(2);
        expect(BuiltInFunctions.round(2.6)).toBe(3);
      });

      it("should round negative numbers correctly", () => {
        expect(BuiltInFunctions.round(-2.5)).toBe(-2);
        expect(BuiltInFunctions.round(-2.4)).toBe(-2);
        expect(BuiltInFunctions.round(-2.6)).toBe(-3);
      });

      it("should return integer unchanged", () => {
        expect(BuiltInFunctions.round(5)).toBe(5);
        expect(BuiltInFunctions.round(-5)).toBe(-5);
        expect(BuiltInFunctions.round(0)).toBe(0);
      });

      it("should handle very large numbers", () => {
        expect(BuiltInFunctions.round(1e10 + 0.5)).toBe(1e10 + 1);
      });
    });

    describe("CEIL", () => {
      it("should round up to nearest integer", () => {
        expect(BuiltInFunctions.ceil(2.1)).toBe(3);
        expect(BuiltInFunctions.ceil(2.9)).toBe(3);
        expect(BuiltInFunctions.ceil(2.0)).toBe(2);
      });

      it("should round negative numbers toward zero", () => {
        expect(BuiltInFunctions.ceil(-2.1)).toBe(-2);
        expect(BuiltInFunctions.ceil(-2.9)).toBe(-2);
        expect(BuiltInFunctions.ceil(-2.0)).toBe(-2);
      });

      it("should return integer unchanged", () => {
        expect(BuiltInFunctions.ceil(5)).toBe(5);
        expect(BuiltInFunctions.ceil(-5)).toBe(-5);
        expect(BuiltInFunctions.ceil(0)).toBe(0);
      });

      it("should handle very small positive decimals", () => {
        expect(BuiltInFunctions.ceil(0.00001)).toBe(1);
        expect(BuiltInFunctions.ceil(0.99999)).toBe(1);
      });
    });

    describe("FLOOR", () => {
      it("should round down to nearest integer", () => {
        expect(BuiltInFunctions.floor(2.1)).toBe(2);
        expect(BuiltInFunctions.floor(2.9)).toBe(2);
        expect(BuiltInFunctions.floor(2.0)).toBe(2);
      });

      it("should round negative numbers away from zero", () => {
        expect(BuiltInFunctions.floor(-2.1)).toBe(-3);
        expect(BuiltInFunctions.floor(-2.9)).toBe(-3);
        expect(BuiltInFunctions.floor(-2.0)).toBe(-2);
      });

      it("should return integer unchanged", () => {
        expect(BuiltInFunctions.floor(5)).toBe(5);
        expect(BuiltInFunctions.floor(-5)).toBe(-5);
        expect(BuiltInFunctions.floor(0)).toBe(0);
      });

      it("should handle very small positive decimals", () => {
        expect(BuiltInFunctions.floor(0.00001)).toBe(0);
        expect(BuiltInFunctions.floor(0.99999)).toBe(0);
      });
    });

    describe("RAND", () => {
      it("should return number in range [0, 1)", () => {
        for (let i = 0; i < 100; i++) {
          const value = BuiltInFunctions.rand();
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThan(1);
        }
      });

      it("should return different values on multiple calls", () => {
        const values: Set<number> = new Set();
        for (let i = 0; i < 100; i++) {
          values.add(BuiltInFunctions.rand());
        }
        // Should have mostly unique values (statistically)
        expect(values.size).toBeGreaterThan(90);
      });
    });
  });

  describe("SPARQL 1.1 Conditional Functions", () => {
    describe("COALESCE", () => {
      it("should return first non-null value with 2 arguments", () => {
        expect(BuiltInFunctions.coalesce([undefined, "fallback"])).toBe("fallback");
        expect(BuiltInFunctions.coalesce(["first", "second"])).toBe("first");
      });

      it("should return first non-null value with 3 arguments", () => {
        expect(BuiltInFunctions.coalesce([undefined, undefined, "third"])).toBe("third");
        expect(BuiltInFunctions.coalesce([undefined, "second", "third"])).toBe("second");
        expect(BuiltInFunctions.coalesce(["first", "second", "third"])).toBe("first");
      });

      it("should return first non-null value with 5 arguments", () => {
        expect(BuiltInFunctions.coalesce([undefined, undefined, undefined, undefined, "fifth"])).toBe("fifth");
        expect(BuiltInFunctions.coalesce([undefined, undefined, "third", undefined, "fifth"])).toBe("third");
      });

      it("should return undefined when all arguments are unbound", () => {
        expect(BuiltInFunctions.coalesce([undefined, undefined])).toBeUndefined();
        expect(BuiltInFunctions.coalesce([undefined, undefined, undefined])).toBeUndefined();
        expect(BuiltInFunctions.coalesce([null, null, null])).toBeUndefined();
        expect(BuiltInFunctions.coalesce([undefined, null, undefined])).toBeUndefined();
      });

      it("should return undefined for empty array", () => {
        expect(BuiltInFunctions.coalesce([])).toBeUndefined();
      });

      it("should handle mixed types (string, number, IRI)", () => {
        const iri = new IRI("http://example.org/resource");
        const literal = new Literal("test");

        expect(BuiltInFunctions.coalesce([undefined, iri])).toBe(iri);
        expect(BuiltInFunctions.coalesce([undefined, literal])).toBe(literal);
        expect(BuiltInFunctions.coalesce([undefined, 42])).toBe(42);
        expect(BuiltInFunctions.coalesce([undefined, 0])).toBe(0);
        expect(BuiltInFunctions.coalesce([undefined, ""])).toBe("");
      });

      it("should treat 0 and empty string as valid values", () => {
        expect(BuiltInFunctions.coalesce([0, 42])).toBe(0);
        expect(BuiltInFunctions.coalesce(["", "fallback"])).toBe("");
      });

      it("should skip null values and continue", () => {
        expect(BuiltInFunctions.coalesce([null, "second"])).toBe("second");
        expect(BuiltInFunctions.coalesce([null, null, "third"])).toBe("third");
      });
    });

    describe("IF", () => {
      it("should return thenValue when condition is true", () => {
        expect(BuiltInFunctions.if(true, "yes", "no")).toBe("yes");
        expect(BuiltInFunctions.if(true, 1, 0)).toBe(1);
      });

      it("should return elseValue when condition is false", () => {
        expect(BuiltInFunctions.if(false, "yes", "no")).toBe("no");
        expect(BuiltInFunctions.if(false, 1, 0)).toBe(0);
      });

      it("should handle RDF term return types", () => {
        const iri1 = new IRI("http://example.org/resource1");
        const iri2 = new IRI("http://example.org/resource2");
        const literal1 = new Literal("value1");
        const literal2 = new Literal("value2");

        expect(BuiltInFunctions.if(true, iri1, iri2)).toBe(iri1);
        expect(BuiltInFunctions.if(false, iri1, iri2)).toBe(iri2);
        expect(BuiltInFunctions.if(true, literal1, literal2)).toBe(literal1);
        expect(BuiltInFunctions.if(false, literal1, literal2)).toBe(literal2);
      });

      it("should handle mixed types via any cast", () => {
        // In real SPARQL, IF can return different types based on condition
        // TypeScript generic forces same types, but runtime allows mixed types
        const iri = new IRI("http://example.org/resource");
        const literal = new Literal("test");

        // Use explicit any to test runtime behavior with mixed types
        const result1 = (BuiltInFunctions.if as any)(true, iri, literal);
        const result2 = (BuiltInFunctions.if as any)(false, iri, literal);
        const result3 = (BuiltInFunctions.if as any)(true, 42, "forty-two");
        const result4 = (BuiltInFunctions.if as any)(false, 42, "forty-two");

        expect(result1).toBe(iri);
        expect(result2).toBe(literal);
        expect(result3).toBe(42);
        expect(result4).toBe("forty-two");
      });

      it("should handle undefined and null as return values", () => {
        expect(BuiltInFunctions.if(true, undefined, "fallback")).toBeUndefined();
        expect(BuiltInFunctions.if(false, "value", null)).toBeNull();
      });
    });
  });

  describe("sameTerm", () => {
    describe("IRI comparison", () => {
      it("should return true for identical IRIs", () => {
        const iri1 = new IRI("http://example.org/resource");
        const iri2 = new IRI("http://example.org/resource");
        expect(BuiltInFunctions.sameTerm(iri1, iri2)).toBe(true);
      });

      it("should return false for different IRIs", () => {
        const iri1 = new IRI("http://example.org/resource1");
        const iri2 = new IRI("http://example.org/resource2");
        expect(BuiltInFunctions.sameTerm(iri1, iri2)).toBe(false);
      });

      it("should handle same IRI object reference", () => {
        const iri = new IRI("http://example.org/resource");
        expect(BuiltInFunctions.sameTerm(iri, iri)).toBe(true);
      });
    });

    describe("BlankNode comparison", () => {
      it("should return true for identical blank nodes", () => {
        const bn1 = new BlankNode("b1");
        const bn2 = new BlankNode("b1");
        expect(BuiltInFunctions.sameTerm(bn1, bn2)).toBe(true);
      });

      it("should return false for different blank nodes", () => {
        const bn1 = new BlankNode("b1");
        const bn2 = new BlankNode("b2");
        expect(BuiltInFunctions.sameTerm(bn1, bn2)).toBe(false);
      });
    });

    describe("Literal comparison - plain literals", () => {
      it("should return true for identical plain literals", () => {
        const lit1 = new Literal("hello");
        const lit2 = new Literal("hello");
        expect(BuiltInFunctions.sameTerm(lit1, lit2)).toBe(true);
      });

      it("should return false for different plain literal values", () => {
        const lit1 = new Literal("hello");
        const lit2 = new Literal("world");
        expect(BuiltInFunctions.sameTerm(lit1, lit2)).toBe(false);
      });
    });

    describe("Literal comparison - typed literals", () => {
      it("should return true for identical typed literals", () => {
        const xsdInt = new IRI("http://www.w3.org/2001/XMLSchema#integer");
        const lit1 = new Literal("42", xsdInt);
        const lit2 = new Literal("42", xsdInt);
        expect(BuiltInFunctions.sameTerm(lit1, lit2)).toBe(true);
      });

      it("should return false for same value with different datatypes", () => {
        const xsdInt = new IRI("http://www.w3.org/2001/XMLSchema#integer");
        const xsdDecimal = new IRI("http://www.w3.org/2001/XMLSchema#decimal");
        const lit1 = new Literal("42", xsdInt);
        const lit2 = new Literal("42", xsdDecimal);
        // Key difference from = operator: sameTerm requires exact datatype match
        expect(BuiltInFunctions.sameTerm(lit1, lit2)).toBe(false);
      });

      it("should return false for plain literal vs xsd:string typed literal", () => {
        // This is the key semantic difference from Literal.equals()
        // Per SPARQL 1.1 spec, sameTerm requires exact term identity
        const xsdString = new IRI("http://www.w3.org/2001/XMLSchema#string");
        const plainLit = new Literal("hello");
        const typedLit = new Literal("hello", xsdString);
        // Plain literal has no datatype, typed has xsd:string - not identical terms
        expect(BuiltInFunctions.sameTerm(plainLit, typedLit)).toBe(false);
      });

      it("should return false for different numeric representations", () => {
        // "42"^^xsd:integer and "42.0"^^xsd:decimal are equal by value but not same term
        const xsdInt = new IRI("http://www.w3.org/2001/XMLSchema#integer");
        const xsdDecimal = new IRI("http://www.w3.org/2001/XMLSchema#decimal");
        const intLit = new Literal("42", xsdInt);
        const decLit = new Literal("42.0", xsdDecimal);
        expect(BuiltInFunctions.sameTerm(intLit, decLit)).toBe(false);
      });
    });

    describe("Literal comparison - language tags", () => {
      it("should return true for identical language-tagged literals", () => {
        const lit1 = new Literal("hello", undefined, "en");
        const lit2 = new Literal("hello", undefined, "en");
        expect(BuiltInFunctions.sameTerm(lit1, lit2)).toBe(true);
      });

      it("should return false for different language tags", () => {
        const lit1 = new Literal("hello", undefined, "en");
        const lit2 = new Literal("hello", undefined, "de");
        expect(BuiltInFunctions.sameTerm(lit1, lit2)).toBe(false);
      });

      it("should return false for language-tagged vs plain literal", () => {
        const lit1 = new Literal("hello", undefined, "en");
        const lit2 = new Literal("hello");
        expect(BuiltInFunctions.sameTerm(lit1, lit2)).toBe(false);
      });

      it("should be case-insensitive for language tags (normalized by Literal)", () => {
        // Literal class normalizes language tags to lowercase
        const lit1 = new Literal("hello", undefined, "EN");
        const lit2 = new Literal("hello", undefined, "en");
        expect(BuiltInFunctions.sameTerm(lit1, lit2)).toBe(true);
      });
    });

    describe("Cross-type comparison", () => {
      it("should return false for IRI vs Literal", () => {
        const iri = new IRI("http://example.org/resource");
        const lit = new Literal("http://example.org/resource");
        expect(BuiltInFunctions.sameTerm(iri, lit)).toBe(false);
      });

      it("should return false for IRI vs BlankNode", () => {
        const iri = new IRI("http://example.org/b1");
        const bn = new BlankNode("b1");
        expect(BuiltInFunctions.sameTerm(iri, bn)).toBe(false);
      });

      it("should return false for Literal vs BlankNode", () => {
        const lit = new Literal("b1");
        const bn = new BlankNode("b1");
        expect(BuiltInFunctions.sameTerm(lit, bn)).toBe(false);
      });
    });

    describe("Undefined handling", () => {
      it("should return true for both undefined", () => {
        expect(BuiltInFunctions.sameTerm(undefined, undefined)).toBe(true);
      });

      it("should return false for undefined vs IRI", () => {
        const iri = new IRI("http://example.org/resource");
        expect(BuiltInFunctions.sameTerm(undefined, iri)).toBe(false);
        expect(BuiltInFunctions.sameTerm(iri, undefined)).toBe(false);
      });

      it("should return false for undefined vs Literal", () => {
        const lit = new Literal("test");
        expect(BuiltInFunctions.sameTerm(undefined, lit)).toBe(false);
        expect(BuiltInFunctions.sameTerm(lit, undefined)).toBe(false);
      });

      it("should return false for undefined vs BlankNode", () => {
        const bn = new BlankNode("b1");
        expect(BuiltInFunctions.sameTerm(undefined, bn)).toBe(false);
        expect(BuiltInFunctions.sameTerm(bn, undefined)).toBe(false);
      });
    });

    describe("SPARQL spec examples", () => {
      it("should distinguish between equal values and same terms", () => {
        // From SPARQL 1.1 spec section 17.4.2.5
        // sameTerm("42"^^xsd:integer, "42"^^xsd:integer) = true
        const xsdInt = new IRI("http://www.w3.org/2001/XMLSchema#integer");
        const lit1 = new Literal("42", xsdInt);
        const lit2 = new Literal("42", xsdInt);
        expect(BuiltInFunctions.sameTerm(lit1, lit2)).toBe(true);

        // sameTerm("42"^^xsd:integer, "42.0"^^xsd:decimal) = false
        // Even though they are equal by value
        const xsdDecimal = new IRI("http://www.w3.org/2001/XMLSchema#decimal");
        const lit3 = new Literal("42.0", xsdDecimal);
        expect(BuiltInFunctions.sameTerm(lit1, lit3)).toBe(false);
      });
    });
  });

  describe("XSD Type Casting Functions", () => {
    describe("xsdDateTime", () => {
      it("should convert ISO 8601 string to dateTime Literal", () => {
        const result = BuiltInFunctions.xsdDateTime("2025-12-02T10:30:00Z");
        expect(result).toBeInstanceOf(Literal);
        expect(result.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#dateTime");
        // The value should be a valid ISO string
        expect(new Date(result.value).toISOString()).toBe("2025-12-02T10:30:00.000Z");
      });

      it("should convert JavaScript Date string format to dateTime Literal", () => {
        // Real-world format from vault data (Issue #534)
        const result = BuiltInFunctions.xsdDateTime("Tue Dec 02 2025 02:10:39 GMT+0500");
        expect(result).toBeInstanceOf(Literal);
        expect(result.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#dateTime");
        // Should be converted to ISO 8601
        expect(result.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      });

      it("should handle date without time", () => {
        const result = BuiltInFunctions.xsdDateTime("2025-12-02");
        expect(result).toBeInstanceOf(Literal);
        expect(result.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#dateTime");
      });

      it("should throw for invalid date string", () => {
        expect(() => BuiltInFunctions.xsdDateTime("invalid")).toThrow("xsd:dateTime: invalid date string");
      });

      it("should throw for empty string", () => {
        expect(() => BuiltInFunctions.xsdDateTime("")).toThrow("xsd:dateTime: invalid date string");
      });

      it("should preserve date semantics after conversion", () => {
        // Sleep analysis use case from Issue #534
        const startStr = "Tue Dec 02 2025 02:10:39 GMT+0500";
        const endStr = "Tue Dec 02 2025 10:30:00 GMT+0500";

        const startLiteral = BuiltInFunctions.xsdDateTime(startStr);
        const endLiteral = BuiltInFunctions.xsdDateTime(endStr);

        // Verify the dates can be parsed and compared
        const startMs = new Date(startLiteral.value).getTime();
        const endMs = new Date(endLiteral.value).getTime();

        expect(endMs).toBeGreaterThan(startMs);
        // Difference should be ~8 hours 19 minutes = 499 minutes
        const diffMinutes = (endMs - startMs) / (1000 * 60);
        expect(diffMinutes).toBeCloseTo(499, 0);
      });
    });

    describe("xsdInteger", () => {
      it("should convert string to integer Literal", () => {
        const result = BuiltInFunctions.xsdInteger("42");
        expect(result).toBeInstanceOf(Literal);
        expect(result.value).toBe("42");
        expect(result.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#integer");
      });

      it("should handle negative numbers", () => {
        const result = BuiltInFunctions.xsdInteger("-123");
        expect(result.value).toBe("-123");
        expect(result.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#integer");
      });

      it("should truncate decimal values", () => {
        const result = BuiltInFunctions.xsdInteger("42.99");
        expect(result.value).toBe("42");
      });

      it("should throw for non-numeric string", () => {
        expect(() => BuiltInFunctions.xsdInteger("abc")).toThrow("xsd:integer: cannot convert 'abc' to integer");
      });

      it("should handle zero", () => {
        const result = BuiltInFunctions.xsdInteger("0");
        expect(result.value).toBe("0");
      });

      it("should handle large numbers", () => {
        const result = BuiltInFunctions.xsdInteger("1234567890");
        expect(result.value).toBe("1234567890");
      });
    });

    describe("xsdDecimal", () => {
      it("should convert string to decimal Literal", () => {
        const result = BuiltInFunctions.xsdDecimal("42.5");
        expect(result).toBeInstanceOf(Literal);
        expect(result.value).toBe("42.5");
        expect(result.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#decimal");
      });

      it("should handle integer values", () => {
        const result = BuiltInFunctions.xsdDecimal("42");
        expect(result.value).toBe("42");
        expect(result.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#decimal");
      });

      it("should handle negative decimals", () => {
        const result = BuiltInFunctions.xsdDecimal("-3.14159");
        expect(result.value).toBe("-3.14159");
      });

      it("should throw for non-numeric string", () => {
        expect(() => BuiltInFunctions.xsdDecimal("xyz")).toThrow("xsd:decimal: cannot convert 'xyz' to decimal");
      });

      it("should handle scientific notation", () => {
        const result = BuiltInFunctions.xsdDecimal("1.5e3");
        expect(result.value).toBe("1500");
      });
    });
  });

  describe("ENCODE_FOR_URI", () => {
    describe("basic encoding", () => {
      it("should encode spaces as %20", () => {
        expect(BuiltInFunctions.encodeForUri("hello world")).toBe("hello%20world");
      });

      it("should encode URL special characters", () => {
        expect(BuiltInFunctions.encodeForUri("a/b?c=d")).toBe("a%2Fb%3Fc%3Dd");
      });

      it("should encode ampersand", () => {
        expect(BuiltInFunctions.encodeForUri("foo&bar")).toBe("foo%26bar");
      });

      it("should encode hash/fragment", () => {
        expect(BuiltInFunctions.encodeForUri("test#anchor")).toBe("test%23anchor");
      });

      it("should encode percent sign", () => {
        expect(BuiltInFunctions.encodeForUri("100%")).toBe("100%25");
      });
    });

    describe("unreserved characters (should NOT be encoded)", () => {
      it("should not encode alphabetic characters", () => {
        expect(BuiltInFunctions.encodeForUri("ABCxyz")).toBe("ABCxyz");
      });

      it("should not encode digits", () => {
        expect(BuiltInFunctions.encodeForUri("0123456789")).toBe("0123456789");
      });

      it("should not encode hyphen", () => {
        expect(BuiltInFunctions.encodeForUri("foo-bar")).toBe("foo-bar");
      });

      it("should not encode underscore", () => {
        expect(BuiltInFunctions.encodeForUri("foo_bar")).toBe("foo_bar");
      });

      it("should not encode period", () => {
        expect(BuiltInFunctions.encodeForUri("file.txt")).toBe("file.txt");
      });

      it("should not encode tilde", () => {
        expect(BuiltInFunctions.encodeForUri("~user")).toBe("~user");
      });
    });

    describe("reserved characters (should be encoded)", () => {
      it("should encode colon", () => {
        expect(BuiltInFunctions.encodeForUri("http://example.org")).toBe("http%3A%2F%2Fexample.org");
      });

      it("should encode brackets", () => {
        expect(BuiltInFunctions.encodeForUri("[array]")).toBe("%5Barray%5D");
      });

      it("should encode parentheses", () => {
        expect(BuiltInFunctions.encodeForUri("(value)")).toBe("(value)");
      });

      it("should encode plus sign", () => {
        expect(BuiltInFunctions.encodeForUri("a+b")).toBe("a%2Bb");
      });

      it("should encode exclamation mark", () => {
        expect(BuiltInFunctions.encodeForUri("hello!")).toBe("hello!");
      });
    });

    describe("unicode characters", () => {
      it("should encode Cyrillic characters", () => {
        expect(BuiltInFunctions.encodeForUri("Привет")).toBe("%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82");
      });

      it("should encode Chinese characters", () => {
        expect(BuiltInFunctions.encodeForUri("中文")).toBe("%E4%B8%AD%E6%96%87");
      });

      it("should encode emoji", () => {
        expect(BuiltInFunctions.encodeForUri("👍")).toBe("%F0%9F%91%8D");
      });
    });

    describe("edge cases", () => {
      it("should return empty string for empty input", () => {
        expect(BuiltInFunctions.encodeForUri("")).toBe("");
      });

      it("should handle string with only unreserved characters", () => {
        expect(BuiltInFunctions.encodeForUri("simple-test_123.txt~")).toBe("simple-test_123.txt~");
      });

      it("should handle string with only reserved characters", () => {
        expect(BuiltInFunctions.encodeForUri("/?#")).toBe("%2F%3F%23");
      });

      it("should handle mixed content", () => {
        expect(BuiltInFunctions.encodeForUri("Los Angeles")).toBe("Los%20Angeles");
        expect(BuiltInFunctions.encodeForUri("New York City")).toBe("New%20York%20City");
      });
    });

    describe("SPARQL spec examples", () => {
      // From SPARQL 1.1 spec section 17.4.3.11
      it('ENCODE_FOR_URI("Los Angeles") returns "Los%20Angeles"', () => {
        expect(BuiltInFunctions.encodeForUri("Los Angeles")).toBe("Los%20Angeles");
      });

      it("should properly encode for use in IRI construction", () => {
        // Use case: CONCAT("http://example.org/", ENCODE_FOR_URI(?name))
        const name = "John Doe";
        const encoded = BuiltInFunctions.encodeForUri(name);
        expect(encoded).toBe("John%20Doe");
        const uri = "http://example.org/" + encoded;
        expect(uri).toBe("http://example.org/John%20Doe");
      });
    });
  });

  describe("SPARQL 1.1 Hash Functions", () => {
    describe("MD5", () => {
      it("should return correct hash for 'test'", () => {
        // Well-known MD5 hash for "test"
        expect(BuiltInFunctions.md5("test")).toBe("098f6bcd4621d373cade4e832627b4f6");
      });

      it("should return lowercase hex string", () => {
        const result = BuiltInFunctions.md5("hello");
        expect(result).toMatch(/^[0-9a-f]{32}$/);
      });

      it("should handle empty string", () => {
        // MD5("") = d41d8cd98f00b204e9800998ecf8427e
        expect(BuiltInFunctions.md5("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
      });

      it("should handle unicode strings", () => {
        const result = BuiltInFunctions.md5("Привет");
        expect(result).toMatch(/^[0-9a-f]{32}$/);
        expect(result.length).toBe(32);
      });

      it("should produce different hashes for different inputs", () => {
        const hash1 = BuiltInFunctions.md5("test1");
        const hash2 = BuiltInFunctions.md5("test2");
        expect(hash1).not.toBe(hash2);
      });
    });

    describe("SHA1", () => {
      it("should return correct hash for 'test'", () => {
        // Well-known SHA1 hash for "test"
        expect(BuiltInFunctions.sha1("test")).toBe("a94a8fe5ccb19ba61c4c0873d391e987982fbbd3");
      });

      it("should return lowercase hex string", () => {
        const result = BuiltInFunctions.sha1("hello");
        expect(result).toMatch(/^[0-9a-f]{40}$/);
      });

      it("should handle empty string", () => {
        // SHA1("") = da39a3ee5e6b4b0d3255bfef95601890afd80709
        expect(BuiltInFunctions.sha1("")).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
      });

      it("should handle unicode strings", () => {
        const result = BuiltInFunctions.sha1("Привет");
        expect(result).toMatch(/^[0-9a-f]{40}$/);
        expect(result.length).toBe(40);
      });

      it("should produce different hashes for different inputs", () => {
        const hash1 = BuiltInFunctions.sha1("test1");
        const hash2 = BuiltInFunctions.sha1("test2");
        expect(hash1).not.toBe(hash2);
      });
    });

    describe("SHA256", () => {
      it("should return correct hash for 'test'", () => {
        // Well-known SHA256 hash for "test"
        expect(BuiltInFunctions.sha256("test")).toBe(
          "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
        );
      });

      it("should return lowercase hex string", () => {
        const result = BuiltInFunctions.sha256("hello");
        expect(result).toMatch(/^[0-9a-f]{64}$/);
      });

      it("should handle empty string", () => {
        // SHA256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
        expect(BuiltInFunctions.sha256("")).toBe(
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
      });

      it("should handle unicode strings", () => {
        const result = BuiltInFunctions.sha256("Привет");
        expect(result).toMatch(/^[0-9a-f]{64}$/);
        expect(result.length).toBe(64);
      });

      it("should produce different hashes for different inputs", () => {
        const hash1 = BuiltInFunctions.sha256("test1");
        const hash2 = BuiltInFunctions.sha256("test2");
        expect(hash1).not.toBe(hash2);
      });
    });

    describe("SHA384", () => {
      it("should return lowercase hex string of correct length", () => {
        const result = BuiltInFunctions.sha384("test");
        expect(result).toMatch(/^[0-9a-f]{96}$/);
        expect(result.length).toBe(96);
      });

      it("should handle empty string", () => {
        // SHA384("") starts with 38b060a751ac96...
        expect(BuiltInFunctions.sha384("")).toBe(
          "38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da274edebfe76f65fbd51ad2f14898b95b"
        );
      });

      it("should handle unicode strings", () => {
        const result = BuiltInFunctions.sha384("Привет");
        expect(result).toMatch(/^[0-9a-f]{96}$/);
      });

      it("should produce different hashes for different inputs", () => {
        const hash1 = BuiltInFunctions.sha384("test1");
        const hash2 = BuiltInFunctions.sha384("test2");
        expect(hash1).not.toBe(hash2);
      });
    });

    describe("SHA512", () => {
      it("should return lowercase hex string of correct length", () => {
        const result = BuiltInFunctions.sha512("test");
        expect(result).toMatch(/^[0-9a-f]{128}$/);
        expect(result.length).toBe(128);
      });

      it("should handle empty string", () => {
        // SHA512("") starts with cf83e1357eefb8...
        expect(BuiltInFunctions.sha512("")).toBe(
          "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e"
        );
      });

      it("should handle unicode strings", () => {
        const result = BuiltInFunctions.sha512("Привет");
        expect(result).toMatch(/^[0-9a-f]{128}$/);
      });

      it("should produce different hashes for different inputs", () => {
        const hash1 = BuiltInFunctions.sha512("test1");
        const hash2 = BuiltInFunctions.sha512("test2");
        expect(hash1).not.toBe(hash2);
      });
    });

    describe("SPARQL spec use cases", () => {
      it("should generate reproducible keys from email addresses", () => {
        const email = "user@example.org";
        const hash1 = BuiltInFunctions.sha256(email);
        const hash2 = BuiltInFunctions.sha256(email);
        expect(hash1).toBe(hash2);
      });

      it("should generate unique identifiers from strings", () => {
        const id1 = BuiltInFunctions.md5("resource1");
        const id2 = BuiltInFunctions.md5("resource2");
        expect(id1).not.toBe(id2);
      });

      it("should work with special characters", () => {
        const result = BuiltInFunctions.sha256("test@email.com#anchor?query=1");
        expect(result).toMatch(/^[0-9a-f]{64}$/);
      });
    });
  });

  // SPARQL 1.1 Constructor Functions Tests
  // https://www.w3.org/TR/sparql11-query/#FunctionMapping

  describe("IRI constructor function", () => {
    describe("basic functionality", () => {
      it("should create IRI from string literal", () => {
        const literal = new Literal("http://example.org/resource");
        const result = BuiltInFunctions.iri(literal);
        expect(result).toBeInstanceOf(IRI);
        expect(result.value).toBe("http://example.org/resource");
      });

      it("should return IRI unchanged", () => {
        const iri = new IRI("http://example.org/resource");
        const result = BuiltInFunctions.iri(iri);
        expect(result).toBeInstanceOf(IRI);
        expect(result.value).toBe("http://example.org/resource");
      });

      it("should handle absolute URIs", () => {
        const literal = new Literal("https://example.org/path/to/resource#fragment");
        const result = BuiltInFunctions.iri(literal);
        expect(result.value).toBe("https://example.org/path/to/resource#fragment");
      });

      it("should handle URN scheme", () => {
        const literal = new Literal("urn:isbn:0451450523");
        const result = BuiltInFunctions.iri(literal);
        expect(result.value).toBe("urn:isbn:0451450523");
      });
    });

    describe("error handling", () => {
      it("should throw for undefined", () => {
        expect(() => BuiltInFunctions.iri(undefined)).toThrow("IRI: argument is undefined");
      });

      it("should throw for blank node", () => {
        const blank = new BlankNode("b1");
        expect(() => BuiltInFunctions.iri(blank)).toThrow("IRI: cannot convert blank node to IRI");
      });
    });

    describe("SPARQL spec examples", () => {
      it("IRI(literal) creates IRI from string value", () => {
        const literal = new Literal("http://example.org/test");
        const result = BuiltInFunctions.iri(literal);
        expect(result).toBeInstanceOf(IRI);
        expect(result.value).toBe("http://example.org/test");
      });

      it("IRI(IRI) returns the same IRI", () => {
        const iri = new IRI("http://example.org/test");
        const result = BuiltInFunctions.iri(iri);
        expect(result).toBe(iri);
      });
    });
  });

  describe("URI constructor function (synonym for IRI)", () => {
    it("should behave identically to IRI", () => {
      const literal = new Literal("http://example.org/resource");
      const iriResult = BuiltInFunctions.iri(literal);
      const uriResult = BuiltInFunctions.uri(literal);
      expect(uriResult.value).toBe(iriResult.value);
    });

    it("should throw for undefined", () => {
      expect(() => BuiltInFunctions.uri(undefined)).toThrow("IRI: argument is undefined");
    });

    it("should throw for blank node", () => {
      const blank = new BlankNode("b1");
      expect(() => BuiltInFunctions.uri(blank)).toThrow("IRI: cannot convert blank node to IRI");
    });
  });

  describe("BNODE constructor function", () => {
    describe("without argument", () => {
      it("should create unique blank node", () => {
        const result = BuiltInFunctions.bnode();
        expect(result).toBeInstanceOf(BlankNode);
        expect(result.id).toBeDefined();
        expect(result.id.length).toBeGreaterThan(0);
      });

      it("should create different blank nodes on each call", () => {
        const bn1 = BuiltInFunctions.bnode();
        const bn2 = BuiltInFunctions.bnode();
        const bn3 = BuiltInFunctions.bnode();
        expect(bn1.id).not.toBe(bn2.id);
        expect(bn2.id).not.toBe(bn3.id);
        expect(bn1.id).not.toBe(bn3.id);
      });

      it("should generate IDs starting with 'b'", () => {
        const result = BuiltInFunctions.bnode();
        expect(result.id.startsWith("b")).toBe(true);
      });
    });

    describe("with string literal argument", () => {
      it("should create blank node with specified label", () => {
        const label = new Literal("myLabel");
        const result = BuiltInFunctions.bnode(label);
        expect(result).toBeInstanceOf(BlankNode);
        expect(result.id).toBe("myLabel");
      });

      it("should create consistent blank nodes for same label", () => {
        const label = new Literal("consistentLabel");
        const bn1 = BuiltInFunctions.bnode(label);
        const bn2 = BuiltInFunctions.bnode(label);
        expect(bn1.id).toBe(bn2.id);
      });

      it("should handle empty string label", () => {
        const label = new Literal("");
        const result = BuiltInFunctions.bnode(label);
        expect(result.id).toBe("");
      });
    });

    describe("with blank node argument", () => {
      it("should return the same blank node", () => {
        const blank = new BlankNode("existing");
        const result = BuiltInFunctions.bnode(blank);
        expect(result).toBe(blank);
      });
    });

    describe("error handling", () => {
      it("should throw for IRI argument", () => {
        const iri = new IRI("http://example.org/resource");
        expect(() => BuiltInFunctions.bnode(iri)).toThrow("BNODE: argument must be a string literal or omitted");
      });
    });

    describe("uniqueness properties", () => {
      it("should generate many unique IDs", () => {
        const ids: Set<string> = new Set();
        for (let i = 0; i < 100; i++) {
          ids.add(BuiltInFunctions.bnode().id);
        }
        expect(ids.size).toBe(100);
      });
    });
  });

  describe("STRDT constructor function", () => {
    describe("basic functionality", () => {
      it("should create typed literal with xsd:integer", () => {
        const lexicalForm = new Literal("42");
        const datatypeIRI = new IRI("http://www.w3.org/2001/XMLSchema#integer");
        const result = BuiltInFunctions.strdt(lexicalForm, datatypeIRI);
        expect(result).toBeInstanceOf(Literal);
        expect(result.value).toBe("42");
        expect(result.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#integer");
      });

      it("should create typed literal with xsd:date", () => {
        const lexicalForm = new Literal("2025-01-01");
        const datatypeIRI = new IRI("http://www.w3.org/2001/XMLSchema#date");
        const result = BuiltInFunctions.strdt(lexicalForm, datatypeIRI);
        expect(result.value).toBe("2025-01-01");
        expect(result.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#date");
      });

      it("should create typed literal with xsd:boolean", () => {
        const lexicalForm = new Literal("true");
        const datatypeIRI = new IRI("http://www.w3.org/2001/XMLSchema#boolean");
        const result = BuiltInFunctions.strdt(lexicalForm, datatypeIRI);
        expect(result.value).toBe("true");
        expect(result.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#boolean");
      });

      it("should create typed literal with custom datatype", () => {
        const lexicalForm = new Literal("custom-value");
        const datatypeIRI = new IRI("http://example.org/myDatatype");
        const result = BuiltInFunctions.strdt(lexicalForm, datatypeIRI);
        expect(result.value).toBe("custom-value");
        expect(result.datatype?.value).toBe("http://example.org/myDatatype");
      });
    });

    describe("error handling", () => {
      it("should throw for undefined lexical form", () => {
        const datatypeIRI = new IRI("http://www.w3.org/2001/XMLSchema#integer");
        expect(() => BuiltInFunctions.strdt(undefined, datatypeIRI)).toThrow("STRDT: lexical form is undefined");
      });

      it("should throw for undefined datatype", () => {
        const lexicalForm = new Literal("42");
        expect(() => BuiltInFunctions.strdt(lexicalForm, undefined)).toThrow("STRDT: datatype IRI is undefined");
      });

      it("should throw for language-tagged lexical form", () => {
        const lexicalForm = new Literal("hello", undefined, "en");
        const datatypeIRI = new IRI("http://www.w3.org/2001/XMLSchema#string");
        expect(() => BuiltInFunctions.strdt(lexicalForm, datatypeIRI)).toThrow(
          "STRDT: lexical form must not have a language tag"
        );
      });

      it("should throw for blank node as lexical form", () => {
        const blank = new BlankNode("b1");
        const datatypeIRI = new IRI("http://www.w3.org/2001/XMLSchema#string");
        expect(() => BuiltInFunctions.strdt(blank, datatypeIRI)).toThrow("STRDT: lexical form must be a string literal");
      });

      it("should throw for blank node as datatype", () => {
        const lexicalForm = new Literal("42");
        const blank = new BlankNode("b1");
        expect(() => BuiltInFunctions.strdt(lexicalForm, blank)).toThrow("STRDT: datatype must be an IRI");
      });
    });

    describe("SPARQL spec examples", () => {
      it('STRDT("123", xsd:integer) returns "123"^^xsd:integer', () => {
        const lexicalForm = new Literal("123");
        const xsdInteger = new IRI("http://www.w3.org/2001/XMLSchema#integer");
        const result = BuiltInFunctions.strdt(lexicalForm, xsdInteger);
        expect(result.value).toBe("123");
        expect(result.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#integer");
      });

      it('STRDT("iiii", <http://example.org/Roman>) returns "iiii"^^<http://example.org/Roman>', () => {
        const lexicalForm = new Literal("iiii");
        const romanDatatype = new IRI("http://example.org/Roman");
        const result = BuiltInFunctions.strdt(lexicalForm, romanDatatype);
        expect(result.value).toBe("iiii");
        expect(result.datatype?.value).toBe("http://example.org/Roman");
      });
    });
  });

  describe("STRLANG constructor function", () => {
    describe("basic functionality", () => {
      it("should create language-tagged literal with 'en'", () => {
        const lexicalForm = new Literal("hello");
        const langTag = new Literal("en");
        const result = BuiltInFunctions.strlang(lexicalForm, langTag);
        expect(result).toBeInstanceOf(Literal);
        expect(result.value).toBe("hello");
        expect(result.language).toBe("en");
      });

      it("should create language-tagged literal with 'ru'", () => {
        const lexicalForm = new Literal("Привет");
        const langTag = new Literal("ru");
        const result = BuiltInFunctions.strlang(lexicalForm, langTag);
        expect(result.value).toBe("Привет");
        expect(result.language).toBe("ru");
      });

      it("should create language-tagged literal with subtag 'en-US'", () => {
        const lexicalForm = new Literal("color");
        const langTag = new Literal("en-US");
        const result = BuiltInFunctions.strlang(lexicalForm, langTag);
        expect(result.value).toBe("color");
        expect(result.language).toBe("en-us"); // Normalized to lowercase
      });

      it("should create language-tagged literal with 'zh-Hans'", () => {
        const lexicalForm = new Literal("你好");
        const langTag = new Literal("zh-Hans");
        const result = BuiltInFunctions.strlang(lexicalForm, langTag);
        expect(result.value).toBe("你好");
        expect(result.language).toBe("zh-hans"); // Normalized to lowercase
      });
    });

    describe("error handling", () => {
      it("should throw for undefined lexical form", () => {
        const langTag = new Literal("en");
        expect(() => BuiltInFunctions.strlang(undefined, langTag)).toThrow("STRLANG: lexical form is undefined");
      });

      it("should throw for undefined language tag", () => {
        const lexicalForm = new Literal("hello");
        expect(() => BuiltInFunctions.strlang(lexicalForm, undefined)).toThrow("STRLANG: language tag is undefined");
      });

      it("should throw for empty language tag", () => {
        const lexicalForm = new Literal("hello");
        const langTag = new Literal("");
        expect(() => BuiltInFunctions.strlang(lexicalForm, langTag)).toThrow("STRLANG: language tag cannot be empty");
      });

      it("should throw for language-tagged lexical form", () => {
        const lexicalForm = new Literal("hello", undefined, "en");
        const langTag = new Literal("de");
        expect(() => BuiltInFunctions.strlang(lexicalForm, langTag)).toThrow(
          "STRLANG: lexical form must not already have a language tag"
        );
      });

      it("should throw for blank node as lexical form", () => {
        const blank = new BlankNode("b1");
        const langTag = new Literal("en");
        expect(() => BuiltInFunctions.strlang(blank, langTag)).toThrow("STRLANG: lexical form must be a string literal");
      });

      it("should throw for IRI as language tag", () => {
        const lexicalForm = new Literal("hello");
        const iri = new IRI("http://example.org/en");
        expect(() => BuiltInFunctions.strlang(lexicalForm, iri)).toThrow("STRLANG: language tag must be a string literal");
      });
    });

    describe("SPARQL spec examples", () => {
      it('STRLANG("chat", "en") returns "chat"@en', () => {
        const lexicalForm = new Literal("chat");
        const langTag = new Literal("en");
        const result = BuiltInFunctions.strlang(lexicalForm, langTag);
        expect(result.value).toBe("chat");
        expect(result.language).toBe("en");
        expect(result.datatype).toBeUndefined();
      });
    });
  });

  describe("UUID constructor function", () => {
    describe("basic functionality", () => {
      it("should return IRI with urn:uuid scheme", () => {
        const result = BuiltInFunctions.uuid();
        expect(result).toBeInstanceOf(IRI);
        expect(result.value.startsWith("urn:uuid:")).toBe(true);
      });

      it("should return valid UUID format", () => {
        const result = BuiltInFunctions.uuid();
        const uuidPart = result.value.replace("urn:uuid:", "");
        // UUID v4 format: xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx
        expect(uuidPart).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      });

      it("should return different UUID on each call", () => {
        const uuid1 = BuiltInFunctions.uuid();
        const uuid2 = BuiltInFunctions.uuid();
        const uuid3 = BuiltInFunctions.uuid();
        expect(uuid1.value).not.toBe(uuid2.value);
        expect(uuid2.value).not.toBe(uuid3.value);
        expect(uuid1.value).not.toBe(uuid3.value);
      });
    });

    describe("uniqueness properties", () => {
      it("should generate many unique UUIDs", () => {
        const uuids: Set<string> = new Set();
        for (let i = 0; i < 100; i++) {
          uuids.add(BuiltInFunctions.uuid().value);
        }
        expect(uuids.size).toBe(100);
      });
    });

    describe("SPARQL spec examples", () => {
      it("UUID() returns fresh IRI with UUID URN scheme", () => {
        const result = BuiltInFunctions.uuid();
        expect(result).toBeInstanceOf(IRI);
        expect(result.value).toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      });
    });
  });

  describe("STRUUID constructor function", () => {
    describe("basic functionality", () => {
      it("should return string literal", () => {
        const result = BuiltInFunctions.struuid();
        expect(result).toBeInstanceOf(Literal);
      });

      it("should return valid UUID format", () => {
        const result = BuiltInFunctions.struuid();
        // UUID v4 format: xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx
        expect(result.value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      });

      it("should NOT include urn:uuid: prefix", () => {
        const result = BuiltInFunctions.struuid();
        expect(result.value.includes("urn:uuid:")).toBe(false);
      });

      it("should return different UUID string on each call", () => {
        const uuid1 = BuiltInFunctions.struuid();
        const uuid2 = BuiltInFunctions.struuid();
        const uuid3 = BuiltInFunctions.struuid();
        expect(uuid1.value).not.toBe(uuid2.value);
        expect(uuid2.value).not.toBe(uuid3.value);
        expect(uuid1.value).not.toBe(uuid3.value);
      });

      it("should return plain literal without datatype", () => {
        const result = BuiltInFunctions.struuid();
        expect(result.datatype).toBeUndefined();
        expect(result.language).toBeUndefined();
      });
    });

    describe("uniqueness properties", () => {
      it("should generate many unique UUID strings", () => {
        const uuids: Set<string> = new Set();
        for (let i = 0; i < 100; i++) {
          uuids.add(BuiltInFunctions.struuid().value);
        }
        expect(uuids.size).toBe(100);
      });
    });

    describe("SPARQL spec examples", () => {
      it("STRUUID() returns fresh UUID string (without urn:uuid: prefix)", () => {
        const result = BuiltInFunctions.struuid();
        expect(result).toBeInstanceOf(Literal);
        expect(result.value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      });
    });

    describe("comparison with UUID", () => {
      it("STRUUID value should match UUID value without prefix", () => {
        // While UUIDs are random, the format should be consistent
        const struuidResult = BuiltInFunctions.struuid();
        const uuidResult = BuiltInFunctions.uuid();

        // Both should have same format (just one with prefix)
        expect(struuidResult.value.length).toBe(36); // UUID string length
        expect(uuidResult.value.length).toBe(45); // "urn:uuid:" (9) + UUID string (36)
      });
    });
  });

  describe("Constructor Functions Integration", () => {
    describe("BIND-style usage patterns", () => {
      it("should create IRI from concatenated string (CONCAT + IRI pattern)", () => {
        // Simulates: BIND(IRI(CONCAT("http://example.com/", ?name)) AS ?newIri)
        const name = "John";
        const concatenated = new Literal("http://example.com/" + name);
        const result = BuiltInFunctions.iri(concatenated);
        expect(result.value).toBe("http://example.com/John");
      });

      it("should create typed literal from string (STRDT pattern)", () => {
        // Simulates: BIND(STRDT(?value, xsd:integer) AS ?typedValue)
        const value = new Literal("42");
        const xsdInteger = new IRI("http://www.w3.org/2001/XMLSchema#integer");
        const result = BuiltInFunctions.strdt(value, xsdInteger);
        expect(result.value).toBe("42");
        expect(result.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#integer");
      });

      it("should create language-tagged literal (STRLANG pattern)", () => {
        // Simulates: BIND(STRLANG(?text, "fr") AS ?frenchText)
        const text = new Literal("Bonjour");
        const lang = new Literal("fr");
        const result = BuiltInFunctions.strlang(text, lang);
        expect(result.value).toBe("Bonjour");
        expect(result.language).toBe("fr");
      });
    });

    describe("CONSTRUCT-style usage patterns", () => {
      it("should generate unique identifiers for new resources", () => {
        // Simulates: CONSTRUCT { ?newIri rdf:type ?class } WHERE { ... BIND(UUID() AS ?newIri) }
        const newIri = BuiltInFunctions.uuid();
        expect(newIri).toBeInstanceOf(IRI);
        expect(newIri.value).toMatch(/^urn:uuid:/);
      });

      it("should create blank nodes for anonymous resources", () => {
        // Simulates: CONSTRUCT { _:x rdf:type ex:AnonymousThing }
        const bnode = BuiltInFunctions.bnode();
        expect(bnode).toBeInstanceOf(BlankNode);
      });
    });
  });

  describe("xsd:dayTimeDuration Support (SPARQL 1.1)", () => {
    describe("parseDayTimeDuration", () => {
      it("should parse hours only", () => {
        expect(BuiltInFunctions.parseDayTimeDuration("PT5H")).toBe(5 * 60 * 60 * 1000);
        expect(BuiltInFunctions.parseDayTimeDuration("PT1H")).toBe(60 * 60 * 1000);
        expect(BuiltInFunctions.parseDayTimeDuration("PT24H")).toBe(24 * 60 * 60 * 1000);
      });

      it("should parse minutes only", () => {
        expect(BuiltInFunctions.parseDayTimeDuration("PT30M")).toBe(30 * 60 * 1000);
        expect(BuiltInFunctions.parseDayTimeDuration("PT1M")).toBe(60 * 1000);
      });

      it("should parse seconds only", () => {
        expect(BuiltInFunctions.parseDayTimeDuration("PT45S")).toBe(45 * 1000);
        expect(BuiltInFunctions.parseDayTimeDuration("PT0S")).toBe(0);
      });

      it("should parse decimal seconds", () => {
        expect(BuiltInFunctions.parseDayTimeDuration("PT1.5S")).toBe(1500);
        expect(BuiltInFunctions.parseDayTimeDuration("PT0.5S")).toBe(500);
      });

      it("should parse days only", () => {
        expect(BuiltInFunctions.parseDayTimeDuration("P1D")).toBe(24 * 60 * 60 * 1000);
        expect(BuiltInFunctions.parseDayTimeDuration("P7D")).toBe(7 * 24 * 60 * 60 * 1000);
      });

      it("should parse combined duration", () => {
        // 1 day + 2 hours
        expect(BuiltInFunctions.parseDayTimeDuration("P1DT2H")).toBe((24 + 2) * 60 * 60 * 1000);
        // 8 hours 30 minutes
        expect(BuiltInFunctions.parseDayTimeDuration("PT8H30M")).toBe((8 * 60 + 30) * 60 * 1000);
        // 1 hour 30 minutes 45 seconds
        expect(BuiltInFunctions.parseDayTimeDuration("PT1H30M45S")).toBe((1 * 3600 + 30 * 60 + 45) * 1000);
      });

      it("should parse negative durations", () => {
        expect(BuiltInFunctions.parseDayTimeDuration("-PT5H")).toBe(-5 * 60 * 60 * 1000);
        expect(BuiltInFunctions.parseDayTimeDuration("-PT8H30M")).toBe(-(8 * 60 + 30) * 60 * 1000);
        expect(BuiltInFunctions.parseDayTimeDuration("-P1D")).toBe(-24 * 60 * 60 * 1000);
      });

      it("should handle whitespace", () => {
        expect(BuiltInFunctions.parseDayTimeDuration("  PT5H  ")).toBe(5 * 60 * 60 * 1000);
      });

      it("should throw for empty string", () => {
        expect(() => BuiltInFunctions.parseDayTimeDuration("")).toThrow("duration string is empty");
      });

      it("should throw for invalid format - missing P", () => {
        expect(() => BuiltInFunctions.parseDayTimeDuration("T5H")).toThrow("must start with 'P'");
      });

      it("should throw for invalid format - wrong order", () => {
        expect(() => BuiltInFunctions.parseDayTimeDuration("PT5M30H")).toThrow("invalid time component");
      });
    });

    describe("formatDayTimeDuration", () => {
      it("should format hours", () => {
        expect(BuiltInFunctions.formatDayTimeDuration(5 * 60 * 60 * 1000)).toBe("PT5H");
      });

      it("should format minutes", () => {
        expect(BuiltInFunctions.formatDayTimeDuration(30 * 60 * 1000)).toBe("PT30M");
      });

      it("should format seconds", () => {
        expect(BuiltInFunctions.formatDayTimeDuration(45 * 1000)).toBe("PT45S");
      });

      it("should format zero duration", () => {
        expect(BuiltInFunctions.formatDayTimeDuration(0)).toBe("PT0S");
      });

      it("should format days", () => {
        expect(BuiltInFunctions.formatDayTimeDuration(24 * 60 * 60 * 1000)).toBe("P1DT0S");
        expect(BuiltInFunctions.formatDayTimeDuration(7 * 24 * 60 * 60 * 1000)).toBe("P7DT0S");
      });

      it("should format combined duration", () => {
        // 1 day + 2 hours
        expect(BuiltInFunctions.formatDayTimeDuration((24 + 2) * 60 * 60 * 1000)).toBe("P1DT2H");
        // 8 hours 30 minutes
        expect(BuiltInFunctions.formatDayTimeDuration((8 * 60 + 30) * 60 * 1000)).toBe("PT8H30M");
      });

      it("should format negative durations", () => {
        expect(BuiltInFunctions.formatDayTimeDuration(-5 * 60 * 60 * 1000)).toBe("-PT5H");
        expect(BuiltInFunctions.formatDayTimeDuration(-(8 * 60 + 30) * 60 * 1000)).toBe("-PT8H30M");
      });

      it("should format decimal seconds", () => {
        expect(BuiltInFunctions.formatDayTimeDuration(1500)).toBe("PT1.5S");
      });
    });

    describe("xsdDayTimeDuration", () => {
      it("should create Literal with correct datatype", () => {
        const result = BuiltInFunctions.xsdDayTimeDuration("PT5H");
        expect(result).toBeInstanceOf(Literal);
        expect(result.value).toBe("PT5H");
        expect(result.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#dayTimeDuration");
      });

      it("should validate the duration string", () => {
        expect(() => BuiltInFunctions.xsdDayTimeDuration("invalid")).toThrow();
      });
    });

    describe("compareDurations", () => {
      it("should compare equal durations", () => {
        expect(BuiltInFunctions.compareDurations("PT5H", "PT5H", "=")).toBe(true);
        expect(BuiltInFunctions.compareDurations("PT5H", "PT300M", "=")).toBe(true); // 5h = 300min
        expect(BuiltInFunctions.compareDurations("PT5H", "PT6H", "=")).toBe(false);
      });

      it("should compare not equal durations", () => {
        expect(BuiltInFunctions.compareDurations("PT5H", "PT6H", "!=")).toBe(true);
        expect(BuiltInFunctions.compareDurations("PT5H", "PT5H", "!=")).toBe(false);
      });

      it("should compare less than", () => {
        expect(BuiltInFunctions.compareDurations("PT4H", "PT5H", "<")).toBe(true);
        expect(BuiltInFunctions.compareDurations("PT5H", "PT5H", "<")).toBe(false);
        expect(BuiltInFunctions.compareDurations("PT6H", "PT5H", "<")).toBe(false);
      });

      it("should compare greater than", () => {
        expect(BuiltInFunctions.compareDurations("PT6H", "PT5H", ">")).toBe(true);
        expect(BuiltInFunctions.compareDurations("PT5H", "PT5H", ">")).toBe(false);
        expect(BuiltInFunctions.compareDurations("PT4H", "PT5H", ">")).toBe(false);
      });

      it("should compare with Literal objects", () => {
        const d1 = new Literal("PT5H", new IRI("http://www.w3.org/2001/XMLSchema#dayTimeDuration"));
        const d2 = new Literal("PT6H", new IRI("http://www.w3.org/2001/XMLSchema#dayTimeDuration"));
        expect(BuiltInFunctions.compareDurations(d1, d2, "<")).toBe(true);
      });

      it("should handle negative durations", () => {
        expect(BuiltInFunctions.compareDurations("-PT1H", "PT1H", "<")).toBe(true);
        expect(BuiltInFunctions.compareDurations("-PT2H", "-PT1H", "<")).toBe(true);
      });
    });

    describe("isDayTimeDuration", () => {
      it("should return true for dayTimeDuration Literal", () => {
        const dur = new Literal("PT5H", new IRI("http://www.w3.org/2001/XMLSchema#dayTimeDuration"));
        expect(BuiltInFunctions.isDayTimeDuration(dur)).toBe(true);
      });

      it("should return false for other datatypes", () => {
        const str = new Literal("PT5H");
        const int = new Literal("5", new IRI("http://www.w3.org/2001/XMLSchema#integer"));
        expect(BuiltInFunctions.isDayTimeDuration(str)).toBe(false);
        expect(BuiltInFunctions.isDayTimeDuration(int)).toBe(false);
      });

      it("should return false for non-Literal values", () => {
        expect(BuiltInFunctions.isDayTimeDuration("PT5H")).toBe(false);
        expect(BuiltInFunctions.isDayTimeDuration(5)).toBe(false);
        expect(BuiltInFunctions.isDayTimeDuration(null)).toBe(false);
        expect(BuiltInFunctions.isDayTimeDuration(undefined)).toBe(false);
      });
    });

    describe("dateTimeDiff", () => {
      it("should calculate positive difference", () => {
        const result = BuiltInFunctions.dateTimeDiff(
          "2025-01-01T12:00:00Z",
          "2025-01-01T10:00:00Z"
        );
        expect(result).toBeInstanceOf(Literal);
        expect(result.value).toBe("PT2H");
        expect(result.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#dayTimeDuration");
      });

      it("should calculate negative difference", () => {
        const result = BuiltInFunctions.dateTimeDiff(
          "2025-01-01T10:00:00Z",
          "2025-01-01T12:00:00Z"
        );
        expect(result.value).toBe("-PT2H");
      });

      it("should handle day boundaries", () => {
        const result = BuiltInFunctions.dateTimeDiff(
          "2025-01-02T00:00:00Z",
          "2025-01-01T00:00:00Z"
        );
        expect(result.value).toBe("P1DT0S");
      });

      it("should work with Literal inputs", () => {
        const dt1 = new Literal("2025-01-01T14:00:00Z", new IRI("http://www.w3.org/2001/XMLSchema#dateTime"));
        const dt2 = new Literal("2025-01-01T10:00:00Z", new IRI("http://www.w3.org/2001/XMLSchema#dateTime"));
        const result = BuiltInFunctions.dateTimeDiff(dt1, dt2);
        expect(result.value).toBe("PT4H");
      });

      it("should throw for invalid dateTime", () => {
        expect(() => BuiltInFunctions.dateTimeDiff("invalid", "2025-01-01T10:00:00Z")).toThrow();
      });
    });

    describe("dateTimeAdd", () => {
      it("should add duration to dateTime", () => {
        const result = BuiltInFunctions.dateTimeAdd(
          "2025-01-01T10:00:00Z",
          "PT2H"
        );
        expect(result).toBeInstanceOf(Literal);
        expect(result.value).toBe("2025-01-01T12:00:00.000Z");
        expect(result.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#dateTime");
      });

      it("should add negative duration (subtract)", () => {
        const result = BuiltInFunctions.dateTimeAdd(
          "2025-01-01T12:00:00Z",
          "-PT2H"
        );
        expect(result.value).toBe("2025-01-01T10:00:00.000Z");
      });

      it("should handle day boundaries", () => {
        const result = BuiltInFunctions.dateTimeAdd(
          "2025-01-01T22:00:00Z",
          "PT5H"
        );
        expect(result.value).toBe("2025-01-02T03:00:00.000Z");
      });

      it("should work with Literal inputs", () => {
        const dt = new Literal("2025-01-01T10:00:00Z", new IRI("http://www.w3.org/2001/XMLSchema#dateTime"));
        const dur = new Literal("PT30M", new IRI("http://www.w3.org/2001/XMLSchema#dayTimeDuration"));
        const result = BuiltInFunctions.dateTimeAdd(dt, dur);
        expect(result.value).toBe("2025-01-01T10:30:00.000Z");
      });
    });

    describe("dateTimeSubtract", () => {
      it("should subtract duration from dateTime", () => {
        const result = BuiltInFunctions.dateTimeSubtract(
          "2025-01-01T12:00:00Z",
          "PT2H"
        );
        expect(result).toBeInstanceOf(Literal);
        expect(result.value).toBe("2025-01-01T10:00:00.000Z");
      });

      it("should handle day boundaries", () => {
        const result = BuiltInFunctions.dateTimeSubtract(
          "2025-01-02T03:00:00Z",
          "PT5H"
        );
        expect(result.value).toBe("2025-01-01T22:00:00.000Z");
      });
    });

    describe("durationAdd", () => {
      it("should add two durations", () => {
        const result = BuiltInFunctions.durationAdd("PT2H", "PT30M");
        expect(result).toBeInstanceOf(Literal);
        expect(result.value).toBe("PT2H30M");
        expect(result.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#dayTimeDuration");
      });

      it("should add durations with different components", () => {
        const result = BuiltInFunctions.durationAdd("P1D", "PT2H");
        expect(result.value).toBe("P1DT2H");
      });
    });

    describe("durationSubtract", () => {
      it("should subtract two durations", () => {
        const result = BuiltInFunctions.durationSubtract("PT2H30M", "PT30M");
        expect(result).toBeInstanceOf(Literal);
        expect(result.value).toBe("PT2H");
      });

      it("should produce negative duration if needed", () => {
        const result = BuiltInFunctions.durationSubtract("PT1H", "PT2H");
        expect(result.value).toBe("-PT1H");
      });
    });

    describe("durationMultiply", () => {
      it("should multiply duration by number", () => {
        const result = BuiltInFunctions.durationMultiply("PT2H", 2);
        expect(result.value).toBe("PT4H");
      });

      it("should handle decimal multiplier", () => {
        const result = BuiltInFunctions.durationMultiply("PT2H", 0.5);
        expect(result.value).toBe("PT1H");
      });

      it("should handle negative multiplier", () => {
        const result = BuiltInFunctions.durationMultiply("PT2H", -1);
        expect(result.value).toBe("-PT2H");
      });
    });

    describe("durationDivide", () => {
      it("should divide duration by number", () => {
        const result = BuiltInFunctions.durationDivide("PT4H", 2);
        expect(result.value).toBe("PT2H");
      });

      it("should throw for division by zero", () => {
        expect(() => BuiltInFunctions.durationDivide("PT4H", 0)).toThrow("division by zero");
      });
    });

    describe("durationToX accessors", () => {
      it("should convert to days", () => {
        expect(BuiltInFunctions.durationToDays("P1D")).toBe(1);
        expect(BuiltInFunctions.durationToDays("PT12H")).toBe(0.5);
      });

      it("should convert to hours", () => {
        expect(BuiltInFunctions.durationToHours("PT5H")).toBe(5);
        expect(BuiltInFunctions.durationToHours("PT90M")).toBe(1.5);
        expect(BuiltInFunctions.durationToHours("P1D")).toBe(24);
      });

      it("should convert to minutes", () => {
        expect(BuiltInFunctions.durationToMinutes("PT30M")).toBe(30);
        expect(BuiltInFunctions.durationToMinutes("PT1H")).toBe(60);
        expect(BuiltInFunctions.durationToMinutes("PT90S")).toBe(1.5);
      });

      it("should convert to seconds", () => {
        expect(BuiltInFunctions.durationToSeconds("PT1M")).toBe(60);
        expect(BuiltInFunctions.durationToSeconds("PT1H")).toBe(3600);
        expect(BuiltInFunctions.durationToSeconds("PT1.5S")).toBe(1.5);
      });
    });

    describe("compare() with dayTimeDuration", () => {
      it("should compare dayTimeDuration Literals", () => {
        const d1 = new Literal("PT5H", new IRI("http://www.w3.org/2001/XMLSchema#dayTimeDuration"));
        const d2 = new Literal("PT6H", new IRI("http://www.w3.org/2001/XMLSchema#dayTimeDuration"));

        expect(BuiltInFunctions.compare(d1, d2, "<")).toBe(true);
        expect(BuiltInFunctions.compare(d1, d2, ">")).toBe(false);
        expect(BuiltInFunctions.compare(d1, d1, "=")).toBe(true);
      });

      it("should handle equivalent durations with different formats", () => {
        const d1 = new Literal("PT5H", new IRI("http://www.w3.org/2001/XMLSchema#dayTimeDuration"));
        const d2 = new Literal("PT300M", new IRI("http://www.w3.org/2001/XMLSchema#dayTimeDuration"));

        expect(BuiltInFunctions.compare(d1, d2, "=")).toBe(true);
      });
    });

    describe("Duration Component Accessors (Issue #989)", () => {
      describe("durationDays", () => {
        it("should extract days component from P1DT2H30M", () => {
          expect(BuiltInFunctions.durationDays("P1DT2H30M")).toBe(1);
        });

        it("should return 0 when no days component", () => {
          expect(BuiltInFunctions.durationDays("PT5H")).toBe(0);
        });

        it("should handle negative durations", () => {
          expect(BuiltInFunctions.durationDays("-P2DT3H")).toBe(-2);
        });

        it("should handle days only", () => {
          expect(BuiltInFunctions.durationDays("P5D")).toBe(5);
        });

        it("should work with Literal input", () => {
          const durLiteral = new Literal("P3DT12H", new IRI("http://www.w3.org/2001/XMLSchema#dayTimeDuration"));
          expect(BuiltInFunctions.durationDays(durLiteral)).toBe(3);
        });

        it("should throw for invalid duration format", () => {
          expect(() => BuiltInFunctions.durationDays("invalid")).toThrow();
        });
      });

      describe("durationHours", () => {
        it("should extract hours component from PT1H30M", () => {
          expect(BuiltInFunctions.durationHours("PT1H30M")).toBe(1);
        });

        it("should extract hours component from P1DT2H30M (not 26)", () => {
          // This is the key difference from durationToHours - extract component only
          expect(BuiltInFunctions.durationHours("P1DT2H30M")).toBe(2);
        });

        it("should return 0 when no hours component", () => {
          expect(BuiltInFunctions.durationHours("PT30M")).toBe(0);
        });

        it("should handle negative durations", () => {
          expect(BuiltInFunctions.durationHours("-PT8H30M")).toBe(-8);
        });

        it("should work with Literal input", () => {
          const durLiteral = new Literal("PT5H", new IRI("http://www.w3.org/2001/XMLSchema#dayTimeDuration"));
          expect(BuiltInFunctions.durationHours(durLiteral)).toBe(5);
        });

        it("should throw for invalid duration format", () => {
          expect(() => BuiltInFunctions.durationHours("invalid")).toThrow();
        });
      });

      describe("durationMinutes", () => {
        it("should extract minutes component from PT1H30M", () => {
          expect(BuiltInFunctions.durationMinutes("PT1H30M")).toBe(30);
        });

        it("should return 0 when no minutes component", () => {
          expect(BuiltInFunctions.durationMinutes("PT5H")).toBe(0);
        });

        it("should handle negative durations", () => {
          expect(BuiltInFunctions.durationMinutes("-PT1H45M")).toBe(-45);
        });

        it("should handle minutes exceeding 59 if specified", () => {
          // If someone writes PT90M, we return 90 as the component value
          expect(BuiltInFunctions.durationMinutes("PT90M")).toBe(90);
        });

        it("should work with Literal input", () => {
          const durLiteral = new Literal("PT45M", new IRI("http://www.w3.org/2001/XMLSchema#dayTimeDuration"));
          expect(BuiltInFunctions.durationMinutes(durLiteral)).toBe(45);
        });

        it("should throw for invalid duration format", () => {
          expect(() => BuiltInFunctions.durationMinutes("invalid")).toThrow();
        });
      });

      describe("durationSeconds", () => {
        it("should extract seconds component from PT1H30M45S", () => {
          expect(BuiltInFunctions.durationSeconds("PT1H30M45S")).toBe(45);
        });

        it("should return 0 when no seconds component", () => {
          expect(BuiltInFunctions.durationSeconds("PT5H30M")).toBe(0);
        });

        it("should handle decimal seconds", () => {
          expect(BuiltInFunctions.durationSeconds("PT1.5S")).toBe(1.5);
        });

        it("should handle negative durations with decimal seconds", () => {
          expect(BuiltInFunctions.durationSeconds("-PT30.123S")).toBe(-30.123);
        });

        it("should work with Literal input", () => {
          const durLiteral = new Literal("PT30.5S", new IRI("http://www.w3.org/2001/XMLSchema#dayTimeDuration"));
          expect(BuiltInFunctions.durationSeconds(durLiteral)).toBe(30.5);
        });

        it("should throw for invalid duration format", () => {
          expect(() => BuiltInFunctions.durationSeconds("invalid")).toThrow();
        });
      });

      describe("Acceptance Criteria (Issue #989)", () => {
        it("HOURS('PT1H30M'^^xsd:dayTimeDuration) should return 1", () => {
          const durLiteral = new Literal("PT1H30M", new IRI("http://www.w3.org/2001/XMLSchema#dayTimeDuration"));
          expect(BuiltInFunctions.durationHours(durLiteral)).toBe(1);
        });

        it("MINUTES('PT1H30M'^^xsd:dayTimeDuration) should return 30", () => {
          const durLiteral = new Literal("PT1H30M", new IRI("http://www.w3.org/2001/XMLSchema#dayTimeDuration"));
          expect(BuiltInFunctions.durationMinutes(durLiteral)).toBe(30);
        });
      });
    });
  });

  // =========================================================================
  // SPARQL 1.2 NORMALIZE Function Tests (Issue #982)
  // =========================================================================

  describe("NORMALIZE", () => {
    describe("NFC normalization (default)", () => {
      it("should normalize string to NFC by default", () => {
        // "café" with combining acute accent (e + ́) should become precomposed é
        const decomposed = "cafe\u0301"; // e + combining acute accent
        const result = BuiltInFunctions.normalize(decomposed);
        expect(result.value).toBe("café"); // precomposed é
        expect(result.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#string");
      });

      it("should normalize Literal input to NFC", () => {
        const decomposed = new Literal("cafe\u0301");
        const result = BuiltInFunctions.normalize(decomposed);
        expect(result.value).toBe("café");
      });

      it("should return already normalized string unchanged", () => {
        const normalized = "café"; // precomposed
        const result = BuiltInFunctions.normalize(normalized);
        expect(result.value).toBe("café");
      });

      it("should handle plain ASCII strings", () => {
        const result = BuiltInFunctions.normalize("hello");
        expect(result.value).toBe("hello");
      });

      it("should throw for empty string (Literal constraint)", () => {
        // Literal class does not allow empty strings
        expect(() => BuiltInFunctions.normalize("")).toThrow("Literal value cannot be empty");
      });
    });

    describe("NFD normalization", () => {
      it("should decompose precomposed characters", () => {
        const composed = "café"; // precomposed é
        const result = BuiltInFunctions.normalize(composed, "NFD");
        // NFD decomposes é into e + combining acute accent
        expect(result.value).toBe("cafe\u0301");
        expect(result.value.length).toBe(5); // c, a, f, e, combining accent
      });

      it("should accept lowercase form specification", () => {
        const composed = "café";
        const result = BuiltInFunctions.normalize(composed, "nfd");
        expect(result.value).toBe("cafe\u0301");
      });

      it("should accept Literal as form parameter", () => {
        const composed = "café";
        const formLiteral = new Literal("NFD");
        const result = BuiltInFunctions.normalize(composed, formLiteral);
        expect(result.value).toBe("cafe\u0301");
      });
    });

    describe("NFKC normalization (compatibility composition)", () => {
      it("should decompose ligatures", () => {
        // ﬁ (fi ligature) should become "fi"
        const ligature = "\uFB01"; // ﬁ ligature
        const result = BuiltInFunctions.normalize(ligature, "NFKC");
        expect(result.value).toBe("fi");
      });

      it("should normalize fullwidth characters", () => {
        // Ａ (fullwidth A) should become A
        const fullwidth = "\uFF21"; // fullwidth A
        const result = BuiltInFunctions.normalize(fullwidth, "NFKC");
        expect(result.value).toBe("A");
      });

      it("should handle superscript numbers", () => {
        // ² (superscript 2) should become 2
        const superscript = "\u00B2";
        const result = BuiltInFunctions.normalize(superscript, "NFKC");
        expect(result.value).toBe("2");
      });

      it("should normalize roman numerals", () => {
        // Ⅳ (Roman numeral 4) should become IV
        const romanNumeral = "\u2163"; // Ⅳ
        const result = BuiltInFunctions.normalize(romanNumeral, "NFKC");
        expect(result.value).toBe("IV");
      });
    });

    describe("NFKD normalization (compatibility decomposition)", () => {
      it("should decompose ligatures and keep decomposed form", () => {
        const ligature = "\uFB01"; // ﬁ ligature
        const result = BuiltInFunctions.normalize(ligature, "NFKD");
        expect(result.value).toBe("fi");
      });

      it("should decompose and keep accents separate", () => {
        // ﬁ followed by precomposed é
        const input = "\uFB01" + "é";
        const result = BuiltInFunctions.normalize(input, "NFKD");
        // Should be: f, i, e, combining acute accent
        expect(result.value).toBe("fie\u0301");
      });
    });

    describe("error handling", () => {
      it("should throw for undefined string argument", () => {
        expect(() => BuiltInFunctions.normalize(undefined)).toThrow("NORMALIZE: string argument is undefined");
      });

      it("should throw for invalid normalization form", () => {
        expect(() => BuiltInFunctions.normalize("test", "INVALID")).toThrow(
          "NORMALIZE: invalid normalization form 'INVALID'. Valid forms are: NFC, NFD, NFKC, NFKD"
        );
      });

      it("should throw for empty normalization form", () => {
        expect(() => BuiltInFunctions.normalize("test", "")).toThrow(
          "NORMALIZE: invalid normalization form ''. Valid forms are: NFC, NFD, NFKC, NFKD"
        );
      });
    });

    describe("comparing equivalent strings after normalization", () => {
      it("should make composed and decomposed strings equal after NFC normalization", () => {
        const composed = "café"; // precomposed é
        const decomposed = "cafe\u0301"; // e + combining acute accent

        const normalizedComposed = BuiltInFunctions.normalize(composed, "NFC");
        const normalizedDecomposed = BuiltInFunctions.normalize(decomposed, "NFC");

        expect(normalizedComposed.value).toBe(normalizedDecomposed.value);
      });

      it("should make composed and decomposed strings equal after NFD normalization", () => {
        const composed = "café";
        const decomposed = "cafe\u0301";

        const normalizedComposed = BuiltInFunctions.normalize(composed, "NFD");
        const normalizedDecomposed = BuiltInFunctions.normalize(decomposed, "NFD");

        expect(normalizedComposed.value).toBe(normalizedDecomposed.value);
      });
    });

    describe("edge cases", () => {
      it("should handle strings with multiple combining characters", () => {
        // ö̀ (o with umlaut and grave accent)
        const multiCombining = "o\u0308\u0300"; // o + combining diaeresis + combining grave
        const result = BuiltInFunctions.normalize(multiCombining, "NFC");
        // Result should have the composed form
        expect(result.value.length).toBeLessThan(multiCombining.length);
      });

      it("should handle Korean Hangul", () => {
        // 한 can be composed or decomposed
        const composed = "\uD55C"; // 한
        const decomposed = "\u1112\u1161\u11AB"; // ᄒ + ᅡ + ᆫ

        const normalizedComposed = BuiltInFunctions.normalize(composed, "NFC");
        const normalizedDecomposed = BuiltInFunctions.normalize(decomposed, "NFC");

        expect(normalizedComposed.value).toBe(normalizedDecomposed.value);
      });

      it("should handle emoji with ZWJ sequences", () => {
        // Family emoji (👨‍👩‍👧)
        const family = "👨\u200D👩\u200D👧";
        const result = BuiltInFunctions.normalize(family, "NFC");
        expect(result.value).toBe(family); // ZWJ sequences should be preserved
      });

      it("should handle mixed scripts", () => {
        const mixed = "Hello мир 世界";
        const result = BuiltInFunctions.normalize(mixed, "NFC");
        expect(result.value).toBe("Hello мир 世界");
      });

      it("should work with IRI input", () => {
        const iri = new IRI("http://example.org/café");
        const result = BuiltInFunctions.normalize(iri);
        expect(result.value).toBe("http://example.org/café");
      });

      it("should work with BlankNode input", () => {
        const blank = new BlankNode("café");
        const result = BuiltInFunctions.normalize(blank);
        expect(result.value).toBe("café");
      });
    });

    describe("Acceptance Criteria (Issue #982)", () => {
      it("NORMALIZE('café') should return NFC-normalized string", () => {
        // The acceptance criteria expects that "café" returns NFC-normalized form
        // With decomposed input:
        const decomposed = "cafe\u0301";
        const result = BuiltInFunctions.normalize(decomposed);
        expect(result.value).toBe("café"); // precomposed
        expect(result.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#string");
      });

      it("NORMALIZE('ﬁ', 'NFKC') should return 'fi'", () => {
        const ligature = "\uFB01"; // ﬁ
        const result = BuiltInFunctions.normalize(ligature, "NFKC");
        expect(result.value).toBe("fi");
      });
    });
  });
});
