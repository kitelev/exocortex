/**
 * #4401 — a Layout filter on a camelCase / hyphenated / digit-bearing namespace
 * produced a query that matched nothing, in TWO independent ways:
 *
 *   1. `toPrefixedName` parsed the name with a local `/^([a-z]+)__(.+)$/`, which
 *      cannot see `K` in `aiKnow`, the `-` in `tbank-nessy` or the digits in
 *      `exo003`. The name went into the query RAW.
 *   2. `buildPrefixes` emitted only the hardcoded `SPARQL_PREFIXES` whitelist,
 *      so even a correctly compacted `aiKnow:Memory` referenced an UNDECLARED
 *      prefix.
 *
 * Fixing only the first yields a regex that "looks fixed" and still returns
 * nothing — which is why every axis below asserts BOTH halves: the compact name
 * appears AND its prefix is declared.
 *
 * The control is the 48-case `LayoutQueryBuilder.test.ts` suite next door: it
 * pins the existing `exo`/`ems` output, so a fix that changed those would redden
 * there rather than here.
 */

import {
  LayoutQueryBuilder,
  SPARQL_PREFIXES,
} from "../../../../src/application/layout/LayoutQueryBuilder";
import type { Layout } from "../../../../src/domain/layout";

const ONTOLOGY = "https://exocortex.my/ontology/";

function layoutFilteredOn(targetClass: string, propertyName: string): Layout {
  return {
    id: "layout-4401",
    type: "table",
    targetClass,
    columns: [{ property: propertyName, label: "Col", type: "text" }],
  } as unknown as Layout;
}

function queryFor(targetClass: string, propertyName: string): string {
  const result = new LayoutQueryBuilder().build(
    layoutFilteredOn(targetClass, propertyName),
  );
  expect(result.success).toBe(true);
  return result.query as string;
}

describe("#4401 Layout filters work for every well-formed namespace", () => {
  // One row per SHAPE of prefix, not folded into a single assert: each breaks a
  // different character class of the old regex, so a single failure names which
  // shape regressed.
  const SHAPES: Array<[string, string, string, string]> = [
    ["camelCase", "aiKnow", "aiKnow__Memory", "aiKnow__Memory_source"],
    ["hyphenated", "tbank-nessy", "tbank-nessy__Deal", "tbank-nessy__Deal_stage"],
    ["digit-bearing", "exo003", "exo003__Thing", "exo003__Thing_note"],
  ];

  // ⛔ The two halves are SEPARATE axes on purpose. Folded into one assert, the
  // "narrow grammar" and the "missing declaration" mutants would redden exactly
  // the same axis name, and a matrix could not tell whether both halves are
  // actually pinned or only one of them is.
  it.each(SHAPES)(
    "D1 %s namespace is compacted instead of passed through raw",
    (_shape, prefix, className, propertyName) => {
      const query = queryFor(className, propertyName);
      expect(query).toContain(`${prefix}:${className.split("__")[1]}`);
      expect(query).not.toContain(className); // the raw `ns__Local` form is gone
    },
  );

  it.each(SHAPES)(
    "D1b %s namespace is actually DECLARED — a compact name alone matches nothing",
    (_shape, prefix, className, propertyName) => {
      const query = queryFor(className, propertyName);
      expect(query).toContain(`PREFIX ${prefix}: <${ONTOLOGY}${prefix}#>`);
    },
  );

  it("D2 an unrelated namespace is NOT declared — the query asks for what it uses", () => {
    // Control for D1's second half: declaring every known namespace would pass
    // every row above while making the emitted prefix block a function of the
    // vault rather than of the query.
    const query = queryFor("aiKnow__Memory", "aiKnow__Memory_source");
    expect(query).not.toContain("PREFIX tbank-nessy:");
    expect(query).not.toContain("PREFIX exo003:");
  });

  it("D3 the always-on table is still emitted first, in its original order", () => {
    // The byte-identity requirement of the DoD, stated as an order assertion:
    // an `exo`/`ems` query must not acquire new lines or a new arrangement.
    const query = queryFor("ems__Task", "ems__Effort_status");
    const prefixLines = query
      .split("\n")
      .filter((l) => l.startsWith("PREFIX "));
    expect(prefixLines).toEqual(
      Object.entries(SPARQL_PREFIXES).map(
        ([p, uri]) => `PREFIX ${p}: <${uri}>`,
      ),
    );
  });

  it("D4 a reused builder declares nothing the query does not mention", () => {
    // `usedPrefixes` is instance state; without the reset in `build()` the
    // second query declares a namespace from the first — a leak no single-query
    // axis can see.
    //
    // ⛔ Stated as an INVARIANT ("every non-always-on prefix declared is one the
    // body uses"), not as `not.toContain("PREFIX aiKnow:")` after asserting the
    // first query declares it. That earlier form embedded D1b's condition, so
    // every mutant that broke declaration reddened this axis too and the matrix
    // could not show what D4 alone pins.
    const builder = new LayoutQueryBuilder();
    builder.build(layoutFilteredOn("aiKnow__Memory", "aiKnow__Memory_source"));
    const second = builder.build(
      layoutFilteredOn("ems__Task", "ems__Effort_status"),
    );

    const query = second.query as string;
    const [prefixBlock, ...bodyLines] = [
      query.split("\n").filter((l) => l.startsWith("PREFIX ")),
      query.split("\n").filter((l) => !l.startsWith("PREFIX ")),
    ];
    const body = bodyLines.flat().join("\n");
    const leaked = prefixBlock
      .map((l) => /^PREFIX ([^:]+):/.exec(l)?.[1] ?? "")
      .filter((p) => !(p in SPARQL_PREFIXES))
      .filter((p) => !body.includes(`${p}:`));
    expect(leaked).toEqual([]);
  });
});
