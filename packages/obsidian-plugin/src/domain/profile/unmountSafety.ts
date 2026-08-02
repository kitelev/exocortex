import { transitiveDependsOnClosure } from "@kitelev/exocortex-core";
import type { AssetSpaceInfo } from "../../infrastructure/adapters/AssetSpaceManager";
import { TBOX_PROVIDER_NAMESPACES } from "./closureGap";

/**
 * req `d5bc68f6` — the blast radius of REMOVING a knowledge pack, assessed
 * read-only before the destructive confirm.
 *
 * ## Why the warning is the load-bearing half of P2
 *
 * The parent project's falsification gate (task `8b8466bb`, measured 2026-08-02
 * on the real vaults) found that mounting less through profiles does NOT
 * materially help — the active profile already resolves to ~100 % of every
 * vault, because the transitive `exo__AssetSpace_dependsOn` closure is forced.
 * Its verdict for this task was explicit: granularity buys nothing where the
 * closure is forced, and is useful **only together with the reverse-reference
 * warning**, which the same measurement quantified as real — 3 684 wikilinks
 * from 1 464 personal assets point into `shared-private` alone.
 *
 * So the danger is not "the user cannot trim enough"; it is "the user CAN
 * remove a pack the rest of the vault still needs". Two independent ways that
 * bites, both assessed here:
 *
 * 1. **A declared dependency.** Another still-mounted AssetSpace has this one in
 *    its `dependsOn` closure. This is the exact mirror of
 *    {@link detectUnmountedClosureMembers} — that one asks "what did I forget to
 *    mount?", this one asks "who still needs what I am about to remove?".
 *    Removing a TBox provider is the worst case: `exocmd` is OPTIONAL (not
 *    TS-floor), so it CAN be removed today, and its absence leaves homoiconic
 *    commands and SHACL validation **silently** dead.
 * 2. **Incoming links.** Notes that stay behind link into the pack's files.
 *    After the removal those links dangle.
 *
 * ## Why `resolvedLinks` is the right (and free) source
 *
 * Obsidian already maintains `metadataCache.resolvedLinks`
 * (`Record<source, Record<target, count>>`) — no vault walk, no `node:fs`, so
 * this costs nothing extra and behaves identically on iOS (Desktop↔Mobile
 * parity). It carries only links whose target EXISTS, which is exactly what is
 * wanted: the pack is still mounted at assessment time, so a link into it
 * resolves now and would dangle after the removal.
 */
export interface UnmountRisk {
  /**
   * Labels of the still-mounted AssetSpaces whose transitive `dependsOn`
   * closure contains the pack being removed. Empty ⇒ nothing declared depends
   * on it.
   */
  dependents: string[];
  /** Resolved links pointing from OUTSIDE the pack into files INSIDE it. */
  incomingLinks: number;
  /** Distinct files outside the pack that contain those links. */
  linkingFiles: number;
  /**
   * The pack supplies the class / command-binding-resolution TBox
   * ({@link TBOX_PROVIDER_NAMESPACES}) — removing it breaks homoiconic commands
   * and validation silently rather than loudly.
   */
  providesTBox: boolean;
}

/** The subset of a picked AssetSpace this assessment needs. */
export interface UnmountTarget {
  uid: string;
  /** Vault-relative mount folder — the folder the removal deletes. */
  submodulePath: string;
  namespace: string;
}

/** Obsidian's `metadataCache.resolvedLinks` shape. */
export type ResolvedLinks = Readonly<Record<string, Record<string, number>>>;

/** `assetspaces/kitelev/exoas-x` → `assetspaces/kitelev/exoas-x/` (idempotent). */
function asFolderPrefix(mountPath: string): string {
  return mountPath.endsWith("/") ? mountPath : `${mountPath}/`;
}

/**
 * req `d5bc68f6` — the still-mounted AssetSpaces that declare a dependency on
 * `targetUid`, i.e. the REVERSE of {@link detectUnmountedClosureMembers}.
 *
 * Pure. Expands each mounted AssetSpace through the SAME shared
 * {@link transitiveDependsOnClosure} helper that
 * `ProfileApplyManager.resolveDeclaredAndEffective` and `CliProfileResolver`
 * use, so "depends on" here means exactly what an apply would resolve. The
 * target itself is never reported as its own dependent.
 *
 * @param targetUid The AssetSpace about to be removed.
 * @param mountedUids The AssetSpace UIDs currently mounted.
 * @param allInfos The scanned AssetSpace catalogue (carries `dependsOn` edges).
 * @returns Sorted, de-duplicated labels (`namespace`, else the short UID).
 */
