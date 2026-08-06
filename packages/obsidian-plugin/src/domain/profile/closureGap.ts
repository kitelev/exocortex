import { transitiveDependsOnClosure } from "@kitelev/exocortex-core";
import type { AssetSpaceInfo } from "../../infrastructure/adapters/AssetSpaceManager";
import { resolveDependencyKind } from "./dependencyKind";

/**
 * issue #3956 — one member of a mount's `exo__AssetSpace_dependsOn` closure that
 * is NOT currently materialized on disk.
 */
export interface UnmountedClosureMember {
  /** The AssetSpace UID. */
  uid: string;
  /**
   * `exo__AssetSpace_namespace` (e.g. `"exocmd"`) when the descriptor is scanned,
   * else the short UID — a user-legible name for the warning.
   */
  label: string;
  /**
   * True when this AssetSpace supplies class / command-binding-resolution TBox
   * whose absence silently breaks homoiconic commands + SHACL validation
   * (#3956).
   *
   * req `18ecf16f` — read from the graph (`exo__AssetSpace_dependsOnKind` on the
   * AssetSpace's own registry descriptor), no longer from a hardcoded namespace
   * list. A member with NO scanned descriptor is therefore now reported as
   * `true`, not `false` — it can never be materialized, and defaulting an
   * unknown to "harmless content" is the one direction that loses types
   * silently.
   */
  providesTBox: boolean;
}

/**
 * req `18ecf16f` — a HARD-edge closure member the effective set omits. Thrown
 * BEFORE any mount-state mutation, beside the TS-floor assertion, so a profile
 * that would leave a class-definition provider unmounted refuses loudly instead
 * of producing a vault whose assets silently lose their type.
 */
export class OmittedHardDependencyError extends Error {
  /** The omitted hard members, in closure order. */
  public readonly omitted: ReadonlyArray<UnmountedClosureMember>;

  constructor(omitted: ReadonlyArray<UnmountedClosureMember>) {
    const names = omitted.map((m) => m.label).join(", ");
    const one = omitted.length === 1;
    super(
      `Profile omits {${names}}, which ${one ? "supplies" : "supply"} class / ` +
        `command definitions (exo__AssetSpace_dependsOnKind = ` +
        `exo__DependencyKindTBox). Applying it would leave assets without a ` +
        `resolvable type. Add ${one ? "it" : "them"} to the profile, or mark ` +
        `${one ? "it" : "them"} exo__DependencyKindReference if ` +
        `${one ? "it supplies" : "they supply"} content only.`,
    );
    this.name = "OmittedHardDependencyError";
    this.omitted = omitted;
  }
}

/**
 * issue #3956 — the transitive `exo__AssetSpace_dependsOn` closure members of
 * `roots` that are NOT in `materializedUids` (their folder is not present on
 * disk). An incomplete closure leaves a declared dependency (especially the
 * `exocmd` class-TBox) silently unmounted, so the RDF converter can't resolve
 * `exo__Instance_class: [[<uid>]]` to the class label → homoiconic commands +
 * bindings become silently dead. Surfacing this makes the gap fail LOUD.
 *
 * Pure: builds the `dependsOn` map from `allInfos`, computes the closure of
 * `roots` via the shared {@link transitiveDependsOnClosure} (the SAME helper
 * `ProfileApplyManager.resolveDeclaredAndEffective` + `CliProfileResolver` use),
 * and returns each closure member whose UID is not materialized. A materialized
 * root is skipped (it satisfies the check). A closure member with no scanned
 * descriptor (not in `allInfos`) is still reported — it can never be
 * materialized without adding it — but with the short UID as its label and
 * `providesTBox=false` (namespace unknown).
 *
 * @param roots The directly-mounted / declared AssetSpace UIDs to check.
 * @param allInfos The scanned AssetSpace catalogue (carries `dependsOn` edges).
 * @param materializedUids The AssetSpace UIDs currently present on disk.
 * @returns The unmounted closure members (empty when the closure is complete).
 */
