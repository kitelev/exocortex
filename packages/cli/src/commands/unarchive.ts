import { Command } from "commander";
import { resolve } from "path";
import { existsSync } from "fs";
import { NodeFsAdapter } from "../adapters/NodeFsAdapter.js";
import { UnarchiveService } from "../services/UnarchiveService.js";
import { ErrorHandler } from "../utils/ErrorHandler.js";
import { VaultNotFoundError } from "../utils/errors/index.js";

/**
 * Options parsed from CLI flags for the unarchive command.
 */
interface UnarchiveCommandOptions {
  uuid: string;
  vault: string;
  archiveVault: string;
  dryRun?: boolean;
}

/**
 * Creates the 'unarchive' subcommand for restoring an asset from the archive vault
 * back to the active vault.
 *
 * This is the symmetric reverse of the 'archive' command:
 * - Finds asset by UUID in the archive vault
 * - Updates exo__Asset_isDefinedBy from archive ontology to active ontology
 * - Moves file to active vault inbox (03 Knowledge/inbox/)
 * - Preserves archived: true in frontmatter
 *
 * @returns Commander Command instance configured for asset unarchival
 *
 * @example
 * ```bash
 * # Restore asset from archive
 * exocortex unarchive \
 *   --uuid ca0d0001-1111-2222-3333-444455556666 \
 *   --vault /path/to/active-vault \
 *   --archive-vault /path/to/archive-vault
 *
 * # Dry run (preview without restoring)
 * exocortex unarchive --dry-run \
 *   --uuid ca0d0001-1111-2222-3333-444455556666 \
 *   --vault /path/to/active-vault \
 *   --archive-vault /path/to/archive-vault
 * ```
 */
export function unarchiveCommand(): Command {
  return new Command("unarchive")
    .description(
      "Restore asset from archive vault to active vault (reverse of archive)",
    )
    .requiredOption("--uuid <uuid>", "UUID of the asset to restore")
    .requiredOption("--vault <path>", "Path to the active vault")
    .requiredOption("--archive-vault <path>", "Path to the archive vault")
    .option("--dry-run", "Preview without writing files", false)
    .action(async (options: UnarchiveCommandOptions) => {
      try {
        // Validate vault paths
        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath)) {
          throw new VaultNotFoundError(vaultPath);
        }

        const archiveVaultPath = resolve(options.archiveVault);
        if (!existsSync(archiveVaultPath)) {
          throw new VaultNotFoundError(archiveVaultPath);
        }

        // Validate UUID format
        const uuidPattern =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidPattern.test(options.uuid)) {
          throw new Error(
            `Invalid UUID format: ${options.uuid}. Expected format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`,
          );
        }

        // Create services
        const activeFs = new NodeFsAdapter(vaultPath);
        const archiveFs = new NodeFsAdapter(archiveVaultPath);
        const unarchiveService = new UnarchiveService(activeFs, archiveFs);

        // Execute unarchive
        const result = await unarchiveService.unarchive({
          uuid: options.uuid,
          vaultPath,
          archiveVaultPath,
          dryRun: options.dryRun || false,
        });

        if (!result.success) {
          process.stdout.write(
            JSON.stringify({ error: result.error }) + "\n",
          );
          process.exit(1);
        }

        // Output result
        if (options.dryRun) {
          process.stderr.write("--- DRY RUN PREVIEW ---\n");
          process.stderr.write(`Would restore: ${result.uuid}\n`);
          process.stderr.write(`Target: ${result.movedTo}\n`);
          if (result.isDefinedBy) {
            process.stderr.write(
              `isDefinedBy: ${result.isDefinedBy}\n`,
            );
          }
          process.stderr.write("--- END PREVIEW ---\n");
        }

        process.stdout.write(JSON.stringify(result) + "\n");
        process.exit(0);
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });
}
