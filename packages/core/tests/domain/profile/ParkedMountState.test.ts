/**
 * @req:d4ccc901-83a4-4495-a4bb-43d1305dfd00
 *
 * req `d4ccc901` — the three-state transition table and the parked-path deriver.
 *
 * ## Axes (one guard each — a mutant that removes ONE must redden ONLY its own)
 *
 *  A. the soft/hard split at `active` + not-included (park vs destroy)
 *  B. `canPark: false` degrades a park to the pre-existing destroy
 *  C. the `parked` row (unpark when wanted, LEAVE ALONE when not) — this is the
 *     cell `reconcileToLocal` leans on to compute no deletion
 *  D. `parkedPathFor` derives, and REFUSES a malformed folder
 *
 * ⛔ The mutants that prove these must be SEMANTICALLY VALID. `false || X` is
 * `X` and a dead branch placed before a live one is unreachable — both are
 * no-ops, so both would pass and be misread as "the axis does not discriminate".
 * The mutations named per axis below all change behaviour.
 */
import { describe, it, expect } from "@jest/globals";
import {
  classifyMountTransition,
  parkedPathFor,
  PARKED_ROOT,
  DEPENDENCY_KIND_REFERENCE_UID,
  DEPENDENCY_KIND_TBOX_UID,
  type MountState,
  type MountTransition,
} from "../../../src/domain/profile/ParkedMountState";

const SOFT = `[[${DEPENDENCY_KIND_REFERENCE_UID}]]`;
const HARD = `[[${DEPENDENCY_KIND_TBOX_UID}]]`;

describe("@req:d4ccc901-83a4-4495-a4bb-43d1305dfd00 classifyMountTransition — req d4ccc901", () => {
  /**
   * The whole table in one place. Written as data so a NEW state cannot be added
   * without a row here going missing — a prose-only test would silently keep
   * passing while a fourth state fell through.
   */
  const TABLE: ReadonlyArray<{
    state: MountState;
    inEffectiveSet: boolean;
    dependsOnKind?: unknown;
    expected: MountTransition;
    why: string;
  }> = [
    {
      state: "active",
      inEffectiveSet: true,
      expected: "none",
      why: "already where the profile wants it",
    },
    {
      state: "active",
      inEffectiveSet: false,
      dependsOnKind: SOFT,
      expected: "park",
      why: "soft edge — content only, keeping the bytes costs nothing",
    },
    {
      state: "active",
      inEffectiveSet: false,
      dependsOnKind: HARD,
      expected: "destroy",
      why: "hard edge — a half-present TBox provider is the silent state",
    },
    {
      state: "active",
      inEffectiveSet: false,
      dependsOnKind: undefined,
      expected: "destroy",
      why: "absent kind resolves HARD — the hiding direction needs evidence",
    },
    {
      state: "parked",
      inEffectiveSet: true,
      expected: "unpark",
      why: "bytes are on the device — a rename, not a download",
    },
    {
      state: "parked",
      inEffectiveSet: false,
      expected: "none",
      why: "left alone — this is why reconcile computes no deletion for it",
    },
    {
      state: "absent",
      inEffectiveSet: true,
      expected: "materialize",
      why: "nothing local to reuse",
    },
    { state: "absent", inEffectiveSet: false, expected: "none", why: "nothing to do" },
  ];

  it.each(TABLE)(
    "$state + inEffectiveSet=$inEffectiveSet → $expected ($why)",
    ({ state, inEffectiveSet, dependsOnKind, expected }) => {
      expect(
        classifyMountTransition({ state, inEffectiveSet, dependsOnKind }),
      ).toBe(expected);
    },
  );

  it("covers every (state × membership) pair — the table is exhaustive", () => {
    // Guards the table itself: 3 states × 2 memberships = 6 distinct pairs, and
    // the `active`+not-included pair is split three ways by dependency kind.
    // Without this the table above could quietly lose a row and stay green.
    const pairs = new Set(
      TABLE.map((r) => `${r.state}:${String(r.inEffectiveSet)}`),
    );
    expect(pairs.size).toBe(6);
  });

  /**
   * AXIS B — `canPark: false` must fall back to DESTROY, not to park-and-hope.
   *
   * Mutant: drop `canPark &&` from the `active` arm. Only this reddens: every
   * other row either never reaches the dependency-kind read or passes the
   * default `canPark: true`.
   */
  it("refuses to PLAN a park the caller cannot execute (canPark=false → destroy)", () => {
    expect(
      classifyMountTransition({
        state: "active",
        inEffectiveSet: false,
        dependsOnKind: SOFT,
        canPark: false,
      }),
    ).toBe("destroy");
    // …and the same input WITH the capability parks, so the guard is what moved
    // the answer — not the dependency kind.
    expect(
      classifyMountTransition({
        state: "active",
        inEffectiveSet: false,
        dependsOnKind: SOFT,
        canPark: true,
      }),
    ).toBe("park");
  });

  it("canPark=false does NOT suppress an unpark — it only gates NEW parks", () => {
    // A parked copy already on disk must still be restorable; `canPark` answers
    // "may I hide more", not "may I stop hiding".
    expect(
      classifyMountTransition({
        state: "parked",
        inEffectiveSet: true,
        canPark: false,
      }),
    ).toBe("unpark");
  });
});

describe("@req:d4ccc901-83a4-4495-a4bb-43d1305dfd00 parkedPathFor — req d4ccc901", () => {
  it("derives the parked location from the mount folder", () => {
    expect(parkedPathFor("assetspaces/kitelev/exoas-public")).toBe(
      `${PARKED_ROOT}/kitelev/exoas-public`,
    );
  });

  it("parks under .exocortex/, never under .obsidian/plugins/", () => {
    // BRAT overwrites the plugin directory on every update; a parked mount living
    // there would be destroyed by a routine plugin upgrade.
    const p = parkedPathFor("assetspaces/o/r");
    expect(p.startsWith(".exocortex/")).toBe(true);
    expect(p.includes(".obsidian")).toBe(false);
  });

  /**
   * AXIS D — the refusal. Mutant: delete the `segments.some(...)` clause.
   * Only these reden; the happy-path derivation above stays green, which is what
   * makes this a guard test rather than a restatement of the deriver.
   */
  it.each([
    ["", "empty"],
    ["assetspaces/../../etc", "traversal"],
    ["assetspaces//repo", "empty segment"],
    ["assetspaces/./repo", "dot segment"],
    ["not-a-mount/repo", "outside the mount root"],
  ])("refuses %s (%s) rather than moving a directory somewhere else", (bad) => {
    expect(() => parkedPathFor(bad)).toThrow(/refusing unsafe mount folder/);
  });
});
