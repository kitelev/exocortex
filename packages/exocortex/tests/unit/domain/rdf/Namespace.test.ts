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

  describe("additional Exocortex namespaces", () => {
    it("should provide EXOCMD namespace", () => {
      expect(Namespace.EXOCMD.prefix).toBe("exocmd");
      expect(Namespace.EXOCMD.iri.value).toBe("https://exocortex.my/ontology/exocmd#");
    });

    it("should provide IMS namespace", () => {
      expect(Namespace.IMS.prefix).toBe("ims");
      expect(Namespace.IMS.iri.value).toBe("https://exocortex.my/ontology/ims#");
    });

    it("should provide ZTLK namespace", () => {
      expect(Namespace.ZTLK.prefix).toBe("ztlk");
      expect(Namespace.ZTLK.iri.value).toBe("https://exocortex.my/ontology/ztlk#");
    });

    it("should provide PTMS namespace", () => {
      expect(Namespace.PTMS.prefix).toBe("ptms");
      expect(Namespace.PTMS.iri.value).toBe("https://exocortex.my/ontology/ptms#");
    });

    it("should provide LIT namespace", () => {
      expect(Namespace.LIT.prefix).toBe("lit");
      expect(Namespace.LIT.iri.value).toBe("https://exocortex.my/ontology/lit#");
    });

    it("should provide INBOX namespace", () => {
      expect(Namespace.INBOX.prefix).toBe("inbox");
      expect(Namespace.INBOX.iri.value).toBe("https://exocortex.my/ontology/inbox#");
    });
  });

  describe("resolve", () => {
    it.each([
      ["exo", Namespace.EXO],
      ["ems", Namespace.EMS],
      ["exocmd", Namespace.EXOCMD],
      ["ims", Namespace.IMS],
      ["ztlk", Namespace.ZTLK],
      ["ptms", Namespace.PTMS],
      ["lit", Namespace.LIT],
      ["inbox", Namespace.INBOX],
    ])("resolves '%s' to correct namespace", (prefix, expected) => {
      expect(Namespace.resolve(prefix)).toBe(expected);
    });

    it("returns null for unknown prefix", () => {
      expect(Namespace.resolve("unknown")).toBeNull();
      expect(Namespace.resolve("")).toBeNull();
    });

    it("does not resolve standard W3C namespaces (rdf, rdfs, owl, xsd)", () => {
      expect(Namespace.resolve("rdf")).toBeNull();
      expect(Namespace.resolve("rdfs")).toBeNull();
      expect(Namespace.resolve("owl")).toBeNull();
      expect(Namespace.resolve("xsd")).toBeNull();
    });
  });
});
