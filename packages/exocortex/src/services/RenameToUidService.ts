import { injectable, inject } from "tsyringe";
import type { IVaultAdapter, IFile } from "../interfaces/IVaultAdapter";
import { DI_TOKENS } from "../interfaces/tokens";

@injectable()
export class RenameToUidService {
  constructor(
    @inject(DI_TOKENS.IVaultAdapter) private vault: IVaultAdapter,
  ) {}

  async renameToUid(file: IFile, metadata: Record<string, any>): Promise<void> {
    const uid = metadata.exo__Asset_uid;

    if (!uid) {
      throw new Error("Asset has no exo__Asset_uid property");
    }

    const currentBasename = file.basename;
    const targetBasename = uid;

    if (currentBasename === targetBasename) {
      throw new Error("File is already named according to UID");
    }

    const currentLabel = metadata.exo__Asset_label;
    const needsLabelUpdate = !currentLabel || currentLabel.trim() === "";

    if (needsLabelUpdate) {
      const isArchived = this.isAssetArchived(metadata);
      await this.updateLabel(file, currentBasename, isArchived);
    }

    const folderPath = file.parent?.path || "";
    const newPath = folderPath
      ? `${folderPath}/${targetBasename}.md`
      : `${targetBasename}.md`;

    await this.vault.updateLinks(file.path, newPath, currentBasename);

    await this.vault.rename(file, newPath);
  }

  private async updateLabel(
    file: IFile,
    label: string,
    isArchived: boolean,
  ): Promise<void> {
    await this.vault.process(file, (content) => {
      const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
      const match = content.match(frontmatterRegex);

      if (!match) {
        return content;
      }

      const frontmatterContent = match[1];
      const newFrontmatter = isArchived
        ? `${frontmatterContent}\nexo__Asset_label: ${label}`
        : `${frontmatterContent}\nexo__Asset_label: ${label}\naliases:\n  - ${label}`;

      return content.replace(frontmatterRegex, `---\n${newFrontmatter}\n---`);
    });
  }

  private isAssetArchived(metadata: Record<string, any>): boolean {
    if (metadata?.exo__Asset_isArchived === true) {
      return true;
    }

    const archivedValue = metadata?.archived;

    if (archivedValue === undefined || archivedValue === null) {
      return false;
    }

    if (typeof archivedValue === "boolean") {
      return archivedValue;
    }

    if (typeof archivedValue === "number") {
      return archivedValue !== 0;
    }

    if (typeof archivedValue === "string") {
      const normalized = archivedValue.toLowerCase().trim();
      return (
        normalized === "true" || normalized === "yes" || normalized === "1"
      );
    }

    return false;
  }
}
