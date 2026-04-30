Feature: exoql__Query + exo:eval SPARQL builtin (Phase 1a MVP)
  As a vault author who stores SPARQL queries as first-class assets
  I want a SPARQL builtin `exo:eval(?uid)` that executes the body of an exoql__Query asset
  So that one query can be composed of other queries (homoiconicity)

  RFC: c78cc5c8 Phase 1a — exoql__Query + exo:eval MVP
  Source-of-truth tests: packages/obsidian-plugin/tests/unit/exoql/exoql-eval-stubs.test.ts
                         packages/exocortex/tests/unit/exoql/drift-guard-function-registry.test.ts

  These scenarios are intentionally **pending** in PR1 — they describe behaviour that PR2
  (parser + executor) and PR3 (flag flip + dogfood) will deliver. Steps are unimplemented
  on purpose; cucumber reports them as undefined and the `test-bdd` job is configured
  with `continue-on-error: true` for `npm run bdd:test` while `bdd:check` (coverage)
  is satisfied via `coverage-mapping.json` `status: "covered"` overrides.

  Background:
    Given the feature flag "exoql.eval.enabled" is true
    And the vault contains an exoql__Query asset "Q-base" with SELECT body

  @phase1a @exoql @eval @happy
  Scenario: exo:eval happy path returns rows from a referenced exoql__Query
    Given I issue a SPARQL SELECT that contains "exo:eval(<urn:uid:Q-base>)"
    When the engine evaluates the outer query
    Then the result rows equal the result rows of "Q-base" body executed standalone
    And no security warning is logged

  @phase1a @exoql @eval @parser-rejection
  Scenario Outline: parser rejects forbidden SPARQL keywords on parse-stage (AST allowlist)
    Given I have an exoql__Query body containing the keyword "<keyword>"
    When the AST-allowlist parser inspects the body
    Then the parser raises an "ExoQLForbiddenKeywordError"
    And the error message names the keyword "<keyword>"
    And the query is never executed against the triple store

    Examples:
      | keyword |
      | SERVICE |
      | FROM    |
      | LOAD    |
      | UPDATE  |

  @phase1a @exoql @eval @cycle-detection
  Scenario: cycle detection terminates eval(A)→eval(B)→eval(A)
    Given exoql__Query "A" body invokes "exo:eval(<urn:uid:B>)"
    And exoql__Query "B" body invokes "exo:eval(<urn:uid:A>)"
    When the engine evaluates "A" as the top-level query
    Then evaluation terminates with an "ExoQLCycleError"
    And the error path lists "A → B → A"
    And no infinite loop occurs

  @phase1a @exoql @eval @budget-overflow
  Scenario: global eval-budget rejects nested>100 invocations per top-level query
    Given a top-level query that fan-outs to 101 nested "exo:eval" calls
    When the engine begins evaluation
    Then the 101st invocation raises an "ExoQLBudgetExceededError"
    And the error names the budget "nested-eval-count"
    And no further evaluations are attempted

  @phase1a @exoql @eval @budget-overflow
  Scenario: global eval-budget rejects aggregate runtime > 10 seconds per top-level query
    Given a top-level query whose nested evals collectively exceed 10 seconds wall-clock
    When the engine begins evaluation
    Then the engine raises an "ExoQLBudgetExceededError"
    And the error names the budget "aggregate-eval-millis"
    And partial results are not returned
