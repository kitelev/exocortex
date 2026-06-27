import { Command } from "commander";
import { existsSync, statSync } from "fs";
import { resolve } from "path";
import {
  VaultCheckRunner,
  createDefaultCheckRegistry,
  KNOWN_CHECK_IDS,
  readEnabledCheckIds,
  type CheckContext,
  type IVaultCheckReader,
  type VaultAssetRecord,
} from "@kitelev/exocortex-core";
import { CachingNodeFsAdapter } from "../adapters/CachingNodeFsAdapter.js";
import { ErrorHandler, type OutputFormat } from "../utils/ErrorHandler.js";
import { VaultNotFoundError } from "../utils/errors/index.js";

/**
 * CLI vault-check reader (RFC f402002b, M1.5): a single fs-walk yields the warm
 * asset array, which powers the portable uid-uniqueness + co-location checks.
 *
 * The SHACL and DAG runners are intentionally absent here: SHACL needs the
 * triple-build (`exocortex validate schema`) and DAG the imports graph
 * (`exocortex audit ontology-imports`) — both remain the CLI source-of-truth as
 * standalone commands; wiring them into `validate vault`'s runShacl/runDag
 * thunks is the M2 unification. Enabling either check here therefore fails LOUD
 * (never a silent skip). The scaffold default (uid-uniqueness only) runs clean.
 */
class CliFsCheckReader implements IVaultCheckReader {
  constructor(private readonly vaultPath: string) {}

  async read(): Promise<CheckContext> {
    const adapter = new CachingNodeFsAdapter(this.vaultPath);
    const indexed = await adapter.indexedAssets();
    const assets: VaultAssetRecord[] = indexed.map((a) => ({
      path: a.path,
      frontmatter: a.metadata,
    }));
    return { assets };
  }
}

export interface ValidateVaultOptions {
  vault: string;
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

        const reader = new CliFsCheckReader(vaultPath);
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
