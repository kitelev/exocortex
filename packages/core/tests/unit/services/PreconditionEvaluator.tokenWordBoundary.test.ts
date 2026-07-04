/**
 * `PreconditionEvaluator.substituteVariables` word-boundary token substitution
 * (req 9bff6eb9 / #3811 review LOW #1).
 *
 * The method text-substitutes calendar-date tokens (`$today`, `$now`,
 * `$yesterday`, …) into a precondition-SPARQL ASK. The token regexes were
 * formerly unanchored (`.replace(/\$today/g, …)`), so a `sparqlAsk` containing
 * `$todayStart` (an executor / SubstitutionToken form, NOT a documented
 * precondition token) had its `$today` prefix replaced → `"YYYY-MM-DD"^^xsd:date`
 * + a stray `Start` = `"…"^^xsd:dateStart` (a malformed, silently-wrong literal).
 *
 * The fix anchors every calendar-date token regex with a trailing `\b` word
 * boundary (matching the `GroundingExecutor` `/\$todayStart\b/` convention), so
 * an unknown token whose name merely shares a prefix with a supported one is left
 * LITERAL — the SPARQL parser then rejects it loudly (fail-loud) rather than
 * substituting a mangled datatype.
 *
 * Revert-verify ([[integration-test-revert-verify]]): removing the `\b` from
 * `/\$today\b/g` makes `substituteVariables("$todayStart")` return a mangled
 * `"…"^^xsd:dateStart` (≠ `"$todayStart"`) → RED; restored with `\b` → GREEN. The
 * assertion compares against the literal unchanged token, so it is
 * date-independent (no fake clock needed).
 *
 * @req:9bff6eb9-c8c2-4931-a93d-331334fc6e15
 */
import { PreconditionEvaluator } from "../../../src/services/PreconditionEvaluator";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";

describe("PreconditionEvaluator token substitution is word-boundary-anchored (req 9bff6eb9 / #3811 LOW #1)", () => {
  const ASSET_IRI = "https://exocortex.my/ontology/ems/test-asset-123";
  const evaluator = new PreconditionEvaluator(new InMemoryTripleStore());

  it("leaves an unknown $token that shares a prefix with a supported one LITERAL (no partial rewrite) @req:9bff6eb9-c8c2-4931-a93d-331334fc6e15", () => {
    // `$todayStart` shares the `$today` prefix. Without the `\b` boundary the
    // `$today` regex clobbers the prefix → `"YYYY-MM-DD"^^xsd:dateStart` (mangled).
    // With `\b` the whole token is left verbatim (an unknown token the SPARQL
    // parser rejects loudly).
    const todayStart = evaluator.substituteVariables("$todayStart", ASSET_IRI);
    expect(todayStart).toBe("$todayStart");
    // Guard the exact mangle the revert produces (`"…"^^xsd:dateStart`) — defeats
    // a false-GREEN where the token vanished/substituted for some other reason.
    expect(todayStart).not.toContain("^^xsd:date");

    // Same class of collision for the `$now` prefix (`$nowCompact` / `$nowLocal`
    // are executor tokens, not precondition tokens) — the sweep covers every
    // calendar-date regex, not just `$today`.
    expect(evaluator.substituteVariables("$nowCompact", ASSET_IRI)).toBe("$nowCompact");
    expect(evaluator.substituteVariables("$nowLocal", ASSET_IRI)).toBe("$nowLocal");
  });

  it("still substitutes every VALID token (word boundary is not a regression) @req:9bff6eb9-c8c2-4931-a93d-331334fc6e15", () => {
    // A standalone valid token, and one embedded in a real ASK, both substitute.
    const today = evaluator.substituteVariables("$today", ASSET_IRI);
    expect(today).toMatch(/^"\d{4}-\d{2}-\d{2}"\^\^xsd:date$/);
    expect(today).not.toContain("$today");

    const now = evaluator.substituteVariables("$now", ASSET_IRI);
    expect(now).toMatch(/\^\^xsd:dateTime$/);

    const ask = evaluator.substituteVariables(
      "ASK { $target ems:plannedDate ?d . FILTER(?d = $today && ?d >= $thisWeekStart) }",
      ASSET_IRI,
    );
    expect(ask).toContain(`<${ASSET_IRI}>`); // $target → IRI
    expect(ask).not.toContain("$today");
    expect(ask).not.toContain("$thisWeekStart");
    expect(ask).toContain("^^xsd:date"); // both date tokens materialised
  });
});
