import { RDFVocabularyMapper } from "../../../../src/infrastructure/rdf/RDFVocabularyMapper";
import { Namespace } from "../../../../src/domain/models/rdf/Namespace";
import { IRI } from "../../../../src/domain/models/rdf/IRI";

describe("RDFVocabularyMapper", () => {
  let mapper: RDFVocabularyMapper;

  beforeEach(() => {
    mapper = new RDFVocabularyMapper();
  });

  describe("generateClassHierarchyTriples", () => {
    it("should generate rdfs:subClassOf triples for ExoRDF classes", () => {
      const triples = mapper.generateClassHierarchyTriples();

      expect(triples.length).toBeGreaterThan(0);

      const taskSubclassTriple = triples.find(
        (t) =>
          (t.subject as IRI).value.includes("Task") &&
          (t.predicate as IRI).value ===
            "http://www.w3.org/2000/01/rdf-schema#subClassOf",
      );

      expect(taskSubclassTriple).toBeDefined();
      expect((taskSubclassTriple!.object as IRI).value).toContain("Asset");
    });

    it("should generate triples for all ExoRDF classes", () => {
      const triples = mapper.generateClassHierarchyTriples();

      const classNames = ["Task", "Project", "Area", "Asset"];

      for (const className of classNames) {
        const classTriple = triples.find((t) =>
          (t.subject as IRI).value.includes(className),
        );
        expect(classTriple).toBeDefined();
      }
    });

    it("should map exo__Asset to rdfs:Resource", () => {
      const triples = mapper.generateClassHierarchyTriples();

      const assetTriple = triples.find(
        (t) =>
          (t.subject as IRI).value.includes("Asset") &&
          (t.object as IRI).value ===
            "http://www.w3.org/2000/01/rdf-schema#Resource",
      );

      expect(assetTriple).toBeDefined();
    });

    it("should map exo__Class to rdfs:Class", () => {
      const triples = mapper.generateClassHierarchyTriples();

      const classTriple = triples.find(
        (t) =>
          (t.subject as IRI).value.includes("#Class") &&
          (t.object as IRI).value === "http://www.w3.org/2000/01/rdf-schema#Class",
      );

      expect(classTriple).toBeDefined();
    });

    it("should map exo__Property to rdf:Property", () => {
      const triples = mapper.generateClassHierarchyTriples();

      const propertyTriple = triples.find(
        (t) =>
          (t.subject as IRI).value.includes("#Property") &&
          (t.object as IRI).value ===
            "http://www.w3.org/1999/02/22-rdf-syntax-ns#Property",
      );

      expect(propertyTriple).toBeDefined();
    });
  });

  describe("generatePropertyHierarchyTriples", () => {
    it("should generate rdfs:subPropertyOf triples for ExoRDF properties", () => {
      const triples = mapper.generatePropertyHierarchyTriples();

      expect(triples.length).toBeGreaterThanOrEqual(6);
    });

    it("should map exo__Instance_class to rdf:type", () => {
      const triples = mapper.generatePropertyHierarchyTriples();

      const instanceClassTriple = triples.find(
        (t) =>
          (t.subject as IRI).value.includes("Instance_class") &&
          (t.object as IRI).value === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
      );

      expect(instanceClassTriple).toBeDefined();
    });

    it("should map exo__Asset_isDefinedBy to rdfs:isDefinedBy", () => {
      const triples = mapper.generatePropertyHierarchyTriples();

      const isDefinedByTriple = triples.find(
        (t) =>
          (t.subject as IRI).value.includes("Asset_isDefinedBy") &&
          (t.object as IRI).value ===
            "http://www.w3.org/2000/01/rdf-schema#isDefinedBy",
      );

      expect(isDefinedByTriple).toBeDefined();
    });

    it("should map exo__Class_superClass to rdfs:subClassOf", () => {
      const triples = mapper.generatePropertyHierarchyTriples();

      const superClassTriple = triples.find(
        (t) =>
          (t.subject as IRI).value.includes("Class_superClass") &&
          (t.object as IRI).value ===
            "http://www.w3.org/2000/01/rdf-schema#subClassOf",
      );

      expect(superClassTriple).toBeDefined();
    });

    it("should map exo__Property_range to rdfs:range", () => {
      const triples = mapper.generatePropertyHierarchyTriples();

      const rangeTriple = triples.find(
        (t) =>
          (t.subject as IRI).value.includes("Property_range") &&
          (t.object as IRI).value === "http://www.w3.org/2000/01/rdf-schema#range",
      );

      expect(rangeTriple).toBeDefined();
    });

    it("should map exo__Property_domain to rdfs:domain", () => {
      const triples = mapper.generatePropertyHierarchyTriples();

      const domainTriple = triples.find(
        (t) =>
          (t.subject as IRI).value.includes("Property_domain") &&
          (t.object as IRI).value === "http://www.w3.org/2000/01/rdf-schema#domain",
      );

      expect(domainTriple).toBeDefined();
    });

    it("should map exo__Property_superProperty to rdfs:subPropertyOf", () => {
      const triples = mapper.generatePropertyHierarchyTriples();

      const superPropertyTriple = triples.find(
        (t) =>
          (t.subject as IRI).value.includes("Property_superProperty") &&
          (t.object as IRI).value ===
            "http://www.w3.org/2000/01/rdf-schema#subPropertyOf",
      );

      expect(superPropertyTriple).toBeDefined();
    });
  });

  describe("generateMappedTriple", () => {
    it("should generate rdf:type triple for exo__Instance_class", () => {
      const subjectIRI = new IRI(
        "https://exocortex.my/ontology/ems/550e8400-e29b-41d4-a716-446655440000",
      );

      const triple = mapper.generateMappedTriple(
        subjectIRI,
        "exo__Instance_class",
        "ems__Task",
      );

      expect(triple).toBeDefined();
      expect((triple!.predicate as IRI).value).toBe(
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
      );
      expect((triple!.object as IRI).value).toContain("Task");
    });

    it("should generate rdfs:isDefinedBy triple for exo__Asset_isDefinedBy", () => {
      const subjectIRI = new IRI(
        "https://exocortex.my/ontology/ems/550e8400-e29b-41d4-a716-446655440000",
      );

      const triple = mapper.generateMappedTriple(
        subjectIRI,
        "exo__Asset_isDefinedBy",
        new IRI("https://exocortex.my/ontology/ems/"),
      );

      expect(triple).toBeDefined();
      expect(triple!.predicate.value).toBe(
        "http://www.w3.org/2000/01/rdf-schema#isDefinedBy",
      );
    });

    it("should return null for unmapped ExoRDF property", () => {
      const subjectIRI = new IRI(
        "https://exocortex.my/ontology/ems/550e8400-e29b-41d4-a716-446655440000",
      );

      const triple = mapper.generateMappedTriple(
        subjectIRI,
        "ems__Task_size",
        "M",
      );

      expect(triple).toBeNull();
    });

    it("should handle string values and convert to IRI", () => {
      const subjectIRI = new IRI(
        "https://exocortex.my/ontology/ems/550e8400-e29b-41d4-a716-446655440000",
      );

      const triple = mapper.generateMappedTriple(
        subjectIRI,
        "exo__Instance_class",
        "ems__Project",
      );

      expect(triple).toBeDefined();
      expect(triple!.object).toBeInstanceOf(IRI);
      expect((triple!.object as IRI).value).toContain("Project");
    });

    it("should handle IRI values directly", () => {
      const subjectIRI = new IRI(
        "https://exocortex.my/ontology/ems/550e8400-e29b-41d4-a716-446655440000",
      );
      const valueIRI = new IRI("https://exocortex.my/ontology/ems/Area");

      const triple = mapper.generateMappedTriple(
        subjectIRI,
        "exo__Asset_isDefinedBy",
        valueIRI,
      );

      expect(triple).toBeDefined();
      expect(triple!.object).toBeInstanceOf(IRI);
      expect((triple!.object as IRI).value).toBe(valueIRI.value);
    });
  });

  describe("hasMappingFor", () => {
    it("should return true for mapped properties", () => {
      expect(mapper.hasMappingFor("exo__Instance_class")).toBe(true);
      expect(mapper.hasMappingFor("exo__Asset_isDefinedBy")).toBe(true);
      expect(mapper.hasMappingFor("exo__Class_superClass")).toBe(true);
    });

    it("should return false for unmapped properties", () => {
      expect(mapper.hasMappingFor("ems__Task_size")).toBe(false);
      expect(mapper.hasMappingFor("ems__Effort_status")).toBe(false);
      expect(mapper.hasMappingFor("exo__Asset_label")).toBe(false);
    });
  });
});
