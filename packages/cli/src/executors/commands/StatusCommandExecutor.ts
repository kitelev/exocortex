import { BaseCommandExecutor, CommandContext } from "./BaseCommandExecutor.js";
import { ErrorHandler } from "../../utils/ErrorHandler.js";
import { ExitCodes } from "../../utils/ExitCodes.js";

/**
 * Executes status-related commands (start, complete, trash, etc.)
 */
export class StatusCommandExecutor extends BaseCommandExecutor {
  constructor(context: CommandContext) {
    super(context);
  }

  /**
   * Transitions task from ToDo to Doing status and records start timestamp.
   */
  async executeStart(filepath: string): Promise<void> {
    try {
      const { relativePath } = this.resolveAndValidate(filepath);
      const timestamp = this.getCurrentTimestamp();

      if (this.dryRun) {
        console.log(`[dry-run] Would start: ${filepath}`);
        console.log(`[dry-run]   ems__Effort_status: "[[ems__EffortStatusDoing]]"`);
        console.log(`[dry-run]   ems__Effort_startTimestamp: ${timestamp}`);
        console.log(`\n💡 Run without --dry-run to apply changes`);
        process.exit(ExitCodes.SUCCESS);
      }

      const content = await this.fsAdapter.readFile(relativePath);

      let updated = this.frontmatterService.updateProperty(
        content,
        "ems__Effort_status",
        '"[[ems__EffortStatusDoing]]"',
      );

      updated = this.frontmatterService.updateProperty(
        updated,
        "ems__Effort_startTimestamp",
        timestamp,
      );

      await this.fsAdapter.updateFile(relativePath, updated);

      console.log(`✅ Started: ${filepath}`);
      console.log(`   Status: Doing`);
      console.log(`   Start time: ${timestamp}`);
      process.exit(ExitCodes.SUCCESS);
    } catch (error) {
      ErrorHandler.handle(error as Error);
    }
  }

  /**
   * Transitions task from Doing to Done status and records completion timestamps.
   */
  async executeComplete(filepath: string): Promise<void> {
    try {
      const { relativePath } = this.resolveAndValidate(filepath);
      const timestamp = this.getCurrentTimestamp();

      if (this.dryRun) {
        console.log(`[dry-run] Would complete: ${filepath}`);
        console.log(`[dry-run]   ems__Effort_status: "[[ems__EffortStatusDone]]"`);
        console.log(`[dry-run]   ems__Effort_endTimestamp: ${timestamp}`);
        console.log(`[dry-run]   ems__Effort_resolutionTimestamp: ${timestamp}`);
        console.log(`\n💡 Run without --dry-run to apply changes`);
        process.exit(ExitCodes.SUCCESS);
      }

      const content = await this.fsAdapter.readFile(relativePath);

      let updated = this.frontmatterService.updateProperty(
        content,
        "ems__Effort_status",
        '"[[ems__EffortStatusDone]]"',
      );

      updated = this.frontmatterService.updateProperty(
        updated,
        "ems__Effort_endTimestamp",
        timestamp,
      );

      updated = this.frontmatterService.updateProperty(
        updated,
        "ems__Effort_resolutionTimestamp",
        timestamp,
      );

      await this.fsAdapter.updateFile(relativePath, updated);

      console.log(`✅ Completed: ${filepath}`);
      console.log(`   Status: Done`);
      console.log(`   Completion time: ${timestamp}`);
      process.exit(ExitCodes.SUCCESS);
    } catch (error) {
      ErrorHandler.handle(error as Error);
    }
  }

