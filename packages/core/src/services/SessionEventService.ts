import { injectable, inject } from "tsyringe";
import { v4 as uuidv4 } from "uuid";
import type { IVaultAdapter, IFile } from "../interfaces/IVaultAdapter";
import type { IVaultSettings } from "../interfaces/IVaultSettings";
import { AssetClass } from "../domain/constants";
import { DateFormatter } from "../utilities/DateFormatter";
import { MetadataHelpers } from "../utilities/MetadataHelpers";
import { DI_TOKENS } from "../interfaces/tokens";

/**
 * Service for managing area focus session event tracking
 * Creates SessionStartEvent and SessionEndEvent assets when users activate/deactivate focus areas
 */
@injectable()
export class SessionEventService {
  private folderPathCache: string | null = null;

  constructor(
    @inject(DI_TOKENS.IVaultAdapter) private vault: IVaultAdapter,
    @inject(DI_TOKENS.IVaultSettings) private vaultSettings: IVaultSettings,
  ) {}

  /**
   * Create a session start event when user activates a focus area
   * @param areaName - Name of the area being activated
   * @returns Created event file
   */
  async createSessionStartEvent(areaName: string): Promise<IFile> {
    return this.createSessionEvent(areaName, AssetClass.SESSION_START_EVENT);
  }

  /**
   * Create a session end event when user deactivates a focus area
   * @param areaName - Name of the area being deactivated
   * @returns Created event file
   */
  async createSessionEndEvent(areaName: string): Promise<IFile> {
    return this.createSessionEvent(areaName, AssetClass.SESSION_END_EVENT);
  }

  /**
   * Get the folder path for session events
   * @returns Vault's default new file location
   */
  private getSessionEventFolder(): string {
    // Return cached value if available
    if (this.folderPathCache !== null) {
      return this.folderPathCache;
    }

    const defaultFolder = this.vault.getDefaultNewFileParent();
    this.folderPathCache = defaultFolder?.path || "";
    return this.folderPathCache;
  }

  /**
   * Private helper method to create session event assets
   * @param areaName - Name of the area
   * @param eventType - Type of session event (start or end)
   * @returns Created event file
   */
  private async createSessionEvent(
    areaName: string,
    eventType: AssetClass,
  ): Promise<IFile> {
    const uid = uuidv4();
     
    const timestamp = DateFormatter.toLocalTimestamp(new Date());

    const frontmatter = {
      exo__Asset_uid: uid,
      exo__Asset_createdAt: timestamp,
      exo__Asset_isDefinedBy: this.vaultSettings.getOwnerIdentity(),
      exo__Instance_class: [`"[[${eventType}]]"`],
      ems__SessionEvent_timestamp: timestamp,
      ems__Session_area: `"[[${areaName}]]"`,
    };

    const fileContent = MetadataHelpers.buildFileContent(frontmatter);
    const folderPath = this.getSessionEventFolder();

    // Ensure folder exists before creating file
    if (folderPath && !(await this.vault.exists(folderPath))) {
      await this.vault.createFolder(folderPath);
    }

    const filePath = folderPath ? `${folderPath}/${uid}.md` : `${uid}.md`;

    return await this.vault.create(filePath, fileContent);
  }
}
