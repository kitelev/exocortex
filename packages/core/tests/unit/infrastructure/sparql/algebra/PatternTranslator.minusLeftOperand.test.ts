import { PatternTranslator } from "../../../../../src/infrastructure/sparql/algebra/PatternTranslator";
import type { AlgebraOperation } from "../../../../../src/infrastructure/sparql/algebra/AlgebraOperation";
import type {
  SparqljsPattern,
  SparqljsExpression,
} from "../../../../../src/infrastructure/sparql/SparqljsTypes";
import type { SelectQuery } from "../../../../../src/infrastructure/sparql/SPARQLParser";

/**
 * MINUS must subtract from the PRECEDING patterns, not from nothing.
 *
 * SPARQL 1.1 §8.3.2 / §18.5: `{ P } MINUS { Q }` is `Diff(eval(P), eval(Q))`.
 * The left operand of the algebra's Minus IS the group that precedes it.
 *
 * ⛔ The defect: `translateWhere` had a dedicated branch for OPTIONAL (which
 * correctly threads `left: result`) but NOT for MINUS, so MINUS fell into the
 * generic `else` and became `Join(P, Minus(∅, Q))`. That is not the same
 * operation — `Minus(∅, Q)` yields the single empty solution (it shares no
 * variables with Q, so nothing is removed), and joining P with one empty
 * solution returns P UNCHANGED. MINUS silently degraded to a no-op.
 *
 * ⛤ Why it stayed hidden: the existing translator tests assert only
 * `result.type === "minus"` on a STANDALONE MINUS pattern. Standalone MINUS is
 * exactly the one case where an empty left operand is CORRECT — so every test
 * passed while the operator did nothing in every real query, which always has
 * a preceding group.
 *
 * The four axes below lock the left operand itself. The fifth is a CANARY: a
 * standalone MINUS must KEEP its empty left, otherwise a fix that blindly
 * threads `result` everywhere would go unnoticed.
 */
describe("PatternTranslator — MINUS left operand", () => {
  let translator: PatternTranslator;

  const mockTranslateExpression = jest.fn((_expr: SparqljsExpression) => ({
    type: "literal" as const,
    value: "mock",
  }));
  const mockTranslateSelect = jest.fn(
    (_query: SelectQuery) => ({ type: "bgp" as const, triples: [] }) as AlgebraOperation
  );
  // Distinguishable BGPs: the assertions must be able to tell WHICH group
  // ended up on the left, not merely that something non-empty is there.
  const mockTranslateBGP = jest.fn(
    (pattern: SparqljsPattern) =>
      ({
        type: "bgp" as const,
        triples: ((pattern as unknown as { triples?: unknown[] }).triples ?? []) as never[],
      }) as AlgebraOperation
  );

  const bgp = (marker: string): SparqljsPattern =>
    ({
      type: "bgp",
      triples: [{ subject: { termType: "Variable", value: marker } }],
    }) as unknown as SparqljsPattern;

  const minusOf = (inner: SparqljsPattern): SparqljsPattern =>
    ({ type: "minus", patterns: [inner] }) as unknown as SparqljsPattern;

  const leftMarker = (op: AlgebraOperation): string | undefined => {
    const triples = (op as unknown as { triples?: Array<{ subject?: { value?: string } }> }).triples;
    return triples?.[0]?.subject?.value;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    translator = new PatternTranslator({
      translateExpression: mockTranslateExpression,
      translateSelect: mockTranslateSelect,
      translateBGP: mockTranslateBGP,
    });
  });

  it("produces a Minus at the top, not a Join wrapping an empty-left Minus", () => {
    const result = translator.translateWhere([bgp("P"), minusOf(bgp("Q"))]);

    // ⛔ Before the fix this was "join" — the operator was still THERE, just
    // subtracting from nothing, which is why no existing test caught it.
    expect(result.type).toBe("minus");
  });

  it("puts the preceding group on the left of MINUS", () => {
    const result = translator.translateWhere([bgp("P"), minusOf(bgp("Q"))]);

    expect(result.type).toBe("minus");
    const left = (result as unknown as { left: AlgebraOperation }).left;
    expect(leftMarker(left)).toBe("P");
  });

  it("keeps the MINUS inner group on the right", () => {
    const result = translator.translateWhere([bgp("P"), minusOf(bgp("Q"))]);

    const right = (result as unknown as { right: AlgebraOperation }).right;
    expect(leftMarker(right)).toBe("Q");
  });

  it("subtracts from EVERYTHING that precedes it, not just the nearest pattern", () => {
    // { P . R . MINUS { Q } }  →  Minus(Join(P, R), Q)
    const result = translator.translateWhere([bgp("P"), bgp("R"), minusOf(bgp("Q"))]);

    expect(result.type).toBe("minus");
    const left = (result as unknown as { left: AlgebraOperation }).left;
    // The left operand must be the JOIN of both preceding groups — if only the
    // nearest one were threaded, MINUS would subtract from a wider set than the
    // query describes and silently return rows it should have removed.
    expect(left.type).toBe("join");
    expect(leftMarker((left as unknown as { left: AlgebraOperation }).left)).toBe("P");
    expect(leftMarker((left as unknown as { right: AlgebraOperation }).right)).toBe("R");
  });

  it("CANARY: a standalone MINUS keeps its empty left operand", () => {
    // Nothing precedes it, so subtracting from the empty solution set is the
    // CORRECT reading here. This axis stays green in BOTH states — it is what
    // proves the fix threads the preceding group rather than inventing one.
    const result = translator.translatePattern(minusOf(bgp("Q")));

    expect(result.type).toBe("minus");
    const left = (result as unknown as { left: AlgebraOperation }).left;
    expect(left.type).toBe("bgp");
    expect(((left as unknown as { triples: unknown[] }).triples ?? []).length).toBe(0);
  });
});
