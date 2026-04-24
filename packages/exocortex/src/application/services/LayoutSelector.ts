/**
 * LayoutSelector — resolve the winning `exo__Layout` for an asset's class set.
 *
 * Priority ladder (RFC exo__Layout §Priority ladder, RFC-applied lessons from
 * RFC be70f741 RelationColumnSetResolver):
 *
 * 1. Normalize every entry of `exo__Instance_class` via
 *    {@link WikiLinkHelpers.normalize} — same semantics as all other
 *    `@exocortex/core` consumers.
 * 2. Iterate normalized classes **in frontmatter order**; for each class, find
 *    every Layout whose `targetClass === rowClass`.
 * 3. The FIRST class that yields ≥1 Layout match wins — no further classes
 *    considered (handles the "multi-class row" case deterministically).
 * 4. Within that class's match set, sort by `priority DESC → uid ASC` and
 *    return the first entry.
 * 5. Zero total matches → return `null` (caller falls back to default
 *    UniversalLayout behaviour).
 *
 * Implementation is pure / side-effect free and suitable for property-based
 * testing (fast-check): given any permutation of layouts targeting a class,
 * the resolver returns the same winner.
 *
 * @module application/services
 * @since 15.x (RFC exo__Layout Phase 1)
 */

import type { Layout } from "../../domain/layout/Layout";
import { WikiLinkHelpers } from "../../utilities/WikiLinkHelpers";

export interface LayoutSelectorSource {
  readonly all: readonly Layout[];
}

export class LayoutSelector {
  constructor(private readonly source: LayoutSelectorSource) {}

  /**
   * Resolve the winning Layout for an asset's `exo__Instance_class` array.
   *
   * @param instanceClasses raw strings from frontmatter (`[[ems__Project]]`,
   *   `[[UUID|ems__Project]]`, bare `"ems__Project"`, etc.) in iteration order.
   * @returns winning Layout or `null` if no layout targets any of the classes.
   */
  resolve(instanceClasses: readonly unknown[]): Layout | null {
    if (!Array.isArray(instanceClasses) || instanceClasses.length === 0) {
      return null;
    }

    const layouts = this.source.all;
    if (layouts.length === 0) return null;

    for (const raw of instanceClasses) {
      if (typeof raw !== "string") continue;
      const normalized = WikiLinkHelpers.normalize(raw);
      if (normalized.length === 0) continue;

      const matches = layouts.filter((layout) => layout.targetClass === normalized);
      if (matches.length === 0) continue;

      return selectByPriority(matches);
    }

    return null;
  }
}

/**
 * Internal helper exposed for unit tests — picks the winner from a non-empty
 * candidate set.  Deterministic across runs: stable sort by
 * `priority DESC → uid ASC`.
 */
export function selectByPriority(candidates: readonly Layout[]): Layout {
  if (candidates.length === 0) {
    throw new Error("selectByPriority: expected at least one candidate");
  }
  if (candidates.length === 1) return candidates[0];

  // `Array#sort` in ES2019+ is stable, so ties resolve by original order
  // which is deterministic when we pre-sort by uid ASC.
  const sorted = [...candidates].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    if (a.uid < b.uid) return -1;
    if (a.uid > b.uid) return 1;
    return 0;
  });
  return sorted[0];
}
