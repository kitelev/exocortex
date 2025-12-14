import { Namespace } from "../../../../src/domain/models/rdf/Namespace";
import { IRI } from "../../../../src/domain/models/rdf/IRI";

describe("Namespace", () => {
  describe("constructor", () => {
    it("should create namespace with prefix and IRI", () => {
      const ns = new Namespace("ex", "http://example.com/");
      expect(ns.prefix).toBe("ex");
      expect(ns.iri.value).toBe("http://example.com/");
    });

    it("should throw error for empty prefix", () => {
      expect(() => new Namespace("", "http://example.com/")).toThrow(
        "Namespace prefix cannot be empty"
      );
    });
  });

  describe("term", () => {
    it("should create IRI by appending term to namespace IRI", () => {
      const ns = new Namespace("ex", "http://example.com/");
      const termIRI = ns.term("Person");
      expect(termIRI.value).toBe("http://example.com/Person");
    });

    it("should work with multiple terms", () => {
      const ns = new Namespace("ex", "http://example.com/");
      expect(ns.term("Person").value).toBe("http://example.com/Person");
      expect(ns.term("name").value).toBe("http://example.com/name");
      expect(ns.term("age").value).toBe("http://example.com/age");
    });

    it("should handle namespace IRI with hash", () => {
      const ns = new Namespace("ex", "http://example.com#");
      const termIRI = ns.term("Person");
      expect(termIRI.value).toBe("http://example.com#Person");
    });
  });

  describe("expand", () => {
    it("should expand prefixed name to full IRI", () => {
      const ns = new Namespace("ex", "http://example.com/");
      const iri = ns.expand("ex:Person");
      expect(iri?.value).toBe("http://example.com/Person");
    });

    it("should return null for non-matching prefix", () => {
      const ns = new Namespace("ex", "http://example.com/");
      const iri = ns.expand("other:Person");
      expect(iri).toBeNull();
    });

    it("should return null for invalid format", () => {
      const ns = new Namespace("ex", "http://example.com/");
      expect(ns.expand("invalidformat")).toBeNull();
      expect(ns.expand("")).toBeNull();
    });
  });

  describe("standard namespaces", () => {
    it("should provide RDF namespace", () => {
      const rdf = Namespace.RDF;
      expect(rdf.prefix).toBe("rdf");
      expect(rdf.iri.value).toBe("http://www.w3.org/1999/02/22-rdf-syntax-ns#");
    });

    it("should provide RDFS namespace", () => {
      const rdfs = Namespace.RDFS;
      expect(rdfs.prefix).toBe("rdfs");
      expect(rdfs.iri.value).toBe("http://www.w3.org/2000/01/rdf-schema#");
    });

    it("should provide OWL namespace", () => {
      const owl = Namespace.OWL;
      expect(owl.prefix).toBe("owl");
      expect(owl.iri.value).toBe("http://www.w3.org/2002/07/owl#");
    });

    it("should provide XSD namespace", () => {
      const xsd = Namespace.XSD;
      expect(xsd.prefix).toBe("xsd");
      expect(xsd.iri.value).toBe("http://www.w3.org/2001/XMLSchema#");
    });

    it("should provide EXO namespace", () => {
      const exo = Namespace.EXO;
      expect(exo.prefix).toBe("exo");
      expect(exo.iri.value).toBe("https://exocortex.my/ontology/exo#");
    });

    it("should provide EMS namespace", () => {
      const ems = Namespace.EMS;
      expect(ems.prefix).toBe("ems");
      expect(ems.iri.value).toBe("https://exocortex.my/ontology/ems#");
    });
  });

  describe("standard namespace terms", () => {
    it("should create RDF type IRI", () => {
      const type = Namespace.RDF.term("type");
      expect(type.value).toBe("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
    });

    it("should create RDFS label IRI", () => {
      const label = Namespace.RDFS.term("label");
      expect(label.value).toBe("http://www.w3.org/2000/01/rdf-schema#label");
    });

    it("should create OWL Class IRI", () => {
      const cls = Namespace.OWL.term("Class");
      expect(cls.value).toBe("http://www.w3.org/2002/07/owl#Class");
    });

    it("should create XSD string IRI", () => {
      const str = Namespace.XSD.term("string");
      expect(str.value).toBe("http://www.w3.org/2001/XMLSchema#string");
    });
  });
});
