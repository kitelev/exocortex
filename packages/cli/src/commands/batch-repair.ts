import { Command } from "commander";
import { resolve } from "path";
import { BatchExecutor, type BatchResult, type BatchOperation } from "../executors/BatchExecutor.js";
import { NodeFsAdapter } from "../adapters/NodeFsAdapter.js";
import { ErrorHandler, type OutputFormat } from "../utils/ErrorHandler.js";
import { InvalidArgumentsError } from "../utils/errors/index.js";
import { ResponseBuilder } from "../responses/index.js";
import { ExitCodes } from "../utils/ExitCodes.js";

export interface BatchRepairOptions {
  vault: string;
  dryRun?: boolean;
  format?: OutputFormat;
  progress?: boolean;
}

/**
 * Progress callback type for batch repair operations
 */
export type ProgressCallback = (current: number, total: number, filepath: string) => void;

/**
 * Extended batch result with repair-specific information
 */
export interface BatchRepairResult extends BatchResult {
  movedCount: number;
  alreadyCorrectCount: number;
  errorCount: number;
}

/**
 * Outputs batch repair result in the specified format
 */
function outputResult(format: OutputFormat, result: BatchRepairResult): void {
  if (format === "json") {
    const response = ResponseBuilder.success(result, {
      durationMs: result.durationMs,
      itemCount: result.total,
    });
    console.log(JSON.stringify(response, null, 2));
  } else {
    // Text format output
    console.log(`\n📦 Batch Repair ${result.success ? "Complete" : "Completed with Errors"}`);
    console.log(`   Total files: ${result.total}`);
    console.log(`   📁 Moved: ${result.movedCount}`);
    console.log(`   ✅ Already correct: ${result.alreadyCorrectCount}`);
    console.log(`   ❌ Errors: ${result.errorCount}`);
    console.log(`   ⏱️  Duration: ${result.durationMs}ms`);

    if (result.errorCount > 0) {
      console.log("\n📋 Failed Files:");
      for (const op of result.results.filter((r) => !r.success)) {
        console.log(`   ❌ ${op.filepath}: ${op.error}`);
      }
    }

    if (result.movedCount > 0 && format === "text") {
      console.log("\n📋 Moved Files:");
      for (const op of result.results.filter((r) => r.success && r.changes?.moved)) {
        console.log(`   📁 ${op.filepath} → ${op.changes?.newPath}`);
      }
    }
  }
}

/**
 * Creates the 'batch-repair' subcommand for batch folder repair operations
 *
 * @returns Commander Command instance configured for batch repair
 *
 * @example
 * # Repair all markdown files in a directory
 * exocortex batch-repair "01 Inbox" --vault /path/to/vault
 *
 * # Dry run (preview changes without executing)
 * exocortex batch-repair "01 Inbox" --dry-run
 *
 * # JSON output for MCP integration
 * exocortex batch-repair "01 Inbox" --format json
 *
 * # Suppress progress output
 * exocortex batch-repair "01 Inbox" --no-progress
 */
export function batchRepairCommand(): Command {
  return new Command("batch-repair")
    .description("Batch repair folder locations for all markdown files in a directory")
    .argument("<directory>", "Directory to process (relative to vault root)")
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option("--dry-run", "Preview changes without modifying files")
    .option("--format <type>", "Output format: text|json (default: text)", "text")
    .option("--progress", "Show progress during processing (default: true)", true)
    .option("--no-progress", "Disable progress output")
    .action(async (directory: string, options: BatchRepairOptions) => {
      const format = (options.format || "text") as OutputFormat;
      ErrorHandler.setFormat(format);

      try {
        const vaultPath = resolve(options.vault);
        const fsAdapter = new NodeFsAdapter(vaultPath);

        // Verify directory exists
        const dirPath = directory;
        const dirExists = await fsAdapter.directoryExists(dirPath);
        if (!dirExists) {
          throw new InvalidArgumentsError(
            `Directory not found: ${dirPath}`,
            "exocortex batch-repair <existing-directory>",
          );
        }

        // Get all markdown files in directory
        const allFiles = await fsAdapter.getMarkdownFiles(dirPath);

        if (allFiles.length === 0) {
          if (format === "json") {
            const response = ResponseBuilder.success({
              success: true,
              total: 0,
              movedCount: 0,
              alreadyCorrectCount: 0,
              errorCount: 0,
              results: [],
              durationMs: 0,
              atomic: false,
            });
            console.log(JSON.stringify(response, null, 2));
          } else {
            console.log(`\n📂 No markdown files found in ${dirPath}`);
          }
          process.exit(ExitCodes.SUCCESS);
        }

        // Create batch operations for all files
        const operations: BatchOperation[] = allFiles.map((filepath) => ({
          command: "repair-folder",
          filepath,
        }));

        // Progress callback
        const showProgress = options.progress !== false && format === "text";
        let processedCount = 0;

        if (showProgress) {
          console.log(`\n🔍 Processing ${allFiles.length} files in ${dirPath}...`);
        }

        // Execute batch with custom progress tracking
        const executor = new BatchExecutor(vaultPath, options.dryRun);

        // We can't directly hook into BatchExecutor's progress, so we'll use the results
        const batchResult = await executor.executeBatch(operations, false);

        // Calculate repair-specific metrics
        let movedCount = 0;
        let alreadyCorrectCount = 0;
        let errorCount = 0;

        for (const result of batchResult.results) {
          if (!result.success) {
            errorCount++;
          } else if (result.changes?.moved) {
            movedCount++;
          } else {
            alreadyCorrectCount++;
          }

          // Show progress during processing (after each result)
          if (showProgress && !options.dryRun) {
            processedCount++;
            const progress = Math.round((processedCount / allFiles.length) * 100);
            process.stdout.write(`\r   Processing ${processedCount}/${allFiles.length} (${progress}%)...`);
          }
        }

        if (showProgress) {
          process.stdout.write("\r" + " ".repeat(60) + "\r"); // Clear progress line
        }

        const result: BatchRepairResult = {
          ...batchResult,
          movedCount,
          alreadyCorrectCount,
          errorCount,
        };

        // Output result
        outputResult(format, result);

        // Exit with appropriate code
        process.exit(result.success ? ExitCodes.SUCCESS : ExitCodes.OPERATION_FAILED);
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });
}
