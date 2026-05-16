import path from "path";
import { BaseCommandExecutor, CommandContext } from "./BaseCommandExecutor.js";
import { ErrorHandler } from "../../utils/ErrorHandler.js";
import { ExitCodes } from "../../utils/ExitCodes.js";
import { DateFormatter } from "exocortex";

/**
 * Executes property-related commands (rename-to-uid, update-label, schedule, set-deadline)
 */
export class PropertyCommandExecutor extends BaseCommandExecutor {
  constructor(context: CommandContext) {
    super(context);
  }

  /**
   * Renames file to match its exo__Asset_uid property value.
   * If label is missing, sets it to the original filename.
   */
  async executeRenameToUid(filepath: string): Promise<void> {
    try {
      const { relativePath } = this.resolveAndValidate(filepath);
      const metadata = await this.fsAdapter.getFileMetadata(relativePath);

      if (!metadata.exo__Asset_uid) {
        throw new Error("Asset missing exo__Asset_uid property");
      }

      const currentBasename = path.basename(relativePath, ".md");
      const targetBasename = metadata.exo__Asset_uid;

      if (currentBasename === targetBasename) {
        console.log(`✅ Already renamed: ${filepath}`);
        console.log(`   Current filename matches UID: ${targetBasename}.md`);
        process.exit(ExitCodes.SUCCESS);
      }

      const labelMissing =
        !metadata.exo__Asset_label || metadata.exo__Asset_label.trim() === "";
      const isArchived = this.isAssetArchived(metadata);

      // Construct new path
      const directory = path.dirname(relativePath);
      const newPath =
        directory !== "." ? `${directory}/${targetBasename}.md` : `${targetBasename}.md`;

      // Dry-run: preview only, no fs writes (Issue #3111)
      if (this.dryRun) {
        if (labelMissing) {
          console.log(`[dry-run] Would update label: "${currentBasename}"`);
          if (!isArchived) {
            console.log(`[dry-run] Would add alias: "${currentBasename}"`);
          }
        }
        console.log(`[dry-run] Would rename: ${relativePath} -> ${newPath}`);
        console.log(`\n💡 Run without --dry-run to apply changes`);
        process.exit(ExitCodes.SUCCESS);
      }

      // If label missing, update it to preserve original filename
      if (labelMissing) {
        const content = await this.fsAdapter.readFile(relativePath);
        const updatedContent = this.frontmatterService.updateProperty(
          content,
          "exo__Asset_label",
          currentBasename,
        );

        // Also add to aliases if not archived
        let finalContent = updatedContent;
        if (!isArchived) {
          finalContent = this.frontmatterService.updateProperty(
            updatedContent,
            "aliases",
            `\n  - ${currentBasename}`,
          );
        }

        await this.fsAdapter.updateFile(relativePath, finalContent);
        console.log(`   Updated label: "${currentBasename}"`);
      }

      // Rename file
      await this.fsAdapter.renameFile(relativePath, newPath);

      console.log(`✅ Renamed to UID format`);
      console.log(`   Old: ${relativePath}`);
      console.log(`   New: ${newPath}`);
      process.exit(ExitCodes.SUCCESS);
    } catch (error) {
      ErrorHandler.handle(error as Error);
    }
  }

