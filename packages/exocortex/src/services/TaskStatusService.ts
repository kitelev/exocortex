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

  async syncEffortEndTimestamp(taskFile: IFile, date?: Date): Promise<void> {
    await this.timestampService.addEndAndResolutionTimestamps(taskFile, date);
  }

  async shiftPlannedEndTimestamp(taskFile: IFile, deltaMs: number): Promise<void> {
    await this.timestampService.shiftPlannedEndTimestamp(taskFile, deltaMs);
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
