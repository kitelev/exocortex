import {
  PropertyFieldType,
  rangeToFieldType,
} from "exocortex";

describe("PropertyFieldType", () => {
  describe("enum values", () => {
    it("should have correct string values", () => {
      expect(PropertyFieldType.Text).toBe("text");
      expect(PropertyFieldType.Number).toBe("number");
      expect(PropertyFieldType.Date).toBe("date");
      expect(PropertyFieldType.DateTime).toBe("datetime");
      expect(PropertyFieldType.Boolean).toBe("boolean");
      expect(PropertyFieldType.Reference).toBe("reference");
      expect(PropertyFieldType.Enum).toBe("enum");
      expect(PropertyFieldType.StatusSelect).toBe("status-select");
      expect(PropertyFieldType.SizeSelect).toBe("size-select");
      expect(PropertyFieldType.Wikilink).toBe("wikilink");
      expect(PropertyFieldType.Timestamp).toBe("timestamp");
      expect(PropertyFieldType.Unknown).toBe("unknown");
    });
  });
});

describe("rangeToFieldType", () => {
  describe("when rangeType is undefined or empty", () => {
    it("should return Unknown for undefined", () => {
      expect(rangeToFieldType(undefined)).toBe(PropertyFieldType.Unknown);
    });

    it("should return Unknown for empty string", () => {
      expect(rangeToFieldType("")).toBe(PropertyFieldType.Unknown);
    });

    it("should return Unknown for whitespace-only string", () => {
      expect(rangeToFieldType("   ")).toBe(PropertyFieldType.Unknown);
    });
  });

  describe("XSD string types", () => {
    it("should return Text for xsd:string (full IRI)", () => {
      expect(
        rangeToFieldType("http://www.w3.org/2001/XMLSchema#string"),
      ).toBe(PropertyFieldType.Text);
    });

    it("should return Text for xsd:string (prefixed)", () => {
      expect(rangeToFieldType("xsd:string")).toBe(PropertyFieldType.Text);
    });

    it("should return Text for xsd:normalizedString", () => {
      expect(rangeToFieldType("xsd:normalizedString")).toBe(
        PropertyFieldType.Text,
      );
    });

    it("should return Text for xsd:token", () => {
      expect(rangeToFieldType("xsd:token")).toBe(PropertyFieldType.Text);
    });

    it("should return Text for xsd:anyURI", () => {
      expect(rangeToFieldType("xsd:anyURI")).toBe(PropertyFieldType.Text);
    });
  });

  describe("XSD numeric types", () => {
    it("should return Number for xsd:integer (full IRI)", () => {
      expect(
        rangeToFieldType("http://www.w3.org/2001/XMLSchema#integer"),
      ).toBe(PropertyFieldType.Number);
    });

    it("should return Number for xsd:integer (prefixed)", () => {
      expect(rangeToFieldType("xsd:integer")).toBe(PropertyFieldType.Number);
    });

    it("should return Number for xsd:int", () => {
      expect(rangeToFieldType("xsd:int")).toBe(PropertyFieldType.Number);
    });

    it("should return Number for xsd:long", () => {
      expect(rangeToFieldType("xsd:long")).toBe(PropertyFieldType.Number);
    });

    it("should return Number for xsd:short", () => {
      expect(rangeToFieldType("xsd:short")).toBe(PropertyFieldType.Number);
    });

    it("should return Number for xsd:byte", () => {
      expect(rangeToFieldType("xsd:byte")).toBe(PropertyFieldType.Number);
    });

    it("should return Number for xsd:decimal", () => {
      expect(rangeToFieldType("xsd:decimal")).toBe(PropertyFieldType.Number);
    });

    it("should return Number for xsd:float", () => {
      expect(rangeToFieldType("xsd:float")).toBe(PropertyFieldType.Number);
    });

    it("should return Number for xsd:double", () => {
      expect(rangeToFieldType("xsd:double")).toBe(PropertyFieldType.Number);
    });

    it("should return Number for xsd:nonNegativeInteger", () => {
      expect(rangeToFieldType("xsd:nonNegativeInteger")).toBe(
        PropertyFieldType.Number,
      );
    });

    it("should return Number for xsd:positiveInteger", () => {
      expect(rangeToFieldType("xsd:positiveInteger")).toBe(
        PropertyFieldType.Number,
      );
    });

    it("should return Number for xsd:unsignedInt", () => {
      expect(rangeToFieldType("xsd:unsignedInt")).toBe(
        PropertyFieldType.Number,
      );
    });
  });

  describe("XSD date and time types", () => {
    it("should return Date for xsd:date (full IRI)", () => {
      expect(rangeToFieldType("http://www.w3.org/2001/XMLSchema#date")).toBe(
        PropertyFieldType.Date,
      );
    });

    it("should return Date for xsd:date (prefixed)", () => {
      expect(rangeToFieldType("xsd:date")).toBe(PropertyFieldType.Date);
    });

    it("should return DateTime for xsd:dateTime (full IRI)", () => {
      expect(
        rangeToFieldType("http://www.w3.org/2001/XMLSchema#dateTime"),
      ).toBe(PropertyFieldType.DateTime);
    });

    it("should return DateTime for xsd:dateTime (prefixed)", () => {
      expect(rangeToFieldType("xsd:dateTime")).toBe(PropertyFieldType.DateTime);
    });

    it("should return DateTime for xsd:dateTimeStamp", () => {
      expect(rangeToFieldType("xsd:dateTimeStamp")).toBe(
        PropertyFieldType.DateTime,
      );
    });

    it("should return Timestamp for xsd:time", () => {
      expect(rangeToFieldType("xsd:time")).toBe(PropertyFieldType.Timestamp);
    });
  });

  describe("XSD boolean type", () => {
    it("should return Boolean for xsd:boolean (full IRI)", () => {
      expect(
        rangeToFieldType("http://www.w3.org/2001/XMLSchema#boolean"),
      ).toBe(PropertyFieldType.Boolean);
    });

    it("should return Boolean for xsd:boolean (prefixed)", () => {
      expect(rangeToFieldType("xsd:boolean")).toBe(PropertyFieldType.Boolean);
    });
  });

  describe("EMS namespace types", () => {
    it("should return StatusSelect for ems:EffortStatus", () => {
      expect(
        rangeToFieldType("https://exocortex.my/ontology/ems#EffortStatus"),
      ).toBe(PropertyFieldType.StatusSelect);
    });

    it("should return StatusSelect for ems:EffortStatus (prefixed)", () => {
      expect(rangeToFieldType("ems:EffortStatus")).toBe(
        PropertyFieldType.StatusSelect,
      );
    });

    it("should return SizeSelect for ems:TaskSize", () => {
      expect(
        rangeToFieldType("https://exocortex.my/ontology/ems#TaskSize"),
      ).toBe(PropertyFieldType.SizeSelect);
    });

    it("should return SizeSelect for ems:TaskSize (prefixed)", () => {
      expect(rangeToFieldType("ems:TaskSize")).toBe(
        PropertyFieldType.SizeSelect,
      );
    });

    it("should return Reference for other EMS types", () => {
      expect(rangeToFieldType("https://exocortex.my/ontology/ems#Task")).toBe(
        PropertyFieldType.Reference,
      );
    });
  });

  describe("EXO namespace types", () => {
    it("should return Reference for exo:Asset", () => {
      expect(
        rangeToFieldType("https://exocortex.my/ontology/exo#Asset"),
      ).toBe(PropertyFieldType.Reference);
    });

    it("should return Reference for exo:Asset (prefixed)", () => {
      expect(rangeToFieldType("exo:Asset")).toBe(PropertyFieldType.Reference);
    });
  });

  describe("class reference detection", () => {
    it("should return Reference for Asset in IRI", () => {
      expect(
        rangeToFieldType("https://example.org/ontology#Asset"),
      ).toBe(PropertyFieldType.Reference);
    });

    it("should return Reference for Task in IRI", () => {
      expect(
        rangeToFieldType("https://example.org/ontology#Task"),
      ).toBe(PropertyFieldType.Reference);
    });

    it("should return Reference for Project in IRI", () => {
      expect(
        rangeToFieldType("https://example.org/ontology#Project"),
      ).toBe(PropertyFieldType.Reference);
    });

    it("should return Reference for Area in IRI", () => {
      expect(
        rangeToFieldType("https://example.org/ontology#Area"),
      ).toBe(PropertyFieldType.Reference);
    });

    it("should return Reference for exocortex.my/ontology IRIs", () => {
      expect(
        rangeToFieldType("https://exocortex.my/ontology/custom#SomeClass"),
      ).toBe(PropertyFieldType.Reference);
    });
  });

  describe("unknown types", () => {
    it("should return Text for unrecognized XSD types", () => {
      expect(rangeToFieldType("xsd:unknownType")).toBe(PropertyFieldType.Text);
    });

    it("should return Text for arbitrary string", () => {
      expect(rangeToFieldType("some:random:value")).toBe(PropertyFieldType.Text);
    });
  });

  describe("edge cases", () => {
    it("should handle leading/trailing whitespace", () => {
      expect(rangeToFieldType("  xsd:string  ")).toBe(PropertyFieldType.Text);
    });

    it("should be case-insensitive for XSD types", () => {
      expect(rangeToFieldType("xsd:STRING")).toBe(PropertyFieldType.Text);
      expect(rangeToFieldType("xsd:DateTime")).toBe(PropertyFieldType.DateTime);
      expect(rangeToFieldType("xsd:BOOLEAN")).toBe(PropertyFieldType.Boolean);
    });

    it("should handle mixed case EMS types", () => {
      expect(rangeToFieldType("ems:effortStatus")).toBe(
        PropertyFieldType.StatusSelect,
      );
      expect(rangeToFieldType("ems:TASKSIZE")).toBe(
        PropertyFieldType.SizeSelect,
      );
    });
  });
});
