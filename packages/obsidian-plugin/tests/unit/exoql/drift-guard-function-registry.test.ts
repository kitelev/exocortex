/**
 * Drift-guard for the SPARQL FunctionRegistry.
 *
 * RFC c78cc5c8 Phase 1a — exoql__Query + exo:eval MVP (PR1 / T1).
 *
 * Two assertions live here:
 *
 *  1. **Snapshot drift guard (green now, fires on any regression)** — asserts that
 *     the sorted set of registered SPARQL function handler keys exactly equals an
 *     inline manifest. If anyone adds, removes, or renames a function without
 *     updating this manifest, the test fails — making registry drift an explicit
 *     review gate, not a silent breaking change.
 *
 *  2. **TDD red anchor for `exo:eval`** — asserts that `exo:eval` is registered.
 *     Currently the registry does NOT have this key, so the assertion fails;
 *     `it.failing()` inverts the expectation, so on PR1 the test is GREEN in CI
 *     (failing-as-expected). When PR2 (T2) registers `exo:eval`, the assertion
 *     starts passing — `it.failing` then flips back to FAILING, signalling PR2 to
 *     convert this stub to a regular `it()`.
 *
 *  The pair satisfies AC «Drift-guard test stub: ломается при regression в SPARQL
 *  function registry / config» + «scenarios + drift-guard падают (red) —
 *  implementation отсутствует»: assertion (2) is genuinely red on PR1 (masked via
 *  `it.failing`), and assertion (1) becomes red on any future drift.
 */

import { functionHandlers } from "../../../../core/src/infrastructure/sparql/filters/FunctionRegistry";

const EXPECTED_FUNCTIONS_INCLUDING_EXOQL_EVAL: ReadonlyArray<string> = [
  "abs",
  "adjust",
  "age_days",
  "bound",
  "ceil",
  "concat",
  "contains",
  "datatype",
  "dateafter",
  "datebefore",
  "datediffhours",
  "datediffminutes",
  "dateinrange",
  "datetime",
  "datetimeadd",
  "datetimediff",
  "datetimesubtract",
  "day",
  "days",
  "days_between",
  "daytimeduration",
  "decimal",
  "durationdays",
  "durationhours",
  "durationminutes",
  "durationmonths",
  "durationseconds",
  "durationtodays",
  "durationtohours",
  "durationtominutes",
  "durationtoseconds",
  "durationyears",
  "encode_for_uri",
  "exo:eval",
  "floor",
  "format_date",
  "haslangdir",
  "hours",
  "hours_between",
  "integer",
  "isblank",
  "isiri",
  "isliteral",
  "isnumeric",
  "istriple",
  "isuri",
  "lang",
  "langmatches",
  "lcase",
  "md5",
  "minutes",
  "minutes_between",
  "month",
  "months",
  "mstohours",
  "mstominutes",
  "mstoseconds",
  "now",
  "object",
  "parsedate",
  "predicate",
  "rand",
  "regex",
  "replace",
  "round",
  "sameterm",
  "seconds",
  "sha1",
  "sha256",
  "sha384",
  "sha512",
  "str",
  "strafter",
  "strbefore",
  "strends",
  "strlen",
  "strstarts",
  "subject",
  "substr",
  "timezone",
  "triple",
  "tz",
  "ucase",
  "week_number",
  "xsd:datetime",
  "xsd:daytimeduration",
  "xsd:decimal",
  "xsd:integer",
  "year",
  "years",
];

describe("drift-guard: SPARQL FunctionRegistry", () => {
  it("registry sorted keys match the inline manifest exactly", () => {
    const actual = Array.from(functionHandlers.keys()).sort();
    const expected = [...EXPECTED_FUNCTIONS_INCLUDING_EXOQL_EVAL].sort();
    expect(actual).toEqual(expected);
  });

  // PR2 (T2) flipped this from `it.failing` to `it(...)` once the handler
  // landed in FunctionRegistry. The presence of `exo:eval` is now an
  // affirmative invariant; removing the registration breaks this test.
  it("exo:eval is registered as a SPARQL builtin (PR2 — T2)", () => {
    expect(functionHandlers.has("exo:eval")).toBe(true);
  });
});
