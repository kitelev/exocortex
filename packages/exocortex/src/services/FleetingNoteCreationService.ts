import { injectable, inject } from "tsyringe";
import { v4 as uuidv4 } from "uuid";
import { DateFormatter } from "../utilities/DateFormatter";
import { MetadataHelpers } from "../utilities/MetadataHelpers";
import type { IVaultAdapter, IFile } from "../interfaces/IVaultAdapter";
import { DI_TOKENS } from "../interfaces/tokens";

/**
 * Service responsible for creating fleeting note assets.
 *
 * Generates required frontmatter and persists the file inside the inbox folder.
 */
@injectable()
export class FleetingNoteCreationService {
  private static readonly INBOX_FOLDER = "01 Inbox";

  constructor(
    @inject(DI_TOKENS.IVaultAdapter) private vault: IVaultAdapter,
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

    const filePath = `${FleetingNoteCreationService.INBOX_FOLDER}/${fileName}`;

    const createdFile = await this.vault.create(filePath, fileContent);

    return createdFile;
  }

  private generateFrontmatter(uid: string, label: string): Record<string, any> {
    const now = new Date();
    const timestamp = DateFormatter.toLocalTimestamp(now);

    const trimmedLabel = label.trim();

    const frontmatter: Record<string, any> = {
      exo__Asset_isDefinedBy: '"[[!kitelev]]"',
      exo__Asset_uid: uid,
      exo__Asset_createdAt: timestamp,
      exo__Instance_class: ['"[[ztlk__FleetingNote]]"'],
      exo__Asset_label: trimmedLabel,
      aliases: [trimmedLabel],
    };

    return frontmatter;
  }
}
