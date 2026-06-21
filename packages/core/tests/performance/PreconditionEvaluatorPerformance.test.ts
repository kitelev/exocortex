/**
 * Performance regression test for PreconditionEvaluator compiled ASK cache.
 *
 * Verifies that 27 distinct compiled SPARQL ASK queries complete
 * within 50ms total on a 10K triple store.
 *
 * Issue #2497: Performance test — 27 ASK queries < 50ms
 * Depends on Issue #2496 (compiled SPARQL ASK cache).
 */

import { PreconditionEvaluator } from "../../src/services/PreconditionEvaluator";
import { InMemoryTripleStore } from "../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../src/domain/models/rdf/Triple";
import { IRI } from "../../src/domain/models/rdf/IRI";
import { Literal } from "../../src/domain/models/rdf/Literal";
import { Namespace } from "../../src/domain/models/rdf/Namespace";
import type { PreconditionDefinition } from "../../src/domain/models/CommandDefinition";

/**
 * 27 distinct ASK queries representative of real-world preconditions.
 *
 * Categories:
 * - Status checks (6): Effort status transitions
 * - Property existence (6): Has timestamp, label, etc.
 * - Type checks (5): rdf:type assertions
 * - Multi-pattern (5): Compound BGP patterns
 * - Negation via pattern (5): Checks specific value matches
 */
