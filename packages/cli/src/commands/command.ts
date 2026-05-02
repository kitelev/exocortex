import { Command } from "commander";
import { resolve } from "path";
import { CommandExecutor } from "../executors/CommandExecutor.js";
import { ErrorHandler, type OutputFormat } from "../utils/ErrorHandler.js";
import { InvalidArgumentsError } from "../utils/errors/index.js";
import { ResponseBuilder, type CommandResult } from "../responses/index.js";

export interface CommandOptions {
  vault: string;
  label?: string;
  prototype?: string;
  area?: string;
  parent?: string;
  date?: string;
  dryRun?: boolean;
  format?: OutputFormat;
}

/**
 * Outputs command result in the specified format
 */
function outputResult(
  format: OutputFormat,
  command: string,
  filepath: string,
  action: string,
  changes?: Record<string, unknown>,
): void {
  if (format === "json") {
    const result: CommandResult = {
      command,
      filepath,
      action,
      ...(changes && { changes }),
    };
    const response = ResponseBuilder.success(result);
    console.log(JSON.stringify(response, null, 2));
  } else {
    console.log(`✅ ${action}`);
  }
}

/**
 * Handles missing required option error
 */
function handleMissingOption(
  format: OutputFormat,
  optionName: string,
  commandName: string,
  usage: string,
): never {
  const error = new InvalidArgumentsError(
    `--${optionName} option is required for ${commandName} command`,
    usage,
    { command: commandName, missingOption: optionName },
  );
  ErrorHandler.handle(error);
}

/**
 * Creates the 'command' subcommand for executing plugin commands via CLI
 *
 * @returns Commander Command instance configured for command execution
 *
 * @example
 * exocortex command rename-to-uid "03 Knowledge/tasks/task.md"
 * exocortex command start "path/to/task.md" --vault /path/to/vault
 * exocortex command start "path/to/task.md" --format json  # JSON output for MCP
 */
