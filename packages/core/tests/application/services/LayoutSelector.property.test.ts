/**
 * Property-based determinism invariants for LayoutSelector.
 *
 * RFC exo__Layout §"Priority ladder" demands N≥500 runs of the determinism
 * invariant: `resolve(classes)` yields the same answer given the same
 * snapshot and input, regardless of snapshot ORDER.  The tiebreaker
 * (`priority DESC → uid ASC`) fully orders matches.
 *
 * Seeds are explicit so failures reproduce locally with the counterexample
 * shrinks.
 */

import * as fc from "fast-check";
import { LayoutSelector } from "../../../src/application/services/LayoutSelector";
import type { Layout } from "../../../src/domain/layout/Layout";

const NUM_RUNS = 500;
const SEED = 0xcafed00d;

const classPool = ["ems__Task", "ems__Project", "ems__Area", "period__Week", "ems__Meeting"];

const layoutArb = fc
  .record({
    uid: fc.uuid(),
    label: fc.string({ minLength: 1, maxLength: 10 }),
    targetClass: fc.constantFrom(...classPool),
    blocks: fc
      .array(fc.constantFrom("block-a", "block-b", "block-c"), {
        minLength: 1,
        maxLength: 3,
      })
      .map((arr) => [...arr]),
    priority: fc.integer({ min: 0, max: 10 }),
    coexistsWithDefault: fc.boolean(),
    sourcePath: fc.string({ minLength: 1, maxLength: 20 }).map((s) => `${s}.md`),
  })
  .map(
    (l): Layout => ({
      uid: l.uid,
      label: l.label,
      targetClass: l.targetClass,
      blocks: l.blocks,
      priority: l.priority,
      coexistsWithDefault: l.coexistsWithDefault,
      sourcePath: l.sourcePath,
    }),
  );

const classArrayArb = fc
  .subarray(classPool, { minLength: 1, maxLength: 3 })
  .map((arr) => [...arr]);

const uniqueByUid = (list: Layout[]): Layout[] => {
  const seen = new Set<string>();
  const out: Layout[] = [];
  for (const l of list) {
    if (seen.has(l.uid)) continue;
    seen.add(l.uid);
    out.push(l);
  }
  return out;
};

describe("LayoutSelector — property-based invariants", () => {
  it("determinism: repeated resolve with identical inputs + snapshot yields identical output", () => {
    fc.assert(
      fc.property(
        fc.array(layoutArb, { minLength: 0, maxLength: 15 }).map(uniqueByUid),
        classArrayArb,
        (snapshot, classes) => {
          const selector = new LayoutSelector({ all: snapshot });
          const first = selector.resolve(classes);
          const second = selector.resolve(classes);
          return first === second;
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it("order-independence: shuffling snapshot does NOT change resolved Layout (by uid)", () => {
    fc.assert(
      fc.property(
        fc.array(layoutArb, { minLength: 0, maxLength: 15 }).map(uniqueByUid),
        classArrayArb,
        fc.integer({ min: 0, max: 2 ** 31 - 1 }),
        (snapshot, classes, shuffleSeed) => {
          const baseline = new LayoutSelector({ all: snapshot });
          const baselineResult = baseline.resolve(classes);

          const shuffled = snapshot
            .map((l, idx): [number, Layout] => [
              (shuffleSeed ^ (idx * 2654435761)) >>> 0,
              l,
            ])
            .sort((a, b) => a[0] - b[0])
            .map(([, l]) => l);

          const shuffledResult = new LayoutSelector({ all: shuffled }).resolve(
            classes,
          );

          if (baselineResult === null && shuffledResult === null) return true;
          if (baselineResult === null || shuffledResult === null) return false;
          return baselineResult.uid === shuffledResult.uid;
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED + 1 },
    );
  });

  it("priority tiebreaker: winner always has priority >= every match for same class", () => {
    fc.assert(
      fc.property(
        fc.array(layoutArb, { minLength: 1, maxLength: 15 }).map(uniqueByUid),
        classArrayArb,
        (snapshot, classes) => {
          const selector = new LayoutSelector({ all: snapshot });
          const winner = selector.resolve(classes);
          if (winner === null) return true;

          const firstMatchingClass = classes.find((c) =>
            snapshot.some((l) => l.targetClass === c),
          );
          if (firstMatchingClass === undefined) return true;

          const candidates = snapshot.filter(
            (l) => l.targetClass === firstMatchingClass,
          );
          return candidates.every((c) => {
            if (c.priority > winner.priority) return false;
            if (c.priority === winner.priority) {
              return winner.uid <= c.uid;
            }
            return true;
          });
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED + 2 },
    );
  });

  it("multi-class iteration: first class with match wins, later classes ignored", () => {
    fc.assert(
      fc.property(
        fc.array(layoutArb, { minLength: 1, maxLength: 15 }).map(uniqueByUid),
        classArrayArb,
        (snapshot, classes) => {
          const selector = new LayoutSelector({ all: snapshot });
          const winner = selector.resolve(classes);
          if (winner === null) return true;

          const firstIdxWithMatch = classes.findIndex((c) =>
            snapshot.some((l) => l.targetClass === c),
          );
          if (firstIdxWithMatch < 0) return false;

          // winner's targetClass must equal classes[firstIdxWithMatch]
          return winner.targetClass === classes[firstIdxWithMatch];
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED + 3 },
    );
  });

  it("null-safety: degenerate inputs never throw and return null", () => {
    fc.assert(
      fc.property(
        fc.array(layoutArb, { minLength: 0, maxLength: 5 }).map(uniqueByUid),
        (snapshot) => {
          const selector = new LayoutSelector({ all: snapshot });
          expect(selector.resolve([])).toBeNull();
          expect(selector.resolve([""])).toBeNull();
          expect(selector.resolve([null as unknown as string])).toBeNull();
          expect(selector.resolve([undefined as unknown as string])).toBeNull();
          // Non-array input — cast as any to simulate frontmatter corruption.
          expect(
            selector.resolve(null as unknown as readonly string[]),
          ).toBeNull();
          return true;
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED + 4 },
    );
  });
});
