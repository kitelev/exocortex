/**
 * Resolver for `exoql__Query` SPARQL bodies referenced by UID.
 *
 * RFC c78cc5c8 Phase 1a — preserves the M2 invariant: the SPARQL body
 * lives EXCLUSIVELY in the markdown ```sparql code-block of the
 * `exoql__Query` asset, never mirrored into frontmatter.
 *
 * Implementations resolve a UID to the asset file, then extract the
 * fenced ```sparql ... ``` block from the markdown body. Returns `null`
 * when the asset cannot be located or no sparql block is present —
 * callers (PreconditionEvaluator) must fail closed.
 *
 * The interface lives in `@kitelev/exocortex-core` so the engine layer can
 * depend on it abstractly; concrete vault-aware implementations live
 * in the host plugin.
 */
export interface IQueryBodyResolver {
  /**
   * Resolve an `exoql__Query` UID to its raw SPARQL body string.
   *
   * @param queryUid `exo__Asset_uid` of the target `exoql__Query` asset
   * @returns The SPARQL string from the first ```sparql``` fenced block
   *          in the asset's markdown body, or `null` if the asset is
   *          missing or has no sparql block.
   */
  resolveSparql(queryUid: string): Promise<string | null>;
}
