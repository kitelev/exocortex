import { SourceAnnotator, SOURCE_VARIABLE, DEPTH_VARIABLE } from "../../../src/services/SourceAnnotator";
import { INFERRED_GRAPH, inferredGraphForDepth } from "../../../src/services/PrototypeChainMaterializer";
import { PrototypeChainMaterializer } from "../../../src/services/PrototypeChainMaterializer";
import { NonInheritablePropertyRegistry } from "../../../src/services/NonInheritablePropertyRegistry";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { SolutionMapping } from "../../../src/infrastructure/sparql/SolutionMapping";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

describe("SourceAnnotator", () => {
  let store: InMemoryTripleStore;
  let annotator: SourceAnnotator;

  // Predicates
  const prototype = Namespace.EXO.term("Asset_prototype");
  const assetLabel = Namespace.EXO.term("Asset_label");
  const assetUid = Namespace.EXO.term("Asset_uid");
  const effortArea = Namespace.EMS.term("Effort_area");
  const effortTimeEstimate = Namespace.EMS.term("Effort_timeEstimateMinutes");

  // Subjects
  const breakfastProto = new IRI("obsidian://vault/Breakfast.md");
  const breakfastInstance = new IRI("obsidian://vault/Breakfast-2026-04-05.md");

  // Objects
  const healthArea = new IRI("obsidian://vault/Health.md");

  beforeEach(() => {
    store = new InMemoryTripleStore();
    annotator = new SourceAnnotator(store);
  });

  describe("annotate", () => {
    it("should return 'own' for directly asserted triples", async () => {
      // Add a triple only to default graph (own)
      await store.add(new Triple(breakfastInstance, effortArea, healthArea));

      const solution = new SolutionMapping();
      solution.set("s", breakfastInstance);
      solution.set("p", effortArea);
      solution.set("o", healthArea);

      const results = await annotator.annotate([solution], "s", "p", "o");

      expect(results).toHaveLength(1);
      const source = results[0].get(SOURCE_VARIABLE);
      expect(source).toBeInstanceOf(Literal);
      expect((source as Literal).value).toBe("own");
    });

    it("should return 'inherited' for materialized triples", async () => {
      // Add triple to both default and inferred graph (materialized)
      const triple = new Triple(breakfastInstance, effortArea, healthArea);
      await store.add(triple);
      await store.addToGraph(triple, INFERRED_GRAPH);

      const solution = new SolutionMapping();
      solution.set("s", breakfastInstance);
      solution.set("p", effortArea);
      solution.set("o", healthArea);

      const results = await annotator.annotate([solution], "s", "p", "o");

      expect(results).toHaveLength(1);
      const source = results[0].get(SOURCE_VARIABLE);
      expect(source).toBeInstanceOf(Literal);
      expect((source as Literal).value).toBe("inherited");
    });

    it("should handle multiple solutions with mixed sources", async () => {
      // Own triple
      await store.add(new Triple(breakfastInstance, assetLabel, new Literal("Breakfast")));

      // Inherited triple
      const inheritedTriple = new Triple(breakfastInstance, effortArea, healthArea);
      await store.add(inheritedTriple);
      await store.addToGraph(inheritedTriple, INFERRED_GRAPH);

      const ownSolution = new SolutionMapping();
      ownSolution.set("s", breakfastInstance);
      ownSolution.set("p", assetLabel);
      ownSolution.set("o", new Literal("Breakfast"));

      const inheritedSolution = new SolutionMapping();
      inheritedSolution.set("s", breakfastInstance);
      inheritedSolution.set("p", effortArea);
      inheritedSolution.set("o", healthArea);

      const results = await annotator.annotate(
        [ownSolution, inheritedSolution],
        "s", "p", "o",
      );

      expect(results).toHaveLength(2);
      expect((results[0].get(SOURCE_VARIABLE) as Literal).value).toBe("own");
      expect((results[1].get(SOURCE_VARIABLE) as Literal).value).toBe("inherited");
    });

    it("should default to 'own' when bindings are missing", async () => {
      const solution = new SolutionMapping();
      solution.set("s", breakfastInstance);
      // Missing "p" and "o"

      const results = await annotator.annotate([solution], "s", "p", "o");

      expect(results).toHaveLength(1);
      expect((results[0].get(SOURCE_VARIABLE) as Literal).value).toBe("own");
    });

    it("should preserve existing bindings in annotated results", async () => {
      await store.add(new Triple(breakfastInstance, effortArea, healthArea));

      const solution = new SolutionMapping();
      solution.set("s", breakfastInstance);
      solution.set("p", effortArea);
      solution.set("o", healthArea);
      solution.set("extra", new Literal("keep-me"));

      const results = await annotator.annotate([solution], "s", "p", "o");

      expect(results[0].get("s")).toEqual(breakfastInstance);
      expect(results[0].get("p")).toEqual(effortArea);
      expect(results[0].get("o")).toEqual(healthArea);
      expect(results[0].get("extra")).toEqual(new Literal("keep-me"));
      expect(results[0].has(SOURCE_VARIABLE)).toBe(true);
    });

    it("should not mutate original solution mappings", async () => {
      await store.add(new Triple(breakfastInstance, effortArea, healthArea));

      const solution = new SolutionMapping();
      solution.set("s", breakfastInstance);
      solution.set("p", effortArea);
      solution.set("o", healthArea);

      await annotator.annotate([solution], "s", "p", "o");

      // Original should NOT have _source
      expect(solution.has(SOURCE_VARIABLE)).toBe(false);
    });

    it("should handle empty solutions array", async () => {
      const results = await annotator.annotate([], "s", "p", "o");
      expect(results).toHaveLength(0);
    });
  });

  describe("annotateSingle", () => {
    it("should annotate a single solution mapping", async () => {
      await store.add(new Triple(breakfastInstance, effortArea, healthArea));

      const solution = new SolutionMapping();
      solution.set("s", breakfastInstance);
      solution.set("p", effortArea);
      solution.set("o", healthArea);

      const result = await annotator.annotateSingle(solution, "s", "p", "o");

      expect((result.get(SOURCE_VARIABLE) as Literal).value).toBe("own");
    });
  });

  describe("determineSource", () => {
    it("should return 'own' when triple is not in inferred graph", async () => {
      await store.add(new Triple(breakfastInstance, effortArea, healthArea));

      const source = await annotator.determineSource(
        breakfastInstance,
        effortArea,
        healthArea,
      );

      expect(source).toBe("own");
    });

    it("should return 'inherited' when triple is in inferred graph", async () => {
      const triple = new Triple(breakfastInstance, effortArea, healthArea);
      await store.add(triple);
      await store.addToGraph(triple, INFERRED_GRAPH);

      const source = await annotator.determineSource(
        breakfastInstance,
        effortArea,
        healthArea,
      );

      expect(source).toBe("inherited");
    });
  });

  describe("annotateBySubject", () => {
    it("should return 'own' for subjects with no inferred triples", async () => {
      await store.add(new Triple(breakfastInstance, assetLabel, new Literal("Breakfast")));

      const solution = new SolutionMapping();
      solution.set("s", breakfastInstance);

      const results = await annotator.annotateBySubject([solution], "s");

      expect(results).toHaveLength(1);
      expect((results[0].get(SOURCE_VARIABLE) as Literal).value).toBe("own");
    });

    it("should return 'inherited' for subjects with inferred triples", async () => {
      const triple = new Triple(breakfastInstance, effortArea, healthArea);
      await store.add(triple);
      await store.addToGraph(triple, INFERRED_GRAPH);

      const solution = new SolutionMapping();
      solution.set("s", breakfastInstance);

      const results = await annotator.annotateBySubject([solution], "s");

      expect(results).toHaveLength(1);
      expect((results[0].get(SOURCE_VARIABLE) as Literal).value).toBe("inherited");
    });

    it("should cache subject lookups for performance", async () => {
      await store.add(new Triple(breakfastInstance, assetLabel, new Literal("Breakfast")));

      const sol1 = new SolutionMapping();
      sol1.set("s", breakfastInstance);
      const sol2 = new SolutionMapping();
      sol2.set("s", breakfastInstance);

      // Spy on matchInGraph
      const spy = jest.spyOn(store, "matchInGraph");

      await annotator.annotateBySubject([sol1, sol2], "s");

      // Should only call matchInGraph once due to caching
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("should default to 'own' for non-IRI subjects", async () => {
      const solution = new SolutionMapping();
      solution.set("s", new Literal("not-an-iri"));

      const results = await annotator.annotateBySubject([solution], "s");

      expect((results[0].get(SOURCE_VARIABLE) as Literal).value).toBe("own");
    });
  });

  describe("integration with PrototypeChainMaterializer", () => {
    let materializer: PrototypeChainMaterializer;
    let registry: NonInheritablePropertyRegistry;

    const nonInheritableClassIRI = new IRI("obsidian://vault/exo__NonInheritableProperty.md");
    const instanceClass = Namespace.EXO.term("Instance_class");

    beforeEach(async () => {
      registry = new NonInheritablePropertyRegistry();

      // Setup registry with standard non-inheritable properties
      const registryStore = new InMemoryTripleStore();
      await registryStore.add(
        new Triple(nonInheritableClassIRI, assetLabel, new Literal("exo__NonInheritableProperty")),
      );
      for (const propLabel of ["exo__Asset_uid", "exo__Asset_label", "exo__Asset_prototype"]) {
        const defIRI = new IRI(`obsidian://vault/${propLabel}.md`);
        await registryStore.add(new Triple(defIRI, instanceClass, nonInheritableClassIRI));
        await registryStore.add(new Triple(defIRI, assetLabel, new Literal(propLabel)));
      }
      await registry.initialize(registryStore);

      materializer = new PrototypeChainMaterializer(registry);
    });

    it("should correctly distinguish own vs inherited after materialization", async () => {
      // Setup prototype with inheritable property
      await store.add(new Triple(breakfastProto, effortArea, healthArea));
      await store.add(new Triple(breakfastProto, effortTimeEstimate, new Literal("15")));
      await store.add(new Triple(breakfastProto, assetLabel, new Literal("Breakfast Proto")));

      // Setup instance with prototype link and own label
      await store.add(new Triple(breakfastInstance, prototype, breakfastProto));
      await store.add(new Triple(breakfastInstance, assetLabel, new Literal("Breakfast Instance")));
      await store.add(new Triple(breakfastInstance, assetUid, new Literal("uid-123")));

      // Materialize
      const materialized = await materializer.materialize(store);
      expect(materialized).toBe(2); // area + timeEstimate

      // Now annotate: own label should be "own", inherited area should be "inherited"
      const ownSolution = new SolutionMapping();
      ownSolution.set("s", breakfastInstance);
      ownSolution.set("p", assetLabel);
      ownSolution.set("o", new Literal("Breakfast Instance"));

      const inheritedAreaSolution = new SolutionMapping();
      inheritedAreaSolution.set("s", breakfastInstance);
      inheritedAreaSolution.set("p", effortArea);
      inheritedAreaSolution.set("o", healthArea);

      const inheritedTimeSolution = new SolutionMapping();
      inheritedTimeSolution.set("s", breakfastInstance);
      inheritedTimeSolution.set("p", effortTimeEstimate);
      inheritedTimeSolution.set("o", new Literal("15"));

      const results = await annotator.annotate(
        [ownSolution, inheritedAreaSolution, inheritedTimeSolution],
        "s", "p", "o",
      );

      expect(results).toHaveLength(3);
      expect((results[0].get(SOURCE_VARIABLE) as Literal).value).toBe("own");
      expect((results[1].get(SOURCE_VARIABLE) as Literal).value).toBe("inherited");
      expect((results[2].get(SOURCE_VARIABLE) as Literal).value).toBe("inherited");
    });

    it("should return 'own' for properties that override prototype", async () => {
      // Prototype has area
      await store.add(new Triple(breakfastProto, effortArea, healthArea));

      // Instance overrides with its own area
      const fitnessArea = new IRI("obsidian://vault/Fitness.md");
      await store.add(new Triple(breakfastInstance, prototype, breakfastProto));
      await store.add(new Triple(breakfastInstance, effortArea, fitnessArea));

      // Materialize (should not materialize area since instance already has it)
      const materialized = await materializer.materialize(store);
      expect(materialized).toBe(0);

      // Annotate
      const solution = new SolutionMapping();
      solution.set("s", breakfastInstance);
      solution.set("p", effortArea);
      solution.set("o", fitnessArea);

      const results = await annotator.annotate([solution], "s", "p", "o");

      expect((results[0].get(SOURCE_VARIABLE) as Literal).value).toBe("own");
    });
  });

  describe("getInheritanceDepth", () => {
    it("should return 0 for own triples (not in any inferred graph)", async () => {
      await store.add(new Triple(breakfastInstance, effortArea, healthArea));

      const depth = await annotator.getInheritanceDepth(
        breakfastInstance,
        effortArea,
        healthArea,
      );

      expect(depth).toBe(0);
    });

    it("should return 1 for depth-1 inherited triples", async () => {
      const triple = new Triple(breakfastInstance, effortArea, healthArea);
      await store.add(triple);
      await store.addToGraph(triple, INFERRED_GRAPH);
      await store.addToGraph(triple, inferredGraphForDepth(1));

      const depth = await annotator.getInheritanceDepth(
        breakfastInstance,
        effortArea,
        healthArea,
      );

      expect(depth).toBe(1);
    });

    it("should return 2 for depth-2 inherited triples", async () => {
      const triple = new Triple(breakfastInstance, effortArea, healthArea);
      await store.add(triple);
      await store.addToGraph(triple, INFERRED_GRAPH);
      await store.addToGraph(triple, inferredGraphForDepth(2));

      const depth = await annotator.getInheritanceDepth(
        breakfastInstance,
        effortArea,
        healthArea,
      );

      expect(depth).toBe(2);
    });

    it("should work with PrototypeChainMaterializer depth-1", async () => {
      const registry = new NonInheritablePropertyRegistry();
      const registryStore = new InMemoryTripleStore();
      const nonInheritableClassIRI = new IRI("obsidian://vault/exo__NonInheritableProperty.md");
      await registryStore.add(
        new Triple(nonInheritableClassIRI, assetLabel, new Literal("exo__NonInheritableProperty")),
      );
      for (const propLabel of ["exo__Asset_uid", "exo__Asset_label", "exo__Asset_prototype"]) {
        const defIRI = new IRI(`obsidian://vault/${propLabel}.md`);
        await registryStore.add(new Triple(defIRI, Namespace.EXO.term("Instance_class"), nonInheritableClassIRI));
        await registryStore.add(new Triple(defIRI, assetLabel, new Literal(propLabel)));
      }
      await registry.initialize(registryStore);

      // Setup: breakfastInstance → breakfastProto (depth 1)
      await store.add(new Triple(breakfastProto, effortArea, healthArea));
      await store.add(new Triple(breakfastInstance, Namespace.EXO.term("Asset_prototype"), breakfastProto));

      const materializer = new PrototypeChainMaterializer(registry);
      await materializer.materialize(store);

      const depth = await annotator.getInheritanceDepth(
        breakfastInstance,
        effortArea,
        healthArea,
      );

      expect(depth).toBe(1);
    });

    it("should work with PrototypeChainMaterializer depth-2", async () => {
      const registry = new NonInheritablePropertyRegistry();
      const registryStore = new InMemoryTripleStore();
      const nonInheritableClassIRI = new IRI("obsidian://vault/exo__NonInheritableProperty.md");
      await registryStore.add(
        new Triple(nonInheritableClassIRI, assetLabel, new Literal("exo__NonInheritableProperty")),
      );
      for (const propLabel of ["exo__Asset_uid", "exo__Asset_label", "exo__Asset_prototype"]) {
        const defIRI = new IRI(`obsidian://vault/${propLabel}.md`);
        await registryStore.add(new Triple(defIRI, Namespace.EXO.term("Instance_class"), nonInheritableClassIRI));
        await registryStore.add(new Triple(defIRI, assetLabel, new Literal(propLabel)));
      }
      await registry.initialize(registryStore);

      // Setup: breakfastInstance → breakfastProto → morningProto (depth 2)
      const morningProto = new IRI("obsidian://vault/MorningRoutine.md");
      const effortParent = Namespace.EMS.term("Effort_parent");
      const routineParent = new IRI("obsidian://vault/Routine.md");

      await store.add(new Triple(breakfastProto, effortArea, healthArea));
      await store.add(new Triple(breakfastProto, Namespace.EXO.term("Asset_prototype"), morningProto));
      await store.add(new Triple(morningProto, effortParent, routineParent));
      await store.add(new Triple(breakfastInstance, Namespace.EXO.term("Asset_prototype"), breakfastProto));

      const materializer = new PrototypeChainMaterializer(registry);
      await materializer.materialize(store);

      // area from depth-1 (breakfastProto)
      const areaDepth = await annotator.getInheritanceDepth(
        breakfastInstance,
        effortArea,
        healthArea,
      );
      expect(areaDepth).toBe(1);

      // parent from depth-2 (morningProto)
      const parentDepth = await annotator.getInheritanceDepth(
        breakfastInstance,
        effortParent,
        routineParent,
      );
      expect(parentDepth).toBe(2);
    });
  });

  describe("DEPTH_VARIABLE constant", () => {
    it("should be exported and equal to '_depth'", () => {
      expect(DEPTH_VARIABLE).toBe("_depth");
    });
  });

  describe("edge cases", () => {
    it("should handle Literal objects in triple matching", async () => {
      const literalObj = new Literal("hello");
      const triple = new Triple(breakfastInstance, assetLabel, literalObj);
      await store.add(triple);
      await store.addToGraph(triple, INFERRED_GRAPH);

      const source = await annotator.determineSource(
        breakfastInstance,
        assetLabel,
        literalObj,
      );

      expect(source).toBe("inherited");
    });

    it("should handle typed literals correctly", async () => {
      const xsdInt = new IRI("http://www.w3.org/2001/XMLSchema#integer");
      const typedLiteral = new Literal("42", xsdInt);
      const triple = new Triple(breakfastInstance, effortTimeEstimate, typedLiteral);
      await store.add(triple);

      const source = await annotator.determineSource(
        breakfastInstance,
        effortTimeEstimate,
        typedLiteral,
      );

      expect(source).toBe("own");
    });

    it("should return 'own' when triple exists only in default graph", async () => {
      await store.add(new Triple(breakfastInstance, effortArea, healthArea));

      // Add a DIFFERENT triple to inferred graph (not the same one)
      await store.addToGraph(
        new Triple(breakfastInstance, assetLabel, new Literal("other")),
        INFERRED_GRAPH,
      );

      const source = await annotator.determineSource(
        breakfastInstance,
        effortArea,
        healthArea,
      );

      expect(source).toBe("own");
    });
  });
});
