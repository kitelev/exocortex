/**
 * Leaf module — shared constants + predicates for AssetSpace ABox detection.
 * Extracted out of `AssetSpaceManager` so it can be imported by both
 * `AssetSpaceManager` and `AssetSpaceLookupHelper` without forming a
 * circular dependency (Issue #3327 code-reviewer MEDIUM-2).
 *
 * As of ExoSync E1 (RFC 4e4dc453 Phase E) the implementations live in the
 * exocortex core (`services/sync/spaceSpecCore`) so the CLI's
 * `exosync-parity` collector shares the IDENTICAL predicates — this module
 * is a re-export façade preserving the historical plugin import path.
 * Pure functions only — no Obsidian API, no I/O. Suitable for use anywhere.
 */

export {
  /**
   * Class UID of `exo__AssetSpace` (TBox root). Hardcoded by RFC 0a0791c1
   * (UID frozen by RFC v2 `2a98f345`, implemented 2026-05-17).
   */
  ASSET_SPACE_CLASS_UID,
  /**
   * Predicate — does this frontmatter declare `exo__Instance_class`
   * containing the AssetSpace class UID? Strict wikilink-regex membership
   * (Issue #3312 MEDIUM #1).
   */
  isAssetSpaceFrontmatter,
  /** Predicate — `exo__Instance_class` references `exo__FileSpace`? */
  isFileSpaceFrontmatter,
  /**
   * Class UID of `exo__FileSpace` (TBox: exoas-exo, onto-RFC 18808c73 —
   * frozen). Single source of truth shared with the RDF-indexer skip.
   */
  FILE_SPACE_CLASS_UID,
} from "@kitelev/exocortex-core";
