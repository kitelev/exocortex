import { InMemoryTripleStore } from "../../../../src/infrastructure/rdf/InMemoryTripleStore";
import { RDFVocabularyMapper } from "../../../../src/infrastructure/rdf/RDFVocabularyMapper";
import { Triple } from "../../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../../src/domain/models/rdf/IRI";
import { Namespace } from "../../../../src/domain/models/rdf/Namespace";

describe("InMemoryTripleStore RDF/RDFS Mapping Integration", () => {
  let store: InMemoryTripleStore;
  let mapper: RDFVocabularyMapper;

  beforeEach(() => {
    store = new InMemoryTripleStore();
    mapper = new RDFVocabularyMapper();
  });

  describe("Vocabulary Triple Generation", () => {
    it("should store class hierarchy triples", async () => {
      const triples = mapper.generateClassHierarchyTriples();

      for (const triple of triples) {
        await store.add(triple);
      }

      // Verify ems:Task rdfs:subClassOf exo:Asset
      const taskSubclassTriples = await store.match(
        Namespace.EMS.term("Task"),
        Namespace.RDFS.term("subClassOf"),
        undefined,
      );

      expect(taskSubclassTriples.length).toBeGreaterThan(0);
      expect((taskSubclassTriples[0].object as IRI).value).toContain("Asset");
    });

    it("should store property hierarchy triples", async () => {
      const triples = mapper.generatePropertyHierarchyTriples();

      for (const triple of triples) {
        await store.add(triple);
      }

      // Verify exo:Instance_class rdfs:subPropertyOf rdf:type
      const instanceClassTriples = await store.match(
        Namespace.EXO.term("Instance_class"),
        Namespace.RDFS.term("subPropertyOf"),
        undefined,
      );

      expect(instanceClassTriples.length).toBeGreaterThan(0);
      expect((instanceClassTriples[0].object as IRI).value).toBe(
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
      );
    });

    it("should store all 6 class hierarchy mappings", async () => {
      const triples = mapper.generateClassHierarchyTriples();

      for (const triple of triples) {
        await store.add(triple);
      }

      // Verify all mappings are stored
      const allClassTriples = await store.match(
        undefined,
        Namespace.RDFS.term("subClassOf"),
        undefined,
      );

      expect(allClassTriples.length).toBeGreaterThanOrEqual(6);
    });

    it("should store all 6 property hierarchy mappings", async () => {
      const triples = mapper.generatePropertyHierarchyTriples();

      for (const triple of triples) {
        await store.add(triple);
      }

      // Verify all mappings are stored
      const allPropertyTriples = await store.match(
        undefined,
        Namespace.RDFS.term("subPropertyOf"),
        undefined,
      );

      expect(allPropertyTriples.length).toBeGreaterThanOrEqual(6);
    });
  });

  describe("Asset Triple Generation with RDF Predicates", () => {
    beforeEach(async () => {
      // Load vocabulary triples first
      const classTriples = mapper.generateClassHierarchyTriples();
      const propertyTriples = mapper.generatePropertyHierarchyTriples();

      for (const triple of [...classTriples, ...propertyTriples]) {
        await store.add(triple);
      }
    });

    it("should generate rdf:type triple for exo__Instance_class", async () => {
      const assetURI = new IRI(
        "https://exocortex.my/ontology/ems/550e8400-e29b-41d4-a716-446655440000",
      );

      // Generate mapped triple using RDFVocabularyMapper
      const mappedTriple = mapper.generateMappedTriple(
        assetURI,
        "exo__Instance_class",
        "ems__Task",
      );

      expect(mappedTriple).not.toBeNull();

      await store.add(mappedTriple!);

      // Verify rdf:type triple is stored
      const typeTriples = await store.match(
        assetURI,
        Namespace.RDF.term("type"),
        undefined,
      );

      expect(typeTriples.length).toBe(1);
      expect((typeTriples[0].object as IRI).value).toContain("Task");
    });

    it("should generate rdfs:isDefinedBy triple for exo__Asset_isDefinedBy", async () => {
      const assetURI = new IRI(
        "https://exocortex.my/ontology/ems/550e8400-e29b-41d4-a716-446655440000",
      );
      const ontologyURI = new IRI("https://exocortex.my/ontology/ems/");

      const mappedTriple = mapper.generateMappedTriple(
        assetURI,
        "exo__Asset_isDefinedBy",
        ontologyURI,
      );

      expect(mappedTriple).not.toBeNull();

      await store.add(mappedTriple!);

      // Verify rdfs:isDefinedBy triple is stored
      const isDefinedByTriples = await store.match(
        assetURI,
        Namespace.RDFS.term("isDefinedBy"),
        undefined,
      );

      expect(isDefinedByTriples.length).toBe(1);
      expect((isDefinedByTriples[0].object as IRI).value).toBe(
        "https://exocortex.my/ontology/ems/",
      );
    });

    it("should not generate triple for unmapped ExoRDF property", async () => {
      const assetURI = new IRI(
        "https://exocortex.my/ontology/ems/550e8400-e29b-41d4-a716-446655440000",
      );

      // ems__Task_size has no RDF/RDFS mapping
      const mappedTriple = mapper.generateMappedTriple(
        assetURI,
        "ems__Task_size",
        "M",
      );

      expect(mappedTriple).toBeNull();
    });
  });

  describe("RDF/RDFS Query Patterns", () => {
    beforeEach(async () => {
      // Load vocabulary triples
      const classTriples = mapper.generateClassHierarchyTriples();
      const propertyTriples = mapper.generatePropertyHierarchyTriples();

      for (const triple of [...classTriples, ...propertyTriples]) {
        await store.add(triple);
      }

      // Add mock asset triples
      const task1URI = new IRI(
        "https://exocortex.my/ontology/ems/550e8400-e29b-41d4-a716-446655440000",
      );
      const task2URI = new IRI(
        "https://exocortex.my/ontology/ems/550e8400-e29b-41d4-a716-446655440001",
      );
      const projectURI = new IRI(
        "https://exocortex.my/ontology/ems/550e8400-e29b-41d4-a716-446655440002",
      );

      await store.add(
        new Triple(task1URI, Namespace.RDF.term("type"), Namespace.EMS.term("Task")),
      );
      await store.add(
        new Triple(task2URI, Namespace.RDF.term("type"), Namespace.EMS.term("Task")),
      );
      await store.add(
        new Triple(
          projectURI,
          Namespace.RDF.term("type"),
          Namespace.EMS.term("Project"),
        ),
      );
    });

    it("should query all assets of type ems:Task using rdf:type", async () => {
      const taskTriples = await store.match(
        undefined,
        Namespace.RDF.term("type"),
        Namespace.EMS.term("Task"),
      );

      expect(taskTriples.length).toBe(2);
    });

    it("should query all assets of type ems:Project using rdf:type", async () => {
      const projectTriples = await store.match(
        undefined,
        Namespace.RDF.term("type"),
        Namespace.EMS.term("Project"),
      );

      expect(projectTriples.length).toBe(1);
    });

    it("should query class hierarchy using rdfs:subClassOf", async () => {
      // Query: What are the subclasses of exo:Asset?
      const subclassTriples = await store.match(
        undefined,
        Namespace.RDFS.term("subClassOf"),
        Namespace.EXO.term("Asset"),
      );

      expect(subclassTriples.length).toBeGreaterThanOrEqual(3); // Task, Project, Area
      const subclassNames = subclassTriples.map((t) => (t.subject as IRI).value);
      expect(subclassNames.some((name) => name.includes("Task"))).toBe(true);
      expect(subclassNames.some((name) => name.includes("Project"))).toBe(true);
      expect(subclassNames.some((name) => name.includes("Area"))).toBe(true);
    });

    it("should query property hierarchy using rdfs:subPropertyOf", async () => {
      // Query: What properties are sub-properties of rdfs:isDefinedBy?
      const subpropertyTriples = await store.match(
        undefined,
        Namespace.RDFS.term("subPropertyOf"),
        Namespace.RDFS.term("isDefinedBy"),
      );

      expect(subpropertyTriples.length).toBeGreaterThanOrEqual(1);
      expect((subpropertyTriples[0].subject as IRI).value).toContain("Asset_isDefinedBy");
    });
  });

  describe("Transitive Closure (Conceptual Tests)", () => {
    beforeEach(async () => {
      const classTriples = mapper.generateClassHierarchyTriples();

      for (const triple of classTriples) {
        await store.add(triple);
      }
    });

    it("should retrieve all ancestors of ems:Task", async () => {
      // ems:Task -> exo:Asset -> rdfs:Resource
      // We can traverse this manually (transitive inference would be in SPARQL engine)

      // Step 1: Get direct superclass of ems:Task
      const taskSuperclass = await store.match(
        Namespace.EMS.term("Task"),
        Namespace.RDFS.term("subClassOf"),
        undefined,
      );

      expect(taskSuperclass.length).toBe(1);
      expect((taskSuperclass[0].object as IRI).value).toContain("Asset");

      // Step 2: Get superclass of exo:Asset
      const assetSuperclass = await store.match(
        Namespace.EXO.term("Asset"),
        Namespace.RDFS.term("subClassOf"),
        undefined,
      );

      expect(assetSuperclass.length).toBe(1);
      expect((assetSuperclass[0].object as IRI).value).toBe(
        "http://www.w3.org/2000/01/rdf-schema#Resource",
      );
    });

    it("should handle circular hierarchy gracefully", async () => {
      // Test circular reference detection
      // exo:Asset already has rdfs:Resource as superclass
      // Attempting to add rdfs:Resource -> exo:Asset would create cycle

      const circularTriple = new Triple(
        Namespace.RDFS.term("Resource"),
        Namespace.RDFS.term("subClassOf"),
        Namespace.EXO.term("Asset"),
      );

      await store.add(circularTriple);

      // Triple is stored (no validation in store layer)
      const hasCircular = await store.has(circularTriple);
      expect(hasCircular).toBe(true);

      // Note: Cycle detection should be in SPARQL engine, not triple store
    });
  });

  describe("Backward Compatibility", () => {
    beforeEach(async () => {
      // Load vocabulary triples
      const classTriples = mapper.generateClassHierarchyTriples();
      const propertyTriples = mapper.generatePropertyHierarchyTriples();

      for (const triple of [...classTriples, ...propertyTriples]) {
        await store.add(triple);
      }

      // Add both ExoRDF and RDF/RDFS triples for same asset
      const assetURI = new IRI(
        "https://exocortex.my/ontology/ems/550e8400-e29b-41d4-a716-446655440000",
      );

      // ExoRDF triple
      await store.add(
        new Triple(
          assetURI,
          Namespace.EXO.term("Instance_class"),
          Namespace.EMS.term("Task"),
        ),
      );

      // RDF/RDFS mapped triple
      await store.add(
        new Triple(assetURI, Namespace.RDF.term("type"), Namespace.EMS.term("Task")),
      );
    });

    it("should query using ExoRDF predicate (exo:Instance_class)", async () => {
      const exoTriples = await store.match(
        undefined,
        Namespace.EXO.term("Instance_class"),
        undefined,
      );

      expect(exoTriples.length).toBe(1);
    });

    it("should query using RDF/RDFS predicate (rdf:type)", async () => {
      const rdfTriples = await store.match(
        undefined,
        Namespace.RDF.term("type"),
        undefined,
      );

      expect(rdfTriples.length).toBe(1);
    });

    it("should support both query styles simultaneously", async () => {
      const assetURI = new IRI(
        "https://exocortex.my/ontology/ems/550e8400-e29b-41d4-a716-446655440000",
      );

      // Query with ExoRDF predicate
      const exoTriples = await store.match(
        assetURI,
        Namespace.EXO.term("Instance_class"),
        undefined,
      );
      expect(exoTriples.length).toBe(1);

      // Query with RDF/RDFS predicate
      const rdfTriples = await store.match(
        assetURI,
        Namespace.RDF.term("type"),
        undefined,
      );
      expect(rdfTriples.length).toBe(1);

      // Both should return same object value
      expect((exoTriples[0].object as IRI).value).toBe((rdfTriples[0].object as IRI).value);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty vocabulary gracefully", async () => {
      // Query with no vocabulary triples loaded
      const triples = await store.match(
        undefined,
        Namespace.RDFS.term("subClassOf"),
        undefined,
      );

      expect(triples.length).toBe(0);
    });

    it("should handle large vocabulary efficiently", async () => {
      const startTime = performance.now();

      // Generate and store 100 class hierarchy triples
      for (let i = 0; i < 100; i++) {
        const triple = new Triple(
          new IRI(`https://exocortex.my/ontology/class${i}`),
          Namespace.RDFS.term("subClassOf"),
          Namespace.EXO.term("Asset"),
        );
        await store.add(triple);
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should complete in <50ms for 100 triples
      expect(duration).toBeLessThan(50);
    });

    it("should deduplicate identical vocabulary triples", async () => {
      const triple = mapper.generateClassHierarchyTriples()[0];

      await store.add(triple);
      await store.add(triple); // Add same triple twice

      const allTriples = await store.match(
        triple.subject,
        triple.predicate,
        triple.object,
      );

      expect(allTriples.length).toBe(1); // Deduplicated
    });
  });
});
