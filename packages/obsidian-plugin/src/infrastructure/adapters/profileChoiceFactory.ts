import type { ProfileChoice } from "./ProfileCommands";

/**
 * Pure factory turning an `exo__Profile` asset's frontmatter into a
 * {@link ProfileChoice} for the picker (RFC 0002 §3.4). Extracted from
 * `ExocortexPlugin` so the RDF-shape parsing — description, the
 * `recommended` flag, and the locality computation — is unit-testable against
 * the real Obsidian frontmatter shapes (string vs string[], boolean vs
 * `"true"`, `[[uid]]` vs `[[uid|alias]]`) without a Docker e2e.
 *
 * Homoiconicity invariant: every surfaced property is read from RDF — nothing
 * is hardcoded in TS (no magic `label === "starter"` match).
 */

/**
 * Parse an RDF boolean frontmatter value. Obsidian surfaces it as a real
 * boolean or as the string `"true"`/`"false"` depending on how the YAML was
 * written; only an explicit truthy value yields `true`.
 */
export function parseProfileRecommended(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return false;
}

/**
 * Extract bare AssetSpace UIDs from an `exo__Profile_includes` frontmatter
 * value (string | string[]), stripping `[[`/`]]` wrappers and `|alias`
 * suffixes. Mirrors `VaultProfileResolver.extractWikilinkList`.
 */
export function extractIncludeUids(value: unknown): string[] {
  const items: unknown[] = Array.isArray(value)
    ? value
    : value !== undefined && value !== null
      ? [value]
      : [];
  const out: string[] = [];
  for (const raw of items) {
    if (typeof raw !== "string") continue;
    const cleaned = raw
      .trim()
      .replace(/^\[\[/, "")
      .replace(/\]\]$/, "")
      .split("|")[0]
      .trim();
    if (cleaned.length > 0) out.push(cleaned);
  }
  return out;
}

/** Read the optional one-line description, trimmed; `undefined` when blank. */
export function parseProfileDescription(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Build a {@link ProfileChoice} from a Profile asset's frontmatter. Returns
 * `null` when the asset has no `exo__Asset_uid` (cannot be applied).
 *
 * @param fm           the asset's frontmatter record
 * @param basename     fallback label when `exo__Asset_label` is absent
 * @param activeUid    the currently-applied profile UID (drives `isActive`)
 * @param presentUids  every `exo__Asset_uid` present in the vault; a profile
 *                     is locally relevant when every included AssetSpace UID
 *                     is in this set (empty includes ⇒ vacuously relevant).
 */
export function buildProfileChoice(
  fm: Record<string, unknown>,
  basename: string,
  activeUid: string | null,
  presentUids: Set<string>,
): ProfileChoice | null {
  const uid =
    typeof fm["exo__Asset_uid"] === "string"
      ? (fm["exo__Asset_uid"] as string)
      : null;
  if (uid === null) return null;

  const label =
    typeof fm["exo__Asset_label"] === "string"
      ? (fm["exo__Asset_label"] as string)
      : basename;

  const includeUids = extractIncludeUids(fm["exo__Profile_includes"]);
  const isLocallyRelevant = includeUids.every((u) => presentUids.has(u));

  return {
    uid,
    label,
    isActive: uid === activeUid,
    description: parseProfileDescription(fm["exo__Profile_description"]),
    isRecommended: parseProfileRecommended(fm["exo__Profile_recommended"]),
    isLocallyRelevant,
  };
}
