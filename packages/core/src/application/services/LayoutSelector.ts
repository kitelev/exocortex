/**
 * LayoutSelector — resolve the winning `exo__Layout` for an asset's class set.
 *
 * Priority ladder (RFC exo__Layout §Priority ladder):
 *
 * 1. Canonicalize every entry of `exo__Instance_class` AND every Layout's
 *    `targetClass` via {@link WikiLinkHelpers.resolveSymbolic}: the wikilink is
 *    normalized, and a bare UUID is resolved to its class label through the
 *    injected `resolveUid` (RFC 9821a379 decision 4). So `[[uid]]`,
 *    `[[uid|label]]` and `[[label]]` of the same class compare equal on BOTH
 *    sides. Without a resolver (or when it yields nothing) a UUID stays a UUID
 *    — the pre-9821a379 behaviour.
 * 2. Iterate canonical classes **in frontmatter order**; for each class, find
 *    every Layout whose canonical `targetClass` equals it.
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

export interface LayoutSelectorOptions {
  /**
   * UUID → class label (`exo__Asset_label` of the class file), or
   * `null`/`undefined` when unknown. Same contract as `ClassRefResolver`
   * (plugin: `metadataCache`). Called lazily on every `resolve`, so a cold
   * cache that fills later is picked up by the next render.
   */
  readonly resolveUid?: (uuid: string) => string | null | undefined;
}

const NO_RESOLVER = (): null => null;

export class LayoutSelector {
  private readonly resolveUid: (uuid: string) => string | null | undefined;

  constructor(
    private readonly source: LayoutSelectorSource,
    options: LayoutSelectorOptions = {},
  ) {
    this.resolveUid = options.resolveUid ?? NO_RESOLVER;
  }

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

    const targets = layouts.map((layout) =>
      WikiLinkHelpers.resolveSymbolic(layout.targetClass, this.resolveUid),
    );

    for (const raw of instanceClasses) {
      if (typeof raw !== "string") continue;
      const canonical = WikiLinkHelpers.resolveSymbolic(raw, this.resolveUid);
      if (canonical.length === 0) continue;

      const matches = layouts.filter((_, at) => targets[at] === canonical);
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