function buildDistinctPreconditions(): PreconditionDefinition[] {
  return [
    // --- Status checks (6) ---
    {
      id: "pre-status-backlog",
      label: "Status is Backlog",
      sparqlAsk: `PREFIX ems: <https://exocortex.my/ontology/ems#>
        ASK { $target ems:Effort_status "ems__EffortStatusBacklog" }`,
    },
    {
      id: "pre-status-doing",
      label: "Status is Doing",
      sparqlAsk: `PREFIX ems: <https://exocortex.my/ontology/ems#>
        ASK { $target ems:Effort_status "ems__EffortStatusDoing" }`,
    },
    {
      id: "pre-status-done",
      label: "Status is Done",
      sparqlAsk: `PREFIX ems: <https://exocortex.my/ontology/ems#>
        ASK { $target ems:Effort_status "ems__EffortStatusDone" }`,
    },
    {
      id: "pre-status-blocked",
      label: "Status is Blocked",
      sparqlAsk: `PREFIX ems: <https://exocortex.my/ontology/ems#>
        ASK { $target ems:Effort_status "ems__EffortStatusBlocked" }`,
    },
    {
      id: "pre-status-review",
      label: "Status is Review",
      sparqlAsk: `PREFIX ems: <https://exocortex.my/ontology/ems#>
        ASK { $target ems:Effort_status "ems__EffortStatusReview" }`,
    },
    {
      id: "pre-status-cancelled",
      label: "Status is Cancelled",
      sparqlAsk: `PREFIX ems: <https://exocortex.my/ontology/ems#>
        ASK { $target ems:Effort_status "ems__EffortStatusCancelled" }`,
    },

    // --- Property existence (6) ---
    {
      id: "pre-has-start",
      label: "Has startTimestamp",
      sparqlAsk: `PREFIX ems: <https://exocortex.my/ontology/ems#>
        ASK { $target ems:Effort_startTimestamp ?ts }`,
    },
    {
      id: "pre-has-end",
      label: "Has endTimestamp",
      sparqlAsk: `PREFIX ems: <https://exocortex.my/ontology/ems#>
        ASK { $target ems:Effort_endTimestamp ?ts }`,
    },
    {
      id: "pre-has-planned-start",
      label: "Has plannedStartTimestamp",
      sparqlAsk: `PREFIX ems: <https://exocortex.my/ontology/ems#>
        ASK { $target ems:Effort_plannedStartTimestamp ?ts }`,
    },
    {
      id: "pre-has-planned-end",
      label: "Has plannedEndTimestamp",
      sparqlAsk: `PREFIX ems: <https://exocortex.my/ontology/ems#>
        ASK { $target ems:Effort_plannedEndTimestamp ?ts }`,
    },
    {
      id: "pre-has-label",
      label: "Has label",
      sparqlAsk: `PREFIX exo: <https://exocortex.my/ontology/exo#>
        ASK { $target exo:Asset_label ?label }`,
    },
    {
      id: "pre-has-parent",
      label: "Has parent",
      sparqlAsk: `PREFIX ems: <https://exocortex.my/ontology/ems#>
        ASK { $target ems:belongsTo ?parent }`,
    },

    // --- Type checks (5) ---
    {
      id: "pre-is-task",
      label: "Is Task",
      sparqlAsk: `PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        ASK { $target rdf:type ems:Task }`,
    },
    {
      id: "pre-is-project",
      label: "Is Project",
      sparqlAsk: `PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        ASK { $target rdf:type ems:Project }`,
    },
    {
      id: "pre-is-area",
      label: "Is Area",
      sparqlAsk: `PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        ASK { $target rdf:type ems:Area }`,
    },
    {
      id: "pre-is-context",
      label: "Is Context",
      sparqlAsk: `PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        ASK { $target rdf:type ems:Context }`,
    },
    {
      id: "pre-is-layout",
      label: "Is Layout",
      sparqlAsk: `PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        ASK { $target rdf:type exo:Layout }`,
    },

    // --- Multi-pattern compound (5) ---
    {
      id: "pre-task-backlog",
      label: "Task in Backlog",
      sparqlAsk: `PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        ASK {
          $target rdf:type ems:Task .
          $target ems:Effort_status "ems__EffortStatusBacklog" .
        }`,
    },
    {
      id: "pre-task-doing",
      label: "Task in Doing",
      sparqlAsk: `PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        ASK {
          $target rdf:type ems:Task .
          $target ems:Effort_status "ems__EffortStatusDoing" .
        }`,
    },
    {
      id: "pre-task-with-start",
      label: "Task with startTimestamp",
      sparqlAsk: `PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        ASK {
          $target rdf:type ems:Task .
          $target ems:Effort_startTimestamp ?ts .
        }`,
    },
    {
      id: "pre-project-with-label",
      label: "Project with label",
      sparqlAsk: `PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        ASK {
          $target rdf:type ems:Project .
          $target exo:Asset_label ?label .
        }`,
    },
    {
      id: "pre-task-in-project",
      label: "Task belongs to project",
      sparqlAsk: `PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        ASK {
          $target rdf:type ems:Task .
          $target ems:belongsTo ?project .
        }`,
    },

    // --- Specific value matches (5) ---
    {
      id: "pre-size-small",
      label: "Size is 1",
      sparqlAsk: `PREFIX ems: <https://exocortex.my/ontology/ems#>
        ASK { $target ems:Task_size "1" }`,
    },
    {
      id: "pre-size-medium",
      label: "Size is 3",
      sparqlAsk: `PREFIX ems: <https://exocortex.my/ontology/ems#>
        ASK { $target ems:Task_size "3" }`,
    },
    {
      id: "pre-size-large",
      label: "Size is 8",
      sparqlAsk: `PREFIX ems: <https://exocortex.my/ontology/ems#>
        ASK { $target ems:Task_size "8" }`,
    },
    {
      id: "pre-has-uid",
      label: "Has UID",
      sparqlAsk: `PREFIX exo: <https://exocortex.my/ontology/exo#>
        ASK { $target exo:Asset_uid ?uid }`,
    },
    {
      id: "pre-has-prototype",
      label: "Has prototype",
      sparqlAsk: `PREFIX exo: <https://exocortex.my/ontology/exo#>
        ASK { $target exo:Asset_prototype ?proto }`,
    },
  ];
}

/**
 * Populate store with 10K realistic triples.
 *
 * Distribution:
 * - 1000 Task assets (8 triples each  = 8000)
 * - 100 Project assets (4 triples each = 400)
 * - 10 Area assets (3 triples each     = 30)
 * - Remaining triples from contexts + layouts
 *
 * Total ~10K triples.
 */
