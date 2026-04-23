/**
 * RelationColumnSetResolver — 4-tier priority ladder for `ui__RelationColumnSet`.
 *
 * Phase 2 of RFC be70f741-a8e3-4826-aab1-d3f950068861.
 *
 * Inputs
 * - Row classes in the order declared on the row asset (`exo__Instance_class`
 *   is always an array — see `AssetRelationsTable.tsx` `getInstanceClasses`).
 * - Referencing property (raw or wikilink form) — the backlinks group key.
 *
 * Algorithm (per RFC §"Priority ladder")
 * - Iterate `rowClasses` in declaration order.  For each class, evaluate the
 *   tiers top-down; first tier with ≥1 match wins for that class, and the
 *   overall resolve returns it — we never look at subsequent classes once a
 *   prior class has a match.
 *   - Tier 1: exact — `targetClasses.includes(cls) && referencingProperty === prop`.
 *   - Tier 2: class-only — `targetClasses.includes(cls) && config.referencingProperty === null`.
 *   - Tier 3: property-only — `config.targetClasses === null && referencingProperty === prop`.
 *   - Tier 4: null — caller falls back to legacy hardcoded map.
 * - Tie-breaker within a tier (RFC v2 architect M3 fix):
 *   `priority DESC → exo__Asset_uid ASC (localeCompare)`.
 * - `log.warn` fires once per resolve when ≥2 matches share the winning tier
 *   AND priority — the debugging aid cited in RFC v2 R2 mitigation.
 *
 * Determinism
 * - Given a stable snapshot (`getAll()` returns the same array contents) and
 *   stable inputs, `resolve` returns the same asset; property-based test in
 *   `tests/application/services/RelationColumnSetResolver.property.test.ts`
 *   asserts this invariant over N=500 fast-check runs.
 *
 * Performance
 * - `resolve()` p95 < 1 ms on 100 configs per RFC M4 benchmark.  See
 *   `tests/performance/RelationColumnSetResolverPerformance.test.ts`.
 *
 * @module application/services
 * @since 15.x (RFC be70f741 Phase 2)
 */

import { normalizeRef, type RelationColumnSet } from "../../domain/layout/RelationColumnSet";

export interface RelationColumnSetResolverLogger {
  warn(message: string): void;
}

const NOOP_LOGGER: RelationColumnSetResolverLogger = {
  warn: () => {},
};

export interface RelationColumnSetResolverOptions {
  readonly logger?: RelationColumnSetResolverLogger;
}

export type RelationColumnSetProvider = () => readonly RelationColumnSet[];

export class RelationColumnSetResolver {
  private readonly provider: RelationColumnSetProvider;
  private readonly logger: RelationColumnSetResolverLogger;

  constructor(
    provider: RelationColumnSetProvider,
    options: RelationColumnSetResolverOptions = {},
  ) {
    this.provider = provider;
    this.logger = options.logger ?? NOOP_LOGGER;
  }

  /**
   * Resolve the column set for a row-asset + referencing-property pair.
   *
   * @param rowClasses  `exo__Instance_class` of the row asset.  Array order is
   *                    honored — first class with a match wins.
   * @param referencingProperty  Backlinks group key.  May be `null`/empty; in
   *                             that case only Tier 2 (class-only) can match.
   * @returns The winning config, or `null` if no tier matches for any class.
   */
  resolve(
    rowClasses: readonly string[] | null | undefined,
    referencingProperty: string | null | undefined,
  ): RelationColumnSet | null {
    if (!rowClasses || rowClasses.length === 0) {
      return null;
    }

    const prop =
      referencingProperty != null ? normalizeRef(referencingProperty) : null;
    const all = this.provider();
    if (all.length === 0) {
      return null;
    }

    for (const rawCls of rowClasses) {
      const cls = normalizeRef(rawCls);
      if (cls === null) {
        continue;
      }

      if (prop !== null) {
        const tier1 = this.filterTier1(all, cls, prop);
        if (tier1.length > 0) {
          return this.tiebreak(tier1, 1);
        }
      }

      const tier2 = this.filterTier2(all, cls);
      if (tier2.length > 0) {
        return this.tiebreak(tier2, 2);
      }

      if (prop !== null) {
        const tier3 = this.filterTier3(all, prop);
        if (tier3.length > 0) {
          return this.tiebreak(tier3, 3);
        }
      }
    }

    return null;
  }

  private filterTier1(
    all: readonly RelationColumnSet[],
    cls: string,
    prop: string,
  ): RelationColumnSet[] {
    const out: RelationColumnSet[] = [];
    for (const cs of all) {
      if (cs.targetClasses === null) continue;
      if (cs.referencingProperty !== prop) continue;
      if (!cs.targetClasses.includes(cls)) continue;
      out.push(cs);
    }
    return out;
  }

  private filterTier2(
    all: readonly RelationColumnSet[],
    cls: string,
  ): RelationColumnSet[] {
    const out: RelationColumnSet[] = [];
    for (const cs of all) {
      if (cs.targetClasses === null) continue;
      if (cs.referencingProperty !== null) continue;
      if (!cs.targetClasses.includes(cls)) continue;
      out.push(cs);
    }
    return out;
  }

  private filterTier3(
    all: readonly RelationColumnSet[],
    prop: string,
  ): RelationColumnSet[] {
    const out: RelationColumnSet[] = [];
    for (const cs of all) {
      if (cs.targetClasses !== null) continue;
      if (cs.referencingProperty !== prop) continue;
      out.push(cs);
    }
    return out;
  }

  private tiebreak(
    matches: RelationColumnSet[],
    tier: 1 | 2 | 3,
  ): RelationColumnSet {
    const sorted = matches.slice().sort((a, b) => {
      const priorityDelta = b.priority - a.priority;
      if (priorityDelta !== 0) return priorityDelta;
      return a.uid.localeCompare(b.uid);
    });
    const winner = sorted[0];
    if (sorted.length > 1) {
      const winningPriority = winner.priority;
      const tied = sorted.filter((cs) => cs.priority === winningPriority);
      if (tied.length > 1) {
        const losers = tied
          .slice(1)
          .map((cs) => cs.uid)
          .join(", ");
        this.logger.warn(
          `RelationColumnSetResolver: tier=${tier} priority=${winningPriority} collision — selected ${winner.uid}; tied losers: ${losers}`,
        );
      }
    }
    return winner;
  }
}
