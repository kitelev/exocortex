import { injectable, inject } from "tsyringe";
import { v4 as uuidv4 } from "uuid";
import { DateFormatter } from "../utilities/DateFormatter";
import { MetadataHelpers } from "../utilities/MetadataHelpers";
import type { IVaultAdapter, IFile } from "../interfaces/IVaultAdapter";
import type { IVaultSettings } from "../interfaces/IVaultSettings";
import { DI_TOKENS } from "../interfaces/tokens";

/**
 * Service responsible for creating fleeting note assets.
 *
 * Generates required frontmatter and persists the file inside the inbox folder.
 */
@injectable()
export class FleetingNoteCreationService {
  constructor(
    @inject(DI_TOKENS.IVaultAdapter) private vault: IVaultAdapter,
    @inject(DI_TOKENS.IVaultSettings) private vaultSettings: IVaultSettings,
  ) {}

  /**
   * Creates a new fleeting note asset using provided label as display name.
   *
   * @param label - Required label for the new asset
   * @returns The created file descriptor
   */
  async createFleetingNote(label: string): Promise<IFile> {
    const uid = uuidv4();
    const fileName = `${uid}.md`;
    const frontmatter = this.generateFrontmatter(uid, label);
    const fileContent = MetadataHelpers.buildFileContent(frontmatter);

    const inboxFolder = this.vaultSettings.getDefaultInboxFolder();
    const filePath = `${inboxFolder}/${fileName}`;

    await this.ensureFolderExists(inboxFolder);

    const createdFile = await this.vault.create(filePath, fileContent);

    return createdFile;
  }

  private async ensureFolderExists(folderPath: string): Promise<void> {
    const exists = await this.vault.exists(folderPath);
    if (!exists) {
      await this.vault.createFolder(folderPath);
    }
  }

  private generateFrontmatter(uid: string, label: string): Record<string, unknown> {
    const now = new Date();
     
    const timestamp = DateFormatter.toLocalTimestamp(now);

    const trimmedLabel = label.trim();

    const frontmatter: Record<string, unknown> = {
      exo__Asset_isDefinedBy: this.vaultSettings.getOwnerIdentity(),
      exo__Asset_uid: uid,
      exo__Asset_createdAt: timestamp,
      exo__Instance_class: [`"[[${this.vaultSettings.getFleetingNoteClassUID()}]]"`],
      exo__Asset_label: trimmedLabel,
      aliases: [trimmedLabel],
    };

    return frontmatter;
  }
}
