import { Command } from "commander";
import { existsSync, statSync } from "fs";
import { resolve } from "path";
import {
  VaultCheckRunner,
  createDefaultCheckRegistry,
  KNOWN_CHECK_IDS,
  extractAssetReference,
  type CheckContext,
  type IVaultCheckReader,
  type VaultAssetRecord,
} from "@kitelev/exocortex-core";

/**
 * Read the enabled validation-check set — the DATA half of the Homoiconicity
 * Invariant: WHICH checks run is configured by validation-check `setting__Setting`
 * instances (created by `scaffold validation-settings`), not by code. A
 * check-Setting carries `setting__Setting_key` (→ a check-key UID = the check-id)
 * and `setting__Setting_value` (boolean). Returns the truthy ones; only KNOWN
 * check-ids count, so unrelated setting__Setting instances never leak in.
 *
 * (Kept inline in the CLI rather than the core barrel — adding it as a core
 * export broke the jest cjs-module-lexer ESM-CJS enumeration of core's named
 * exports, dropping unrelated names like FileAlreadyExistsError for CLI ESM
 * importers. It re-uses KNOWN_CHECK_IDS + extractAssetReference, both already in
 * core's barrel. Shared home for plugin reuse is the M1.5-plugin follow-up.)
 */
function readEnabledCheckIds(
  assets: readonly VaultAssetRecord[],
): string[] {
  const enabled = new Set<string>();
  for (const a of assets) {
    const keyRef = extractAssetReference(a.frontmatter["setting__Setting_key"]);
    if (!keyRef || !KNOWN_CHECK_IDS.has(keyRef)) continue;
    const value = a.frontmatter["setting__Setting_value"];
    if (value === true || value === "true") enabled.add(keyRef);
  }
  return [...enabled];
}
import { CachingNodeFsAdapter } from "../adapters/CachingNodeFsAdapter.js";
import {
  loadTriplesFromAllVaults,
  runShapesValidation,
} from "./validate-schema.js";
import { ErrorHandler, type OutputFormat } from "../utils/ErrorHandler.js";
import { VaultNotFoundError } from "../utils/errors/index.js";

/**
 * CLI vault-check reader (RFC f402002b, M1.5): a single fs-walk yields the warm
 * asset array; the SHACL runner reuses the same triple-build the `validate
 * schema` command does. (The DAG runner is intentionally absent here — the
 * standalone `exocortex audit ontology-imports` command remains the CLI
 * source-of-truth for the imports DAG; enabling the DAG check in `validate
 * vault` therefore fails LOUD until its portable runner lands, M2.)
 */
class CliFsCheckReader implements IVaultCheckReader {
  constructor(
    private readonly vaultPath: string,
    private readonly useCache: boolean,
  ) {}

  async read(): Promise<CheckContext> {
    const adapter = new CachingNodeFsAdapter(this.vaultPath);
    const indexed = await adapter.indexedAssets();
    const assets: VaultAssetRecord[] = indexed.map((a) => ({
      path: a.path,
      frontmatter: a.metadata,
    }));
    const vaultPath = this.vaultPath;
    const useCache = this.useCache;
    return {
      assets,
      runShacl: async () => {
        const { triples } = await loadTriplesFromAllVaults(vaultPath, useCache);
        const report = await runShapesValidation(vaultPath, triples);
        return report.violations.map((v) => ({
          focusNode: v.focusNode,
          path: v.propertyPath,
          message: v.message,
        }));
      },
    };
  }
}

export interface ValidateVaultOptions {
  vault: string;
  useCache?: boolean;
  all?: boolean;
  output?: OutputFormat;
}

/**
 * `exocortex validate vault` (RFC f402002b, M1.5) — runs the configurable
 * vault-integrity checks (uid-uniqueness / co-location / SHACL / DAG) from the
 * enabled-set declared by validation-check `setting__Setting` instances
 * (created by `scaffold validation-settings`). `--all` runs every known check.
 *
 * Exit 0 = all enabled checks pass; exit 1 = any check fails OR errors
 * (fail-loud: an enabled check with no runner is an error, not a silent skip).
 */
export function validateVaultCommand(): Command {
  return new Command("vault")
    .description(
      "Run the homoiconic vault-integrity check-runner (enabled-set from validation-check setting__Setting instances; --all runs every check)",
    )
    .requiredOption("--vault <path>", "Vault root directory")
    .option("--use-cache", "Reuse the persistent triple cache for the SHACL check")
    .option("--all", "Run ALL known checks, ignoring the vault enabled-set")
    .option("--output <type>", "Response format: text|json", "text")
    .action(async (options: ValidateVaultOptions) => {
      const fmt = (options.output ?? "text") as OutputFormat;
      ErrorHandler.setFormat(fmt);
      try {
        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath) || !statSync(vaultPath).isDirectory()) {
          throw new VaultNotFoundError(vaultPath);
        }

        const reader = new CliFsCheckReader(vaultPath, Boolean(options.useCache));
        const ctx = await reader.read(); // ONE warm pass
        const enabled = options.all
          ? [...KNOWN_CHECK_IDS]
          : readEnabledCheckIds(ctx.assets);

        const report = await new VaultCheckRunner(
          createDefaultCheckRegistry(),
        ).runWithContext(ctx, enabled);

        if (fmt === "json") {
          console.log(JSON.stringify({ vaultPath, ...report }, null, 2));
        } else {
          if (enabled.length === 0) {
            console.log(
              `OK ${vaultPath}: no validation checks enabled (scaffold validation-settings to enable some, or pass --all)`,
            );
          }
          for (const r of report.results) {
            const head = `${r.status === "pass" ? "OK" : r.status === "fail" ? "FAIL" : "ERROR"} ${r.label}`;
            if (r.status === "pass") console.log(`${head} (${ctx.assets.length} assets)`);
            else if (r.status === "error") console.error(`${head}: ${r.errorMessage}`);
            else {
              console.error(`${head}: ${r.findings.length} violation(s)`);
              for (const f of r.findings.slice(0, 50)) {
                console.error(`  ${f.path ? f.path + " — " : ""}${f.message}`);
              }
              if (r.findings.length > 50)
                console.error(`  …and ${r.findings.length - 50} more`);
            }
          }
          console.error(
            report.ok
              ? `\n✅ ${vaultPath}: all ${enabled.length} enabled check(s) passed`
              : `\n❌ ${vaultPath}: validation failed`,
          );
        }

        if (!report.ok) process.exitCode = 1;
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });
}
