import { Command } from "commander";
import { resolve } from "path";
import { existsSync } from "fs";
import { NodeFsAdapter } from "../adapters/NodeFsAdapter.js";
import { ClassResolverService } from "../services/ClassResolverService.js";
import { ArchiveService } from "../services/ArchiveService.js";
import { ErrorHandler } from "../utils/ErrorHandler.js";
import { VaultNotFoundError } from "../utils/errors/index.js";

/**
 * Options parsed from CLI flags for the archive command.
 */
interface ArchiveCommandOptions {
  vault: string;
  archiveVault: string;
  class: string;
  year: string;
  dryRun?: boolean;
  noReferenced?: boolean;
  json?: boolean;
}

/**
 * Creates the 'archive' subcommand for automated asset archival.
 *
 * Transfers archived assets from the active vault to a separate archive vault,
 * ensuring zero broken links by checking references before moving.
 *
 * @returns Commander Command instance configured for asset archival
 *
 * @example
 * ```bash
 * # Archive all ems__Task and ems__Meeting from 2025
 * exocortex archive \
 *   --vault /path/to/active-vault \
 *   --archive-vault /path/to/archive-vault \
 *   --class ems__Task,ems__Meeting \
 *   --year 2025
 *
 * # Dry run (preview without writing)
 * exocortex archive --dry-run \
 *   --vault /path/to/active-vault \
 *   --archive-vault /path/to/archive-vault \
 *   --class ems__Task --year 2025
 * ```
 */
export function archiveCommand(): Command {
  return new Command("archive")
    .description(
      "Archive assets from active vault to archive vault (automated asset archival)",
    )
    .requiredOption("--vault <path>", "Path to the active vault")
    .requiredOption("--archive-vault <path>", "Path to the archive vault")
    .requiredOption(
      "--class <names>",
      "Comma-separated class short names or UUIDs (e.g. ems__Task,ems__Meeting)",
    )
    .requiredOption(
      "--year <year>",
      "Filter by resolution/end timestamp year (e.g. 2025)",
    )
    .option("--dry-run", "Preview without writing files", false)
    .option(
      "--no-referenced",
      "Skip assets referenced by non-archived (default: true)",
    )
    .option("--json", "Output in JSON format (default: true)", true)
    .action(async (options: ArchiveCommandOptions) => {
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

        // Parse year
        const year = parseInt(options.year, 10);
        if (isNaN(year) || year < 1900 || year > 2100) {
          throw new Error(
            `Invalid year: ${options.year}. Must be a valid year (1900-2100).`,
          );
        }

        // Parse class names
        const classes = options.class
          .split(",")
          .map((c) => c.trim())
          .filter((c) => c.length > 0);
        if (classes.length === 0) {
          throw new Error("At least one class name is required.");
        }

        // The --no-referenced flag is handled by Commander.js as a negation
        // When --no-referenced is passed, options.referenced becomes false
        // Default is true (skip referenced assets)
        const noReferenced =
          options.noReferenced !== undefined ? options.noReferenced : true;

        // Create services
        const activeFs = new NodeFsAdapter(vaultPath);
        const archiveFs = new NodeFsAdapter(archiveVaultPath);
        const classResolver = new ClassResolverService(activeFs);
        const archiveService = new ArchiveService(
          activeFs,
          archiveFs,
          classResolver,
        );

        // Execute archive
        const result = await archiveService.archive({
          vaultPath,
          archiveVaultPath,
          classes,
          year,
          dryRun: options.dryRun || false,
          noReferenced,
        });

        // Output result
        const output = {
          moved: result.moved,
          blocked: result.blocked,
          skipped: result.skipped,
          ontologies_created: result.ontologies_created,
          dry_run: options.dryRun || false,
        };

        if (options.dryRun) {
          process.stderr.write("--- DRY RUN PREVIEW ---\n");
          process.stderr.write(
            `Would move: ${result.moved} assets\n`,
          );
          process.stderr.write(
            `Blocked: ${result.blocked} assets (referenced by active)\n`,
          );
          process.stderr.write(
            `Skipped: ${result.skipped} assets\n`,
          );
          process.stderr.write(
            `Would create: ${result.ontologies_created} archive ontologies\n`,
          );
          process.stderr.write("--- END PREVIEW ---\n");
        }

        process.stdout.write(JSON.stringify(output) + "\n");
        process.exit(0);
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });
}
