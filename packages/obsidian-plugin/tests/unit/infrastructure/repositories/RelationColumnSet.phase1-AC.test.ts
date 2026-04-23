/**
 * Phase 1 acceptance-criteria coverage that does NOT duplicate the dedicated
 * Repository + domain-model suites.
 *
 * - AC 6: SPARQL-shape query — Phase 1 ships zero instances, so the Repository
 *   must return an empty snapshot without throwing.
 * - AC 7: empty vault does not break UniversalLayout — structural assertion
 *   that the Repository exposes safe defaults (no runtime integration yet).
 * - AC 8: "0 configs = baseline identical" — behaviour-neutral by construction
 *   (no consumer wired in Phase 1); assertion is that the snapshot is frozen
 *   and therefore cannot leak mutations to any future consumer.
 * - AC 9: contract-test on `MetadataHelpers.getPropertyValue` signature — an
 *   assignability guard that fails compilation (or this assertion) when the
 *   upstream signature shifts.
 */

import { RelationColumnSetRepository } from "../../../../src/infrastructure/repositories/RelationColumnSetRepository";
import type { RelationColumnSetVaultAdapter } from "../../../../src/infrastructure/repositories/RelationColumnSetRepository";
import { MetadataHelpers } from "exocortex";

const CLASS_WIKILINK =
  "[[97fc9862-c886-4d86-9a60-e0cf9d778575|ui__RelationColumnSet]]";

function adapterWith(
  files: Record<string, Record<string, unknown>>,
): RelationColumnSetVaultAdapter {
  return {
    getAllMarkdownPaths: () => Object.keys(files),
    getFrontmatter: (path) => files[path] ?? null,
    on: () => () => {},
  };
}

describe("Phase 1 AC coverage", () => {
  test("AC 6 — Repository exposes the same shape a `?set a ui:RelationColumnSet` query would", () => {
    const repo = new RelationColumnSetRepository(adapterWith({}));
    repo.initialize();
    const snap = repo.getSnapshot();
    // no instances shipped in Phase 1 → empty result is the expected answer
    expect(Array.from(snap.byUid.keys())).toEqual([]);
    expect(snap.all).toEqual([]);
  });

  test("AC 6 — with one well-formed instance, Repository picks it up (SPARQL-equivalent smoke)", () => {
    const repo = new RelationColumnSetRepository(
      adapterWith({
        "ui/example.md": {
          exo__Asset_uid: "cfg-1",
          exo__Instance_class: [CLASS_WIKILINK],
          ui__RelationColumnSet_targetClass: ["[[ems__WeeklyObjective]]"],
          ui__RelationColumnSet_columns: ["[[exo__Asset_label]]"],
        },
      }),
    );
    repo.initialize();
    expect(Array.from(repo.getSnapshot().byUid.keys())).toEqual(["cfg-1"]);
  });

  test("AC 7 — empty vault smoke: snapshot is safe to traverse", () => {
    const repo = new RelationColumnSetRepository(adapterWith({}));
    repo.initialize();
    const snap = repo.getSnapshot();
    // any future consumer (Phase 3) would call .find / .filter — must not throw
    expect(() => snap.all.find(() => true)).not.toThrow();
    expect(() => snap.byUid.get("missing")).not.toThrow();
    expect(snap.all.filter(() => true)).toEqual([]);
  });

  test("AC 8 — snapshot is frozen (defence against accidental consumer-side mutation)", () => {
    const repo = new RelationColumnSetRepository(adapterWith({}));
    repo.initialize();
    const snap = repo.getSnapshot();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.all)).toBe(true);
  });

  test("AC 9 — MetadataHelpers.getPropertyValue preserves its signature", () => {
    // Runtime-shape assertion — fails loudly if upstream rotates arity/types.
    const fn = MetadataHelpers.getPropertyValue;
    expect(typeof fn).toBe("function");
    expect(fn.length).toBe(2);
    const result = fn(
      {
        title: "demo",
        created: 123,
        modified: 456,
        path: "demo.md",
        metadata: { foo: "bar" },
      },
      "foo",
    );
    expect(result).toBe("bar");
  });

  test("AC 9 — MetadataHelpers.getPropertyValue well-known field short-circuits", () => {
    // Exercises every literal-branch the Repository has no business knowing
    // about but that ownership of the signature implies.
    const relation = {
      title: "T",
      created: 1,
      modified: 2,
      path: "p",
      metadata: { custom: "C" },
    };
    expect(MetadataHelpers.getPropertyValue(relation, "Name")).toBe("T");
    expect(MetadataHelpers.getPropertyValue(relation, "title")).toBe("T");
    expect(MetadataHelpers.getPropertyValue(relation, "created")).toBe(1);
    expect(MetadataHelpers.getPropertyValue(relation, "modified")).toBe(2);
    expect(MetadataHelpers.getPropertyValue(relation, "path")).toBe("p");
    expect(MetadataHelpers.getPropertyValue(relation, "custom")).toBe("C");
    expect(MetadataHelpers.getPropertyValue(relation, "missing")).toBeUndefined();
  });
});
