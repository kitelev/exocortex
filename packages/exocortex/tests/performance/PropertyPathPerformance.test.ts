/**
 * Performance test: Transitive property path closure (RFC-013).
 *
 * Verifies path execution budgets:
 *   - 1000-node linear chain p+: < 100ms
 *   - 100-node tree (branching factor 3) p*: < 100ms
 *   - Cycle in 50-node graph: terminates < 50ms
 *
 * Issue #2596: Performance test transitive closure
 */

import { InMemoryTripleStore } from "../../src/infrastructure/rdf/InMemoryTripleStore";
import { SPARQLParser } from "../../src/infrastructure/sparql/SPARQLParser";
import { ExoQLAlgebraTranslator } from "../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { ExoQLQueryExecutor } from "../../src/infrastructure/sparql/executors/QueryExecutor";
import { Triple } from "../../src/domain/models/rdf/Triple";
import { IRI } from "../../src/domain/models/rdf/IRI";
import { Namespace } from "../../src/domain/models/rdf/Namespace";

const parentPred = Namespace.EMS.term("Effort_parent");

async function executeAndMeasure(
  store: InMemoryTripleStore,
  sparql: string,
): Promise<{ elapsed: number; resultCount: number }> {
  const parser = new SPARQLParser();
  const translator = new ExoQLAlgebraTranslator();
  const ast = parser.parse(sparql);
  const algebra = translator.translate(ast);
  const executor = new ExoQLQueryExecutor(store);

  const start = performance.now();
  const results = await executor.executeAll(algebra);
  const elapsed = performance.now() - start;

  return { elapsed, resultCount: results.length };
}

describe("Property Path Performance (RFC-013)", () => {
  it("1000-node linear chain p+: < 100ms", async () => {
    const store = new InMemoryTripleStore();

    // Build chain: node-1000 → node-999 → ... → node-0
    for (let i = 1; i <= 1000; i++) {
      await store.add(
        new Triple(
          new IRI(`urn:exo:node-${i}`),
          parentPred,
          new IRI(`urn:exo:node-${i - 1}`),
        ),
      );
    }

    // Warm-up
    await executeAndMeasure(store, `
      PREFIX ems: <https://exocortex.my/ontology/ems#>
      SELECT ?ancestor WHERE {
        <urn:exo:node-10> ems:Effort_parent+ ?ancestor .
      }
    `);

    // Timed run: find all ancestors from node-1000
    const { elapsed, resultCount } = await executeAndMeasure(store, `
      PREFIX ems: <https://exocortex.my/ontology/ems#>
      SELECT ?ancestor WHERE {
        <urn:exo:node-1000> ems:Effort_parent+ ?ancestor .
      }
    `);

    // eslint-disable-next-line no-console
    console.log(
      `[perf] 1000-node chain p+: ${elapsed.toFixed(2)}ms ` +
        `(${resultCount} results, threshold: 100ms)`,
    );

    // Note: MAX_PATH_DEPTH=100 caps results, but execution should still be fast
    expect(elapsed).toBeLessThan(100);
  });

  it("100-node tree (branching factor 3) p*: < 100ms", async () => {
    const store = new InMemoryTripleStore();

    // Build tree: root has 3 children, each has 3, each has 3 (4 levels, 121 nodes)
    // Level 0: root (1 node)
    // Level 1: 3 nodes
    // Level 2: 9 nodes
    // Level 3: 27 nodes
    // Level 4: 81 nodes → total 121 nodes
    let nodeId = 0;
    const root = new IRI(`urn:exo:tree-0`);

    async function buildTree(parent: IRI, depth: number): Promise<void> {
      if (depth >= 4) return;
      for (let i = 0; i < 3; i++) {
        nodeId++;
        const child = new IRI(`urn:exo:tree-${nodeId}`);
        await store.add(new Triple(child, parentPred, parent));
        await buildTree(child, depth + 1);
      }
    }

    await buildTree(root, 0);

    // Warm-up
    await executeAndMeasure(store, `
      PREFIX ems: <https://exocortex.my/ontology/ems#>
      SELECT ?desc WHERE {
        <urn:exo:tree-0> ^ems:Effort_parent* ?desc .
      }
    `);

    // Timed: find all descendants of root (p* = zero-or-more via ^parent)
    const { elapsed, resultCount } = await executeAndMeasure(store, `
      PREFIX ems: <https://exocortex.my/ontology/ems#>
      SELECT ?desc WHERE {
        <urn:exo:tree-0> ^ems:Effort_parent* ?desc .
      }
    `);

    // eslint-disable-next-line no-console
    console.log(
      `[perf] 100-node tree p*: ${elapsed.toFixed(2)}ms ` +
        `(${resultCount} results, threshold: 100ms)`,
    );

    expect(resultCount).toBeGreaterThanOrEqual(100);
    expect(elapsed).toBeLessThan(100);
  });

  it("cycle in 50-node graph: terminates < 50ms", async () => {
    const store = new InMemoryTripleStore();

    // Build circular chain: 0→1→2→...→49→0
    for (let i = 0; i < 50; i++) {
      await store.add(
        new Triple(
          new IRI(`urn:exo:cycle-${i}`),
          parentPred,
          new IRI(`urn:exo:cycle-${(i + 1) % 50}`),
        ),
      );
    }

    // Warm-up
    await executeAndMeasure(store, `
      PREFIX ems: <https://exocortex.my/ontology/ems#>
      SELECT ?node WHERE {
        <urn:exo:cycle-0> ems:Effort_parent+ ?node .
      }
    `);

    // Timed: should detect cycle and terminate
    const { elapsed, resultCount } = await executeAndMeasure(store, `
      PREFIX ems: <https://exocortex.my/ontology/ems#>
      SELECT ?node WHERE {
        <urn:exo:cycle-0> ems:Effort_parent+ ?node .
      }
    `);

    // eslint-disable-next-line no-console
    console.log(
      `[perf] 50-node cycle p+: ${elapsed.toFixed(2)}ms ` +
        `(${resultCount} results, threshold: 50ms)`,
    );

    expect(resultCount).toBeGreaterThan(0);
    expect(resultCount).toBeLessThanOrEqual(50); // cycle detection caps results
    expect(elapsed).toBeLessThan(50);
  });
});
