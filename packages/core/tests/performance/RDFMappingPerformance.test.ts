import { InMemoryTripleStore } from "../../src/infrastructure/rdf/InMemoryTripleStore";
import { RDFVocabularyMapper } from "../../src/infrastructure/rdf/RDFVocabularyMapper";
import { Triple } from "../../src/domain/models/rdf/Triple";
import { IRI } from "../../src/domain/models/rdf/IRI";
import { Namespace } from "../../src/domain/models/rdf/Namespace";

describe("RDF Mapping Performance", () => {
  let store: InMemoryTripleStore;
  let mapper: RDFVocabularyMapper;

  beforeEach(() => {
    store = new InMemoryTripleStore();
    mapper = new RDFVocabularyMapper();
  });

  describe("Vocabulary Triple Generation Performance", () => {
    it("should generate class hierarchy triples in <1ms", () => {
      const iterations = 100;
      const startTime = performance.now();

      for (let i = 0; i < iterations; i++) {
        mapper.generateClassHierarchyTriples();
      }

      const endTime = performance.now();
      const avgDuration = (endTime - startTime) / iterations;

      expect(avgDuration).toBeLessThan(1); // <1ms average
    });

    it("should generate property hierarchy triples in <1ms", () => {
      const iterations = 100;
      const startTime = performance.now();

      for (let i = 0; i < iterations; i++) {
        mapper.generatePropertyHierarchyTriples();
      }

      const endTime = performance.now();
      const avgDuration = (endTime - startTime) / iterations;

      expect(avgDuration).toBeLessThan(1); // <1ms average
    });
  });

  describe("Triple Store Loading Performance", () => {
    it("should load vocabulary triples in <10ms", async () => {
      const classTriples = mapper.generateClassHierarchyTriples();
      const propertyTriples = mapper.generatePropertyHierarchyTriples();
      const allTriples = [...classTriples, ...propertyTriples];

      const startTime = performance.now();

      for (const triple of allTriples) {
        await store.add(triple);
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(10); // <10ms for 12 triples
    });

    it("should load 100 asset triples in <50ms", async () => {
      // Load vocabulary first
      const classTriples = mapper.generateClassHierarchyTriples();
      for (const triple of classTriples) {
        await store.add(triple);
      }

      // Generate 100 asset triples
      const assetTriples: Triple[] = [];
      for (let i = 0; i < 100; i++) {
        const assetURI = new IRI(
          `https://exocortex.my/ontology/ems/asset-${i}`,
        );
        assetTriples.push(
          new Triple(assetURI, Namespace.RDF.term("type"), Namespace.EMS.term("Task")),
        );
      }

      const startTime = performance.now();

      for (const triple of assetTriples) {
        await store.add(triple);
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(50); // <50ms for 100 triples (<0.5ms per triple)
    });

    it("should load 1000 asset triples in <500ms", async () => {
      // Generate 1000 asset triples
      const assetTriples: Triple[] = [];
      for (let i = 0; i < 1000; i++) {
        const assetURI = new IRI(
          `https://exocortex.my/ontology/ems/asset-${i}`,
        );
        assetTriples.push(
          new Triple(assetURI, Namespace.RDF.term("type"), Namespace.EMS.term("Task")),
        );
      }

      const startTime = performance.now();

      for (const triple of assetTriples) {
        await store.add(triple);
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(500); // <500ms for 1000 triples (<0.5ms per triple)
    });
  });

  describe("Query Performance with RDF/RDFS Predicates", () => {
    beforeEach(async () => {
      // Load vocabulary
      const classTriples = mapper.generateClassHierarchyTriples();
      const propertyTriples = mapper.generatePropertyHierarchyTriples();
      for (const triple of [...classTriples, ...propertyTriples]) {
        await store.add(triple);
      }

      // Load 100 mock assets
      for (let i = 0; i < 100; i++) {
        const assetURI = new IRI(
          `https://exocortex.my/ontology/ems/asset-${i}`,
        );
        await store.add(
          new Triple(assetURI, Namespace.RDF.term("type"), Namespace.EMS.term("Task")),
        );
      }
    });

    it("should query using rdf:type in <10ms", async () => {
      const startTime = performance.now();

      const results = await store.match(
        undefined,
        Namespace.RDF.term("type"),
        Namespace.EMS.term("Task"),
      );

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(results.length).toBe(100);
      expect(duration).toBeLessThan(10); // <10ms for query
    });

    it("should query class hierarchy using rdfs:subClassOf in <5ms", async () => {
      const startTime = performance.now();

      const results = await store.match(
        undefined,
        Namespace.RDFS.term("subClassOf"),
        Namespace.EXO.term("Asset"),
      );

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(results.length).toBeGreaterThanOrEqual(3); // Task, Project, Area
      expect(duration).toBeLessThan(5); // <5ms for hierarchy query
    });

    it("should query property hierarchy using rdfs:subPropertyOf in <5ms", async () => {
      const startTime = performance.now();

      const results = await store.match(
        undefined,
        Namespace.RDFS.term("subPropertyOf"),
        undefined,
      );

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(results.length).toBeGreaterThanOrEqual(6); // 6 property mappings
      expect(duration).toBeLessThan(5); // <5ms for property hierarchy query
    });
  });

  describe("Mapped Triple Generation Performance", () => {
    it("should generate mapped triples in <0.1ms per triple", () => {
      const assetURI = new IRI(
        "https://exocortex.my/ontology/ems/550e8400-e29b-41d4-a716-446655440000",
      );

      const iterations = 1000;
      const startTime = performance.now();

      for (let i = 0; i < iterations; i++) {
        mapper.generateMappedTriple(
          assetURI,
          "exo__Instance_class",
          "ems__Task",
        );
      }

      const endTime = performance.now();
      const avgDuration = (endTime - startTime) / iterations;

      expect(avgDuration).toBeLessThan(0.1); // <0.1ms per triple generation
    });

    it("should check mapping existence in <0.01ms", () => {
      const iterations = 10000;
      const startTime = performance.now();

      for (let i = 0; i < iterations; i++) {
        mapper.hasMappingFor("exo__Instance_class");
        mapper.hasMappingFor("ems__Task_size"); // No mapping
      }

      const endTime = performance.now();
      const avgDuration = (endTime - startTime) / iterations / 2; // 2 calls per iteration

      expect(avgDuration).toBeLessThan(0.01); // <0.01ms per check
    });
  });

  describe("Memory Usage (Conceptual)", () => {
    it("should not significantly increase memory with RDF/RDFS triples", async () => {
      // Baseline: store 100 assets with ExoRDF predicates only
      const baselineAssets = 100;
      for (let i = 0; i < baselineAssets; i++) {
        const assetURI = new IRI(
          `https://exocortex.my/ontology/ems/baseline-${i}`,
        );
        await store.add(
          new Triple(
            assetURI,
            Namespace.EXO.term("Instance_class"),
            Namespace.EMS.term("Task"),
          ),
        );
      }

      const baselineSize = (await store.match(undefined, undefined, undefined))
        .length;

      // Add RDF/RDFS mapped triples for same assets
      for (let i = 0; i < baselineAssets; i++) {
        const assetURI = new IRI(
          `https://exocortex.my/ontology/ems/baseline-${i}`,
        );
        await store.add(
          new Triple(assetURI, Namespace.RDF.term("type"), Namespace.EMS.term("Task")),
        );
      }

      const withMappingSize = (await store.match(undefined, undefined, undefined))
        .length;

      // Memory increase should be exactly 100 triples (100% increase, but that's expected for dual representation)
      expect(withMappingSize).toBe(baselineSize + 100);
      expect(withMappingSize / baselineSize).toBeLessThanOrEqual(2.5); // <2.5x increase
    });
  });

  describe("Deduplication Performance", () => {
    it("should deduplicate triples efficiently", async () => {
      const triple = new Triple(
        Namespace.EMS.term("Task"),
        Namespace.RDFS.term("subClassOf"),
        Namespace.EXO.term("Asset"),
      );

      // Add same triple 1000 times
      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        await store.add(triple);
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should deduplicate and store only once
      const results = await store.match(
        Namespace.EMS.term("Task"),
        Namespace.RDFS.term("subClassOf"),
        Namespace.EXO.term("Asset"),
      );

      expect(results.length).toBe(1);
      expect(duration).toBeLessThan(100); // <100ms for 1000 deduplication checks
    });
  });
});
