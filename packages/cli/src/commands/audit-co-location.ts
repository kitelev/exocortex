import { Command } from "commander";
import { existsSync, statSync } from "fs";
import path from "path";
import { resolve } from "path";
import { extractAssetReference } from "@kitelev/exocortex-core";
import { CachingNodeFsAdapter } from "../adapters/CachingNodeFsAdapter.js";
import {
  findReferencedFile,
  normalizePath,
} from "../executors/folderRepairHelpers.js";
import { ErrorHandler, type OutputFormat } from "../utils/ErrorHandler.js";
import { VaultNotFoundError } from "../utils/errors/index.js";
import { isTemplatesPath } from "../utils/vaultPathFilters.js";

/**
 * Reasons an asset is fail-open SKIPPED (not a violation, but also not proven
 * co-located). Reported explicitly so "0 violations" never masks "100%
 * co-located" — per RFC 0b7a2fad skip-accounting requirement.
 */
export type CoLocationSkipReason =
  | "empty-isDefinedBy"
  | "bang-prefix"
  | "unresolvable";

export interface CoLocationViolation {
  path: string;
  isDefinedBy: string;
  expectedFolder: string;
  actualFolder: string;
}

export interface CoLocationResult {
  vaultPath: string;
  totalFiles: number;
  /** Files where co-location was actually verified (ref resolved). */
  checked: number;
  violations: CoLocationViolation[];
  skips: Record<CoLocationSkipReason, number>;
  /** Up to a few example paths per skip reason, for human triage. */
  skipExamples: Record<CoLocationSkipReason, string[]>;
}

const MAX_SKIP_EXAMPLES = 5;

function addExample(
  examples: Record<CoLocationSkipReason, string[]>,
  reason: CoLocationSkipReason,
  filePath: string,
): void {
  if (examples[reason].length < MAX_SKIP_EXAMPLES) {
    examples[reason].push(filePath);
  }
}

/**
 * Audit a single vault for the asset–ontology co-location invariant: every
 * asset with `exo__Asset_isDefinedBy` must physically live in the same folder
 * as the ontology file that reference resolves to (FLAT, exact-match). Uses the
 * shared {@link findReferencedFile} resolver (same path as `apply
 * repair-folder`) over a cached adapter so the audit and migration agree.
 *
 * Fail-open: assets with no `isDefinedBy`, a `!`-prefixed (intentionally
 * unresolvable) reference, or a reference that doesn't resolve in THIS vault
 * (cross-vault or missing ontology file) are skipped and counted by reason —
 * never reported as violations.
 */
export async function scanVaultForCoLocation(
  vaultPath: string,
): Promise<CoLocationResult> {
  const adapter = new CachingNodeFsAdapter(vaultPath);
  const assets = await adapter.indexedAssets();

  const violations: CoLocationViolation[] = [];
  const skips: Record<CoLocationSkipReason, number> = {
    "empty-isDefinedBy": 0,
    "bang-prefix": 0,
    unresolvable: 0,
  };
  const skipExamples: Record<CoLocationSkipReason, string[]> = {
    "empty-isDefinedBy": [],
    "bang-prefix": [],
    unresolvable: [],
  };
  let checked = 0;

  for (const { path: relPath, metadata } of assets) {
    // node_modules is not vault content (glob already excludes dotdirs like
    // .git/.obsidian, but not node_modules). Never audit/report those.
    if (relPath.split("/").includes("node_modules")) continue;

    // Templates folders hold Templater templates (intentional <%* %> / {{…}}
    // placeholder syntax), not real assets — they carry exo__Asset_isDefinedBy
    // by pattern inheritance but must never move (RFC 0b7a2fad CR-1). The
    // exclusion previously hardcoded the stale "09 Templates/" path; the live
    // vault keeps templates under root-level "templates/" (RFC df39007b R6).
    if (isTemplatesPath(relPath)) continue;

    const rawIsDefinedBy = metadata["exo__Asset_isDefinedBy"];
    const ref = extractAssetReference(rawIsDefinedBy);

    if (!ref) {
      skips["empty-isDefinedBy"]++;
      addExample(skipExamples, "empty-isDefinedBy", relPath);
      continue;
    }
    if (ref.startsWith("!")) {
      skips["bang-prefix"]++;
      addExample(skipExamples, "bang-prefix", relPath);
      continue;
    }

    const ontologyPath = await findReferencedFile(adapter, ref, relPath);
    if (!ontologyPath) {
      // Unresolvable in this vault: cross-vault ontology OR genuinely missing.
      skips.unresolvable++;
      addExample(skipExamples, "unresolvable", relPath);
      continue;
    }

    checked++;
    const expectedFolder = normalizePath(path.dirname(ontologyPath));
    const actualFolder = normalizePath(path.dirname(relPath));
    if (expectedFolder !== actualFolder) {
      violations.push({
        path: relPath,
        isDefinedBy: ref,
        expectedFolder,
        actualFolder,
      });
    }
  }

  return {
    vaultPath,
    totalFiles: assets.length,
    checked,
    violations,
    skips,
    skipExamples,
  };
}