export function commandCommand(): Command {
  return new Command("command")
    .description("Execute plugin command on single asset")
    .argument("<command-name>", "Command to execute (rename-to-uid, start, complete, schedule, set-deadline, etc.)")
    .argument("<filepath>", "Path to asset file (relative to vault root or absolute)")
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option("--label <value>", "Asset label (required for update-label and creation commands)")
    .option("--prototype <uid>", "Prototype UID for inheritance (creation commands)")
    .option("--area <uid>", "Area UID for effort linkage (creation commands)")
    .option("--parent <uid>", "Parent UID for effort linkage (creation commands)")
    .option("--date <value>", "Date in YYYY-MM-DD format (required for schedule and set-deadline commands)")
    .option("--dry-run", "Preview changes without modifying files")
    .option("--format <type>", "Output format: text|json (default: text)", "text")
    .action(async (commandName: string, filepath: string, options: CommandOptions) => {
      const format = (options.format || "text") as OutputFormat;
      ErrorHandler.setFormat(format);

      // SUNSET-T7.3: legacy `command start <path>` is deprecated as of v15.55.x
      // (RFC 94e520da § Phase 7). Remove this `if` block AND the `case "start"`
      // branch below in v15.57.0 or later (≥2 minor releases after 15.55.5).
      // See packages/cli/docs/SUNSET_LEGACY_COMMAND_START.md for the full removal
      // checklist; canonical replacement is `dyncommand exec <uid>`.
      if (commandName === "start") {
        console.error(
          '⚠️  DEPRECATED: `command start <path>` is deprecated. ' +
            'Use `dyncommand exec <uid>` instead. ' +
            '`command start <path>` will be removed in 2 minor releases (T7.3).',
        );
      }

      try {
        const vaultPath = resolve(options.vault);
        const executor = new CommandExecutor(vaultPath, options.dryRun);

        switch (commandName) {
          // Maintenance commands
          case "rename-to-uid":
            await executor.executeRenameToUid(filepath);
            outputResult(format, commandName, filepath, `Renamed file to UID-based name`);
            break;

          case "update-label":
            if (!options.label) {
              handleMissingOption(
                format,
                "label",
                "update-label",
                'exocortex command update-label <filepath> --label "<value>"',
              );
            }
            await executor.executeUpdateLabel(filepath, options.label);
            outputResult(format, commandName, filepath, `Updated label to "${options.label}"`, {
              label: options.label,
            });
            break;

          // Status transition commands
          // SUNSET-T7.3: remove this `case "start"` branch in v15.57.0+
          // (RFC 94e520da § Phase 7). After removal, "start" falls through to
          // the `default` branch and surfaces an "unknown command" error,
          // pushing callers onto `dyncommand exec <uid>`.
          case "start":
            await executor.executeStart(filepath);
            outputResult(format, commandName, filepath, "Started task");
            break;

          case "complete":
            await executor.executeComplete(filepath);
            outputResult(format, commandName, filepath, "Completed task");
            break;

          case "trash":
            await executor.executeTrash(filepath);
            outputResult(format, commandName, filepath, "Moved task to trash");
            break;

          case "archive":
            await executor.executeArchive(filepath);
            outputResult(format, commandName, filepath, "Archived task");
            break;

          case "move-to-backlog":
            await executor.executeMoveToBacklog(filepath);
            outputResult(format, commandName, filepath, "Moved task to backlog");
            break;

          case "move-to-analysis":
            await executor.executeMoveToAnalysis(filepath);
            outputResult(format, commandName, filepath, "Moved task to analysis");
            break;

          case "move-to-todo":
            await executor.executeMoveToToDo(filepath);
            outputResult(format, commandName, filepath, "Moved task to todo");
            break;

          // Creation commands
          case "create-task":
            if (!options.label) {
              handleMissingOption(
                format,
                "label",
                "create-task",
                'exocortex command create-task <filepath> --label "<value>"',
              );
            }
            await executor.executeCreateTask(filepath, options.label, {
              prototype: options.prototype,
              area: options.area,
              parent: options.parent,
            });
            outputResult(format, commandName, filepath, `Created task "${options.label}"`, {
              label: options.label,
              prototype: options.prototype,
              area: options.area,
              parent: options.parent,
            });
            break;

          case "create-meeting":
            if (!options.label) {
              handleMissingOption(
                format,
                "label",
                "create-meeting",
                'exocortex command create-meeting <filepath> --label "<value>"',
              );
            }
            await executor.executeCreateMeeting(filepath, options.label, {
              prototype: options.prototype,
              area: options.area,
              parent: options.parent,
            });
            outputResult(format, commandName, filepath, `Created meeting "${options.label}"`, {
              label: options.label,
              prototype: options.prototype,
              area: options.area,
              parent: options.parent,
            });
            break;

          case "create-project":
            if (!options.label) {
              handleMissingOption(
                format,
                "label",
                "create-project",
                'exocortex command create-project <filepath> --label "<value>"',
              );
            }
            await executor.executeCreateProject(filepath, options.label, {
              prototype: options.prototype,
              area: options.area,
              parent: options.parent,
            });
            outputResult(format, commandName, filepath, `Created project "${options.label}"`, {
              label: options.label,
              prototype: options.prototype,
              area: options.area,
              parent: options.parent,
            });
            break;

          case "create-area":
            if (!options.label) {
              handleMissingOption(
                format,
                "label",
                "create-area",
                'exocortex command create-area <filepath> --label "<value>"',
              );
            }
            await executor.executeCreateArea(filepath, options.label, {
              prototype: options.prototype,
              area: options.area,
              parent: options.parent,
            });
            outputResult(format, commandName, filepath, `Created area "${options.label}"`, {
              label: options.label,
              prototype: options.prototype,
              area: options.area,
              parent: options.parent,
            });
            break;

          // Planning commands
          case "schedule":
            if (!options.date) {
              handleMissingOption(
                format,
                "date",
                "schedule",
                'exocortex command schedule <filepath> --date "YYYY-MM-DD"',
              );
            }
            await executor.executeSchedule(filepath, options.date);
            outputResult(format, commandName, filepath, `Scheduled task for ${options.date}`, {
              date: options.date,
            });
            break;

          case "set-deadline":
            if (!options.date) {
              handleMissingOption(
                format,
                "date",
                "set-deadline",
                'exocortex command set-deadline <filepath> --date "YYYY-MM-DD"',
              );
            }
            await executor.executeSetDeadline(filepath, options.date);
            outputResult(format, commandName, filepath, `Set deadline to ${options.date}`, {
              date: options.date,
            });
            break;

          // Folder repair command
          case "repair-folder": {
            const result = await executor.executeRepairFolder(filepath);
            outputResult(format, commandName, filepath, result.moved
              ? `Moved to correct folder: ${result.newPath}`
              : `Already in correct folder`, {
              moved: result.moved,
              oldPath: result.oldPath,
              newPath: result.newPath,
              expectedFolder: result.expectedFolder,
            });
            break;
          }

          default:
            // For other commands, use the old generic execute method
            await executor.execute(commandName, filepath, options);
            outputResult(format, commandName, filepath, `Executed ${commandName}`);
            break;
        }
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });
}
