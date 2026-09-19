/**
 * utilities/xsdDatatype — the ONE parser for XSD datatype references shared by
 * RequiredPropertyResolver (local name, lower-cased at ITS call site) and
 * ShapeLoader.datatypeRangeToIRI (full IRI, local name verbatim). Ticket
 * b151005b (NIT of review #4266). Axes X1–X7; the case policy of each caller
 * is locked by the callers' own suites (RequiredPropertyResolver R1,
 * ShapeLoader "resolves xsd: prefix in range to full XSD IRI").
 */
import {
  XSD_NS,
  xsdDatatypeIRI,
  xsdDatatypeLocalName,
} from "../../src/utilities/xsdDatatype";

describe("xsdDatatype — shared XSD datatype reference parser (b151005b)", () => {
  it("X1 xsdDatatypeLocalName: CURIE `xsd:<local>` → local name AS WRITTEN (case preserved, no policy in the helper)", () => {
    expect(xsdDatatypeLocalName("xsd:dateTime")).toBe("dateTime");
    expect(xsdDatatypeLocalName("xsd:Integer")).toBe("Integer");
    expect(xsdDatatypeLocalName("xsd:integer")).toBe("integer");
  });

  it("X2 xsdDatatypeLocalName: full W3C IRI `http://www.w3.org/2001/XMLSchema#<local>` → local name as written", () => {
    expect(xsdDatatypeLocalName(`${XSD_NS}integer`)).toBe("integer");
    expect(xsdDatatypeLocalName(`${XSD_NS}DateTime`)).toBe("DateTime");
    expect(XSD_NS).toBe("http://www.w3.org/2001/XMLSchema#");
  });

  it("X3 xsdDatatypeLocalName: a foreign CURIE, a foreign IRI, a plain word or an empty string is NOT a datatype reference → null", () => {
    expect(xsdDatatypeLocalName("ex:date")).toBeNull();
    expect(
      xsdDatatypeLocalName("https://exocortex.my/ontology/ems#Task"),
    ).toBeNull();
    expect(
      xsdDatatypeLocalName("http://www.w3.org/ns/shacl#datatype"),
    ).toBeNull();
    expect(xsdDatatypeLocalName("integer")).toBeNull();
    expect(xsdDatatypeLocalName("")).toBeNull();
    // Prefix match is anchored at the start: an XSD reference embedded later
    // in the string is not one.
    expect(xsdDatatypeLocalName("range: xsd:integer")).toBeNull();
  });

  it("X4 xsdDatatypeIRI: CURIE `xsd:<local>` expands to the W3C namespace with the local name verbatim (`xsd:Integer` → `…#Integer`)", () => {
    expect(xsdDatatypeIRI("xsd:integer")).toBe(`${XSD_NS}integer`);
    expect(xsdDatatypeIRI("xsd:Integer")).toBe(`${XSD_NS}Integer`);
    expect(xsdDatatypeIRI("xsd:dateTime")).toBe(`${XSD_NS}dateTime`);
  });

  it("X5 xsdDatatypeIRI: a full XSD IRI is returned as-is", () => {
    expect(xsdDatatypeIRI(`${XSD_NS}dateTime`)).toBe(`${XSD_NS}dateTime`);
    expect(xsdDatatypeIRI(`${XSD_NS}boolean`)).toBe(`${XSD_NS}boolean`);
  });

  it("X6 xsdDatatypeIRI: a foreign CURIE / foreign IRI / plain word → null (the helper does NOT pass foreign IRIs through — that is ShapeLoader's own http(s) branch)", () => {
    expect(xsdDatatypeIRI("ex:date")).toBeNull();
    expect(xsdDatatypeIRI("sh:IRI")).toBeNull();
    expect(xsdDatatypeIRI("https://exocortex.my/ontology/ems#Task")).toBeNull();
    expect(xsdDatatypeIRI("integer")).toBeNull();
  });

  it("X7 bare prefix (`xsd:` / the namespace alone) is an EMPTY local name, not null — the resolver falls through to text, ShapeLoader keeps the bare namespace as the range IRI (pre-existing)", () => {
    expect(xsdDatatypeLocalName("xsd:")).toBe("");
    expect(xsdDatatypeLocalName(XSD_NS)).toBe("");
    expect(xsdDatatypeIRI("xsd:")).toBe(XSD_NS);
    expect(xsdDatatypeIRI(XSD_NS)).toBe(XSD_NS);
  });
});
