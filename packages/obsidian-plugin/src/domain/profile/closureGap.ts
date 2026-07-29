import { transitiveDependsOnClosure } from "@kitelev/exocortex-core";
import type { AssetSpaceInfo } from "../../infrastructure/adapters/AssetSpaceManager";

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
   * (#3956): the `exo` SDK floor + the `exocmd` command TBox. Only knowable when
   * the descriptor is scanned (namespace present).
   */
  providesTBox: boolean;
}

/**
 * The namespaces whose AssetSpace supplies command/binding-resolution TBox.
 * `exo` = the class/property defs + the RDF engine floor; `exocmd` = the
 * `exocmd__Command`/`Precondition`/`Grounding`/`CommandBinding` class defs +
 * grounding-type enums that `CommandResolver.loadCommand` matches `rdf:type`
 * against. Their absence is the exact gap that left the alpha tester's entire
 * homoiconic command system silently dead (RFC 430e84f1 P3).
 */
const TBOX_PROVIDER_NAMESPACES: ReadonlySet<string> = new Set(["exo", "exocmd"]);

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
  const missing: UnmountedClosureMember[] = [];
  for (const uid of closure) {
    if (materializedUids.has(uid)) continue;
    const namespace = infoByUid.get(uid)?.namespace ?? "";
    missing.push({
      uid,
      label: namespace.length > 0 ? namespace : uid.slice(0, 8),
      providesTBox: TBOX_PROVIDER_NAMESPACES.has(namespace),
    });
  }
  return missing;
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
