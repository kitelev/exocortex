/**
 * Combined performance test: prototype chain materialization + 27 ASK queries.
 *
 * Verifies the full pipeline completes in < 50ms total:
 *   1. NonInheritablePropertyRegistry.initialize()
 *   2. PrototypeChainMaterializer.materialize()
 *   3. 27 distinct SPARQL ASK queries via PreconditionEvaluator
 *
 * Issue #2507: Combined perf test — materialized prototype chain + ASK queries
 * Depends on: #2496 (compiled ASK cache), #2503 (prototype chain materializer)
 */

import { PreconditionEvaluator } from "../../src/services/PreconditionEvaluator";
import { PrototypeChainMaterializer } from "../../src/services/PrototypeChainMaterializer";
import { NonInheritablePropertyRegistry } from "../../src/services/NonInheritablePropertyRegistry";
import { InMemoryTripleStore } from "../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../src/domain/models/rdf/Triple";
import { IRI } from "../../src/domain/models/rdf/IRI";
import { Literal } from "../../src/domain/models/rdf/Literal";
import { Namespace } from "../../src/domain/models/rdf/Namespace";
import type { PreconditionDefinition } from "../../src/domain/models/CommandDefinition";

/**
 * 27 distinct ASK queries — same set as PreconditionEvaluatorPerformance.test.ts.
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
 * Populate store with realistic data including prototypes + instances.
 *
 * Distribution (50+ triples):
 * - 5 prototypes (6 triples each = 30 triples)
 * - 10 instances linked to prototypes (4 own triples each = 40 triples)
 * - 3 NonInheritableProperty markers (3 triples = 9 triples)
 * - 5 Projects (4 triples each = 20 triples)
 * - 2 Areas (3 triples each = 6 triples)
 *
 * Total: ~105 own triples + materialized triples from prototype inheritance.
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
  const sizes = ["1", "3", "5", "8", "13"];

  // --- 5 Prototypes (rich properties to inherit) ---
  for (let i = 0; i < 5; i++) {
    const iri = new IRI(`urn:exo:prototype-${i}`);
    triples.push(
      new Triple(iri, Namespace.RDF.term("type"), Namespace.EMS.term("Task")),
      new Triple(
        iri,
        Namespace.EXO.term("Instance_class"),
        new Literal("ems__Task"),
      ),
      new Triple(
        iri,
        Namespace.EMS.term("Effort_status"),
        new Literal(statuses[i % statuses.length]),
      ),
      new Triple(
        iri,
        Namespace.EMS.term("Task_size"),
        new Literal(sizes[i % sizes.length]),
      ),
      new Triple(
        iri,
        Namespace.EMS.term("Effort_plannedStartTimestamp"),
        new Literal(`2026-03-${String(i + 1).padStart(2, "0")}T09:00:00`),
      ),
      new Triple(
        iri,
        Namespace.EMS.term("Effort_plannedEndTimestamp"),
        new Literal(`2026-03-${String(i + 1).padStart(2, "0")}T17:00:00`),
      ),
    );
  }

  // --- 10 Instances linked to prototypes ---
  for (let i = 0; i < 10; i++) {
    const iri = new IRI(`urn:exo:task-${i}`);
    const protoIri = new IRI(`urn:exo:prototype-${i % 5}`);
    const projectIri = new IRI(`urn:exo:project-${Math.floor(i / 2)}`);

    triples.push(
      new Triple(iri, Namespace.RDF.term("type"), Namespace.EMS.term("Task")),
      new Triple(
        iri,
        Namespace.EXO.term("Asset_prototype"),
        protoIri,
      ),
      new Triple(
        iri,
        Namespace.EXO.term("Asset_label"),
        new Literal(`Task Instance ${i}`),
      ),
      new Triple(
        iri,
        Namespace.EXO.term("Asset_uid"),
        new Literal(`uid-task-${i}`),
      ),
      new Triple(iri, Namespace.EMS.term("belongsTo"), projectIri),
    );

    // Some instances override prototype properties (own takes priority)
    if (i % 3 === 0) {
      triples.push(
        new Triple(
          iri,
          Namespace.EMS.term("Effort_status"),
          new Literal("ems__EffortStatusDoing"),
        ),
      );
    }

    // Some instances have timestamps
    if (i % 2 === 0) {
      triples.push(
        new Triple(
          iri,
          Namespace.EMS.term("Effort_startTimestamp"),
          new Literal(`2026-04-${String(i + 1).padStart(2, "0")}T09:00:00`),
        ),
        new Triple(
          iri,
          Namespace.EMS.term("Effort_endTimestamp"),
          new Literal(`2026-04-${String(i + 1).padStart(2, "0")}T17:00:00`),
        ),
      );
    }
  }

  // --- NonInheritableProperty markers ---
  // Mark exo__Asset_uid and exo__Asset_prototype as non-inheritable
  const nonInhClassIri = new IRI("urn:exo:class-non-inheritable");
  triples.push(
    new Triple(
      nonInhClassIri,
      Namespace.EXO.term("Asset_label"),
      new Literal("exo__NonInheritableProperty"),
    ),
  );

  const propUid = new IRI("urn:exo:prop-uid");
  triples.push(
    new Triple(
      propUid,
      Namespace.EXO.term("Instance_class"),
      nonInhClassIri,
    ),
    new Triple(
      propUid,
      Namespace.EXO.term("Asset_label"),
      new Literal("exo__Asset_uid"),
    ),
  );

  const propProto = new IRI("urn:exo:prop-prototype");
  triples.push(
    new Triple(
      propProto,
      Namespace.EXO.term("Instance_class"),
      nonInhClassIri,
    ),
    new Triple(
      propProto,
      Namespace.EXO.term("Asset_label"),
      new Literal("exo__Asset_prototype"),
    ),
  );

  const propLabel = new IRI("urn:exo:prop-label");
  triples.push(
    new Triple(
      propLabel,
      Namespace.EXO.term("Instance_class"),
      nonInhClassIri,
    ),
    new Triple(
      propLabel,
      Namespace.EXO.term("Asset_label"),
      new Literal("exo__Asset_label"),
    ),
  );

  // --- 5 Projects ---
  for (let i = 0; i < 5; i++) {
    const iri = new IRI(`urn:exo:project-${i}`);
    const areaIri = new IRI(`urn:exo:area-${Math.floor(i / 3)}`);
    triples.push(
      new Triple(
        iri,
        Namespace.RDF.term("type"),
        Namespace.EMS.term("Project"),
      ),
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

  // --- 2 Areas ---
  for (let i = 0; i < 2; i++) {
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

  await store.addAll(triples);
}

describe("Combined Prototype Chain + ASK Queries Performance", () => {
  let store: InMemoryTripleStore;
  let evaluator: PreconditionEvaluator;
  let registry: NonInheritablePropertyRegistry;
  let materializer: PrototypeChainMaterializer;
  let preconditions: PreconditionDefinition[];

  const TARGET_IRI = "urn:exo:task-2";

  // Generous CI threshold; actual execution should be well under this.
  const TOTAL_THRESHOLD_MS = 50;

  beforeAll(async () => {
    store = new InMemoryTripleStore();
    preconditions = buildDistinctPreconditions();

    await populateStore(store);

    // Verify we have 50+ triples before materialization
    const initialCount = await store.count();
    expect(initialCount).toBeGreaterThanOrEqual(50);

    // Warm-up: run full pipeline once to compile ASK cache
    registry = new NonInheritablePropertyRegistry();
    await registry.initialize(store);

    materializer = new PrototypeChainMaterializer(registry);
    await materializer.materialize(store);

    evaluator = new PreconditionEvaluator(store);
    for (const pc of preconditions) {
      await evaluator.evaluate(pc, TARGET_IRI);
    }
  });

  it("should have exactly 27 distinct precondition queries", () => {
    expect(preconditions).toHaveLength(27);

    const uniqueQueries = new Set(preconditions.map((p) => p.sparqlAsk));
    expect(uniqueQueries.size).toBe(27);
  });

  it("should have 50+ triples in store (own + materialized)", async () => {
    const count = await store.count();
    expect(count).toBeGreaterThanOrEqual(50);
  });

  it("should have materialized prototype triples into instances", async () => {
    // task-2 inherits from prototype-2; check that inherited status is present
    const targetIri = new IRI(TARGET_IRI);
    const statusTriples = await store.match(
      targetIri,
      Namespace.EMS.term("Effort_status"),
      undefined,
    );

    // task-2 (i=2, 2%3 !== 0) has no own status → should inherit from prototype-2
    expect(statusTriples.length).toBeGreaterThanOrEqual(1);
  });

  it("should complete registry.initialize() + materializer.materialize() + 27 ASK queries in < 50ms", async () => {
    // Fresh store for clean measurement
    const freshStore = new InMemoryTripleStore();
    await populateStore(freshStore);

    // Pre-warm ASK cache on fresh evaluator
    const freshEvaluator = new PreconditionEvaluator(freshStore);
    const freshRegistry = new NonInheritablePropertyRegistry();
    await freshRegistry.initialize(freshStore);

    const freshMaterializer = new PrototypeChainMaterializer(freshRegistry);
    await freshMaterializer.materialize(freshStore);

    for (const pc of preconditions) {
      await freshEvaluator.evaluate(pc, TARGET_IRI);
    }

    // --- Timed measurement: full pipeline on pre-populated store ---
    const measuredStore = new InMemoryTripleStore();
    await populateStore(measuredStore);

    const start = performance.now();

    // Step 1: Initialize registry
    const measuredRegistry = new NonInheritablePropertyRegistry();
    await measuredRegistry.initialize(measuredStore);

    // Step 2: Materialize prototype chain
    const measuredMaterializer = new PrototypeChainMaterializer(measuredRegistry);
    const materializedCount = await measuredMaterializer.materialize(measuredStore);

    // Step 3: Run 27 ASK queries
    const measuredEvaluator = new PreconditionEvaluator(measuredStore);
    for (const pc of preconditions) {
      await measuredEvaluator.evaluate(pc, TARGET_IRI);
    }

    const elapsed = performance.now() - start;

    // eslint-disable-next-line no-console
    console.log(
      `[perf] Combined pipeline on realistic data: ${elapsed.toFixed(2)}ms (threshold: ${TOTAL_THRESHOLD_MS}ms)\n` +
        `       Registry init + ${materializedCount} materialized triples + 27 ASK queries`,
    );

    expect(elapsed).toBeLessThan(TOTAL_THRESHOLD_MS);
  });

  it("should maintain < 50ms across multiple runs (P95)", async () => {
    const RUN_COUNT = 20;
    const durations: number[] = [];

    for (let run = 0; run < RUN_COUNT; run++) {
      const runStore = new InMemoryTripleStore();
      await populateStore(runStore);

      const start = performance.now();

      const runRegistry = new NonInheritablePropertyRegistry();
      await runRegistry.initialize(runStore);

      const runMaterializer = new PrototypeChainMaterializer(runRegistry);
      await runMaterializer.materialize(runStore);

      const runEvaluator = new PreconditionEvaluator(runStore);
      for (const pc of preconditions) {
        await runEvaluator.evaluate(pc, TARGET_IRI);
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
});
