import { injectable, inject } from "tsyringe";
import type { IVaultAdapter, IFile } from "../interfaces/IVaultAdapter";
import { DI_TOKENS } from "../interfaces/tokens";

@injectable()
export class RenameToUidService {
  constructor(
    @inject(DI_TOKENS.IVaultAdapter) private vault: IVaultAdapter,
  ) {}

  async renameToUid(file: IFile, metadata: Record<string, unknown>): Promise<void> {
    const uid = metadata.exo__Asset_uid;

    if (!uid) {
      throw new Error("Asset has no exo__Asset_uid property");
    }

    const currentBasename = file.basename;
    const targetBasename = uid;

    if (currentBasename === targetBasename) {
      throw new Error("File is already named according to UID");
    }

    const currentLabel = metadata.exo__Asset_label as string | undefined;
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

      let frontmatterContent = match[1];

      // Add label
      frontmatterContent = `${frontmatterContent}\nexo__Asset_label: ${label}`;

      // Add aliases if not archived
      if (!isArchived) {
        frontmatterContent = this.updateAliases(frontmatterContent, label);
      }

      return content.replace(frontmatterRegex, `---\n${frontmatterContent}\n---`);
    });
  }

  /**
   * Updates the aliases property in frontmatter content.
   * - If aliases doesn't exist: creates new aliases with the label
   * - If aliases is empty ([], null, ~, or no value): replaces with new aliases
   * - If aliases has existing values: appends the label if not already present
   */
  private updateAliases(frontmatterContent: string, label: string): string {
    // Check if aliases property exists
    const aliasesExistPattern = /^aliases\s*:/m;
    if (!aliasesExistPattern.test(frontmatterContent)) {
      // No aliases property - add new one
      return `${frontmatterContent}\naliases:\n  - ${label}`;
    }

    // Check for existing non-empty aliases in list format (  - value)
    const aliasesWithValuesPattern =
      /^aliases\s*:\s*\n((?:[ \t]*-[ \t]+[^\n]+\n?)+)/m;
    const aliasesWithValuesMatch = frontmatterContent.match(
      aliasesWithValuesPattern,
    );

    if (aliasesWithValuesMatch) {
      // Has existing aliases in list format - extract them and append new one
      const existingAliasesBlock = aliasesWithValuesMatch[1];
      const existingAliases = existingAliasesBlock
        .split("\n")
        .filter((line) => line.trim().startsWith("-"))
        .map((line) => line.replace(/^[ \t]*-[ \t]+/, "").trim());

      // Check if label already exists in aliases (avoid duplicates)
      if (existingAliases.includes(label)) {
        // Already exists - no change needed
        return frontmatterContent;
      }

      // Append new alias to existing block
      const newAliasesBlock = `${existingAliasesBlock.trimEnd()}\n  - ${label}\n`;
      return frontmatterContent.replace(aliasesWithValuesMatch[1], newAliasesBlock);
    }

    // Check for inline array format aliases: [value1, value2]
    const inlineAliasesPattern = /^aliases\s*:\s*\[([^\]]*)\]/m;
    const inlineMatch = frontmatterContent.match(inlineAliasesPattern);

    if (inlineMatch) {
      const inlineContent = inlineMatch[1].trim();
      if (inlineContent === "") {
        // Empty inline array - replace with list format
        return frontmatterContent.replace(
          inlineAliasesPattern,
          `aliases:\n  - ${label}`,
        );
      }

      // Non-empty inline array - parse and check for duplicates
      const existingAliases = inlineContent
        .split(",")
        .map((a) => a.trim().replace(/^["']|["']$/g, ""));

      if (existingAliases.includes(label)) {
        return frontmatterContent;
      }

      // Append new alias to inline array
      return frontmatterContent.replace(
        inlineAliasesPattern,
        `aliases: [${inlineContent}, ${label}]`,
      );
    }

    // Empty aliases property (aliases:, aliases: null, aliases: ~) - replace it
    const emptyAliasesPattern = /^aliases\s*:\s*(?:null|~)?\s*$/m;
    return frontmatterContent.replace(
      emptyAliasesPattern,
      `aliases:\n  - ${label}`,
    );
  }

  private isAssetArchived(metadata: Record<string, unknown>): boolean {
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
