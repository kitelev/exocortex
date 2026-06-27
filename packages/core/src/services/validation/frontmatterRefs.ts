import { extractAssetReference } from "../../utilities/extractAssetReference";

/**
 * Small frontmatter accessors shared by the asset-array checks. They read the
 * already-parsed warm frontmatter (never re-parse files) and normalise the two
 * shapes a value can take (scalar vs YAML list of `[[ref]]` wikilinks).
 */

/** `exo__Asset_uid` as a trimmed string, or null. */
export function readUid(fm: Readonly<Record<string, unknown>>): string | null {
  const v = fm["exo__Asset_uid"];
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/** `exo__Asset_isDefinedBy` resolved to its bare reference (uid or label), or null. */
export function readIsDefinedByRef(
  fm: Readonly<Record<string, unknown>>,
): string | null {
  return extractAssetReference(fm["exo__Asset_isDefinedBy"]);
}

/** All `exo__Instance_class` references (bare uid/label), normalising scalar | list shape. */
export function readInstanceClassRefs(
  fm: Readonly<Record<string, unknown>>,
): string[] {
  const raw = fm["exo__Instance_class"];
  const values: unknown[] = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const refs: string[] = [];
  for (const v of values) {
    const ref = extractAssetReference(v);
    if (ref) refs.push(ref);
  }
  return refs;
}
