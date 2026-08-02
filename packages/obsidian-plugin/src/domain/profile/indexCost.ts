import { transitiveDependsOnClosure } from "@kitelev/exocortex-core";
import type { AssetSpaceInfo } from "../../infrastructure/adapters/AssetSpaceManager";

/**
 * req 6171f443 — the index cost of a mount decision, measured over the whole
 * `exo__AssetSpace_dependsOn` CLOSURE rather than a single AssetSpace.
 *
 * ## Why the closure and not the AssetSpace
 *
 * The parent project's falsification gate (task `8b8466bb`, measured 2026-08-02
 * on the real vaults) found that mounting less through profiles does NOT
 * materially help: the active profile already resolves to 100 % of vault-my
 * (8 738 / 8 738) and 99.4 % of vault-exodev. The limiter is not the
 * always-mounted TS floor (`{exo}` = 300 files = 3.4 %) — it is the transitive
 * `dependsOn` closure. Mounting the personal `exoas-my` (3 763 files) *forces*
 * another 4 862, so the "minimal profile that still has my data" saves 58 files
 * (0.7 %).
 *
 * Surfacing an AssetSpace's OWN size alone would therefore actively mislead —
 * it is precisely the number that makes "just turn the extra ones off" look
 * promising. The closure figure is the honest one, and showing it is what the
 * gate explicitly recommended keeping this work for.
 *
 * ## Why no millisecond estimate
 *
 * The same measurement established that index time is strictly linear in file
 * count (`index_ms = 0.677 × files + 181`, R² = 0.9995; an independent
 * parse-proxy gave R² = 0.996). But the *constant* is device-specific (desktop
 * ≠ iPhone) while the *ratio* is stable. A file count is therefore the honest,
 * device-independent weight; a millisecond figure would bake a fabricated
 * constant into TS.
 */
export interface IndexCost {
  /**
   * Total files across the closure members whose count is KNOWN. When
   * {@link uncountedAssetSpaces} is non-zero this is a LOWER BOUND, not the
   * full cost.
   */
  files: number;
  /** Size of the transitive `dependsOn` closure (roots included). */
  closureSize: number;
  /** Closure members with a known file count (materialized and counted). */
  countedAssetSpaces: number;
  /**
   * Closure members with NO known count — not materialized, so their files
   * cannot be walked. Non-zero ⇒ {@link files} is a lower bound.
   */
  uncountedAssetSpaces: number;
}

/**
 * req 6171f443 — compute the index cost of mounting `roots`, expanded through
 * the transitive `exo__AssetSpace_dependsOn` closure.
 *
 * Pure. Uses the SAME shared {@link transitiveDependsOnClosure} helper that
 * `ProfileApplyManager.resolveDeclaredAndEffective` and `CliProfileResolver`
 * use, so the previewed set matches what an apply would actually resolve
 * (multi-parser-predicate-migration parity rule).
 *
 * ⛔ Deliberately does NOT call `resolveDeclaredAndEffective`: that method
 * asserts the TS floor and THROWS on a floor-violating profile, which would
 * break the picker for every other row. A preview must never throw.
 *
 * @param roots The directly-declared AssetSpace UIDs (a profile's
 *   `exo__Profile_includes`, or a single AssetSpace being inspected).
 * @param allInfos The scanned AssetSpace catalogue (carries `dependsOn` edges).
 * @param fileCountByUid Known per-AssetSpace file counts. Absent ⇒ uncounted.
 */
export function computeClosureIndexCost(
  roots: Iterable<string>,
  allInfos: ReadonlyArray<AssetSpaceInfo>,
  fileCountByUid: ReadonlyMap<string, number>,
): IndexCost {
  const dependsOnMap = new Map<string, string[]>();
  for (const info of allInfos) {
    if (info.dependsOn !== undefined && info.dependsOn.length > 0) {
      dependsOnMap.set(info.uid, info.dependsOn);
    }
  }
  // TEMP-REVERT (revert-verify of the e2e gate — restored in the next commit):
  // price only the DECLARED roots, i.e. drop the transitive dependsOn walk.
  const closure = new Set(roots);
  void dependsOnMap;
  void transitiveDependsOnClosure;

  let files = 0;
  let countedAssetSpaces = 0;
  let uncountedAssetSpaces = 0;
  for (const uid of closure) {
    const count = fileCountByUid.get(uid);
    if (count === undefined) {
      uncountedAssetSpaces += 1;
      continue;
    }
    files += count;
    countedAssetSpaces += 1;
  }

  return {
    files,
    closureSize: closure.size,
    countedAssetSpaces,
    uncountedAssetSpaces,
  };
}

/** Group digits so a five-figure file count stays readable (`8 738`). */
function formatFileCount(files: number): string {
  const grouped = files.toLocaleString("en-US").replace(/,/g, " ");
  return `${grouped} ${files === 1 ? "file" : "files"}`;
}

/**
 * req 6171f443 — render an {@link IndexCost} as one muted picker line.
 *
 * Returns `null` when NOTHING is known (no closure member could be counted).
 * That null is what makes the zero-regression guarantee structural rather than
 * argued: with no counts available the caller attaches no cost, and the picker
 * rows render byte-identically to the pre-feature behaviour.
 *
 * An uncounted closure member is never silently absorbed — the total is marked
 * as a lower bound (`≥`) and the number of uncounted AssetSpaces is stated.
 */
export function formatIndexCost(cost: IndexCost): string | null {
  if (cost.countedAssetSpaces === 0) return null;

  const files = formatFileCount(cost.files);
  const bound = cost.uncountedAssetSpaces > 0 ? "≥ " : "";
  const packs = cost.closureSize === 1 ? "assetspace" : "assetspaces";
  const base = `${bound}${files} · ${cost.closureSize} ${packs}`;
  if (cost.uncountedAssetSpaces === 0) return base;
  return `${base} (${cost.uncountedAssetSpaces} not mounted, uncounted)`;
}

/**
 * req 6171f443 — render the cost line for ONE AssetSpace in the pack list: its
 * OWN size plus the cost of its closure, so removing it reads honestly.
 *
 * The own size alone is the misleading number (see the module docstring); the
 * closure suffix is appended only when the closure is genuinely larger than the
 * AssetSpace itself, so a dependency-free pack stays a single clean figure.
 *
 * Returns `null` when nothing is known (zero-regression, as above).
 */
export function formatAssetSpaceIndexCost(
  ownFiles: number | undefined,
  closure: IndexCost,
): string | null {
  if (ownFiles === undefined) return formatIndexCost(closure);
  const own = formatFileCount(ownFiles);
  if (closure.closureSize <= 1) return own;
  const closureLine = formatIndexCost(closure);
  if (closureLine === null) return own;
  return `${own} · with dependencies: ${closureLine}`;
}