async function populateStore(store: InMemoryTripleStore): Promise<void> {
  const triples: Triple[] = [];
  const statuses = [
    "ems__EffortStatusBacklog",
    "ems__EffortStatusDoing",
    "ems__EffortStatusDone",
    "ems__EffortStatusBlocked",
    "ems__EffortStatusReview",
    "ems__EffortStatusCancelled",
  ];
  const sizes = ["1", "2", "3", "5", "8", "13"];

  // 1000 Tasks — 8 triples each = 8000 triples
  for (let i = 0; i < 1000; i++) {
    const iri = new IRI(`urn:exo:task-${i}`);
    const projectIri = new IRI(`urn:exo:project-${Math.floor(i / 10)}`);
    const status = statuses[i % statuses.length];
    const size = sizes[i % sizes.length];

    triples.push(
      new Triple(iri, Namespace.RDF.term("type"), Namespace.EMS.term("Task")),
      new Triple(iri, Namespace.EMS.term("Effort_status"), new Literal(status)),
      new Triple(
        iri,
        Namespace.EMS.term("Effort_startTimestamp"),
        new Literal(`2026-01-${String((i % 28) + 1).padStart(2, "0")}T09:00:00`),
      ),
      new Triple(
        iri,
        Namespace.EMS.term("Effort_endTimestamp"),
        new Literal(`2026-01-${String((i % 28) + 1).padStart(2, "0")}T17:00:00`),
      ),
      new Triple(
        iri,
        Namespace.EXO.term("Asset_label"),
        new Literal(`Task ${i}`),
      ),
      new Triple(
        iri,
        Namespace.EXO.term("Asset_uid"),
        new Literal(`uid-task-${i}`),
      ),
      new Triple(iri, Namespace.EMS.term("Task_size"), new Literal(size)),
      new Triple(iri, Namespace.EMS.term("belongsTo"), projectIri),
    );
  }

  // 100 Projects — 4 triples each = 400 triples
  for (let i = 0; i < 100; i++) {
    const iri = new IRI(`urn:exo:project-${i}`);
    const areaIri = new IRI(`urn:exo:area-${Math.floor(i / 10)}`);

    triples.push(
      new Triple(iri, Namespace.RDF.term("type"), Namespace.EMS.term("Project")),
      new Triple(
        iri,
        Namespace.EXO.term("Asset_label"),
        new Literal(`Project ${i}`),
      ),
      new Triple(
        iri,
        Namespace.EXO.term("Asset_uid"),
        new Literal(`uid-project-${i}`),
      ),
      new Triple(iri, Namespace.EMS.term("belongsTo"), areaIri),
    );
  }

  // 10 Areas — 3 triples each = 30 triples
  for (let i = 0; i < 10; i++) {
    const iri = new IRI(`urn:exo:area-${i}`);

    triples.push(
      new Triple(iri, Namespace.RDF.term("type"), Namespace.EMS.term("Area")),
      new Triple(
        iri,
        Namespace.EXO.term("Asset_label"),
        new Literal(`Area ${i}`),
      ),
      new Triple(
        iri,
        Namespace.EXO.term("Asset_uid"),
        new Literal(`uid-area-${i}`),
      ),
    );
  }

  // 50 Contexts — 3 triples each = 150 triples
  for (let i = 0; i < 50; i++) {
    const iri = new IRI(`urn:exo:context-${i}`);

    triples.push(
      new Triple(iri, Namespace.RDF.term("type"), Namespace.EMS.term("Context")),
      new Triple(
        iri,
        Namespace.EXO.term("Asset_label"),
        new Literal(`Context ${i}`),
      ),
      new Triple(
        iri,
        Namespace.EXO.term("Asset_uid"),
        new Literal(`uid-context-${i}`),
      ),
    );
  }

  // 40 Layouts — 3 triples each = 120 triples
  for (let i = 0; i < 40; i++) {
    const iri = new IRI(`urn:exo:layout-${i}`);

    triples.push(
      new Triple(iri, Namespace.RDF.term("type"), Namespace.EXO.term("Layout")),
      new Triple(
        iri,
        Namespace.EXO.term("Asset_label"),
        new Literal(`Layout ${i}`),
      ),
      new Triple(
        iri,
        Namespace.EXO.term("Asset_uid"),
        new Literal(`uid-layout-${i}`),
      ),
    );
  }

  // Planned timestamps for some tasks (500 tasks) — 2 triples each = 1000 triples
  for (let i = 0; i < 500; i++) {
    const iri = new IRI(`urn:exo:task-${i}`);

    triples.push(
      new Triple(
        iri,
        Namespace.EMS.term("Effort_plannedStartTimestamp"),
        new Literal(`2026-02-${String((i % 28) + 1).padStart(2, "0")}T09:00:00`),
      ),
      new Triple(
        iri,
        Namespace.EMS.term("Effort_plannedEndTimestamp"),
        new Literal(`2026-02-${String((i % 28) + 1).padStart(2, "0")}T17:00:00`),
      ),
    );
  }

  // Prototypes for 100 tasks — 1 triple each = 100 triples
  for (let i = 0; i < 100; i++) {
    const iri = new IRI(`urn:exo:task-${i}`);

    triples.push(
      new Triple(
        iri,
        Namespace.EXO.term("Asset_prototype"),
        new IRI(`urn:exo:prototype-${i % 5}`),
      ),
    );
  }

  await store.addAll(triples);
}

