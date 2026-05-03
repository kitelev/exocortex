import { Command } from "commander";
import { resolve, join } from "path";
import { existsSync } from "fs";
import { homedir } from "os";
import {
  detectOrphans,
  recoverOrphan,
} from "../services/OrphanRecoveryService.js";

export interface RecoverCommandOptions {
  vault: string;
  dryRun: boolean;
  apply: boolean;
}

function defaultVault(): string {
  return (
    process.env.EXOCORTEX_VAULT ??
    join(homedir(), "vault-2025")
  );
}

export function recoverCommand(): Command {
  return new Command("recover")
    .description(
      "Detect and recover orphaned claude-child tmux sessions. " +
      "A session is orphaned when the corresponding vault task is not in Doing status. " +
      "Default mode: dry-run (no changes). Use --apply to perform recovery.",
    )
    .option("--vault <path>", "Path to Obsidian vault", defaultVault())
    .option("--dry-run", "List orphans without applying changes (default)", false)
    .option("--apply", "Apply orphan recovery: set Failed + kill tmux session", false)
    .action(async (options: RecoverCommandOptions) => {
      const vaultPath = resolve(options.vault);
      if (!existsSync(vaultPath)) {
        console.error(`[recover] vault not found: ${vaultPath}`);
        process.exitCode = 1;
        return;
      }

      const dryRun = !options.apply;

      console.log(
        `[recover] vault=${vaultPath} mode=${dryRun ? "dry-run" : "apply"}`,
      );

      const orphans = await detectOrphans(vaultPath);

      if (orphans.length === 0) {
        console.log("[recover] No orphaned claude-child sessions found.");
        return;
      }

      console.log(`[recover] Found ${orphans.length} orphan(s):`);
      for (const o of orphans) {
        const fp = o.taskFilePath ?? "(not found in vault)";
        console.log(`  session=${o.sessionName}  uuid=${o.taskUuid}  reason=${o.reason}`);
        console.log(`    file=${fp}`);
      }

      if (dryRun) {
        console.log(
          "[recover] Dry-run mode: no changes applied. Use --apply to recover.",
        );
        return;
      }

      let recovered = 0;
      let errors = 0;
      for (const o of orphans) {
        const result = await recoverOrphan(o, false);
        if (result.ok) {
          recovered++;
          console.log(`[recover] RECOVERED: ${o.sessionName}`);
        } else {
          errors++;
          console.error(`[recover] ERROR recovering ${o.sessionName}: ${result.error}`);
        }
      }

      console.log(`[recover] Done: recovered=${recovered} errors=${errors}`);
      if (errors > 0) process.exitCode = 1;
    });
}
