import type { ITripleStore } from "../interfaces/ITripleStore";
import { IRI } from "../domain/models/rdf/IRI";
import { Literal } from "../domain/models/rdf/Literal";
import { Namespace } from "../domain/models/rdf/Namespace";
import { iriToObsidianName } from "../utilities/iriToObsidianName";

/**
 * Ticket 534a7a46 — the declared `exo__Property_range` of each mounted property
 * definition, keyed by the definition's `<prefix>__<Name>` label (the frontmatter
 * key a writer actually addresses).
 *
 * The signature is a byte-copy of the CLI's `PropertyNameValidator.declaredRanges`
 * (`packages/cli/src/services/PropertyNameValidator.ts`): same key, same return
 * shape, same optional `addressed` argument. That is deliberate — ticket 2227d660
 * taught `cli create` / `cli set-property` to type a YAML scalar by the declared
 * range through that method, and this port is how the SECOND pair of writers
 * (`create_instance` / `property_set`, both reached through `GroundingExecutor`)
 * obtains the same map from a triple store instead of an FS scan. One signature,
 * two sources, no chance for the two runtimes to key the map differently
 * (CLI↔UI parity #3417).
 *
 * `addressed` is accepted for signature parity and deliberately unused here: the
 * CLI method uses it only to decide WHICH duplicate-label warnings to emit, and
 * this resolver has no warn channel (a store-backed read cannot tell a duplicate
 * label from a single definition — the graph has already merged them by subject).
 */
export type DeclaredRangesResolver = (
  addressed?: Iterable<string>,
) => Promise<ReadonlyMap<string, readonly string[]>>;

/**
 * Build a {@link DeclaredRangesResolver} over an {@link ITripleStore}. Used by the
 * Obsidian plugin and by `cli apply` — both already hold a hydrated store at the
 * point where they construct `GroundingExecutor`, so this is a single
 * implementation rather than one per surface (the parser-drift class of bug).
 *
 * ⛔ The lookup key is NOT read as a plain label literal, and it is NOT derived with
 * `FrontmatterService.normalizeIRI`. Both would be dead on live data, each for its
 * own measured reason (2026-09-20, vault-exodev):
 *
 *  - `exo__Asset_label` of a property definition is emitted as a SYMBOLIC IRI, not a
 *    literal, in 478 of 485 cases — `NoteToRDFConverter` substitutes class-shaped
 *    string literals with term IRIs at that predicate (issues #2782 / #2959, the
 *    reason `apply.ts` gives for not using a store lookup for class labels). The 7
 *    literal cases are labels that do not parse as `<prefix>__<Name>` at all. So the
 *    key comes from `rdfs:label`, which IS a literal for all 485, with the symbolic
 *    inverse as the fallback for the rest.
 *  - ⛤ so the LOAD-BEARING choice is reading `rdfs:label` AT ALL: drop that match and
 *    478 of 485 live definitions become invisible to this index, which is exactly the
 *    shape the nearest precedent's unit fixture does not model. The symbolic-IRI
 *    inverse below is, on today's data, DEFENSIVE — measured: all 485 ranged
 *    definitions carry an `rdfs:label` literal, so no live definition needs it. It is
 *    kept because a definition without `rdfs:label` is possible and the inverse is
 *    free, and it is `iriToObsidianName` rather than
 *    `FrontmatterService.normalizeIRI` because the latter walks a static NINE-namespace
 *    map: of the 104 definitions whose range actually types a scalar, that map knows 23
 *    (exo 9, pmbok 7, lit 4, ems 3) and misses 81 — flow 48, pmi 17, person 5, team 5,
 *    bot 3, exodev 3, i.e. 78 per cent — so on the defensive path it would fail
 *    SILENTLY and selectively. `iriToObsidianName` delegates to
 *    `Namespace.fromTermIRI`, the shared inverse of the forward emission path, covering
 *    registered, ad-hoc and W3C namespaces alike. ⛤ The static nine-namespace map
 *    this once had to be chosen OVER no longer exists (retired by ticket 6572f3f3 / req 38e3f174):
 *    `iriToObsidianName` is now the only inverse there is, so the choice recorded
 *    here is settled rather than contested. The numbers above stay the reason the
 *    choice mattered.
 *    Axes K4 (out-of-map `team`) and K16 (in-map `ems`) are the pair that makes the
 *    choice between the two inverses addressable rather than asserted.
 *
 * The index is built with exactly THREE predicate-only `match` calls — not one pair
 * per definition, which would be 485×2 matches for a single create (#4272 records
 * what repeated whole-corpus lookups cost).
 *
 * ⛤ And it is deliberately STATELESS — no memoised map inside the resolver. That is
 * not laziness, it is where the caching already lives: `InMemoryTripleStore` keeps a
 * `pso` index (so a predicate-only match is a lookup, not a scan) plus an LRU
 * `queryCache` over the match tuple, and it calls `queryCache.clear()` on every
 * `add` and `remove`. Memoising here would duplicate that cache while ADDING the one
 * thing the store's cache does not have — a staleness surface: the plugin builds its
 * executor once at load, so an instance-level map would answer from the TBox as it
 * stood at startup for the rest of the session, and a property definition created
 * mid-session would be invisible (graph-record-outlives-its-referent). Reading the
 * store every call costs three indexed lookups, two of which hit its LRU on the
 * second write, and can never go stale.
 *
 * First-wins on a duplicated label, matching `PropertyNameValidator.collect()`.
 */
export function createTripleStoreDeclaredRanges(
  store: ITripleStore,
): DeclaredRangesResolver {
  const EXO = Namespace.EXO;
  const RDFS = Namespace.RDFS;

  return async (): Promise<ReadonlyMap<string, readonly string[]>> => {
    const rangeTriples = await store.match(
      undefined,
      EXO.term("Property_range"),
      undefined,
    );
    const exoLabelTriples = await store.match(
      undefined,
      EXO.term("Asset_label"),
      undefined,
    );
    const rdfsLabelTriples = await store.match(
      undefined,
      RDFS.term("label"),
      undefined,
    );

    // subject IRI → the label literal, if any reader gave one
    const literalLabel = new Map<string, string>();
    // subject IRI → the symbolic label IRI, for the inverse fallback
    const iriLabel = new Map<string, string>();
    for (const t of [...exoLabelTriples, ...rdfsLabelTriples]) {
      if (!(t.subject instanceof IRI)) continue;
      const s = t.subject.value;
      if (t.object instanceof Literal) {
        const v = t.object.value.trim();
        if (v.length > 0 && !literalLabel.has(s)) literalLabel.set(s, v);
      } else if (t.object instanceof IRI && !iriLabel.has(s)) {
        iriLabel.set(s, t.object.value);
      }
    }

    const out = new Map<string, readonly string[]>();
    const ranges = new Map<string, string[]>();
    for (const t of rangeTriples) {
      if (!(t.subject instanceof IRI)) continue;
      const v =
        t.object instanceof IRI
          ? t.object.value
          : t.object instanceof Literal
            ? t.object.value
            : null;
      if (v === null) continue;
      const s = t.subject.value;
      const acc = ranges.get(s);
      if (acc) acc.push(v);
      else ranges.set(s, [v]);
    }

    for (const [subject, values] of ranges) {
      const fromLiteral = literalLabel.get(subject);
      const symbolic = iriLabel.get(subject);
      const key =
        fromLiteral ??
        (symbolic === undefined ? null : iriToObsidianName(symbolic));
      if (key === null || key === undefined || key.length === 0) continue;
      if (out.has(key)) continue; // first-wins, as PropertyNameValidator does
      out.set(key, values);
    }

    return out;
  };
}
