/**
 * Performance gate for RelationColumnSetResolver.
 *
 * RFC be70f741 Phase 2 §Acceptance Criteria: `resolve()` p95 < 1 ms on 100
 * configs.  This test is the gate; failing this test blocks Phase 2 Done.
 *
 * Measurement
 * - 100 synthetic configs spread evenly across tier-1 / tier-2 / tier-3 shapes.
 * - 500 warmup + 5000 measured iterations (enough for stable p95 even on
 *   noisy CI runners).
 * - `process.hrtime.bigint()` for monotonic ns precision.
 * - p95 = sorted[ceil(0.95 * n) - 1].
 *
 * Guardrail
 * - Gate `p95 < 1_000_000` ns (= 1 ms).  The median is expected well below
 *   100 µs on a modern runner; the 10× headroom absorbs CI jitter.
 */

import { RelationColumnSetResolver } from "../../src/application/services/RelationColumnSetResolver";
import type { RelationColumnSet } from "../../src/domain/layout/RelationColumnSet";

const WARMUP_ITERATIONS = 500;
const MEASURED_ITERATIONS = 5000;
const P95_BUDGET_NS = 1_000_000; // 1 ms

function buildFixture(): RelationColumnSet[] {
  const out: RelationColumnSet[] = [];
  // Tier 1 candidates: 40 configs with (class, property) pairs.
  for (let i = 0; i < 40; i += 1) {
    out.push({
      uid: `tier1-${String(i).padStart(3, "0")}`,
      label: `tier1-${i}`,
      targetClasses: [`Cls${i % 10}`],
      referencingProperty: `Prop${i % 10}`,
      columns: ["exo__Asset_label"],
      priority: i % 3,
      sourcePath: `tier1-${i}.md`,
    });
  }
  // Tier 2 candidates: 30 class-only configs.
  for (let i = 0; i < 30; i += 1) {
    out.push({
      uid: `tier2-${String(i).padStart(3, "0")}`,
      label: `tier2-${i}`,
      targetClasses: [`Cls${i % 10}`],
      referencingProperty: null,
      columns: ["exo__Asset_label"],
      priority: i % 4,
      sourcePath: `tier2-${i}.md`,
    });
  }
  // Tier 3 candidates: 30 property-only configs.
  for (let i = 0; i < 30; i += 1) {
    out.push({
      uid: `tier3-${String(i).padStart(3, "0")}`,
      label: `tier3-${i}`,
      targetClasses: null,
      referencingProperty: `Prop${i % 10}`,
      columns: ["exo__Asset_label"],
      priority: i % 5,
      sourcePath: `tier3-${i}.md`,
    });
  }
  return out;
}

function percentile(sorted: readonly bigint[], p: number): bigint {
  const rank = Math.ceil(p * sorted.length);
  const idx = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[idx];
}

describe("RelationColumnSetResolver — performance gate", () => {
  it("resolve() p95 < 1 ms on 100 configs", () => {
    const configs = buildFixture();
    expect(configs).toHaveLength(100);

    const resolver = new RelationColumnSetResolver(() => configs);

    // Representative rowClass × property inputs covering all tiers.
    const queries: Array<[readonly string[], string]> = [
      [["Cls0"], "Prop0"], // tier 1 hit
      [["Cls5"], "Prop5"], // tier 1 hit
      [["Cls9"], "PropMiss"], // tier 2 hit (class-only)
      [["ClsMiss"], "Prop0"], // tier 3 hit
      [["ClsMiss"], "PropMiss"], // tier 4 miss
      [["Cls0", "Cls1"], "Prop0"], // multi-class
    ];

    // Warmup — JIT stabilisation.
    for (let i = 0; i < WARMUP_ITERATIONS; i += 1) {
      const [cls, prop] = queries[i % queries.length];
      resolver.resolve(cls, prop);
    }

    const samples: bigint[] = new Array(MEASURED_ITERATIONS);
    for (let i = 0; i < MEASURED_ITERATIONS; i += 1) {
      const [cls, prop] = queries[i % queries.length];
      const t0 = process.hrtime.bigint();
      resolver.resolve(cls, prop);
      const t1 = process.hrtime.bigint();
      samples[i] = t1 - t0;
    }

    samples.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const p50 = percentile(samples, 0.5);
    const p95 = percentile(samples, 0.95);
    const p99 = percentile(samples, 0.99);
    const maxSample = samples[samples.length - 1];

    // Log for visibility in CI summary; noise-free enough to keep in the test.
    // eslint-disable-next-line no-console
    console.log(
      `[RelationColumnSetResolver perf] p50=${p50}ns p95=${p95}ns p99=${p99}ns max=${maxSample}ns (n=${MEASURED_ITERATIONS}, configs=${configs.length})`,
    );

    expect(Number(p95)).toBeLessThan(P95_BUDGET_NS);
  });
});
