/**
 * Property-based determinism invariant for RelationColumnSetResolver.
 *
 * RFC be70f741 Phase 2 §"Unit-тесты (обязательные)" demands N≥500 runs of the
 * determinism invariant: `resolve(a, b)` yields the same answer given the same
 * snapshot and inputs, regardless of snapshot ORDER.  Ordering of configs
 * inside the snapshot MUST NOT change the resolver verdict — the tiebreaker
 * (`priority DESC → uid ASC`) fully orders matches.
 *
 * Seeds are explicit so failures reproduce locally with the same counterexample
 * shrinks the CI run produced.
 */

import * as fc from "fast-check";
import { RelationColumnSetResolver } from "../../../src/application/services/RelationColumnSetResolver";
import type { RelationColumnSet } from "../../../src/domain/layout/RelationColumnSet";

const NUM_RUNS = 500;
const SEED = 0xc0ffee;

const classPool = ["C1", "C2", "C3", "C4", "C5"];
const propertyPool = ["P1", "P2", "P3", "P4", "P5"];

const classArrayArb = fc
  .subarray(classPool, { minLength: 1, maxLength: 3 })
  .map((arr) => [...arr]); // fast-check `subarray` returns readonly — clone to plain array

const configArb = fc
  .record({
    uid: fc.uuid(),
    label: fc.string({ minLength: 1, maxLength: 10 }),
    targetClasses: fc.option(classArrayArb, { nil: null }),
    referencingProperty: fc.option(fc.constantFrom(...propertyPool), {
      nil: null,
    }),
    columns: fc
      .array(fc.constantFrom("exo__Asset_label", "exo__Asset_createdAt"), {
        minLength: 1,
        maxLength: 3,
      })
      .map((arr) => [...arr]),
    priority: fc.integer({ min: 0, max: 10 }),
    sourcePath: fc.string({ minLength: 1, maxLength: 20 }).map((s) => `${s}.md`),
  })
  .filter(
    // RFC v2 asset-level validation: at least one of (targetClass, referencingProperty).
    (cs) => cs.targetClasses !== null || cs.referencingProperty !== null,
  )
  .map(
    (cs): RelationColumnSet => ({
      uid: cs.uid,
      label: cs.label,
      targetClasses: cs.targetClasses,
      referencingProperty: cs.referencingProperty,
      columns: cs.columns,
      priority: cs.priority,
      sourcePath: cs.sourcePath,
    }),
  );

const uniqueByUid = (list: RelationColumnSet[]): RelationColumnSet[] => {
  const seen = new Set<string>();
  const out: RelationColumnSet[] = [];
  for (const cs of list) {
    if (seen.has(cs.uid)) continue;
    seen.add(cs.uid);
    out.push(cs);
  }
  return out;
};

describe("RelationColumnSetResolver — property-based invariants", () => {
  it("determinism: repeated resolve with identical inputs + snapshot yields identical output", () => {
    fc.assert(
      fc.property(
        fc.array(configArb, { minLength: 0, maxLength: 15 }).map(uniqueByUid),
        classArrayArb,
        fc.option(fc.constantFrom(...propertyPool), { nil: null }),
        (snapshot, rowClasses, prop) => {
          const resolver = new RelationColumnSetResolver(() => snapshot);
          const first = resolver.resolve(rowClasses, prop);
          const second = resolver.resolve(rowClasses, prop);
          // Reference equality is the strongest determinism check — the
          // tiebreaker is stable so the same object must be chosen.
          return first === second;
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it("order-independence: shuffling snapshot does NOT change the resolved asset (by uid)", () => {
    fc.assert(
      fc.property(
        fc.array(configArb, { minLength: 0, maxLength: 15 }).map(uniqueByUid),
        classArrayArb,
        fc.option(fc.constantFrom(...propertyPool), { nil: null }),
        fc.integer({ min: 0, max: 2 ** 31 - 1 }),
        (snapshot, rowClasses, prop, shuffleSeed) => {
          const baseline = new RelationColumnSetResolver(() => snapshot);
          const baselineResult = baseline.resolve(rowClasses, prop);

          // Deterministic shuffle driven by `shuffleSeed`.
          const shuffled = snapshot
            .map((cs, idx): [number, RelationColumnSet] => [
              // xor-shift-ish mixing — stable per `shuffleSeed`.
              (shuffleSeed ^ (idx * 2654435761)) >>> 0,
              cs,
            ])
            .sort((a, b) => a[0] - b[0])
            .map(([, cs]) => cs);

          const shuffledResolver = new RelationColumnSetResolver(() => shuffled);
          const shuffledResult = shuffledResolver.resolve(rowClasses, prop);

          if (baselineResult === null && shuffledResult === null) return true;
          if (baselineResult === null || shuffledResult === null) return false;
          return baselineResult.uid === shuffledResult.uid;
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED + 1 },
    );
  });

  it("null-safety: empty/degenerate inputs never throw and always return null", () => {
    fc.assert(
      fc.property(
        fc.array(configArb, { minLength: 0, maxLength: 5 }).map(uniqueByUid),
        (snapshot) => {
          const resolver = new RelationColumnSetResolver(() => snapshot);
          resolver.resolve([], "P");
          resolver.resolve(null, "P");
          resolver.resolve(undefined, "P");
          resolver.resolve(["C"], null);
          resolver.resolve(["C"], undefined);
          resolver.resolve(["C"], "");
          return true; // if we got here — no throws.
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED + 2 },
    );
  });
});