  /**
   * Transitions task to Trashed status from any current status.
   */
  async executeTrash(filepath: string): Promise<void> {
    try {
      const { relativePath } = this.resolveAndValidate(filepath);
      const timestamp = this.getCurrentTimestamp();

      if (this.dryRun) {
        console.log(`[dry-run] Would trash: ${filepath}`);
        console.log(`[dry-run]   ems__Effort_status: "[[ems__EffortStatusTrashed]]"`);
        console.log(`[dry-run]   ems__Effort_resolutionTimestamp: ${timestamp}`);
        console.log(`\n💡 Run without --dry-run to apply changes`);
        process.exit(ExitCodes.SUCCESS);
      }

      const content = await this.fsAdapter.readFile(relativePath);

      let updated = this.frontmatterService.updateProperty(
        content,
        "ems__Effort_status",
        '"[[ems__EffortStatusTrashed]]"',
      );

      updated = this.frontmatterService.updateProperty(
        updated,
        "ems__Effort_resolutionTimestamp",
        timestamp,
      );

      await this.fsAdapter.updateFile(relativePath, updated);

      console.log(`✅ Trashed: ${filepath}`);
      console.log(`   Status: Trashed`);
      console.log(`   Resolution time: ${timestamp}`);
      process.exit(ExitCodes.SUCCESS);
    } catch (error) {
      ErrorHandler.handle(error as Error);
    }
  }

  /**
   * Sets archived property to true and removes aliases.
   */
  async executeArchive(filepath: string): Promise<void> {
    try {
      const { relativePath } = this.resolveAndValidate(filepath);

      if (this.dryRun) {
        console.log(`[dry-run] Would archive: ${filepath}`);
        console.log(`[dry-run]   archived: true`);
        console.log(`[dry-run]   aliases: removed`);
        console.log(`\n💡 Run without --dry-run to apply changes`);
        process.exit(ExitCodes.SUCCESS);
      }

      const content = await this.fsAdapter.readFile(relativePath);

      let updated = this.frontmatterService.updateProperty(content, "archived", "true");
      updated = this.frontmatterService.removeProperty(updated, "aliases");

      await this.fsAdapter.updateFile(relativePath, updated);

      console.log(`✅ Archived: ${filepath}`);
      console.log(`   Archived: true`);
      console.log(`   Aliases removed`);
      process.exit(ExitCodes.SUCCESS);
    } catch (error) {
      ErrorHandler.handle(error as Error);
    }
  }

  /**
   * Transitions task to Backlog status.
   */
  async executeMoveToBacklog(filepath: string): Promise<void> {
    try {
      await this.updateStatus(filepath, "ems__EffortStatusBacklog", "Backlog");
      process.exit(ExitCodes.SUCCESS);
    } catch (error) {
      ErrorHandler.handle(error as Error);
    }
  }

  /**
   * Transitions project to Analysis status.
   */
  async executeMoveToAnalysis(filepath: string): Promise<void> {
    try {
      await this.updateStatus(filepath, "ems__EffortStatusAnalysis", "Analysis");
      process.exit(ExitCodes.SUCCESS);
    } catch (error) {
      ErrorHandler.handle(error as Error);
    }
  }

  /**
   * Transitions task/project to ToDo status.
   */
  async executeMoveToToDo(filepath: string): Promise<void> {
    try {
      await this.updateStatus(filepath, "ems__EffortStatusToDo", "ToDo");
      process.exit(ExitCodes.SUCCESS);
    } catch (error) {
      ErrorHandler.handle(error as Error);
    }
  }

  /**
   * Helper method to update status
   */
  private async updateStatus(
    filepath: string,
    statusValue: string,
    displayName: string,
  ): Promise<void> {
    const { relativePath } = this.resolveAndValidate(filepath);

    if (this.dryRun) {
      console.log(`[dry-run] Would move to ${displayName}: ${filepath}`);
      console.log(`[dry-run]   ems__Effort_status: "[[${statusValue}]]"`);
      console.log(`\n💡 Run without --dry-run to apply changes`);
      return;
    }

    const content = await this.fsAdapter.readFile(relativePath);

    const updated = this.frontmatterService.updateProperty(
      content,
      "ems__Effort_status",
      `"[[${statusValue}]]"`,
    );

    await this.fsAdapter.updateFile(relativePath, updated);

    console.log(`✅ Moved to ${displayName}: ${filepath}`);
    console.log(`   Status: ${displayName}`);
  }
}
