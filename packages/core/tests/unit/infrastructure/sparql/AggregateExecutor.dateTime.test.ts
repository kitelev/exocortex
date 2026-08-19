/**
 * MIN/MAX over xsd:dateTime — SPARQL 1.1 §18.5.1.3/.4.
 *
 * ⛔ THE DEFECT (measured on the live graph, vault-exodev task 0c24668f):
 *   `MAX(?dateTime)` returned `"2026"^^xsd:decimal` instead of the timestamp. Both
 *   `computeMax` and `computeMin` decide numeric-vs-lexical by whether `parseFloat`
 *   succeeds — and `parseFloat` takes the NUMERIC PREFIX of a string:
 *
 *     node -e 'console.log(parseFloat("2026-08-02T20:07:15"))'   →   2026   (isNaN: false)
 *
 *   so every ISO-8601 timestamp is read as its year, `Math.max` compares years, and the
 *   caller stamps the result `xsd:decimal`. `ORDER BY DESC(?dateTime)` sorts correctly —
 *   the defect is in the AGGREGATES, not in date comparison.
 *
 * ⛤ WORSE THAN "dates break": it breaks MIXED sets too. One numeric value among dates
 *   makes `nums.length > 0` true, so ALL dates collapse to their years while the
 *   non-numeric ones are silently dropped by the `isNaN` filter — the aggregate then
 *   answers over a subset nobody asked for.
 *
 * ⛤ MIN and MAX are byte-identical in shape, so both are locked here: fixing only the
 *   one you noticed leaves the sibling broken with a green suite ("fixed the instance,
 *   not the class").
 */

import { AggregateExecutor } from "../../../../src/infrastructure/sparql/executors/AggregateExecutor";
import { SolutionMapping } from "../../../../src/infrastructure/sparql/SolutionMapping";
import { Literal } from "../../../../src/domain/models/rdf/Literal";
import { IRI } from "../../../../src/domain/models/rdf/IRI";
import type {
  GroupOperation,
  AggregateBinding,
} from "../../../../src/infrastructure/sparql/algebra/AlgebraOperation";

describe("AggregateExecutor — MIN/MAX over xsd:dateTime (SPARQL 1.1 §18.5.1.3/.4)", () => {
  let executor: AggregateExecutor;
  const xsdDateTime = new IRI("http://www.w3.org/2001/XMLSchema#dateTime");
  const xsdInt = new IRI("http://www.w3.org/2001/XMLSchema#integer");

  beforeEach(() => {
    executor = new AggregateExecutor();
  });

  const sol = (bindings: Record<string, unknown>): SolutionMapping => {
    const s = new SolutionMapping();
    for (const [k, v] of Object.entries(bindings)) s.set(k, v as never);
    return s;
  };

  // ⛤ Форма взята ДОСЛОВНО из работающего AggregateExecutor.test.ts (`createGroupOperation` /
  //    `createMaxAggregate`): поля называются `variables` и `aggregation`, а не `groupBy`/`function`.
  //    Изобретённая по памяти форма роняла ВСЕ пять осей, включая канарейку, на
  //    `groupVariables.length` — то есть набор был бы красным по причине, к предмету не относящейся.
  const groupOf = (fn: "min" | "max", out: string, variable: string): GroupOperation => ({
    type: "group",
    variables: [],
    aggregates: [
      {
        variable: out,
        expression: { type: "aggregate", aggregation: fn, expression: { type: "variable", name: variable }, distinct: false },
      } as unknown as AggregateBinding,
    ],
    input: { type: "bgp", patterns: [] },
  } as unknown as GroupOperation);

  const raw = (s: SolutionMapping, v: string): { value: string; datatype: string } => {
    const t = s.get(v) as Literal;
    return { value: t.value, datatype: String((t as unknown as { datatype?: IRI }).datatype ?? "") };
  };

  const stamps = [
    new Literal("2026-08-02T20:07:15", xsdDateTime),
    new Literal("2026-08-19T04:31:00", xsdDateTime),
    new Literal("2026-01-05T11:00:00", xsdDateTime),
  ];

  it("MAX returns the LATEST timestamp, not its year", () => {
    const out = executor.execute(groupOf("max", "m", "t"), stamps.map((t) => sol({ t })));
    expect(raw(out[0], "m").value).toBe("2026-08-19T04:31:00");
  });

  it("MAX keeps the datatype a dateTime, not xsd:decimal", () => {
    const out = executor.execute(groupOf("max", "m", "t"), stamps.map((t) => sol({ t })));
    expect(raw(out[0], "m").datatype).not.toContain("decimal");
  });

  it("MIN returns the EARLIEST timestamp — the sibling breaks identically", () => {
    const out = executor.execute(groupOf("min", "m", "t"), stamps.map((t) => sol({ t })));
    expect(raw(out[0], "m").value).toBe("2026-01-05T11:00:00");
  });

  it("a MIXED set does not collapse dates into years because one number is present", () => {
    const mixed = [...stamps.map((t) => sol({ t })), sol({ t: new Literal("42", xsdInt) })];
    const out = executor.execute(groupOf("max", "m", "t"), mixed);
    // whatever the spec-correct winner is, it must NOT be the bare year of a timestamp
    expect(raw(out[0], "m").value).not.toBe("2026");
  });

  it("CANARY — plain numbers still aggregate numerically (the fix must not break them)", () => {
    const nums = [10, 30, 20].map((n) => sol({ t: new Literal(String(n), xsdInt) }));
    const out = executor.execute(groupOf("max", "m", "t"), nums);
    expect(raw(out[0], "m").value).toBe("30");
  });
});
