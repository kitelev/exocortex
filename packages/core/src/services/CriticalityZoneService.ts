import { injectable, inject } from "tsyringe";
import { FrontmatterService } from "../utilities/FrontmatterService";
import type { IVaultAdapter, IFile } from "../interfaces/IVaultAdapter";
import { DI_TOKENS } from "../interfaces/tokens";

/**
 * Criticality Zone UUIDs
 *
 * These map to zone assets in the Exocortex ontology:
 * - Today: High urgency, must be done today
 * - This week: Medium urgency, should be done this week
 * - Someday: Low urgency, no specific deadline
 */
export const CriticalityZoneUUIDs = {
  TODAY: "e266a2e9-9eb0-431d-b1fe-b95b9d3e9a3f",
  THIS_WEEK: "c7f1a968-0959-4ac7-ac82-31b0cdc2aba7",
  SOMEDAY: "6968a0fc-7a41-4393-82b1-17d767c7ad7c",
} as const;

export type CriticalityZone = keyof typeof CriticalityZoneUUIDs;

/**
 * Service for managing task criticality zones.
 *
 * Allows setting ems__Task_zone property to categorize tasks by urgency:
 * - Today: Tasks that must be completed today
 * - This week: Tasks planned for the current week
 * - Someday: Tasks without urgent deadlines
 */
@injectable()
export class CriticalityZoneService {
  private frontmatterService: FrontmatterService;

  constructor(
    @inject(DI_TOKENS.IVaultAdapter) private vault: IVaultAdapter,
  ) {
    this.frontmatterService = new FrontmatterService();
  }

  /**
   * Set task zone to "Today"
   */
  async setZoneToday(taskFile: IFile): Promise<void> {
    await this.setZone(taskFile, CriticalityZoneUUIDs.TODAY);
  }

  /**
   * Set task zone to "This week"
   */
  async setZoneThisWeek(taskFile: IFile): Promise<void> {
    await this.setZone(taskFile, CriticalityZoneUUIDs.THIS_WEEK);
  }

  /**
   * Set task zone to "Someday"
   */
  async setZoneSomeday(taskFile: IFile): Promise<void> {
    await this.setZone(taskFile, CriticalityZoneUUIDs.SOMEDAY);
  }

  /**
   * Set ems__Task_zone property to the given zone UUID
   *
   * @param taskFile - The task file to update
   * @param zoneUUID - The UUID of the zone asset
   */
  private async setZone(taskFile: IFile, zoneUUID: string): Promise<void> {
    const content = await this.vault.read(taskFile);
    const updated = this.frontmatterService.updateProperty(
      content,
      "ems__Task_zone",
      `"[[${zoneUUID}]]"`,
    );
    await this.vault.modify(taskFile, updated);
  }
}
