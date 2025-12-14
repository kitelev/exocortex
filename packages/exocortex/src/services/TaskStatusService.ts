import { injectable, inject } from "tsyringe";
import { FrontmatterService } from "../utilities/FrontmatterService";
import { DateFormatter } from "../utilities/DateFormatter";
import { EffortStatusWorkflow } from "./EffortStatusWorkflow";
import { StatusTimestampService } from "./StatusTimestampService";
import type { IVaultAdapter, IFile } from "../interfaces/IVaultAdapter";
import { DI_TOKENS } from "../interfaces/tokens";

@injectable()
export class TaskStatusService {
  private frontmatterService: FrontmatterService;

  constructor(
    @inject(DI_TOKENS.IVaultAdapter) private vault: IVaultAdapter,
    private workflow: EffortStatusWorkflow,
    private timestampService: StatusTimestampService,
  ) {
    this.frontmatterService = new FrontmatterService();
  }

  async setDraftStatus(taskFile: IFile): Promise<void> {
    await this.updateStatus(taskFile, "ems__EffortStatusDraft");
  }

  async moveToBacklog(taskFile: IFile): Promise<void> {
    await this.updateStatus(taskFile, "ems__EffortStatusBacklog");
  }

  async moveToAnalysis(projectFile: IFile): Promise<void> {
    await this.updateStatus(projectFile, "ems__EffortStatusAnalysis");
  }

  async moveToToDo(projectFile: IFile): Promise<void> {
    await this.updateStatus(projectFile, "ems__EffortStatusToDo");
  }

  async startEffort(taskFile: IFile): Promise<void> {
    const content = await this.vault.read(taskFile);
    const timestamp = DateFormatter.toLocalTimestamp(new Date());

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

    await this.vault.modify(taskFile, updated);
  }

  async markTaskAsDone(taskFile: IFile): Promise<void> {
    const content = await this.vault.read(taskFile);
    const timestamp = DateFormatter.toLocalTimestamp(new Date());

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

    await this.vault.modify(taskFile, updated);
  }

  async syncEffortEndTimestamp(taskFile: IFile, date?: Date): Promise<void> {
    await this.timestampService.addEndAndResolutionTimestamps(taskFile, date);
  }

  async shiftPlannedEndTimestamp(taskFile: IFile, deltaMs: number): Promise<void> {
    await this.timestampService.shiftPlannedEndTimestamp(taskFile, deltaMs);
  }

  async trashEffort(taskFile: IFile, reason?: string | null): Promise<void> {
    const content = await this.vault.read(taskFile);
    const timestamp = DateFormatter.toLocalTimestamp(new Date());

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

    // Append trash reason to note body if provided
    if (reason) {
      updated = this.appendTrashReason(updated, reason);
    }

    await this.vault.modify(taskFile, updated);
  }

  /**
   * Append a trash reason section to the note body.
   * Adds a `## Trash Reason` header followed by the reason text.
   *
   * @param content - Full markdown file content
   * @param reason - The reason for trashing the effort
   * @returns Updated content with trash reason appended
   */
  private appendTrashReason(content: string, reason: string): string {
    const trashReasonSection = `\n\n## Trash Reason\n\n${reason}`;
    return content.trimEnd() + trashReasonSection;
  }

  async archiveTask(taskFile: IFile): Promise<void> {
    const content = await this.vault.read(taskFile);
    let updated = this.frontmatterService.updateProperty(
      content,
      "archived",
      "true",
    );
    updated = this.frontmatterService.removeProperty(updated, "aliases");
    await this.vault.modify(taskFile, updated);
  }

  async planOnToday(taskFile: IFile): Promise<void> {
    const content = await this.vault.read(taskFile);
    const todayStartTimestamp = DateFormatter.getTodayStartTimestamp();
    const updated = this.frontmatterService.updateProperty(
      content,
      "ems__Effort_plannedStartTimestamp",
      todayStartTimestamp,
    );
    await this.vault.modify(taskFile, updated);
  }

  async planForEvening(taskFile: IFile): Promise<void> {
    const content = await this.vault.read(taskFile);
    const evening = new Date();
    evening.setHours(19, 0, 0, 0);
    const eveningTimestamp = DateFormatter.toLocalTimestamp(evening);

    const updated = this.frontmatterService.updateProperty(
      content,
      "ems__Effort_plannedStartTimestamp",
      eveningTimestamp,
    );
    await this.vault.modify(taskFile, updated);
  }