export function findDependentMountedAssetSpaces(
  targetUid: string,
  mountedUids: Iterable<string>,
  allInfos: ReadonlyArray<AssetSpaceInfo>,
): string[] {
  if (targetUid.length === 0) return [];
  const dependsOnMap = new Map<string, string[]>();
  const infoByUid = new Map<string, AssetSpaceInfo>();
  for (const info of allInfos) {
    infoByUid.set(info.uid, info);
    if (info.dependsOn !== undefined && info.dependsOn.length > 0) {
      dependsOnMap.set(info.uid, info.dependsOn);
    }
  }
  const labels = new Set<string>();
  for (const uid of mountedUids) {
    if (uid === targetUid || uid.length === 0) continue;
    const closure = transitiveDependsOnClosure(new Set([uid]), dependsOnMap);
    if (!closure.has(targetUid)) continue;
    const namespace = infoByUid.get(uid)?.namespace ?? "";
    labels.add(namespace.length > 0 ? namespace : uid.slice(0, 8));
  }
  return [...labels].sort((a, b) => a.localeCompare(b));
}

/**
 * req `d5bc68f6` — links pointing from OUTSIDE `mountPath` into files INSIDE it.
 *
 * Pure. A source inside the folder is skipped (an internal link survives the
 * removal along with both of its ends — only links whose SOURCE stays behind
 * can dangle).
 */
export function countIncomingLinks(
  mountPath: string,
  resolvedLinks: ResolvedLinks,
): { links: number; files: number } {
  if (mountPath.length === 0) return { links: 0, files: 0 };
  const prefix = asFolderPrefix(mountPath);
  let links = 0;
  const sources = new Set<string>();
  for (const [source, targets] of Object.entries(resolvedLinks)) {
    if (source.startsWith(prefix)) continue; // internal — removed together
    for (const [target, count] of Object.entries(targets)) {
      if (!target.startsWith(prefix)) continue;
      links += count;
      sources.add(source);
    }
  }
  return { links, files: sources.size };
}

/**
 * req `d5bc68f6` — assess both risk axes for one pick. Pure; the caller supplies
 * the already-scanned catalogue, the mounted set and Obsidian's link index.
 */
export function assessUnmountRisk(
  target: UnmountTarget,
  mountedUids: Iterable<string>,
  allInfos: ReadonlyArray<AssetSpaceInfo>,
  resolvedLinks: ResolvedLinks,
): UnmountRisk {
  const { links, files } = countIncomingLinks(
    target.submodulePath,
    resolvedLinks,
  );
  return {
    dependents: findDependentMountedAssetSpaces(
      target.uid,
      mountedUids,
      allInfos,
    ),
    incomingLinks: links,
    linkingFiles: files,
    providesTBox: TBOX_PROVIDER_NAMESPACES.has(target.namespace),
  };
}

/**
 * req `d5bc68f6` — render the blast radius as one warning line to prepend to the
 * destructive confirmation.
 *
 * Returns `null` when NOTHING is at risk — no dependent mount and no incoming
 * link. That null is what makes the zero-regression guarantee structural rather
 * than argued: the caller prepends nothing and the confirmation wording stays
 * byte-identical to the one shipped before this requirement.
 *
 * The TBox note is deliberately attached only when there IS a risk to report —
 * on its own, "this pack supplies TBox" is not a reason to warn about a removal
 * nothing depends on.
 */
export function formatUnmountRiskWarning(
  risk: UnmountRisk,
  label: string,
): string | null {
  const clauses: string[] = [];
  if (risk.dependents.length > 0) {
    const one = risk.dependents.length === 1;
    clauses.push(
      `${risk.dependents.join(", ")} ${one ? "is" : "are"} still mounted and ` +
        `${one ? "declares" : "declare"} a dependency on it`,
    );
  }
  if (risk.incomingLinks > 0) {
    const oneLink = risk.incomingLinks === 1;
    const oneFile = risk.linkingFiles === 1;
    clauses.push(
      `${risk.incomingLinks} link${oneLink ? "" : "s"} from ` +
        `${risk.linkingFiles} file${oneFile ? "" : "s"} outside it ` +
        `would be left dangling`,
    );
  }
  if (clauses.length === 0) return null;
  const tbox = risk.providesTBox
    ? " It also supplies the class / command TBox — without it, homoiconic " +
      "commands and validation break silently."
    : "";
  return `⚠ Removing «${label}» is not isolated: ${clauses.join("; ")}.${tbox}`;
}