export interface AuditCoLocationOptions {
  vault: string;
  output?: OutputFormat;
}

/**
 * RFC 0b7a2fad Phase 1 — co-location invariant audit (source of truth, CI).
 *
 * `exocortex audit co-location --vault <path>` walks the vault and reports any
 * asset whose folder differs from its `isDefinedBy` ontology folder. Exit 0 =
 * 0 violations (skips are still reported); exit 1 = ≥1 violation. Skips never
 * affect the exit code — fail-open by design.
 */
export function auditCoLocationCommand(): Command {
  return new Command("co-location")
    .description(
      "Detect asset–ontology co-location violations: any asset not in the folder of its exo__Asset_isDefinedBy ontology file (fail-open, skip-accounted)",
    )
    .requiredOption("--vault <path>", "Vault root directory")
    .option("--output <type>", "Response format: text|json", "text")
    .action(async (options: AuditCoLocationOptions) => {
      const outputFormat = (options.output ?? "text") as OutputFormat;
      ErrorHandler.setFormat(outputFormat);

      try {
        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath) || !statSync(vaultPath).isDirectory()) {
          throw new VaultNotFoundError(vaultPath);
        }

        const result = await scanVaultForCoLocation(vaultPath);
        const skipTotal =
          result.skips["empty-isDefinedBy"] +
          result.skips["bang-prefix"] +
          result.skips.unresolvable;

        if (outputFormat === "json") {
          console.log(
            JSON.stringify(
              {
                vaultPath: result.vaultPath,
                totalFiles: result.totalFiles,
                checked: result.checked,
                violationCount: result.violations.length,
                violations: result.violations,
                skips: result.skips,
                skipTotal,
                skipExamples: result.skipExamples,
                clean: result.violations.length === 0,
              },
              null,
              2,
            ),
          );
        } else {
          if (result.violations.length === 0) {
            console.log(
              `OK ${vaultPath}: 0 co-location violations (${result.checked}/${result.totalFiles} checked)`,
            );
          } else {
            console.error(
              `FAIL ${vaultPath}: ${result.violations.length} co-location violation(s) (${result.checked}/${result.totalFiles} checked):`,
            );
            for (const v of result.violations) {
              console.error(
                `  ${v.path}\n      isDefinedBy=${v.isDefinedBy} expected=${v.expectedFolder}/ actual=${v.actualFolder}/`,
              );
            }
          }
          // Skip-accounting is always printed — "0 violations" ≠ "100% co-located".
          console.error(
            `\nSkipped (fail-open, NOT verified): ${skipTotal} — ` +
              `empty-isDefinedBy=${result.skips["empty-isDefinedBy"]}, ` +
              `bang-prefix=${result.skips["bang-prefix"]}, ` +
              `unresolvable(cross-vault/missing)=${result.skips.unresolvable}`,
          );
        }

        if (result.violations.length > 0) process.exitCode = 1;
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });
}
