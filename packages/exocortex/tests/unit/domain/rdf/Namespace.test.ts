import { Namespace } from "../../../../src/domain/models/rdf/Namespace";

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

  describe("forPrefix (whitelist relaxation)", () => {
    it("returns the canonical singleton for well-known prefixes", () => {
      expect(Namespace.forPrefix("ems")).toBe(Namespace.EMS);
      expect(Namespace.forPrefix("inbox")).toBe(Namespace.INBOX);
      expect(Namespace.forPrefix("pmbok")).toBe(Namespace.PMBOK);
    });

    it("auto-extends to ad-hoc namespace for non-whitelisted prefixes", () => {
      const ns = Namespace.forPrefix("aiKnow");
      expect(ns).not.toBeNull();
      expect(ns!.prefix).toBe("aiKnow");
      expect(ns!.iri.value).toBe("https://exocortex.my/ontology/aiKnow#");
      expect(ns!.term("Memory_aboutConcept").value).toBe(
        "https://exocortex.my/ontology/aiKnow#Memory_aboutConcept",
      );
    });

    it("returns null for invalid prefix shape", () => {
      expect(Namespace.forPrefix("Has-Dash")).toBeNull();
      expect(Namespace.forPrefix("UpperCase")).toBeNull();
      expect(Namespace.forPrefix("")).toBeNull();
      expect(Namespace.forPrefix("9starts_with_digit")).toBeNull();
    });
  });

  describe("fromPropertyKey", () => {
    it("parses well-known prefix into canonical namespace + local name", () => {
      const parsed = Namespace.fromPropertyKey("ems__Effort_status");
      expect(parsed).not.toBeNull();
      expect(parsed!.namespace).toBe(Namespace.EMS);
      expect(parsed!.localName).toBe("Effort_status");
    });

    it("parses ad-hoc prefix into derived namespace", () => {
      const parsed = Namespace.fromPropertyKey("aiKnow__Memory_aboutConcept");
      expect(parsed).not.toBeNull();
      expect(parsed!.namespace.prefix).toBe("aiKnow");
      expect(parsed!.namespace.term(parsed!.localName).value).toBe(
        "https://exocortex.my/ontology/aiKnow#Memory_aboutConcept",
      );
    });

    it("returns null for keys without the <prefix>__<local> pattern", () => {
      expect(Namespace.fromPropertyKey("aliases")).toBeNull();
      expect(Namespace.fromPropertyKey("single_underscore")).toBeNull();
      expect(Namespace.fromPropertyKey("__leading")).toBeNull();
    });
  });
});
