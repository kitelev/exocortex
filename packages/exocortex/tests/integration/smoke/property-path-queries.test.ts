/**
 * Integration test: Property path queries with realistic data (RFC-013).
 *
 * Verifies property paths against a vault-like data model:
 * - Area hierarchy traversal (parent+)
 * - Full prototype chain query (prototype*)
 * - Inverse lookups (^prototype)
 * - Alternative paths (parent|relates)
 *
 * Issue #2595: Integration tests property paths
 */

import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { SPARQLParser } from "../../../src/infrastructure/sparql/SPARQLParser";
import { ExoQLAlgebraTranslator } from "../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { ExoQLQueryExecutor } from "../../../src/infrastructure/sparql/executors/QueryExecutor";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

describe("Integration: Property Path Queries (RFC-013)", () => {
  let store: InMemoryTripleStore;
  let parser: SPARQLParser;
  let translator: ExoQLAlgebraTranslator;

  const parentPred = Namespace.EMS.term("Effort_parent");
  const prototypePred = Namespace.EXO.term("Asset_prototype");
  const relatesPred = Namespace.EXO.term("Asset_relates");
  const labelPred = Namespace.EXO.term("Asset_label");
  const areaPred = Namespace.EMS.term("Effort_area");

  // Area hierarchy: Life → Health → Nutrition → Breakfast
  const lifeArea = new IRI("urn:vault:Life.md");
  const healthArea = new IRI("urn:vault:Health.md");
  const nutritionArea = new IRI("urn:vault:Nutrition.md");
  const breakfastArea = new IRI("urn:vault:Breakfast-Area.md");

  // Prototype chain: breakfastInst → breakfastProto → morningProto
  const morningProto = new IRI("urn:vault:MorningRoutine.md");
  const breakfastProto = new IRI("urn:vault:Breakfast.md");
  const breakfastInst = new IRI("urn:vault:Breakfast-2026-04-06.md");
  const lunchProto = new IRI("urn:vault:Lunch.md");
  const lunchInst = new IRI("urn:vault:Lunch-2026-04-06.md");

  // Relations
  const relatedProject = new IRI("urn:vault:MealPlan.md");

  async function queryValues(sparql: string, variable: string): Promise<string[]> {
    const ast = parser.parse(sparql);
    const algebra = translator.translate(ast);
    const executor = new ExoQLQueryExecutor(store);
    const solutions = await executor.executeAll(algebra);

    return solutions
      .map((sol) => {
        const val = sol.get(variable);
        if (val instanceof IRI) return val.value;
        if (val instanceof Literal) return val.value;
        return undefined;
      })
      .filter((v): v is string => v !== undefined);
  }

  beforeEach(async () => {
    store = new InMemoryTripleStore();
    parser = new SPARQLParser();
    translator = new ExoQLAlgebraTranslator();

    // Area hierarchy
    await store.addAll([
      new Triple(healthArea, parentPred, lifeArea),
      new Triple(nutritionArea, parentPred, healthArea),
      new Triple(breakfastArea, parentPred, nutritionArea),
      // Labels
      new Triple(lifeArea, labelPred, new Literal("Life")),
      new Triple(healthArea, labelPred, new Literal("Health")),
      new Triple(nutritionArea, labelPred, new Literal("Nutrition")),
      new Triple(breakfastArea, labelPred, new Literal("Breakfast Area")),
    ]);

    // Prototype chain
    await store.addAll([
      new Triple(breakfastInst, prototypePred, breakfastProto),
      new Triple(breakfastProto, prototypePred, morningProto),
      new Triple(lunchInst, prototypePred, lunchProto),
      // Labels
      new Triple(morningProto, labelPred, new Literal("Morning Routine")),
      new Triple(breakfastProto, labelPred, new Literal("Breakfast")),
      new Triple(breakfastInst, labelPred, new Literal("Breakfast 2026-04-06")),
      new Triple(lunchProto, labelPred, new Literal("Lunch")),
      new Triple(lunchInst, labelPred, new Literal("Lunch 2026-04-06")),
      // Areas
      new Triple(breakfastProto, areaPred, nutritionArea),
      new Triple(morningProto, areaPred, healthArea),
    ]);

    // Relations
    await store.addAll([
      new Triple(breakfastProto, relatesPred, relatedProject),
      new Triple(nutritionArea, relatesPred, healthArea),
    ]);
  });

  it("AC: ?task ems:Effort_parent+ ?root finds all ancestors", async () => {
    const ancestors = await queryValues(`
      PREFIX ems: <https://exocortex.my/ontology/ems#>
      SELECT ?ancestor WHERE {
        <urn:vault:Breakfast-Area.md> ems:Effort_parent+ ?ancestor .
      }
    `, "ancestor");

    // Breakfast-Area → Nutrition → Health → Life
    expect(ancestors).toHaveLength(3);
    expect(ancestors).toContain("urn:vault:Nutrition.md");
    expect(ancestors).toContain("urn:vault:Health.md");
    expect(ancestors).toContain("urn:vault:Life.md");
  });

  it("AC: ?instance exo:Asset_prototype* ?proto includes self + all prototypes", async () => {
    const chain = await queryValues(`
      PREFIX exo: <https://exocortex.my/ontology/exo#>
      SELECT ?proto WHERE {
        <urn:vault:Breakfast-2026-04-06.md> exo:Asset_prototype* ?proto .
      }
    `, "proto");

    // Self + breakfastProto + morningProto
    expect(chain).toHaveLength(3);
    expect(chain).toContain("urn:vault:Breakfast-2026-04-06.md"); // self
    expect(chain).toContain("urn:vault:Breakfast.md");
    expect(chain).toContain("urn:vault:MorningRoutine.md");
  });

  it("AC: ?proto ^exo:Asset_prototype ?instance finds all instances of a prototype", async () => {
    const instances = await queryValues(`
      PREFIX exo: <https://exocortex.my/ontology/exo#>
      SELECT ?instance WHERE {
        <urn:vault:Breakfast.md> ^exo:Asset_prototype ?instance .
      }
    `, "instance");

    expect(instances).toHaveLength(1);
    expect(instances).toContain("urn:vault:Breakfast-2026-04-06.md");
  });

  it("AC: ?s (ems:Effort_parent|exo:Asset_relates) ?related finds both", async () => {
    const related = await queryValues(`
      PREFIX ems: <https://exocortex.my/ontology/ems#>
      PREFIX exo: <https://exocortex.my/ontology/exo#>
      SELECT ?related WHERE {
        <urn:vault:Nutrition.md> (ems:Effort_parent|exo:Asset_relates) ?related .
      }
    `, "related");

    // parent → Health, relates → Health (may deduplicate or not)
    expect(related).toContain("urn:vault:Health.md");
  });

  it("should traverse area hierarchy and get labels via sequence path", async () => {
    const labels = await queryValues(`
      PREFIX ems: <https://exocortex.my/ontology/ems#>
      PREFIX exo: <https://exocortex.my/ontology/exo#>
      SELECT ?label WHERE {
        <urn:vault:Breakfast-Area.md> ems:Effort_parent+/exo:Asset_label ?label .
      }
    `, "label");

    expect(labels).toContain("Nutrition");
    expect(labels).toContain("Health");
    expect(labels).toContain("Life");
  });

  it("should find all descendants via ^parent+", async () => {
    const descendants = await queryValues(`
      PREFIX ems: <https://exocortex.my/ontology/ems#>
      SELECT ?desc WHERE {
        <urn:vault:Life.md> ^ems:Effort_parent+ ?desc .
      }
    `, "desc");

    // Health, Nutrition, Breakfast-Area
    expect(descendants).toHaveLength(3);
    expect(descendants).toContain("urn:vault:Health.md");
    expect(descendants).toContain("urn:vault:Nutrition.md");
    expect(descendants).toContain("urn:vault:Breakfast-Area.md");
  });

  it("should resolve prototype chain with optional depth via prototype?", async () => {
    const results = await queryValues(`
      PREFIX exo: <https://exocortex.my/ontology/exo#>
      SELECT ?proto WHERE {
        <urn:vault:Breakfast-2026-04-06.md> exo:Asset_prototype? ?proto .
      }
    `, "proto");

    // Self + direct prototype only (not transitive)
    expect(results).toContain("urn:vault:Breakfast-2026-04-06.md"); // zero steps
    expect(results).toContain("urn:vault:Breakfast.md");             // one step
    expect(results).not.toContain("urn:vault:MorningRoutine.md");   // two steps
  });

  it("should combine prototype traversal with area lookup via sequence", async () => {
    const areas = await queryValues(`
      PREFIX exo: <https://exocortex.my/ontology/exo#>
      PREFIX ems: <https://exocortex.my/ontology/ems#>
      SELECT ?area WHERE {
        <urn:vault:Breakfast-2026-04-06.md> exo:Asset_prototype+/ems:Effort_area ?area .
      }
    `, "area");

    // breakfastProto.area = Nutrition, morningProto.area = Health
    expect(areas).toContain("urn:vault:Nutrition.md");
    expect(areas).toContain("urn:vault:Health.md");
  });
});
