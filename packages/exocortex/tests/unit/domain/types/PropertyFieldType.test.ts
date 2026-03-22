import { rangeToFieldType, PropertyFieldType } from "../../../../src/domain/types/PropertyFieldType";

describe("PropertyFieldType", () => {
  describe("rangeToFieldType", () => {
    // Branch: !rangeType (undefined)
    it("should return Unknown for undefined rangeType", () => {
      expect(rangeToFieldType(undefined)).toBe(PropertyFieldType.Unknown);
    });

    // Branch: !rangeType (empty string after trim)
    it("should return Unknown for empty string", () => {
      expect(rangeToFieldType("")).toBe(PropertyFieldType.Unknown);
    });

    // Branch: empty string after trim (whitespace only)
    it("should return Unknown for whitespace-only string", () => {
      expect(rangeToFieldType("   ")).toBe(PropertyFieldType.Unknown);
    });

    // Branches: XSD full IRI - Text types
    it("should map xsd:string full IRI to Text", () => {
      expect(rangeToFieldType("http://www.w3.org/2001/XMLSchema#string")).toBe(PropertyFieldType.Text);
    });

    it("should map xsd:normalizedString to Text", () => {
      expect(rangeToFieldType("http://www.w3.org/2001/XMLSchema#normalizedString")).toBe(PropertyFieldType.Text);
    });

    it("should map xsd:token to Text", () => {
      expect(rangeToFieldType("http://www.w3.org/2001/XMLSchema#token")).toBe(PropertyFieldType.Text);
    });

    it("should map xsd:language to Text", () => {
      expect(rangeToFieldType("http://www.w3.org/2001/XMLSchema#language")).toBe(PropertyFieldType.Text);
    });

    it("should map xsd:nmtoken to Text", () => {
      expect(rangeToFieldType("http://www.w3.org/2001/XMLSchema#nmtoken")).toBe(PropertyFieldType.Text);
    });

    it("should map xsd:name to Text", () => {
      expect(rangeToFieldType("http://www.w3.org/2001/XMLSchema#name")).toBe(PropertyFieldType.Text);
    });

    it("should map xsd:ncname to Text", () => {
      expect(rangeToFieldType("http://www.w3.org/2001/XMLSchema#ncname")).toBe(PropertyFieldType.Text);
    });

    it("should map xsd:anyuri to Text", () => {
      expect(rangeToFieldType("http://www.w3.org/2001/XMLSchema#anyuri")).toBe(PropertyFieldType.Text);
    });

    // Branches: XSD full IRI - Number types
    it("should map xsd:integer to Number", () => {
      expect(rangeToFieldType("http://www.w3.org/2001/XMLSchema#integer")).toBe(PropertyFieldType.Number);
    });

    it("should map xsd:int to Number", () => {
      expect(rangeToFieldType("http://www.w3.org/2001/XMLSchema#int")).toBe(PropertyFieldType.Number);
    });

    it("should map xsd:long to Number", () => {
      expect(rangeToFieldType("http://www.w3.org/2001/XMLSchema#long")).toBe(PropertyFieldType.Number);
    });

    it("should map xsd:short to Number", () => {
      expect(rangeToFieldType("http://www.w3.org/2001/XMLSchema#short")).toBe(PropertyFieldType.Number);
    });

    it("should map xsd:byte to Number", () => {
      expect(rangeToFieldType("http://www.w3.org/2001/XMLSchema#byte")).toBe(PropertyFieldType.Number);
    });

    it("should map xsd:nonNegativeInteger to Number", () => {
      expect(rangeToFieldType("http://www.w3.org/2001/XMLSchema#nonNegativeInteger")).toBe(PropertyFieldType.Number);
    });

    it("should map xsd:positiveInteger to Number", () => {
      expect(rangeToFieldType("http://www.w3.org/2001/XMLSchema#positiveInteger")).toBe(PropertyFieldType.Number);
    });

    it("should map xsd:nonPositiveInteger to Number", () => {
      expect(rangeToFieldType("http://www.w3.org/2001/XMLSchema#nonPositiveInteger")).toBe(PropertyFieldType.Number);
    });

    it("should map xsd:negativeInteger to Number", () => {
      expect(rangeToFieldType("http://www.w3.org/2001/XMLSchema#negativeInteger")).toBe(PropertyFieldType.Number);
    });

    it("should map xsd:unsignedLong to Number", () => {
      expect(rangeToFieldType("http://www.w3.org/2001/XMLSchema#unsignedLong")).toBe(PropertyFieldType.Number);
    });

    it("should map xsd:unsignedInt to Number", () => {
      expect(rangeToFieldType("http://www.w3.org/2001/XMLSchema#unsignedInt")).toBe(PropertyFieldType.Number);
    });

    it("should map xsd:unsignedShort to Number", () => {
      expect(rangeToFieldType("http://www.w3.org/2001/XMLSchema#unsignedShort")).toBe(PropertyFieldType.Number);
    });

    it("should map xsd:unsignedByte to Number", () => {
      expect(rangeToFieldType("http://www.w3.org/2001/XMLSchema#unsignedByte")).toBe(PropertyFieldType.Number);
    });

    it("should map xsd:decimal to Number", () => {
      expect(rangeToFieldType("http://www.w3.org/2001/XMLSchema#decimal")).toBe(PropertyFieldType.Number);
    });

    it("should map xsd:float to Number", () => {
      expect(rangeToFieldType("http://www.w3.org/2001/XMLSchema#float")).toBe(PropertyFieldType.Number);
    });

    it("should map xsd:double to Number", () => {
      expect(rangeToFieldType("http://www.w3.org/2001/XMLSchema#double")).toBe(PropertyFieldType.Number);
    });

    // Branches: XSD - Date types
    it("should map xsd:date to Date", () => {
      expect(rangeToFieldType("http://www.w3.org/2001/XMLSchema#date")).toBe(PropertyFieldType.Date);
    });

    it("should map xsd:dateTime to DateTime", () => {
      expect(rangeToFieldType("http://www.w3.org/2001/XMLSchema#dateTime")).toBe(PropertyFieldType.DateTime);
    });

    it("should map xsd:dateTimeStamp to DateTime", () => {
      expect(rangeToFieldType("http://www.w3.org/2001/XMLSchema#dateTimeStamp")).toBe(PropertyFieldType.DateTime);
    });

    // Branches: XSD - Boolean
    it("should map xsd:boolean to Boolean", () => {
      expect(rangeToFieldType("http://www.w3.org/2001/XMLSchema#boolean")).toBe(PropertyFieldType.Boolean);
    });

    // Branches: XSD - Timestamp
    it("should map xsd:time to Timestamp", () => {
      expect(rangeToFieldType("http://www.w3.org/2001/XMLSchema#time")).toBe(PropertyFieldType.Timestamp);
    });

    // Branches: XSD default (unknown xsd type)
    it("should map unknown xsd type to Text", () => {
      expect(rangeToFieldType("http://www.w3.org/2001/XMLSchema#unknownType")).toBe(PropertyFieldType.Text);
    });

    // Branch: prefixed xsd: form
    it("should handle prefixed xsd:string form", () => {
      expect(rangeToFieldType("xsd:string")).toBe(PropertyFieldType.Text);
    });

    it("should handle prefixed xsd:integer form", () => {
      expect(rangeToFieldType("xsd:integer")).toBe(PropertyFieldType.Number);
    });

    it("should handle prefixed xsd:dateTime form", () => {
      expect(rangeToFieldType("xsd:dateTime")).toBe(PropertyFieldType.DateTime);
    });

    it("should handle prefixed xsd:boolean form", () => {
      expect(rangeToFieldType("xsd:boolean")).toBe(PropertyFieldType.Boolean);
    });

    // Branch: XMLSchema# in IRI (non-standard prefix)
    it("should handle XMLSchema# pattern in IRI", () => {
      expect(rangeToFieldType("http://example.org/XMLSchema#string")).toBe(PropertyFieldType.Text);
    });

    it("should handle XMLSchema# pattern for integer", () => {
      expect(rangeToFieldType("http://custom/XMLSchema#integer")).toBe(PropertyFieldType.Number);
    });

    // Branch: EMS types - full IRI
    it("should map EMS EffortStatus to StatusSelect", () => {
      expect(rangeToFieldType("https://exocortex.my/ontology/ems#EffortStatus")).toBe(PropertyFieldType.StatusSelect);
    });

    it("should map EMS TaskSize to SizeSelect", () => {
      expect(rangeToFieldType("https://exocortex.my/ontology/ems#TaskSize")).toBe(PropertyFieldType.SizeSelect);
    });

    it("should map other EMS types to Reference", () => {
      expect(rangeToFieldType("https://exocortex.my/ontology/ems#Project")).toBe(PropertyFieldType.Reference);
    });

    // Branch: EMS types - prefixed form
    it("should handle prefixed ems:EffortStatus form", () => {
      expect(rangeToFieldType("ems:EffortStatus")).toBe(PropertyFieldType.StatusSelect);
    });

    it("should handle prefixed ems:TaskSize form", () => {
      expect(rangeToFieldType("ems:TaskSize")).toBe(PropertyFieldType.SizeSelect);
    });

    it("should handle prefixed ems:SomeOtherType form", () => {
      expect(rangeToFieldType("ems:SomeOtherType")).toBe(PropertyFieldType.Reference);
    });

    // Branch: EXO types - full IRI
    it("should map EXO type IRI to Reference", () => {
      expect(rangeToFieldType("https://exocortex.my/ontology/exo#Asset")).toBe(PropertyFieldType.Reference);
    });

    // Branch: EXO types - prefixed form
    it("should map exo: prefixed form to Reference", () => {
      expect(rangeToFieldType("exo:SomeType")).toBe(PropertyFieldType.Reference);
    });

    // Branch: isClassReference - exocortex.my/ontology pattern
    it("should recognize exocortex.my/ontology as class reference", () => {
      expect(rangeToFieldType("http://exocortex.my/ontology/custom#Something")).toBe(PropertyFieldType.Reference);
    });

    // Branch: isClassReference - known class patterns
    it("should recognize 'asset' in type as Reference", () => {
      expect(rangeToFieldType("http://example.org/Asset")).toBe(PropertyFieldType.Reference);
    });

    it("should recognize 'task' in type as Reference", () => {
      expect(rangeToFieldType("http://example.org/MyTask")).toBe(PropertyFieldType.Reference);
    });

    it("should recognize 'project' in type as Reference", () => {
      expect(rangeToFieldType("http://example.org/ProjectType")).toBe(PropertyFieldType.Reference);
    });

    it("should recognize 'area' in type as Reference", () => {
      expect(rangeToFieldType("http://example.org/AreaDef")).toBe(PropertyFieldType.Reference);
    });

    it("should recognize 'effort' in type as Reference", () => {
      expect(rangeToFieldType("http://example.org/EffortDef")).toBe(PropertyFieldType.Reference);
    });

    it("should recognize 'class' in type as Reference", () => {
      expect(rangeToFieldType("http://example.org/ClassDef")).toBe(PropertyFieldType.Reference);
    });

    it("should recognize 'property' in type as Reference", () => {
      expect(rangeToFieldType("http://example.org/PropertyDef")).toBe(PropertyFieldType.Reference);
    });

    it("should recognize 'concept' in type as Reference", () => {
      expect(rangeToFieldType("http://example.org/ConceptDef")).toBe(PropertyFieldType.Reference);
    });

    // Branch: default - unknown type falls to Text
    it("should default to Text for completely unknown type", () => {
      expect(rangeToFieldType("http://example.org/SomethingRandom")).toBe(PropertyFieldType.Text);
    });
  });
});