  async shiftDayBackward(taskFile: IFile): Promise<void> {
    await this.shiftDay(taskFile, -1);
  }

  async shiftDayForward(taskFile: IFile): Promise<void> {
    await this.shiftDay(taskFile, 1);
  }

  async rollbackStatus(taskFile: IFile): Promise<void> {
    const content = await this.vault.read(taskFile);
    const currentStatus = this.extractCurrentStatus(content);
    const instanceClass = this.extractInstanceClass(content);

    if (!currentStatus) {
      throw new Error("No current status to rollback from");
    }

    const previousStatus = this.workflow.getPreviousStatus(
      currentStatus,
      instanceClass,
    );

    if (previousStatus === undefined) {
      throw new Error("Cannot rollback from current status");
    }

    let updated = content;

    if (previousStatus === null) {
      updated = this.frontmatterService.removeProperty(
        updated,
        "ems__Effort_status",
      );
    } else {
      updated = this.frontmatterService.updateProperty(
        updated,
        "ems__Effort_status",
        previousStatus,
      );
    }

    const normalizedStatus = this.workflow.normalizeStatus(currentStatus);

    if (normalizedStatus === "ems__EffortStatusDone") {
      updated = this.frontmatterService.removeProperty(
        updated,
        "ems__Effort_endTimestamp",
      );
      updated = this.frontmatterService.removeProperty(
        updated,
        "ems__Effort_resolutionTimestamp",
      );
    } else if (normalizedStatus === "ems__EffortStatusDoing") {
      updated = this.frontmatterService.removeProperty(
        updated,
        "ems__Effort_startTimestamp",
      );
    }

    await this.vault.modify(taskFile, updated);
  }

  private async updateStatus(
    taskFile: IFile,
    statusValue: string,
  ): Promise<void> {
    const content = await this.vault.read(taskFile);
    const updated = this.frontmatterService.updateProperty(
      content,
      "ems__Effort_status",
      `"[[${statusValue}]]"`,
    );
    await this.vault.modify(taskFile, updated);
  }

  private async shiftDay(taskFile: IFile, days: number): Promise<void> {
    const content = await this.vault.read(taskFile);
    const currentTimestamp = this.extractPlannedStartTimestamp(content);

    if (!currentTimestamp) {
      throw new Error("ems__Effort_plannedStartTimestamp property not found");
    }

    const currentDate = this.parseDateFromTimestamp(currentTimestamp);

    if (!currentDate) {
      throw new Error("Invalid date format in ems__Effort_plannedStartTimestamp");
    }

    const newDate = DateFormatter.addDays(currentDate, days);
    // Keep time at 00:00:00 local for shifted dates
    newDate.setHours(0, 0, 0, 0);
    const newTimestamp = DateFormatter.toLocalTimestamp(newDate);

    const updated = this.frontmatterService.updateProperty(
      content,
      "ems__Effort_plannedStartTimestamp",
      newTimestamp,
    );
    await this.vault.modify(taskFile, updated);
  }

  private parseDateFromTimestamp(timestamp: string): Date | null {
    const date = new Date(timestamp);

    if (isNaN(date.getTime())) {
      return null;
    }

    return date;
  }

  private extractPlannedStartTimestamp(content: string): string | null {
    const parsed = this.frontmatterService.parse(content);
    if (!parsed.exists) return null;

    return this.frontmatterService.getPropertyValue(
      parsed.content,
      "ems__Effort_plannedStartTimestamp",
    );
  }

  private extractCurrentStatus(content: string): string | null {
    const parsed = this.frontmatterService.parse(content);
    if (!parsed.exists) return null;

    return this.frontmatterService.getPropertyValue(
      parsed.content,
      "ems__Effort_status",
    );
  }

  private extractInstanceClass(content: string): string | string[] | null {
    const parsed = this.frontmatterService.parse(content);
    if (!parsed.exists) return null;

    const arrayMatch = parsed.content.match(
      /exo__Instance_class:\s*\n((?:\s*-\s*.*\n?)+)/,
    );

    if (arrayMatch) {
      const lines = arrayMatch[1].split("\n").filter((l) => l.trim());
      return lines.map((line) => line.replace(/^\s*-\s*/, "").trim());
    }

    return this.frontmatterService.getPropertyValue(
      parsed.content,
      "exo__Instance_class",
    );
  }
}
