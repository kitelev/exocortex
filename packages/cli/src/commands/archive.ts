import { Command } from "commander";
import { resolve } from "path";
import { existsSync } from "fs";
import { NodeFsAdapter } from "../adapters/NodeFsAdapter.js";
import { ClassResolverService } from "../services/ClassResolverService.js";
import { ArchiveService } from "../services/ArchiveService.js";
import { ArchiveVerifyService } from "../services/ArchiveVerifyService.js";
import { ArchiveCascadeService } from "../services/ArchiveCascadeService.js";
import { ErrorHandler } from "../utils/ErrorHandler.js";
import { VaultNotFoundError } from "../utils/errors/index.js";

/**
 * Options parsed from CLI flags for the archive command.
 */
interface ArchiveCommandOptions {
  vault: string;
  archiveVault: string;
  class?: string;
  year?: string;
  dryRun?: boolean;
  noReferenced?: boolean;
  json?: boolean;
  verify?: boolean;
  cascade?: boolean;
}

/**
 * Creates the 'archive' subcommand for automated asset archival.
 *
 * Transfers archived assets from the active vault to a separate archive vault,
 * ensuring zero broken links by checking references before moving.
 *
 * When `--verify` is passed, runs integrity verification instead of archival:
 * checks for broken cross-vault links, missing ontologies, and vault statistics.
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
 *
 * # Verify archive integrity
 * exocortex archive --verify \
 *   --vault /path/to/active-vault \
 *   --archive-vault /path/to/archive-vault
 *
 * # Cascade archive: iteratively resolve archived-to-archived chains
 * exocortex archive --cascade \
 *   --vault /path/to/active-vault \
 *   --archive-vault /path/to/archive-vault
 *
 * # Cascade dry run
 * exocortex archive --cascade --dry-run \
 *   --vault /path/to/active-vault \
 *   --archive-vault /path/to/archive-vault
 * ```
 */
export function archiveCommand(): Command {
  return new Command("archive")
    .description(
      "Archive assets from active vault to archive vault (automated asset archival)",
    )
    .requiredOption("--vault <path>", "Path to the active vault")
    .requiredOption("--archive-vault <path>", "Path to the archive vault")
    .option(
      "--class <names>",
      "Comma-separated class short names or UUIDs (e.g. ems__Task,ems__Meeting)",
    )
    .option(
      "--year <year>",
      "Filter by resolution/end timestamp year (e.g. 2025)",
    )
    .option("--dry-run", "Preview without writing files", false)
    .option(
      "--no-referenced",
      "Skip assets referenced by non-archived (default: true)",
    )
    .option("--json", "Output in JSON format (default: true)", true)
    .option(
      "--verify",
      "Verify archive integrity instead of archiving (read-only)",
      false,
    )
    .option(
      "--cascade",
      "Iteratively resolve archived-to-archived chains (no --class/--year needed)",
      false,
    )
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

        // Branch: verify mode
        if (options.verify) {
          const activeFs = new NodeFsAdapter(vaultPath);
          const archiveFs = new NodeFsAdapter(archiveVaultPath);
          const verifyService = new ArchiveVerifyService(activeFs, archiveFs);

          const result = await verifyService.verify();

          process.stdout.write(JSON.stringify(result, null, 2) + "\n");
          process.exit(result.ok ? 0 : 1);
        }

        // Branch: cascade mode
        if (options.cascade) {
          const activeFs = new NodeFsAdapter(vaultPath);
          const archiveFs = new NodeFsAdapter(archiveVaultPath);
          const cascadeService = new ArchiveCascadeService(
            activeFs,
            archiveFs,
          );

          const result = await cascadeService.cascade({
            vaultPath,
            archiveVaultPath,
            dryRun: options.dryRun || false,
          });

          if (options.dryRun) {
            process.stderr.write("--- CASCADE DRY RUN PREVIEW ---\n");
            process.stderr.write(
              `Would move: ${result.total_moved} assets\n`,
            );
            process.stderr.write(
              `Iterations: ${result.iterations}\n`,
            );
            process.stderr.write(
              `Still blocked: ${result.still_blocked} assets\n`,
            );
            process.stderr.write("--- END PREVIEW ---\n");
          }

          process.stdout.write(JSON.stringify(result, null, 2) + "\n");
          process.exit(0);
        }

        // Archive mode: validate required options
        if (!options.class) {
          throw new Error(
            "--class is required for archive operation. Use --verify for integrity check.",
          );
        }
        if (!options.year) {
          throw new Error(
            "--year is required for archive operation. Use --verify for integrity check.",
          );
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