  /**
   * Updates exo__Asset_label property and synchronizes aliases array.
   */
  async executeUpdateLabel(filepath: string, newLabel: string): Promise<void> {
    try {
      if (!newLabel || newLabel.trim().length === 0) {
        throw new Error("Label cannot be empty");
      }

      const trimmedLabel = newLabel.trim();
      const { relativePath } = this.resolveAndValidate(filepath);
      const content = await this.fsAdapter.readFile(relativePath);

      // Update label
      let updatedContent = this.frontmatterService.updateProperty(
        content,
        "exo__Asset_label",
        trimmedLabel,
      );

      // Update aliases array
      const parsed = this.frontmatterService.parse(updatedContent);
      const currentAliases = this.extractAliasesFromFrontmatter(parsed.content);

      if (!currentAliases.includes(trimmedLabel)) {
        // If no aliases exist yet, create array
        if (currentAliases.length === 0) {
          updatedContent = this.frontmatterService.updateProperty(
            updatedContent,
            "aliases",
            `\n  - ${trimmedLabel}`,
          );
        } else {
          // Append to existing aliases
          updatedContent = this.frontmatterService.updateProperty(
            updatedContent,
            "aliases",
            `${currentAliases.map((a) => `\n  - ${a}`).join("")}\n  - ${trimmedLabel}`,
          );
        }
      }

      // Dry-run mode: preview changes without modifying
      if (this.dryRun) {
        console.log(`🔍 DRY RUN: Preview of changes (not applied)`);
        console.log(`   File: ${filepath}`);
        console.log(`   Changes:`);
        console.log(`     • exo__Asset_label: "${trimmedLabel}"`);

        if (!currentAliases.includes(trimmedLabel)) {
          const newAliases = currentAliases.length === 0
            ? [trimmedLabel]
            : [...currentAliases, trimmedLabel];
          console.log(`     • aliases: [${newAliases.map(a => `"${a}"`).join(", ")}]`);
        } else {
          console.log(`     • aliases: unchanged (label already present)`);
        }

        console.log(`\n💡 Run without --dry-run to apply changes`);
        process.exit(ExitCodes.SUCCESS);
      }

      // Write updated content
      await this.fsAdapter.updateFile(relativePath, updatedContent);

      console.log(`✅ Updated label`);
      console.log(`   File: ${filepath}`);
      console.log(`   New label: "${trimmedLabel}"`);
      console.log(`   Aliases synchronized`);
      process.exit(ExitCodes.SUCCESS);
    } catch (error) {
      ErrorHandler.handle(error as Error);
    }
  }

  /**
   * Sets planned start timestamp for an effort (task/project/meeting).
   */
  async executeSchedule(filepath: string, date: string): Promise<void> {
    try {
      await this.updatePlannedTimestamp(
        filepath,
        date,
        "ems__Effort_plannedStartTimestamp",
      );
      process.exit(ExitCodes.SUCCESS);
    } catch (error) {
      ErrorHandler.handle(error as Error);
    }
  }

  /**
   * Sets planned end timestamp for an effort (task/project/meeting).
   */
  async executeSetDeadline(filepath: string, date: string): Promise<void> {
    try {
      await this.updatePlannedTimestamp(
        filepath,
        date,
        "ems__Effort_plannedEndTimestamp",
      );
      process.exit(ExitCodes.SUCCESS);
    } catch (error) {
      ErrorHandler.handle(error as Error);
    }
  }

  /**
   * Update planned timestamp property in frontmatter
   */
  private async updatePlannedTimestamp(
    filepath: string,
    dateStr: string,
    property: string,
  ): Promise<void> {
    const { relativePath } = this.resolveAndValidate(filepath);

    const exists = await this.fsAdapter.fileExists(relativePath);
    if (!exists) {
      throw new Error(`File not found: ${filepath}`);
    }

    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      throw new Error(
        `Invalid date format: ${dateStr}. Expected YYYY-MM-DD (e.g., 2025-11-25)`,
      );
    }

    // Convert date to timestamp at start of day
    const timestamp = DateFormatter.toTimestampAtStartOfDay(dateStr);

    const actionName =
      property === "ems__Effort_plannedStartTimestamp"
        ? "Scheduled"
        : "Set deadline for";

    // Dry-run: preview only, no fs writes (Issue #3111)
    if (this.dryRun) {
      console.log(`[dry-run] Would ${actionName === "Scheduled" ? "schedule" : "set deadline for"}: ${filepath}`);
      console.log(`[dry-run]   ${property}: ${timestamp}`);
      console.log(`\n💡 Run without --dry-run to apply changes`);
      return;
    }

    // Read file content
    const content = await this.fsAdapter.readFile(relativePath);

    // Update frontmatter property
    const updatedContent = this.frontmatterService.updateProperty(
      content,
      property,
      timestamp,
    );

    // Write updated content
    await this.fsAdapter.writeFile(relativePath, updatedContent);

    console.log(`✅ ${actionName}: ${filepath}`);
    console.log(`   Date: ${dateStr}`);
    console.log(`   Timestamp: ${timestamp}`);
  }
}
