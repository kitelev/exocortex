/**
 * req `d4ccc901` — the three mount states an AssetSpace can be in, and the
 * transition `apply-profile` must perform to move it to the state the target
 * profile asks for.
 *
 * ## Why a third state exists
 *
 * `apply-profile` used to know two: an AssetSpace was **materialized** (its
 * derived folder exists) or **absent**. Leaving the effective set therefore had
 * exactly one outcome — delete the folder — and returning cost a full network
 * re-materialisation (measured ≈2.5 s and 0.7 MB per AssetSpace, against 23 ms
 * and 0 bytes for a local move). **Parked** — on the device, not active — makes
 * the common "take this off the device for now" operation cheap and reversible.
 *
 * ## Why the kind of the dependency decides park vs destroy
 *
 * `exo__AssetSpace_dependsOnKind` (req `18ecf16f`) already answers "what does
 * depending on THIS AssetSpace mean". A **reference** (soft) edge supplies
 * content: unmounting it costs reachability, so keeping the bytes is a pure win.
 * A **tbox** (hard) edge supplies class / command definitions: a copy that sits
 * on disk while being neither indexed nor enumerated by ExoSync is precisely the
 * silent half-state in which assets lose their type with no signal at all.
 * Destroying it stays loud, so `tbox` keeps the pre-existing behaviour.
 *
 * The asymmetry is deliberate and matches {@link resolveDependencyKind}'s own
 * safe default: every unrecognised kind resolves to `tbox`, i.e. **the direction
 * that hides files requires positive evidence**.
 *
 * ## Why parking is safe for ExoSync
 *
 * Proven separately by req `4eca4900`: both sync-unit collectors gate
 * enumeration on the existence of the DERIVED mount path, so a parked
 * AssetSpace is enumerated by neither, its deletion set is never computed, and
 * `push` cannot wipe it on the remote. This module depends on that property and
 * does not restate it.
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
 * Accepts every form the value can reach a runtime in, because the plugin reads
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

/** Vault-relative root every parked mount is moved under. */
export const PARKED_ROOT = ".exocortex/parked";

/** Prefix every derived mount folder carries (`AssetSpacePathDeriver`). */
const MOUNT_ROOT = "assetspaces/";

/**
 * Where a mount folder lives while parked — DERIVED, never stored.
 *
 * `assetspaces/<owner>/<repo>` → `.exocortex/parked/<owner>/<repo>`.
 *
 * `.exocortex/` and not `.obsidian/plugins/exocortex/`: BRAT overwrites the
 * plugin directory on every update, which would silently destroy parked mounts.
 *
 * Deriving (rather than storing a second path alongside the first) is what keeps
 * the two locations from drifting: there is exactly one function that knows the
 * mapping, so a test cannot stay green against a dead deriver by hand-writing
 * the parked path.
 *
 * @param folderName vault-relative derived mount folder.
 * @returns the vault-relative parked location.
 * @throws when `folderName` is not a well-formed mount folder — an unchecked
 *   value here would move a directory to an attacker-chosen place, so this
 *   fails loud rather than falling back to a "best effort" path.
 */
export function parkedPathFor(folderName: string): string {
  const segments = folderName.split("/");
  if (
    folderName.length === 0 ||
    !folderName.startsWith(MOUNT_ROOT) ||
    segments.some((s) => s.length === 0 || s === "." || s === "..")
  ) {
    throw new Error(
      `parkedPathFor: refusing unsafe mount folder "${folderName}"`,
    );
  }
  return `${PARKED_ROOT}/${folderName.slice(MOUNT_ROOT.length)}`;
}

/**
 * Where an AssetSpace's bytes currently are.
 *
 * - `active`  — the derived mount folder exists; the AssetSpace is indexed and
 *   enumerated as a sync unit.
 * - `parked`  — the derived mount folder is gone, but a full copy sits under
 *   {@link PARKED_ROOT}; on the device, invisible to indexing and to ExoSync.
 * - `absent`  — neither location exists.
 */
export type MountState = "active" | "parked" | "absent";

/**
 * What `apply-profile` must do to reach the state the target profile asks for.
 *
 * `none` is an explicit member rather than a `null`: "a parked AssetSpace the
 * profile omits is deliberately left alone" is a decision the transition table
 * makes, and naming it keeps a caller from reading a falsy value as "unhandled".
 */
export type MountTransition =
  | "none"
  | "park"
  | "unpark"
  | "destroy"
  | "materialize";

/** Inputs of {@link classifyMountTransition}. */
export interface MountTransitionInput {
  /** Where the AssetSpace's bytes are right now. */
  state: MountState;
  /** Whether the target profile's effective set includes this AssetSpace. */
  inEffectiveSet: boolean;
  /**
   * RAW `exo__AssetSpace_dependsOnKind` of this AssetSpace's own registry
   * descriptor. Interpreted by {@link resolveDependencyKind} — pass it
   * uninterpreted so the safe default applies to every unreadable form.
   */
  dependsOnKind?: unknown;
  /**
   * Whether the caller is ABLE to park (has a mount port that can move folders).
   * Default `true`.
   *
   * ⛔ Exists so a caller that cannot park never PLANS one. Planning a park and
   * silently falling back to a destroy at execution time is the worse failure by
   * far: the approval card would read "kept on this device" while the files were
   * deleted — the surface describing the opposite of the mechanism, at the exact
   * moment consent is given. Refusing to plan what you cannot do degrades to the
   * pre-existing destroy semantics, which is at least what the card then says.
   */
  canPark?: boolean;
}

/**
 * req `d4ccc901` — the single place that decides what happens to one AssetSpace.
 *
 * Pure and total: every (state × membership) pair maps to exactly one
 * transition, so a new state cannot be added without this table refusing to
 * compile against its own switch.
 *
 * | state \ in effective set | yes           | no                        |
 * |--------------------------|---------------|---------------------------|
 * | `active`                 | `none`        | `park` (soft) / `destroy` |
 * | `parked`                 | `unpark`      | `none`                    |
 * | `absent`                 | `materialize` | `none`                    |
 *
 * The one cell that reads the dependency kind is `active` + not-included: that
 * is the only decision where the AssetSpace's own semantics (content vs
 * definitions) changes what is safe. Everywhere else the state already
 * determines the answer.
 *
 * ⛔ The TS-floor assertion and the catalog-keep rule run BEFORE this
 * classification, so `exoas-exo` and `exoas-registry` never reach a `park` or
 * `destroy` cell at all — this function is not the guard that protects them.
 */
export function classifyMountTransition(
  input: MountTransitionInput,
): MountTransition {
  const { state, inEffectiveSet, dependsOnKind, canPark = true } = input;
  switch (state) {
    case "active":
      if (inEffectiveSet) return "none";
      return canPark && resolveDependencyKind(dependsOnKind) === "reference"
        ? "park"
        : "destroy";
    case "parked":
      // Not in the effective set → stays parked. This is the cell that keeps
      // `reconcileToLocal` from computing a deletion for bytes the user
      // deliberately kept on the device.
      return inEffectiveSet ? "unpark" : "none";
    case "absent":
      return inEffectiveSet ? "materialize" : "none";
  }
}
