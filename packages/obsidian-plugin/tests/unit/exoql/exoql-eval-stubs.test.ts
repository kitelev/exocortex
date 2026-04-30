/**
 * PR1 TDD red-anchors for the BDD scenarios in
 * packages/obsidian-plugin/specs/features/exoql/exoql-eval.feature.
 *
 * Each `it.failing(...)` mirrors one Gherkin scenario and asserts the
 * eventual public API surface that PR2 (parser + executor) and PR3
 * (flag flip + dogfood) must satisfy. While the implementation is
 * absent, every assertion throws — `it.failing` inverts that into a
 * passing CI signal. PR2/PR3 will flip each stub to `it(...)` once the
 * referenced module exists.
 *
 * Coverage attribution lives in
 * packages/obsidian-plugin/coverage-mapping.json (status: "covered"
 * manual override per scripts/bdd-coverage.js §matchScenariosWithTests).
 *
 * RFC: c78cc5c8 Phase 1a.
 */

// The eval entry-point will be exported from packages/exocortex/src/exoql in PR2.
// Importing a not-yet-existing symbol via a deferred require keeps PR1 jest-loadable
// while still making the assertions fail naturally.
function loadExoQLEval(): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const exoql = require("../../../../exocortex/src/exoql");
  return (exoql as Record<string, unknown>).evaluateWithExoEval;
}

describe("exoql__Query + exo:eval — BDD red anchors (PR1)", () => {
  it.failing("happy path: exo:eval(?uid) returns rows of the referenced exoql__Query body", () => {
    const evaluate = loadExoQLEval() as undefined | ((sparql: string) => unknown[]);
    expect(typeof evaluate).toBe("function");
    expect(evaluate!("SELECT ?s WHERE { BIND(exo:eval(<urn:uid:Q-base>) AS ?s) }")).toEqual([]);
  });

  it.failing("parser rejection (SERVICE/FROM/LOAD/UPDATE) raises ExoQLForbiddenKeywordError on parse-stage", () => {
    const evaluate = loadExoQLEval() as undefined | ((sparql: string) => unknown);
    expect(typeof evaluate).toBe("function");
    for (const keyword of ["SERVICE", "FROM", "LOAD", "UPDATE"]) {
      expect(() => evaluate!(`SELECT * WHERE { ${keyword} <x> }`)).toThrow(/ExoQLForbiddenKeywordError/);
    }
  });

  it.failing("cycle detection: eval(A)→eval(B)→eval(A) raises ExoQLCycleError with path A→B→A", () => {
    const evaluate = loadExoQLEval() as undefined | ((sparql: string) => unknown);
    expect(typeof evaluate).toBe("function");
    expect(() => evaluate!("SELECT * WHERE { BIND(exo:eval(<urn:uid:A>) AS ?x) }")).toThrow(/ExoQLCycleError.*A.*B.*A/s);
  });

  it.failing("nested-eval-count budget: 101st nested invocation raises ExoQLBudgetExceededError", () => {
    const evaluate = loadExoQLEval() as undefined | ((sparql: string) => unknown);
    expect(typeof evaluate).toBe("function");
    expect(() => evaluate!("SELECT * WHERE { /* fan-out 101 */ }"))
      .toThrow(/ExoQLBudgetExceededError.*nested-eval-count/);
  });

  it.failing("aggregate-eval-millis budget: > 10s aggregate raises ExoQLBudgetExceededError", () => {
    const evaluate = loadExoQLEval() as undefined | ((sparql: string) => unknown);
    expect(typeof evaluate).toBe("function");
    expect(() => evaluate!("SELECT * WHERE { /* slow nested evals */ }"))
      .toThrow(/ExoQLBudgetExceededError.*aggregate-eval-millis/);
  });
});
