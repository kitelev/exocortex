/**
 * Shared `--profile <uid>` resolution + text-mode banner emission, consumed
 * by `sparql-query`, `classes`, `find`, `ask`, etc. RFC 0a0791c1 Issue #3323.
 *
 * The helper wraps `CliFocusProfileResolver` with CLI-presentation glue:
 * uniform engagement banners (text mode), uniform fallback warnings, and a
 * single return shape — `{ effective, folderMap } | null` — that every
 * `NoteToRDFConverter.convertVault({ effectiveOntologies, assetSpaceFolderToUid })`
 * callsite can spread into the options object directly.
 */

import { CliFocusProfileResolver } from "../services/CliFocusProfileResolver.js";
import type { OutputFormat } from "./ErrorHandler.js";

export interface ResolvedProfileFilter {
  effective: ReadonlySet<string>;
  folderMap: ReadonlyMap<string, string>;
}

export interface ResolveProfileFilterOptions {
  /** Raw `--profile <uid>` value (may be undefined / empty when flag absent). */
  profileUid: string | undefined;
  /** Primary vault root (absolute). */
  primaryVaultPath: string;
  /** Optional additional vault roots (already resolved to absolute paths). */
  alsoVaultPaths?: ReadonlyArray<string>;
  /** Current CLI output format — controls whether banner text is emitted. */
  outputFormat: OutputFormat;
}

/**
 * Resolve `--profile <uid>` to converter filter input. Returns `null` when
 * the filter should NOT be engaged:
 * - flag absent or empty (no profile);
 * - profile UID not found in any scanned vault (missing-profile);
 * - effective set has zero AssetSpace-folder overlap (degraded — R15);
 * - vault scan / yaml parse errored (error).
 *
 * In text-mode emits a single-line banner describing the outcome so users
 * can see why the filter did/didn't engage. JSON-mode stays quiet to keep
 * stdout structured.
 */
export async function resolveProfileFilter(
  options: ResolveProfileFilterOptions,
): Promise<ResolvedProfileFilter | null> {
  const { profileUid, primaryVaultPath, alsoVaultPaths, outputFormat } = options;
  if (profileUid === undefined || profileUid === "") return null;

  const resolver = new CliFocusProfileResolver({
    vaultPath: primaryVaultPath,
    alsoVaultPaths,
    warn: outputFormat === "text" ? (m) => console.warn(m) : undefined,
  });
  const outcome = await resolver.resolveFilter(profileUid);

  switch (outcome.outcome) {
    case "engaged": {
      if (outputFormat === "text") {
        const floorHits = countTsFloor(outcome.result.effective);
        console.log(
          `🎯 Profile ${profileUid.slice(0, 8)} engaged — ` +
            `${outcome.result.effective.size} AS UIDs in scope ` +
            `(incl. ${floorHits} TS-floor), ` +
            `${outcome.result.folderMap.size} folders mapped.`,
        );
        if (outcome.result.untranslated.length > 0) {
          console.log(
            `   ℹ️  ${outcome.result.untranslated.length} declared Ontology UID(s) ` +
              `had no AssetSpace_containsOntology mapping; passed through unfiltered.`,
          );
        }
      }
      return {
        effective: outcome.result.effective,
        folderMap: outcome.result.folderMap,
      };
    }
    case "no-profile":
      return null;
    case "missing-profile":
      if (outputFormat === "text") {
        console.log(
          `⚠️  --profile ${outcome.profileUid} not found in vault(s) — indexing full vault.`,
        );
      }
      return null;
    case "degraded":
      if (outputFormat === "text") {
        console.log(`⚠️  ${outcome.reason}`);
      }
      return null;
    case "error":
      if (outputFormat === "text") {
        console.log(`⚠️  ${outcome.reason}`);
      }
      return null;
  }
}

/** TS-floor AS UID set (mirrors `CliFocusProfileResolver` constants). */
const TS_FLOOR = new Set([
  "49fd2e56-4656-4ca7-a789-f472b16ea260",
  "c9c65b0f-1e01-47c1-a1f9-1bf70b11df6a",
  "0cde1557-6320-4bd0-a7c4-8b72afc38720",
]);

function countTsFloor(effective: ReadonlySet<string>): number {
  let n = 0;
  for (const uid of effective) {
    if (TS_FLOOR.has(uid)) n++;
  }
  return n;
}