export function detectUnmountedClosureMembers(
  roots: Iterable<string>,
  allInfos: ReadonlyArray<AssetSpaceInfo>,
  materializedUids: ReadonlySet<string>,
): UnmountedClosureMember[] {
  const dependsOnMap = new Map<string, string[]>();
  const infoByUid = new Map<string, AssetSpaceInfo>();
  for (const info of allInfos) {
    infoByUid.set(info.uid, info);
    if (info.dependsOn !== undefined && info.dependsOn.length > 0) {
      dependsOnMap.set(info.uid, info.dependsOn);
    }
  }
  const closure = transitiveDependsOnClosure(new Set(roots), dependsOnMap);
  return describeOmittedMembers(closure, materializedUids, infoByUid);
}

/**
 * req `18ecf16f` — the shared "closure minus present" description used by both
 * the post-apply WARNING ({@link detectUnmountedClosureMembers}) and the
 * pre-mutation REFUSAL ({@link assertHardDependenciesSatisfied}), so the two
 * gates can never disagree about which members are hard.
 */
function describeOmittedMembers(
  closure: Iterable<string>,
  presentUids: ReadonlySet<string>,
  infoByUid: ReadonlyMap<string, AssetSpaceInfo>,
): UnmountedClosureMember[] {
  const missing: UnmountedClosureMember[] = [];
  for (const uid of closure) {
    if (presentUids.has(uid)) continue;
    const info = infoByUid.get(uid);
    const namespace = info?.namespace ?? "";
    missing.push({
      uid,
      label: namespace.length > 0 ? namespace : uid.slice(0, 8),
      providesTBox: resolveDependencyKind(info?.dependsOnKind) === "tbox",
    });
  }
  return missing;
}

/**
 * req `18ecf16f` — REFUSE, before any mutation, when the effective set omits a
 * HARD-edge member of the dependsOn closure.
 *
 * Pure. The caller passes the closure it already computed (so this gate judges
 * exactly the set the apply will act on) plus the effective set. A member with
 * no scanned descriptor counts as hard — `resolveDependencyKind(undefined)` is
 * `"tbox"` — which is deliberate: such a member can never be materialized, and
 * it is precisely the silent-drop path
 * (`resolveDeclaredAndEffective` keeps only closure members that have a
 * descriptor) that this gate exists to make loud.
 *
 * @throws OmittedHardDependencyError when at least one hard member is omitted.
 */
export function assertHardDependenciesSatisfied(
  closure: Iterable<string>,
  effectiveUids: ReadonlySet<string>,
  allInfos: ReadonlyArray<AssetSpaceInfo>,
): void {
  const infoByUid = new Map<string, AssetSpaceInfo>();
  for (const info of allInfos) infoByUid.set(info.uid, info);
  const omittedHard = describeOmittedMembers(
    closure,
    effectiveUids,
    infoByUid,
  ).filter((m) => m.providesTBox);
  if (omittedHard.length > 0) throw new OmittedHardDependencyError(omittedHard);
}

/**
 * issue #3956 — render a single non-fatal WARNING line naming the unmounted
 * closure members + the remedy. `contextLabel` describes what triggered the
 * check (e.g. the added AssetSpace's namespace, or the applied profile). Returns
 * `null` for an empty gap (nothing to warn about — no false-positive).
 */
export function formatClosureGapWarning(
  members: ReadonlyArray<UnmountedClosureMember>,
  contextLabel: string,
): string | null {
  if (members.length === 0) return null;
  const names = members.map((m) => m.label).join(", ");
  const tbox = members.filter((m) => m.providesTBox).map((m) => m.label);
  const tboxNote =
    tbox.length > 0
      ? ` ${tbox.join(", ")} provide the class / command TBox — without them, ` +
        `homoiconic commands and validation are silently broken.`
      : "";
  const plural = members.length === 1;
  return (
    `⚠ ${contextLabel} depends on {${names}} which ${plural ? "is" : "are"} not mounted.` +
    `${tboxNote} Run «Apply profile» or add ${plural ? "it" : "them"} via «Add AssetSpace by URL».`
  );
}
