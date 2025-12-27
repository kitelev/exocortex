import { Command } from "commander";
import { resolve } from "path";
import { existsSync } from "fs";
import { container } from "tsyringe";
import { DI_TOKENS, DailyReviewService, type Practice, type DailyReviewSummary } from "exocortex";
import { FileSystemVaultAdapter } from "../adapters/FileSystemVaultAdapter.js";
import { ErrorHandler, type OutputFormat } from "../utils/ErrorHandler.js";
import { VaultNotFoundError, InvalidArgumentsError } from "../utils/errors/index.js";
import { ResponseBuilder } from "../responses/index.js";
import { CLIContainer } from "../infrastructure/di/CLIContainer.js";

export interface DailyReviewOptions {
  vault: string;
  format?: OutputFormat;
  date?: string;
  start?: boolean;
}

/**
 * Setup DI container with FileSystemVaultAdapter
 */
function setupContainer(vaultPath: string): void {
  CLIContainer.setup();
  container.register(DI_TOKENS.IVaultAdapter, {
    useFactory: () => new FileSystemVaultAdapter(vaultPath),
  });
}

/**
 * Format practices for text output
 */
function formatPractices(practices: Practice[]): string {
  if (practices.length === 0) {
    return "No practices found.";
  }

  const lines: string[] = [];
  for (const practice of practices) {
    let status = "⬜";
    if (practice.doneToday) {
      status = "✅";
    } else if (practice.inProgressToday) {
      status = "🔄";
    }

    const duration = practice.estimatedDuration
      ? ` (${practice.estimatedDuration}m)`
      : "";

    lines.push(`${status} ${practice.label}${duration}`);
  }

  return lines.join("\n");
}

/**
 * Format summary for text output
 */
function formatSummary(summary: DailyReviewSummary): string {
  const lines: string[] = [
    `📅 Daily Review: ${summary.date}`,
    "",
    `📊 Tasks:`,
    `   Planned: ${summary.plannedCount}`,
    `   Completed: ${summary.completedCount}`,
    `   In Progress: ${summary.inProgressCount}`,
    `   Progress: ${summary.completionPercentage}%`,
    "",
    `⏱️ Total time: ${Math.round(summary.totalTimeMinutes)} minutes`,
  ];

  if (summary.practicesDue.length > 0) {
    lines.push("");
    lines.push(`📋 Practices due (${summary.practicesDue.length}):`);
    for (const practice of summary.practicesDue) {
      const duration = practice.estimatedDuration
        ? ` (${practice.estimatedDuration}m)`
        : "";
      lines.push(`   ⬜ ${practice.label}${duration}`);
    }
  }

  return lines.join("\n");
}

/**
 * Creates the 'daily' command for daily review operations
 *
 * @example
 * exocortex daily practices --vault /path/to/vault
 * exocortex daily summary
 * exocortex daily log "Morning workout" --start
 * exocortex daily start <practice-uid>
 * exocortex daily done <practice-uid>
 */
