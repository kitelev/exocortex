/**
 * Leaf module — shared constants + predicates for AssetSpace ABox detection.
 * Extracted out of `AssetSpaceManager` so it can be imported by both
 * `AssetSpaceManager` and `AssetSpaceLookupHelper` without forming a
 * circular dependency (Issue #3327 code-reviewer MEDIUM-2).
 *
 * Pure functions only — no Obsidian API, no I/O. Suitable for use anywhere.
 */

/**
 * Class UID of `exo__AssetSpace` (TBox root). Used to discriminate AssetSpace
 * ABox instances from other assets when scanning the vault. Hardcoded by RFC
 * 0a0791c1 (UID frozen by RFC v2 `2a98f345`, implemented 2026-05-17).
 */
export const ASSET_SPACE_CLASS_UID = "73bd00e4-ccc0-4f3f-b20d-c4388c4588fb";

/**
 * Strict wikilink regex — matches `[[<uuid>]]` or `[[<uuid>|<label>]]`,
 * capturing the canonical UUIDv4 form (8-4-4-4-12 hex, case-insensitive).
 * Anchored to the wikilink brackets so substring matches like
 * `notavalid-73bd00e4-...` do not falsely register as the AssetSpace class.
 * See Issue #3312 MEDIUM #1.
 */
const WIKILINK_UID_RE =
  /\[\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\|[^\]]*)?\]\]/gi;

/**
 * Predicate — does this frontmatter declare `exo__Instance_class` containing
 * the AssetSpace class UID? Handles both wikilink-string and array-of-string
 * shapes that Obsidian's parser may produce. Membership is decided by strict
 * wikilink regex (not loose substring), so adjacent UUID-like noise in the
 * value does not falsely match.
 *
 * Shared by `AssetSpaceManager` and `AssetSpaceLookupHelper`; centralising
 * here makes one predicate the source of truth and breaks the
 * `AssetSpaceManager` ↔ `AssetSpaceLookupHelper` circular import.
 * See Issue #3312.
 */
export function isAssetSpaceFrontmatter(fm: Record<string, unknown>): boolean {
  const classes = fm["exo__Instance_class"];
  const candidates: unknown[] = Array.isArray(classes) ? classes : [classes];
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    WIKILINK_UID_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WIKILINK_UID_RE.exec(c)) !== null) {
      if (m[1].toLowerCase() === ASSET_SPACE_CLASS_UID) return true;
    }
  }
  return false;
}
