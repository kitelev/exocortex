import { injectable, inject } from "tsyringe";
import type { IVaultAdapter, IFile } from "../interfaces/IVaultAdapter";
import type { ILogger } from "../interfaces/ILogger";
import { DI_TOKENS } from "../interfaces/tokens";

/**
 * Service for cleaning empty properties from file frontmatter
 */
@injectable()
export class PropertyCleanupService {
  constructor(
    @inject(DI_TOKENS.IVaultAdapter) private vault: IVaultAdapter,
    @inject(DI_TOKENS.ILogger) private logger: ILogger
  ) {
    this.logger.debug("PropertyCleanupService initialized");
  }

  /**
   * Remove all empty properties from file frontmatter
   * Empty properties are: null, undefined, "", [], {}
   */
  async cleanEmptyProperties(file: IFile): Promise<void> {
    this.logger.debug("Cleaning empty properties", { path: file.path });
    const fileContent = await this.vault.read(file);
    const updatedContent = this.removeEmptyPropertiesFromContent(fileContent);
    await this.vault.modify(file, updatedContent);
    this.logger.info("Empty properties cleaned", { path: file.path });
  }

  /**
   * Remove empty properties from file content
   */
  private removeEmptyPropertiesFromContent(content: string): string {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      return content;
    }

    const frontmatterContent = match[1];
    const lines = frontmatterContent.split("\n");
    const cleanedLines: string[] = [];

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip empty lines
      if (trimmed === "") {
        cleanedLines.push(line);
        i++;
        continue;
      }

      // Check if this is a property line (key: value)
      const propertyMatch = trimmed.match(/^([^:]+):\s*(.*)$/);
      if (propertyMatch) {
        const value = propertyMatch[2];

        // Check if this is a list property (value is empty and next lines are indented)
        if (value === "" && i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          if (nextLine.match(/^\s+- /)) {
            // This is a list property, collect all list items
            const listItems: string[] = [];
            let j = i + 1;
            while (j < lines.length && lines[j].match(/^\s+- /)) {
              listItems.push(lines[j]);
              j++;
            }

            // Check if all list items are empty
            const allEmpty = listItems.every((item) => {
              const itemValue = item.replace(/^\s+- /, "").trim();
              return this.isEmptyValue(itemValue);
            });

            if (allEmpty) {
              // Skip the property key and all list items
              i = j;
              continue;
            } else {
              // Keep the property and its list items
              cleanedLines.push(line);
              for (let k = i + 1; k < j; k++) {
                cleanedLines.push(lines[k]);
              }
              i = j;
              continue;
            }
          }
        }

        // Check if value is empty (but not a list)
        if (this.isEmptyValue(value)) {
          // Skip this line (remove empty property)
          i++;
          continue;
        }

        // Keep non-empty property
        cleanedLines.push(line);
        i++;
      } else if (trimmed.match(/^\s*- /)) {
        // This is a list item without a property key (orphaned)
        // This shouldn't happen in valid YAML, but skip it
        i++;
      } else {
        // Not a property line (might be continuation), keep it
        cleanedLines.push(line);
        i++;
      }
    }

    const cleanedFrontmatter = cleanedLines.join("\n");
    return content.replace(frontmatterRegex, `---\n${cleanedFrontmatter}\n---`);
  }

  /**
   * Check if a value string represents an empty value
   */
  private isEmptyValue(value: string): boolean {
    const trimmed = value.trim();

    // Empty string
    if (trimmed === "") return true;

    // null or undefined
    if (trimmed === "null" || trimmed === "undefined") return true;

    // Empty array []
    if (trimmed === "[]") return true;

    // Empty object {}
    if (trimmed === "{}") return true;

    // Quoted empty string
    if (trimmed === '""' || trimmed === "''") return true;

    return false;
  }
}