describe("PreconditionEvaluator ASK Performance", () => {
  let store: InMemoryTripleStore;
  let evaluator: PreconditionEvaluator;
  let preconditions: PreconditionDefinition[];

  const TARGET_IRI = "urn:exo:task-42";

  // Generous CI threshold; actual execution should be well under this.
  const TOTAL_THRESHOLD_MS = 50;

  beforeAll(async () => {
    store = new InMemoryTripleStore();
    evaluator = new PreconditionEvaluator(store);
    preconditions = buildDistinctPreconditions();

    await populateStore(store);

    // Verify we have ~10K triples
    const count = await store.count();
    expect(count).toBeGreaterThanOrEqual(9000);
    expect(count).toBeLessThanOrEqual(11000);

    // Warm-up: compile all 27 queries into the askCache.
    // This simulates real startup where queries are compiled once.
    for (const pc of preconditions) {
      await evaluator.evaluate(pc, TARGET_IRI);
    }
  });

  it("should have exactly 27 distinct precondition queries", () => {
    expect(preconditions).toHaveLength(27);

    const uniqueQueries = new Set(preconditions.map((p) => p.sparqlAsk));
    expect(uniqueQueries.size).toBe(27);
  });

  it("should evaluate 27 cached ASK queries in < 50ms total on 10K triples", async () => {
    // Execute all 27 cached queries and measure total time
    const start = performance.now();

    for (const pc of preconditions) {
      await evaluator.evaluate(pc, TARGET_IRI);
    }

    const elapsed = performance.now() - start;

    // eslint-disable-next-line no-console
    console.log(
      `[perf] 27 ASK queries on 10K triples: ${elapsed.toFixed(2)}ms (threshold: ${TOTAL_THRESHOLD_MS}ms)`,
    );

    expect(elapsed).toBeLessThan(TOTAL_THRESHOLD_MS);
  });

  it("should maintain < 50ms across multiple runs (P95)", async () => {
    const RUN_COUNT = 20;
    const durations: number[] = [];

    for (let run = 0; run < RUN_COUNT; run++) {
      const start = performance.now();

      for (const pc of preconditions) {
        await evaluator.evaluate(pc, TARGET_IRI);
      }

      durations.push(performance.now() - start);
    }

    durations.sort((a, b) => a - b);
    const p95 = durations[Math.floor(RUN_COUNT * 0.95)];

    // eslint-disable-next-line no-console
    console.log(
      `[perf] P95 across ${RUN_COUNT} runs: ${p95.toFixed(2)}ms | ` +
        `min=${durations[0].toFixed(2)}ms | ` +
        `median=${durations[Math.floor(RUN_COUNT / 2)].toFixed(2)}ms | ` +
        `max=${durations[durations.length - 1].toFixed(2)}ms`,
    );

    expect(p95).toBeLessThan(TOTAL_THRESHOLD_MS);
  });

  it("should scale linearly with different target IRIs", async () => {
    const targets = [
      "urn:exo:task-0",
      "urn:exo:task-500",
      "urn:exo:task-999",
      "urn:exo:project-50",
      "urn:exo:area-5",
    ];

    for (const target of targets) {
      const start = performance.now();

      for (const pc of preconditions) {
        await evaluator.evaluate(pc, target);
      }

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(TOTAL_THRESHOLD_MS);
    }
  });
});
