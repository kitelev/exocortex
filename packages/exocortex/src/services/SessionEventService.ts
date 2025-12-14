import { injectable, inject } from "tsyringe";
import { v4 as uuidv4 } from "uuid";
import type { IVaultAdapter, IFile } from "../interfaces/IVaultAdapter";
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
  private defaultOntologyAsset: string | null = null;

  constructor(
    @inject(DI_TOKENS.IVaultAdapter) private vault: IVaultAdapter,
  ) {}

  setDefaultOntologyAsset(asset: string | null): void {
    this.defaultOntologyAsset = asset;
    this.folderPathCache = null;
  }

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
   * Find the folder path where the ontology asset is located
   * @returns Folder path for ontology asset or vault's default new file location as fallback
   */
  private async getOntologyAssetFolder(): Promise<string> {
    // Return cached value if available
    if (this.folderPathCache !== null) {
      return this.folderPathCache;
    }

    if (!this.defaultOntologyAsset) {
      const defaultFolder = this.vault.getDefaultNewFileParent();
      this.folderPathCache = defaultFolder?.path || "";
      return this.folderPathCache;
    }

    const allFiles = this.vault.getAllFiles();

    for (const file of allFiles) {
      // Match by basename without extension
      if (file.basename === this.defaultOntologyAsset) {
        const folderPath = file.parent?.path || "";
        this.folderPathCache = folderPath;
        return this.folderPathCache;
      }
    }

    // Fallback to vault's default new file location if ontology asset not found
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

    const ontologyRef = this.defaultOntologyAsset
      ? `"[[${this.defaultOntologyAsset}]]"`
      : '"[[!kitelev]]"';

    const frontmatter = {
      exo__Asset_uid: uid,
      exo__Asset_createdAt: timestamp,
      exo__Asset_isDefinedBy: ontologyRef,
      exo__Instance_class: [`"[[${eventType}]]"`],
      ems__SessionEvent_timestamp: timestamp,
      ems__Session_area: `"[[${areaName}]]"`,
    };

    const fileContent = MetadataHelpers.buildFileContent(frontmatter);
    const folderPath = await this.getOntologyAssetFolder();

    // Ensure folder exists before creating file
    if (folderPath && !(await this.vault.exists(folderPath))) {
      await this.vault.createFolder(folderPath);
    }

    const filePath = folderPath ? `${folderPath}/${uid}.md` : `${uid}.md`;

    return await this.vault.create(filePath, fileContent);
  }
}
