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
    _workflow: EffortStatusWorkflow,
    private timestampService: StatusTimestampService,
  ) {
    this.frontmatterService = new FrontmatterService();
    void _workflow;
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

}
