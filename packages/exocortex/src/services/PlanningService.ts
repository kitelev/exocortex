import { injectable, inject } from "tsyringe";
import type { IVaultAdapter, IFile } from "../interfaces/IVaultAdapter";
import { FrontmatterService } from "../utilities/FrontmatterService";
import { DateFormatter } from "../utilities/DateFormatter";
import { DI_TOKENS } from "../interfaces/tokens";

@injectable()
export class PlanningService {
  private frontmatterService: FrontmatterService;

  constructor(
    @inject(DI_TOKENS.IVaultAdapter) private vault: IVaultAdapter,
  ) {
    this.frontmatterService = new FrontmatterService();
  }

  async planOnToday(taskPath: string): Promise<void> {
    const file = this.vault.getAbstractFileByPath(taskPath);

    if (!file || !this.isFile(file)) {
      throw new Error(`File not found: ${taskPath}`);
    }

    const content = await this.vault.read(file);
    const todayStartTimestamp = DateFormatter.getTodayStartTimestamp();
    const updated = this.frontmatterService.updateProperty(
      content,
      "ems__Effort_plannedStartTimestamp",
      todayStartTimestamp,
    );
    await this.vault.modify(file, updated);
  }

  private isFile(file: any): file is IFile {
    return "basename" in file;
  }
}
