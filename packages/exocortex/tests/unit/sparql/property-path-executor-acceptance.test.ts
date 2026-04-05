/**
 * Acceptance criteria verification for Issue #2594:
 * BFS executor for transitive property paths (p+, p*)
 *
 * Verifies PropertyPathExecutor correctness for all 6 operators
 * with cycle detection against real triple store.
 *
 * NOTE: The full PropertyPathExecutor was implemented in a prior RFC.
 * This test explicitly verifies each acceptance criterion from Issue #2594.
 */

import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { SPARQLParser } from "../../../src/infrastructure/sparql/SPARQLParser";
import { ExoQLAlgebraTranslator } from "../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { ExoQLQueryExecutor } from "../../../src/infrastructure/sparql/executors/QueryExecutor";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

describe("Issue #2594: BFS executor for transitive property paths", () => {
  let store: InMemoryTripleStore;
  let parser: SPARQLParser;
  let translator: ExoQLAlgebraTranslator;

  // Build a tree: root → A → A1, A2; root → B → B1
  const root = new IRI("urn:exo:root");
  const nodeA = new IRI("urn:exo:A");
  const nodeB = new IRI("urn:exo:B");
  const nodeA1 = new IRI("urn:exo:A1");
  const nodeA2 = new IRI("urn:exo:A2");
  const nodeB1 = new IRI("urn:exo:B1");
  const parentPred = Namespace.EMS.term("Effort_parent");
  const relatesPred = Namespace.EXO.term("Asset_relates");
  const labelPred = Namespace.EXO.term("Asset_label");

  beforeEach(async () => {
    store = new InMemoryTripleStore();
    parser = new SPARQLParser();
    translator = new ExoQLAlgebraTranslator();

    // Parent hierarchy: A1→A→root, A2→A→root, B1→B→root
    await store.addAll([
      new Triple(nodeA1, parentPred, nodeA),
      new Triple(nodeA2, parentPred, nodeA),
      new Triple(nodeA, parentPred, root),
      new Triple(nodeB1, parentPred, nodeB),
      new Triple(nodeB, parentPred, root),
      // Labels
      new Triple(root, labelPred, new Literal("Root")),
      new Triple(nodeA, labelPred, new Literal("A")),
      new Triple(nodeB, labelPred, new Literal("B")),
      new Triple(nodeA1, labelPred, new Literal("A1")),
      // Relates (for alternative path testing)
      new Triple(nodeA, relatesPred, nodeB),
    ]);
  });

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

  describe("AC: p+ iterative expansion with visited set", () => {
    it("should find all ancestors via parent+", async () => {
      const ancestors = await queryValues(`
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        SELECT ?ancestor WHERE {
          <urn:exo:A1> ems:Effort_parent+ ?ancestor .
        }
      `, "ancestor");

      expect(ancestors).toContain("urn:exo:A");
      expect(ancestors).toContain("urn:exo:root");
      expect(ancestors).not.toContain("urn:exo:A1"); // p+ excludes start
    });
  });

  describe("AC: p* includes starting node", () => {
    it("should include self + all ancestors via parent*", async () => {
      const nodes = await queryValues(`
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        SELECT ?node WHERE {
          <urn:exo:A1> ems:Effort_parent* ?node .
        }
      `, "node");

      expect(nodes).toContain("urn:exo:A1"); // p* includes start
      expect(nodes).toContain("urn:exo:A");
      expect(nodes).toContain("urn:exo:root");
    });
  });

  describe("AC: p? optional single step", () => {
    it("should return self + direct parent via parent?", async () => {
      const nodes = await queryValues(`
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        SELECT ?node WHERE {
          <urn:exo:A1> ems:Effort_parent? ?node .
        }
      `, "node");

      expect(nodes).toContain("urn:exo:A1"); // zero steps
      expect(nodes).toContain("urn:exo:A");  // one step
      expect(nodes).not.toContain("urn:exo:root"); // two steps excluded
    });
  });

  describe("AC: ^p reverse direction", () => {
    it("should find children via ^parent", async () => {
      const children = await queryValues(`
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        SELECT ?child WHERE {
          <urn:exo:A> ^ems:Effort_parent ?child .
        }
      `, "child");

      expect(children).toContain("urn:exo:A1");
      expect(children).toContain("urn:exo:A2");
      expect(children).not.toContain("urn:exo:B1");
    });
  });

  describe("AC: p/q sequence", () => {
    it("should follow parent then label", async () => {
      const labels = await queryValues(`
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?label WHERE {
          <urn:exo:A1> ems:Effort_parent/exo:Asset_label ?label .
        }
      `, "label");

      expect(labels).toContain("A"); // A1 → A → "A"
    });
  });

  describe("AC: p|q alternative", () => {
    it("should match parent OR relates", async () => {
      const related = await queryValues(`
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?related WHERE {
          <urn:exo:A> (ems:Effort_parent|exo:Asset_relates) ?related .
        }
      `, "related");

      expect(related).toContain("urn:exo:root"); // via parent
      expect(related).toContain("urn:exo:B");     // via relates
    });
  });

  describe("AC: cycle detection", () => {
    it("should terminate on cyclic graph without infinite loop", async () => {
      // Add cycle: root → A (already exists as A→root)
      await store.add(new Triple(root, parentPred, nodeA));

      const ancestors = await queryValues(`
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        SELECT ?ancestor WHERE {
          <urn:exo:A1> ems:Effort_parent+ ?ancestor .
        }
      `, "ancestor");

      expect(ancestors).toContain("urn:exo:A");
      expect(ancestors).toContain("urn:exo:root");
    });
  });

  describe("AC: MAX_PATH_DEPTH safety limit", () => {
    it("should handle deep chain without stack overflow", async () => {
      for (let i = 0; i < 60; i++) {
        await store.add(
          new Triple(
            new IRI(`urn:exo:chain-${i + 1}`),
            parentPred,
            new IRI(`urn:exo:chain-${i}`),
          ),
        );
      }

      const ancestors = await queryValues(`
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        SELECT ?ancestor WHERE {
          <urn:exo:chain-60> ems:Effort_parent+ ?ancestor .
        }
      `, "ancestor");

      expect(ancestors.length).toBeGreaterThan(0);
      expect(ancestors.length).toBeLessThanOrEqual(100);
    });
  });
});
