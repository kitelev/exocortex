/**
 * req 869561bf — the frontmatter primitives must match a property key ONLY at
 * line start.
 *
 * Why this file exists separately from the GroundingExecutor axes: `hasProperty`
 * gates BOTH writers, so on a fixture that carries only the colliding neighbour
 * the gate returns false and the inner regexes are never reached. Those axes
 * therefore exercise exactly one of the four anchors. Un-anchoring
 * `updateProperty` / `removeProperty` / `getPropertyValue` passes the whole
 * suite green — which is the same shape of blind spot that let the original
 * collision survive eight otherwise-green revert-verify axes. Reaching them
 * needs a fixture where BOTH the real key and the colliding text are present.
 *
 * Two collision shapes, both present in shipped frontmatter:
 *  1. a NEIGHBOURING KEY ending in the searched word (`namespace_aliases` vs
 *     `aliases`);
 *  2. the searched word followed by `:` INSIDE A VALUE or an array item — e.g.
 *     `packages/exoas-exocmd/exocmd/059605d1-….md` carries
 *     `exo__Asset_label: "PropertyDefault: exo__Instance_class = …"` and the
 *     same string as an `aliases` item.
 *
 * The collision is STRUCTURALLY reachable rather than a demonstrated live
 * corruption: the searched name comes from vault data (`grounding.targetProperty`),
 * CLI flags and user-edited property rows, so it is not a closed set — and
 * canonicalisation (req 869561bf) shortened the searched key to one of four
 * ordinary English words, which widened the surface considerably.
 *
 * Revert-verify: removing the `^` / `(?:\n|^)` anchor from ANY of the three
 * inner matchers reddens this file; `hasProperty`'s anchor is covered by the
 * GroundingExecutor axes.
 */
import { describe, it, expect } from "@jest/globals";
import { FrontmatterService } from "../../src/utilities/FrontmatterService";
import { parseFrontmatterAsReader } from "@kitelev/exocortex-test-utils";

/** Neighbour FIRST, so the gate passes on the real key and the inner matchers run. */
const NEIGHBOUR_THEN_REAL = [
  "---",
  'namespace_aliases:',
  '  - "ims"',
  '  - "concept"',
  'aliases:',
  '  - "Real alias"',
  "foo: bar",
  "---",
  "Body",
].join("\n");

function frontmatterOf(content: string): Record<string, unknown> {
  const m = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!m) throw new Error("no frontmatter");
  return parseFrontmatterAsReader(content);
}

describe("FrontmatterService — key matching is anchored to line start (req 869561bf)", () => {
  const fm = new FrontmatterService();

  it("removeProperty removes ONLY the real key, leaving the colliding neighbour whole", () => {
    const out = fm.removeProperty(NEIGHBOUR_THEN_REAL, "aliases");
    const parsed = frontmatterOf(out);

    expect(parsed.aliases).toBeUndefined();
    // un-anchored, the match started inside `namespace_aliases:` and truncated
    // it to a bare `namespace_` — not valid YAML, so the whole block stopped
    // parsing and the asset dropped out of Obsidian AND the RDF graph
    expect(parsed.namespace_aliases).toEqual(["ims", "concept"]);
    expect(parsed.foo).toBe("bar");
    expect(out).not.toContain("namespace_\n");
  });

  it("updateProperty rewrites ONLY the real key, leaving the colliding neighbour whole", () => {
    const out = fm.updateProperty(NEIGHBOUR_THEN_REAL, "aliases", '"Replaced"');
    const parsed = frontmatterOf(out);

    expect(parsed.aliases).toBe("Replaced");
    expect(parsed.namespace_aliases).toEqual(["ims", "concept"]);
  });

  it("getPropertyValue reads the real key, not the colliding neighbour", () => {
    // Scalar values here, not block lists: `getPropertyValue` is a scalar
    // reader (`\s*` in its pattern spans the newline), so a list fixture would
    // blur the discriminator. With the neighbour FIRST an unanchored read
    // matched mid-line inside `namespace_aliases:` and returned NEIGHBOUR.
    const inner = [
      "namespace_aliases: NEIGHBOUR",
      "aliases: REAL",
      "foo: bar",
    ].join("\n");

    expect(fm.getPropertyValue(inner, "aliases")).toBe("REAL");
    expect(fm.getPropertyValue(inner, "namespace_aliases")).toBe("NEIGHBOUR");
    expect(fm.getPropertyValue(inner, "foo")).toBe("bar");
  });

  it("does not match the searched word when it occurs INSIDE a value", () => {
    const content = [
      "---",
      'exo__Asset_label: "PropertyDefault: exo__Instance_class = $targetClassSelf"',
      "foo: bar",
      "---",
      "Body",
    ].join("\n");

    // no such KEY exists — the occurrence is inside a value
    const inner = /^---\n([\s\S]*?)\n---/.exec(content)![1];
    expect(fm.hasProperty(inner, "PropertyDefault")).toBe(false);
    expect(fm.getPropertyValue(inner, "PropertyDefault")).toBeNull();

    // …so removing it is a no-op rather than a mid-value cut
    const out = fm.removeProperty(content, "PropertyDefault");
    expect(frontmatterOf(out).exo__Asset_label).toBe(
      "PropertyDefault: exo__Instance_class = $targetClassSelf",
    );
  });

  it("does not match the searched word inside an ARRAY ITEM", () => {
    const content = [
      "---",
      "aliases:",
      '  - "PropertyDefault: exo__Instance_class = $targetClassSelf"',
      "foo: bar",
      "---",
      "Body",
    ].join("\n");

    const out = fm.removeProperty(content, "PropertyDefault");
    expect(frontmatterOf(out).aliases).toEqual([
      "PropertyDefault: exo__Instance_class = $targetClassSelf",
    ]);
  });
});
