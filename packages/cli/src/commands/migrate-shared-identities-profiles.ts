import { Command } from "commander";
import { resolve } from "path";
import { existsSync } from "fs";
import { SharedIdentitiesProfileMigrationService } from "../services/SharedIdentitiesProfileMigrationService.js";
import { VaultNotFoundError, InvalidArgumentsError } from "../utils/errors/index.js";
import { ErrorHandler } from "../utils/ErrorHandler.js";

interface MigrateOptions {
  vault: string;
  apply?: boolean;
  json?: boolean;
  profilesDir: string;
}

/**
 * `exocortex migrate-shared-identities-profiles`
 *
 * Phase 6.5 migration tool per RFC 13da049f v1.3. Relocates FocusProfile
 * instances from `assetspaces/shared-identities/` к `assetspaces/profiles/`
 * + adds dual-class `exo__KnowledgeProfile` membership.
 *
 * Default: DRY-RUN. Pass `--apply` to mutate vault.
 *
 * Idempotent: re-running after successful apply is a no-op (sources renamed
 * к `.migrated-backup` suffix to mark migrated state).
 *
 * Other shared-identities content (ims__Concepts, ConceptSchemas, etc.)
 * stays untouched — separate future migration phase.
 */
export function migrateSharedIdentitiesProfilesCommand(): Command {
  return new Command("migrate-shared-identities-profiles")
    .description(
      "Phase 6.5: relocate FocusProfile instances from shared-identities/ к profiles/ + add dual-class KnowledgeProfile (RFC 13da049f). Dry-run by default; --apply to mutate.",
    )
    .requiredOption("--vault <path>", "Path to Obsidian vault root")
    .option("--apply", "Execute migration (default: dry-run)", false)
    .option("--json", "Emit plan / result as JSON", false)
    .option(
      "--profiles-dir <name>",
      "Target AssetSpace folder name under assetspaces/ (default: profiles)",
      "profiles",
    )
    .action(async (options: MigrateOptions) => {
      try {
        if (!options.vault) {
          throw new InvalidArgumentsError("--vault is required");
        }
        const profilesDir = options.profilesDir ?? "profiles";
        // Plain folder name only — allowlist defends against path traversal
        // (`/`, `\`, `..`), NUL bytes, `~`/`$HOME` expansion, and empty / `.`
        // values that would collapse the target onto assetspaces/ itself.
        if (!/^[A-Za-z0-9._-]+$/.test(profilesDir) || profilesDir === "." || profilesDir.includes("..")) {
          throw new InvalidArgumentsError(
            `--profiles-dir must be a plain folder name (got "${profilesDir}")`,
          );
        }
        const profilesDirRelative = `assetspaces/${profilesDir}`;
        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath)) {
          throw new VaultNotFoundError(vaultPath);
        }

        const svc = new SharedIdentitiesProfileMigrationService();

        if (options.apply) {
          const result = svc.apply({ vaultPath, apply: true, profilesDirRelative });
          if (options.json) {
            process.stdout.write(JSON.stringify(result, null, 2) + "\n");
          } else {
            process.stdout.write(
              `Migration applied: ${result.applied.length} relocated, ${result.errors.length} errors\n`,
            );
            for (const e of result.applied) {
              process.stdout.write(`  ✓ ${e.uid}: ${e.from} → ${e.to}\n`);
            }
            for (const err of result.errors) {
              process.stderr.write(`  ✗ ${err.uid}: ${err.reason}\n`);
            }
            process.stdout.write(
              `\nNext steps:\n` +
                `  1. cd ${result.plan.profilesDirPath} && git add . && git commit + push\n` +
                `  2. cd ${vaultPath} && git submodule deinit assetspaces/shared-identities (if all migrated)\n` +
                `  3. cd ${vaultPath} && git submodule add <exoas-profiles-url> assetspaces/profiles\n` +
                `  4. Repeat 1-3 в sibling vault if dual-vault setup\n`,
            );
          }
          process.exit(result.errors.length > 0 ? 1 : 0);
        } else {
          // Dry-run.
          const plan = svc.generatePlan({ vaultPath, profilesDirRelative });
          if (options.json) {
            process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
          } else {
            process.stdout.write(`Dry-run plan для ${vaultPath}:\n`);
            process.stdout.write(`  Source: ${plan.sharedIdentitiesPath}\n`);
            process.stdout.write(`  Target: ${plan.profilesDirPath}\n`);
            process.stdout.write(`  Summary: ${plan.summary.relocate} к relocate, ${plan.summary.alreadyMigrated} already migrated, ${plan.summary.skipped} skipped (non-FocusProfile)\n\n`);
            for (const a of plan.actions) {
              if (a.kind === "relocate-and-dual-class") {
                process.stdout.write(`  RELOCATE: ${a.uid} (${a.label}) → ${a.profilesDirPath}\n`);
              } else if (a.kind === "already-migrated") {
                process.stdout.write(`  SKIP-DONE: ${a.uid} (${a.label}) — already at ${a.profilesDirPath}\n`);
              }
            }
            process.stdout.write(`\nRun с --apply к execute.\n`);
          }
          process.exit(0);
        }
      } catch (e) {
        ErrorHandler.handle(e as Error);
      }
    });
}
