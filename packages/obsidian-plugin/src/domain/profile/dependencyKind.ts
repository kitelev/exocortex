/**
 * req `18ecf16f` — the KIND of an `exo__AssetSpace_dependsOn` dependency, read
 * from the graph instead of a hardcoded namespace list.
 *
 * ## Why this is a property of the TARGET node, not of the edge
 *
 * `exo__AssetSpace_dependsOn` is 0..N while `exo__AssetSpace_dependsOnKind` is
 * 0..1, so a per-edge reading is not expressible: an AssetSpace with three
 * dependencies would have one slot for all three. The kind therefore lives on
 * the **target's** registry descriptor and answers "what does depending on THIS
 * AssetSpace mean?". Measured 2026-08-06 across all 47 `dependsOn` edges of the
 * live registry: no target is a TBox provider for one depender and mere content
 * for another, so nothing is lost by the node reading. The namespace allow-list
 * this replaces was already evaluated against the TARGET's namespace, i.e. it
 * was a node property in all but name.
 *
 * ## Why the hardcode had to go (homoiconicity Q1 — and it was also wrong)
 *
 * Which AssetSpaces supply class definitions is user-configurable semantics: the
 * user adds AssetSpaces, so the answer cannot live in a TS `Set`. It was also
 * factually wrong — measured on the live graph, `exoas-public` supplies class
 * definitions to 13478 cross-boundary assets and `exoas-dec` to 2163, against
 * `exocmd`'s 268, yet only `{exo, exocmd}` counted as providers.
 *
 * ## Why the enum UIDs stay in TS
 *
 * The MAPPING (which AssetSpace is which kind) is graph data; these two UIDs are
 * the vocabulary needed to interpret it — the same shape as the class UIDs other
 * homoiconic subsystems pin (`SETTING_CLASS_UID`, `DISPLAY_NAME_SPEC_CLASS_UID`,
 * `PRINTED_PROPERTY_CLASS_UID`). That is Q3 (core processing), not Q1.
 */

/** `exo__DependencyKindTBox` — hard edge: supplies definitions, cannot be parked. */
export const DEPENDENCY_KIND_TBOX_UID = "e1d7fb5c-d334-448d-935b-953b7b033e78";

/** `exo__DependencyKindReference` — soft edge: content only, parkable. */
export const DEPENDENCY_KIND_REFERENCE_UID =
  "fe529085-5370-4ac0-bbe4-1c7351242dee";

/**
 * `"tbox"` — depending on this AssetSpace means depending on its class /
 * command definitions; unmounting it silently breaks type resolution.
 * `"reference"` — content only; unmounting it costs reachability, not types.
 */
export type DependencyKind = "tbox" | "reference";

/** Lower-cased symbolic local name the RDF converter emits for the soft value. */
const REFERENCE_LOCAL_NAME = "dependencykindreference";

/**
 * req `18ecf16f` — resolve `exo__AssetSpace_dependsOnKind` from raw frontmatter.
 *
 * **The safe default is structural, not a fallback branch:** `"reference"` is
 * returned ONLY on a positive match of the known soft value. Absent, empty,
 * unrecognised, wrong-typed — every other input yields `"tbox"`. A wrong
 * `"reference"` silently loses a class type at runtime; a wrong `"tbox"` only
 * costs an extra refusal, so the unsafe outcome is the one made to require
 * evidence.
 *
 * Accepts every form the value can reach the plugin in, because the plugin reads
 * FRONTMATTER (`metadataCache`) while the graph emits the same value as a
 * symbolic IRI (its label parses as `prefix__Local`, so the converter substitutes
 * it) — an author or a migration may legitimately produce either:
 * `[[<uid>]]`, `[[<uid>|exo__DependencyKindReference]]`, a bare UID,
 * `exo__DependencyKindReference`, or the full `…/exo#DependencyKindReference` IRI.
 * A one-element array is unwrapped (`Single` cardinality, but `metadataCache`
 * hands back a list when the author writes YAML list syntax).
 *
 * When BOTH a known UID and a conflicting symbolic name are present (a
 * mismatched alias such as `[[<tbox-uid>|exo__DependencyKindReference]]`), the
 * UID wins — it is the link target, i.e. what the graph actually resolves.
 */
export function resolveDependencyKind(raw: unknown): DependencyKind {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return "tbox";
  const normalized = value.toLowerCase();
  // UID first: it is the link target and therefore authoritative over an alias.
  if (normalized.includes(DEPENDENCY_KIND_TBOX_UID)) return "tbox";
  if (normalized.includes(DEPENDENCY_KIND_REFERENCE_UID)) return "reference";
  // No known UID — fall back to the symbolic form the RDF converter emits.
  if (normalized.includes(REFERENCE_LOCAL_NAME)) return "reference";
  return "tbox";
}
