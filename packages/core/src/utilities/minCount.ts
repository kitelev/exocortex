import { Literal } from "../domain/models/rdf/Literal";

/**
 * The effective `exo__Property_minCount` of ONE property definition — the single
 * reader every consumer of that predicate goes through (ticket abd22b00).
 *
 * Before this helper the predicate was read by FOUR independent implementations,
 * each spelling the same decisions its own way (measured on sha a42a0431):
 *
 * | # | reader | what it did |
 * |---|---|---|
 * | 1 | `ShapeLoader.loadFromRDFGraph` | `minCountTs[0]?.object`, `Literal ? parseInt : NaN` — the FIRST triple |
 * | 2 | `ShapeLoader.registerCandidate` (FS) | `typeof raw === "string" ? parseInt(strip(raw)) : undefined` |
 * | 3 | `createTripleStoreRequiredPropertyResolver` | its own `parseInt` off the store, then `mc > 0` as a FILTER |
 * | 4 | `createTripleStoreClassPropertyResolver` | its own `parseInt` off the store, then `mc > 0` as the `required` FLAG |
 *
 * Four decisions live in that predicate, and they were spelled differently:
 *
 * 1. **What is a readable value.** A `Literal`'s lexical form, or a frontmatter
 *    string; an `IRI` object (or any other term) is NOT a minCount and yields
 *    `undefined` — exactly what `: NaN` meant in readers 1/3/4.
 * 2. **Surrounding quotes.** `ShapeLoader.parseFrontmatter` keeps a value
 *    VERBATIM (`result[key] = kvMatch[2].trim()`), so a definition written
 *    `exo__Property_minCount: "1"` reaches this parser with the quotes still
 *    attached and `parseInt('"1"', 10)` is `NaN` (req bcdd64d8, PR #4309). The
 *    strip lives HERE rather than at the FS call-site because on the graph path
 *    it is a no-op BY CONSTRUCTION — YAML removes the surrounding quotes before
 *    NoteToRDFConverter ever builds the literal — and because req bcdd64d8's
 *    invariant is that both loaders build deep-equal shapes from the SAME bytes.
 *    One reader makes that parity true by construction instead of by agreement.
 * 3. **Unparseable input is a DELIBERATE fail-open**, carried over verbatim from
 *    reader 2: a value that is not a number yields `undefined` and never throws.
 *    The value comes from USER DATA (the outside world), where failing open is
 *    the correct policy; fail-closed is for a break of OUR policy.
 * 4. **Several declared values** — the one place the four readers genuinely
 *    DISAGREED (graph gave the first, FS gave `undefined`, the two resolvers
 *    accepted any value `> 0`). Resolved here as the **maximum** of the
 *    parseable values, for two reasons, in order: `max > 0` is true exactly when
 *    `any > 0` is, so both resolvers keep their semantics byte-for-byte; and the
 *    answer stops depending on TRIPLE ORDER, which `minCountTs[0]` did depend on.
 *    (`first` keeps the order dependence; `min` would change both resolvers.)
 *    ⚠ Unreachable on today's data and stated as such rather than glossed: the
 *    arity of `exo__Property_minCount` is 1 on all 95 live definitions across the
 *    three vaults, and 0 of 95 carry a non-numeric value (measured 2026-09-22,
 *    `--no-cache`). This helper converges a STRUCTURAL debt; it is not a fix for
 *    an observable defect.
 *
 * @param raw a `Literal` (or any RDF term), a frontmatter string, or an array of
 *   either — the two shapes the live sources produce.
 * @returns the effective minCount, or `undefined` when nothing parseable was
 *   declared. `0` is a DECLARED value and comes back as `0`, not `undefined`;
 *   the `> 0` question belongs to the caller (it is a filter in reader 3 and a
 *   flag in reader 4, and that difference is a consumer policy, not parsing).
 */
export function parseMinCount(raw: unknown): number | undefined {
  if (Array.isArray(raw)) {
    let best: number | undefined;
    for (const item of raw) {
      const parsed = parseMinCount(item);
      if (parsed !== undefined && (best === undefined || parsed > best)) {
        best = parsed;
      }
    }
    return best;
  }

  const lexical =
    raw instanceof Literal ? raw.value : typeof raw === "string" ? raw : null;
  if (lexical === null) return undefined;

  const parsed = parseInt(lexical.trim().replace(/^["']|["']$/g, ""), 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}
