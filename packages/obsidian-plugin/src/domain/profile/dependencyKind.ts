/**
 * req `18ecf16f` — the KIND of an `exo__AssetSpace_dependsOn` dependency, read
 * from the graph instead of a hardcoded namespace list.
 *
 * ## Where the implementation lives (and why it moved)
 *
 * req `d4ccc901` — the CLI apply path needs the SAME reading to decide park vs
 * destroy, so the implementation moved to
 * `@kitelev/exocortex-core` (`domain/profile/ParkedMountState`). Duplicating it
 * per package would let the two runtimes disagree about which AssetSpaces are
 * parkable — the exact class of CLI/plugin divergence this subsystem keeps
 * getting bitten by. This module stays as the plugin-local name so existing
 * importers (`closureGap`, `unmountSafety`) are unaffected.
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

export {
  DEPENDENCY_KIND_TBOX_UID,
  DEPENDENCY_KIND_REFERENCE_UID,
  resolveDependencyKind,
} from "@kitelev/exocortex-core";
export type { DependencyKind } from "@kitelev/exocortex-core";
