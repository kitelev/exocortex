/**
 * Performance test: Multi-hop prototype chain materialization (RFC-013).
 *
 * Verifies materialization budgets:
 *   - depth-1 (single-hop): < 5ms
 *   - depth-2: < 10ms
 *   - depth-3: < 10ms
 *   - 100 instances × depth-2: < 50ms
 *   - P95 across 20 runs within budget
 *
 * Issue #2592: Performance test multi-hop < 10ms for depth-3
 */

import { PrototypeChainMaterializer } from "../../src/services/PrototypeChainMaterializer";
import { NonInheritablePropertyRegistry } from "../../src/services/NonInheritablePropertyRegistry";
import { InMemoryTripleStore } from "../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../src/domain/models/rdf/Triple";
import { IRI } from "../../src/domain/models/rdf/IRI";
import { Literal } from "../../src/domain/models/rdf/Literal";
import { Namespace } from "../../src/domain/models/rdf/Namespace";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NON_INHERITABLE_CLASS_IRI = "urn:exo:class-non-inheritable";

async function seedNonInheritableProperties(store: InMemoryTripleStore): Promise<void> {
  const classIRI = new IRI(NON_INHERITABLE_CLASS_IRI);
  await store.addAll([
    new Triple(classIRI, Namespace.EXO.term("Asset_label"), new Literal("exo__NonInheritableProperty")),
  ]);

  const nonInheritableProps = [
    { iri: "urn:exo:nip-uid", label: "exo__Asset_uid" },
    { iri: "urn:exo:nip-label", label: "exo__Asset_label" },
    { iri: "urn:exo:nip-prototype", label: "exo__Asset_prototype" },
    { iri: "urn:exo:nip-status", label: "ems__Effort_status" },
    { iri: "urn:exo:nip-start", label: "ems__Effort_startTimestamp" },
  ];

  for (const prop of nonInheritableProps) {
    const propIRI = new IRI(prop.iri);
    await store.addAll([
      new Triple(propIRI, Namespace.EXO.term("Instance_class"), classIRI),
      new Triple(propIRI, Namespace.EXO.term("Asset_label"), new Literal(prop.label)),
    ]);
  }
}

/**
 * Build a depth-N chain: instance → proto1 → proto2 → ... → protoN.
 * Each prototype has 3 inheritable properties.
 */
async function seedChain(
  store: InMemoryTripleStore,
  instanceIRI: string,
  depth: number,
): Promise<void> {
  const protos: IRI[] = [];
  for (let i = 0; i < depth; i++) {
    protos.push(new IRI(`${instanceIRI}-proto-${i}`));
  }

  const instance = new IRI(instanceIRI);

  // instance → proto0
  await store.add(
    new Triple(instance, Namespace.EXO.term("Asset_prototype"), protos[0]),
  );
  await store.addAll([
    new Triple(instance, Namespace.EXO.term("Asset_uid"), new Literal(`uid-${instanceIRI}`)),
    new Triple(instance, Namespace.EXO.term("Asset_label"), new Literal(`Instance ${instanceIRI}`)),
  ]);

  // proto0 → proto1 → ... → protoN
  for (let i = 0; i < depth; i++) {
    const proto = protos[i];
    if (i < depth - 1) {
      await store.add(
        new Triple(proto, Namespace.EXO.term("Asset_prototype"), protos[i + 1]),
      );
    }

    // Each proto has 3 inheritable properties unique to its level
    await store.addAll([
      new Triple(proto, Namespace.EXO.term("Asset_uid"), new Literal(`uid-proto-${i}`)),
      new Triple(proto, Namespace.EXO.term("Asset_label"), new Literal(`Proto ${i}`)),
      new Triple(proto, Namespace.EMS.term("Effort_area"), new Literal(`Area-${i}`)),
      new Triple(proto, Namespace.EMS.term("Effort_priority"), new Literal(`priority-${i}`)),
      new Triple(proto, Namespace.EMS.term("Effort_timeEstimateMinutes"), new Literal(`${(i + 1) * 15}`)),
    ]);
  }
}

/**
 * Build N instances, each with a depth-2 chain.
 */
async function seedManyInstances(
  store: InMemoryTripleStore,
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await seedChain(store, `urn:exo:batch-instance-${i}`, 2);
  }
}

async function createMaterializer(store: InMemoryTripleStore): Promise<PrototypeChainMaterializer> {
  const registry = new NonInheritablePropertyRegistry();
  await registry.initialize(store);
  return new PrototypeChainMaterializer(registry);
}

/**
 * Measure materialization time. Includes warm-up run.
 */
