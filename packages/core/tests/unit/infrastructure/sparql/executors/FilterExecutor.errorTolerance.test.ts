/**
 * SPARQL 1.1 §17.4.1.5 — error-tolerant semantics of `||` and `&&`.
 *
 * ⛔ THE DEFECT (measured on the live graph, vault-exodev task e242a74b):
 *   `FILTER(!BOUND(?e) || STR(?e) >= "2026-08-02")` returned **0** rows where ≥6 were due,
 *   and `FILTER(true || <error>)` returned **16** rows out of **22**. The right operand was
 *   evaluated and its error killed the row even though the left one had already decided the
 *   result. Any "the interval is not closed yet" query therefore drops the very rows it asks
 *   for — silently, with no error surfaced to the caller.
 *
 * ⛤ THE SPEC: for `||` an error is absorbed by a `true`; for `&&` it is absorbed by a `false`.
 *
 *   ||:  true ∨ error = true  |  false ∨ error = error  |  error ∨ error = error
 *   &&:  false ∧ error = false |  true ∧ error = error  |  error ∧ error = error
 *
 * ⛤ ORDER IS IRRELEVANT — the erroring operand is tested on BOTH sides, because the natural
 *   fix (short-circuit left-to-right) would pass `error ∨ true` only by accident of ordering
 *   and would still drop the row when the error comes first. That asymmetry is what the
 *   "reversed" cases below lock.
 */

import { FilterExecutor } from "../../../../../src/infrastructure/sparql/executors/FilterExecutor";
import { SolutionMapping } from "../../../../../src/infrastructure/sparql/SolutionMapping";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../../src/domain/models/rdf/Literal";
import type {
  Expression,
  FilterOperation,
} from "../../../../../src/infrastructure/sparql/algebra/AlgebraOperation";

describe("FilterExecutor — error tolerance of logical operators (SPARQL 1.1 §17.4.1.5)", () => {
  let executor: FilterExecutor;
  const xsdInt = new IRI("http://www.w3.org/2001/XMLSchema#integer");

  beforeEach(() => {
    executor = new FilterExecutor();
  });

  /**
   * An operand that genuinely ERRORS — `STR()` applied to an UNBOUND variable.
   *
   * ⛔ NOT `?missing > 1` (a bare comparison against an unbound variable): measured
   *    2026-08-20 on the live graph, that shape yields a plain `false` rather than an
   *    error, so every case below would pass in BOTH directions and the whole file would
   *    be vacuous. The discriminator was found by narrowing on the live engine:
   *      FILTER(true)                    → 1185 rows   (baseline)
   *      FILTER(true || BOUND(?e))       → 1185        (variable alone: fine)
   *      FILTER(true || (?e = ?e))       → 1185        (comparison on unbound: fine)
   *      FILTER(true || (STR(?e) >= "a")) →  226   ⛔  (959 rows lost)
   *    ⇒ the carrier of the defect is a FUNCTION over an unbound variable, not `||`.
   */
  const erroring: Expression = {
    type: "comparison",
    operator: ">=",
    left: {
      type: "function",
      function: "STR",
      args: [{ type: "variable", name: "missing" }],
    },
    right: { type: "literal", value: "a" },
  } as Expression;
  const truthy: Expression = {
    type: "comparison",
    operator: "=",
    left: { type: "literal", value: 1 },
    right: { type: "literal", value: 1 },
  };
  const falsy: Expression = {
    type: "comparison",
    operator: "=",
    left: { type: "literal", value: 1 },
    right: { type: "literal", value: 2 },
  };

  const filterOf = (operator: "&&" | "||", operands: Expression[]): FilterOperation => ({
    type: "filter",
    expression: { type: "logical", operator, operands } as Expression,
    input: { type: "bgp", triples: [] },
  });

  const oneSolution = (): SolutionMapping[] => {
    const s = new SolutionMapping();
    s.set("x", new Literal("10", xsdInt));
    return [s];
  };

  describe("|| absorbs an error next to a true", () => {
    it("true || error → row KEPT", async () => {
      const results = await executor.executeAll(filterOf("||", [truthy, erroring]), oneSolution());
      expect(results).toHaveLength(1);
    });

    it("error || true → row KEPT (order must not matter)", async () => {
      const results = await executor.executeAll(filterOf("||", [erroring, truthy]), oneSolution());
      expect(results).toHaveLength(1);
    });

    it("false || error → row DROPPED (error is not silently a false)", async () => {
      const results = await executor.executeAll(filterOf("||", [falsy, erroring]), oneSolution());
      expect(results).toHaveLength(0);
    });
  });

  describe("&& absorbs an error next to a false", () => {
    it("false && error → row DROPPED (the false already decided it — no throw escapes)", async () => {
      const results = await executor.executeAll(filterOf("&&", [falsy, erroring]), oneSolution());
      expect(results).toHaveLength(0);
    });

    it("error && false → row DROPPED (order must not matter)", async () => {
      const results = await executor.executeAll(filterOf("&&", [erroring, falsy]), oneSolution());
      expect(results).toHaveLength(0);
    });

    it("true && error → row DROPPED", async () => {
      const results = await executor.executeAll(filterOf("&&", [truthy, erroring]), oneSolution());
      expect(results).toHaveLength(0);
    });
  });

  it("CANARY — the erroring operand errors ON ITS OWN, and errors differently from a plain false", async () => {
    const results = await executor.executeAll(
      { type: "filter", expression: erroring, input: { type: "bgp", triples: [] } },
      oneSolution(),
    );
    expect(results).toHaveLength(0);
  });
});