export function dailyReviewCommand(): Command {
  const daily = new Command("daily")
    .description("Daily review operations for mobile-friendly workflow");

  // Subcommand: practices
  daily
    .command("practices")
    .description("List today's practices (recurring tasks)")
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option("--format <type>", "Output format: text|json", "text")
    .action(async (options: DailyReviewOptions) => {
      const format = (options.format || "text") as OutputFormat;
      ErrorHandler.setFormat(format);

      try {
        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath)) {
          throw new VaultNotFoundError(vaultPath);
        }

        setupContainer(vaultPath);
        const service = container.resolve(DailyReviewService);
        const practices = await service.getPractices();

        if (format === "json") {
          const response = ResponseBuilder.success({ practices, count: practices.length });
          console.log(JSON.stringify(response, null, 2));
        } else {
          console.log(formatPractices(practices));
        }
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });

  // Subcommand: summary
  daily
    .command("summary")
    .description("Show today's daily review summary")
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option("--format <type>", "Output format: text|json", "text")
    .option("--date <value>", "Date in YYYY-MM-DD format (default: today)")
    .action(async (options: DailyReviewOptions) => {
      const format = (options.format || "text") as OutputFormat;
      ErrorHandler.setFormat(format);

      try {
        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath)) {
          throw new VaultNotFoundError(vaultPath);
        }

        setupContainer(vaultPath);
        const service = container.resolve(DailyReviewService);

        let date: Date | undefined;
        if (options.date) {
          date = new Date(options.date);
          if (isNaN(date.getTime())) {
            throw new InvalidArgumentsError(
              `Invalid date format: ${options.date}`,
              "exocortex daily summary --date YYYY-MM-DD",
              { date: options.date },
            );
          }
        }

        const summary = await service.getDailyReviewSummary(date);

        if (format === "json") {
          const response = ResponseBuilder.success(summary);
          console.log(JSON.stringify(response, null, 2));
        } else {
          console.log(formatSummary(summary));
        }
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });

  // Subcommand: log
  daily
    .command("log")
    .description("Quick capture an activity")
    .argument("<label>", "Activity label/description")
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option("--format <type>", "Output format: text|json", "text")
    .option("--start", "Start the task immediately (default: true)")
    .option("--no-start", "Don't start the task immediately")
    .action(async (label: string, options: DailyReviewOptions) => {
      const format = (options.format || "text") as OutputFormat;
      ErrorHandler.setFormat(format);

      try {
        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath)) {
          throw new VaultNotFoundError(vaultPath);
        }

        setupContainer(vaultPath);
        const service = container.resolve(DailyReviewService);

        const startImmediately = options.start !== false;
        const result = await service.quickCapture(label, startImmediately);

        if (format === "json") {
          const response = ResponseBuilder.success(result);
          console.log(JSON.stringify(response, null, 2));
        } else {
          const statusIcon = result.started ? "🔄" : "⬜";
          console.log(`${statusIcon} Created: ${result.label}`);
          console.log(`   Path: ${result.path}`);
        }
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });

  // Subcommand: start
  daily
    .command("start")
    .description("Start a practice (create task instance from prototype)")
    .argument("<prototype-uid>", "Practice/prototype UID to start")
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option("--format <type>", "Output format: text|json", "text")
    .action(async (prototypeUid: string, options: DailyReviewOptions) => {
      const format = (options.format || "text") as OutputFormat;
      ErrorHandler.setFormat(format);

      try {
        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath)) {
          throw new VaultNotFoundError(vaultPath);
        }

        setupContainer(vaultPath);
        const service = container.resolve(DailyReviewService);

        const result = await service.createFromPractice({
          prototypeUid,
          startImmediately: true,
        });

        if (format === "json") {
          const response = ResponseBuilder.success(result);
          console.log(JSON.stringify(response, null, 2));
        } else {
          console.log(`🔄 Started: ${result.label}`);
          console.log(`   Path: ${result.path}`);
        }
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });

  // Subcommand: done
  daily
    .command("done")
    .description("Mark a practice as done")
    .argument("<prototype-uid>", "Practice/prototype UID to mark as done")
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option("--format <type>", "Output format: text|json", "text")
    .action(async (prototypeUid: string, options: DailyReviewOptions) => {
      const format = (options.format || "text") as OutputFormat;
      ErrorHandler.setFormat(format);

      try {
        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath)) {
          throw new VaultNotFoundError(vaultPath);
        }

        setupContainer(vaultPath);
        const service = container.resolve(DailyReviewService);

        await service.markPracticeDone(prototypeUid);

        if (format === "json") {
          const response = ResponseBuilder.success({
            prototypeUid,
            status: "done"
          });
          console.log(JSON.stringify(response, null, 2));
        } else {
          console.log(`✅ Marked as done: ${prototypeUid}`);
        }
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });

  return daily;
}