async function measureMaterialization(depth: number): Promise<number> {
  // Warm-up
  const warmStore = new InMemoryTripleStore();
  await seedNonInheritableProperties(warmStore);
  await seedChain(warmStore, "urn:exo:warmup", depth);
  const warmMat = await createMaterializer(warmStore);
  await warmMat.materialize(warmStore);

  // Timed run
  const store = new InMemoryTripleStore();
  await seedNonInheritableProperties(store);
  await seedChain(store, "urn:exo:timed", depth);
  const mat = await createMaterializer(store);

  const start = performance.now();
  await mat.materialize(store);
  return performance.now() - start;
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("Multi-Hop Prototype Chain Performance (RFC-013)", () => {
  const RUN_COUNT = 20;

  it("depth-1 (regression): should materialize in < 5ms", async () => {
    const elapsed = await measureMaterialization(1);

    // eslint-disable-next-line no-console
    console.log(`[perf] depth-1: ${elapsed.toFixed(2)}ms (threshold: 5ms)`);
    expect(elapsed).toBeLessThan(5);
  });

  it("depth-2: should materialize in < 10ms", async () => {
    const elapsed = await measureMaterialization(2);

    // eslint-disable-next-line no-console
    console.log(`[perf] depth-2: ${elapsed.toFixed(2)}ms (threshold: 10ms)`);
    expect(elapsed).toBeLessThan(10);
  });

  it("depth-3: should materialize in < 10ms", async () => {
    const elapsed = await measureMaterialization(3);

    // eslint-disable-next-line no-console
    console.log(`[perf] depth-3: ${elapsed.toFixed(2)}ms (threshold: 10ms)`);
    expect(elapsed).toBeLessThan(10);
  });

  it("100 instances × depth-2: should materialize in < 50ms", async () => {
    // Warm-up
    const warmStore = new InMemoryTripleStore();
    await seedNonInheritableProperties(warmStore);
    await seedManyInstances(warmStore, 10);
    const warmMat = await createMaterializer(warmStore);
    await warmMat.materialize(warmStore);

    // Timed run
    const store = new InMemoryTripleStore();
    await seedNonInheritableProperties(store);
    await seedManyInstances(store, 100);
    const mat = await createMaterializer(store);

    const start = performance.now();
    const count = await mat.materialize(store);
    const elapsed = performance.now() - start;

    // eslint-disable-next-line no-console
    console.log(
      `[perf] 100 × depth-2: ${elapsed.toFixed(2)}ms (threshold: 50ms), ` +
        `materialized: ${count} triples`,
    );
    expect(elapsed).toBeLessThan(50);
  });

  it("P95 across 20 runs should stay within budget (depth-2 < 10ms)", async () => {
    const durations: number[] = [];

    for (let run = 0; run < RUN_COUNT; run++) {
      const store = new InMemoryTripleStore();
      await seedNonInheritableProperties(store);
      await seedChain(store, `urn:exo:p95-${run}`, 2);
      const mat = await createMaterializer(store);

      const start = performance.now();
      await mat.materialize(store);
      durations.push(performance.now() - start);
    }

    durations.sort((a, b) => a - b);
    const p95 = durations[Math.floor(RUN_COUNT * 0.95)];

    // eslint-disable-next-line no-console
    console.log(
      `[perf] P95 depth-2 across ${RUN_COUNT} runs: ${p95.toFixed(2)}ms | ` +
        `min=${durations[0].toFixed(2)}ms | ` +
        `median=${durations[Math.floor(RUN_COUNT / 2)].toFixed(2)}ms | ` +
        `max=${durations[durations.length - 1].toFixed(2)}ms`,
    );

    expect(p95).toBeLessThan(10);
  });

  it("P95 across 20 runs for 100-instance batch (< 50ms)", async () => {
    const durations: number[] = [];

    for (let run = 0; run < RUN_COUNT; run++) {
      const store = new InMemoryTripleStore();
      await seedNonInheritableProperties(store);
      await seedManyInstances(store, 100);
      const mat = await createMaterializer(store);

      const start = performance.now();
      await mat.materialize(store);
      durations.push(performance.now() - start);
    }

    durations.sort((a, b) => a - b);
    const p95 = durations[Math.floor(RUN_COUNT * 0.95)];

    // eslint-disable-next-line no-console
    console.log(
      `[perf] P95 100×depth-2 across ${RUN_COUNT} runs: ${p95.toFixed(2)}ms | ` +
        `min=${durations[0].toFixed(2)}ms | ` +
        `median=${durations[Math.floor(RUN_COUNT / 2)].toFixed(2)}ms | ` +
        `max=${durations[durations.length - 1].toFixed(2)}ms`,
    );

    expect(p95).toBeLessThan(50);
  });
});
