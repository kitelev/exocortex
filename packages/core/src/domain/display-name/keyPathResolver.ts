/**
 * Shared dot-notation key-path resolution for the display-name domain.
 *
 * ONE mechanism serves BOTH consumers so their semantics cannot drift:
 *  - `DisplayNameTemplateEngine` — a `{{a.b}}` placeholder inside a display template;
 *  - `PrintNameRuleService.matcherSatisfied` — an `exo__DisplayNameSpec_matchPath`
 *    authored as a dot-path (req fedeaa6e), which lets ONE conditional spec address a
 *    property of a RELATED asset (`exo__Asset_prototype.exo__Instance_class`) instead of
 *    needing one spec per prototype.
 *
 * A path segment hops across a wikilink reference when the current value is a wikilink
 * STRING and a `MetadataResolver` is supplied: the resolver dereferences it to the
 * referenced asset's frontmatter and the next segment reads from there. Without a
 * resolver (or when the target does not resolve) the walk yields `undefined` — the
 * fail-closed behaviour both consumers rely on.
 *
 * Extracted verbatim from `DisplayNameTemplateEngine.getNestedValue` — the template
 * behaviour is unchanged byte-for-byte; the engine now delegates here.
 */

export type MetadataResolver = (
  wikilinkTarget: string,
) => Record<string, unknown> | null;

/** True for a `[[…]]`-shaped value (the only form a key-path hop dereferences). */
export function isWikilink(value: string): boolean {
  return value.startsWith("[[") && value.endsWith("]]");
}

/**
 * Walk `path` (dot-separated) through `obj`, hopping across wikilink references via
 * `metadataResolver`. Returns `undefined` when any segment is missing or unresolvable.
 */
/**
 * Read a key-path segment as an OWN property only (req 5cd9fffe).
 *
 * ⛔ Segments come from `exo__DisplayNameSpec_matchKey` / part definitions — i.e. from user
 * frontmatter — so a plain `obj[part]` reaches Object.prototype: a segment named `toString` or
 * `constructor` yields a FUNCTION and the walk continues over it instead of stopping. Verified by
 * execution, not reasoning; it is the same reachable-by-data hole closed in
 * `PrintNameRuleService.matcherSatisfied`, and fixing only the one I happened to notice would
 * leave its twin sixty lines away.
 *
 * ⚠ Arrays keep working: numeric indices and `length` are own properties of an array.
 */
function ownProperty(source: unknown, key: string): unknown {
  if (source === null || typeof source !== "object") return undefined;
  return Object.hasOwn(source as object, key)
    ? (source as Record<string, unknown>)[key]
    : undefined;
}

export function resolveKeyPath(
  obj: Record<string, unknown>,
  path: string,
  metadataResolver?: MetadataResolver,
): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }

    // A reference authored as a YAML LIST hops via its FIRST element — the same
    // first-element convention `PrintNameRuleService.extractClassKeys` /
    // `resolvePropertyKey` / `resolveIdentityForms` already apply to a multi-valued
    // frontmatter value. Without this an array falls into the plain-object branch below
    // (`typeof [] === "object"`), where `arr["exo__Instance_class"]` is `undefined` — a
    // SILENT non-match. Both forms are live: 545 scalar / 68 list across the vaults
    // (189 / 11 for ems__Meeting), so the list form is 5.5% of the req's own trigger class.
    // A list whose first element is NOT a resolvable wikilink falls through unchanged, so
    // plain index access (e.g. a numeric segment) keeps its previous meaning.
    if (Array.isArray(current)) {
      const first = current[0];
      if (typeof first === "string" && metadataResolver && isWikilink(first)) {
        const resolved = metadataResolver(first);
        if (resolved) {
          current = ownProperty(resolved, part);
          continue;
        }
        return undefined;
      }
    }

    if (typeof current !== "object") {
      if (
        typeof current === "string" &&
        metadataResolver &&
        isWikilink(current)
      ) {
        const resolved = metadataResolver(current);
        if (resolved) {
          current = ownProperty(resolved, part);
          continue;
        }
      }
      return undefined;
    }

    current = ownProperty(current, part);
  }

  return current;
}
