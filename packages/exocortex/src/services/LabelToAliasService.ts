import { injectable, inject } from "tsyringe";
import type { IVaultAdapter, IFile } from "../interfaces/IVaultAdapter";
import { DI_TOKENS } from "../interfaces/tokens";

@injectable()
export class LabelToAliasService {
  constructor(
    @inject(DI_TOKENS.IVaultAdapter) private vault: IVaultAdapter,
  ) {}

  async copyLabelToAliases(file: IFile): Promise<void> {
    const fileContent = await this.vault.read(file);
    const label = this.extractLabel(fileContent);

    if (!label) {
      throw new Error("No exo__Asset_label found in file");
    }

    const updatedContent = this.addLabelToAliases(fileContent, label);
    await this.vault.modify(file, updatedContent);
  }

  private extractLabel(content: string): string | null {
    const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---/;
    const match = content.match(frontmatterRegex);

    if (!match) return null;

    const frontmatterContent = match[1];
    const labelMatch = frontmatterContent.match(
      /exo__Asset_label:\s*["']?([^"'\r\n]+)["']?/,
    );

    if (labelMatch && labelMatch[1]) {
      return labelMatch[1].trim();
    }

    return null;
  }

  private addLabelToAliases(content: string, label: string): string {
    const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---/;
    const match = content.match(frontmatterRegex);

    const lineEnding = content.includes("\r\n") ? "\r\n" : "\n";

    if (!match) {
      const newFrontmatter = `---${lineEnding}aliases:${lineEnding}  - "${label}"${lineEnding}---${lineEnding}${content}`;
      return newFrontmatter;
    }

    const frontmatterContent = match[1];
    let updatedFrontmatter = frontmatterContent;

    if (updatedFrontmatter.includes("aliases:")) {
      const aliasesMatch = updatedFrontmatter.match(
        /(aliases:\r?\n(?: {2}- .*\r?\n)*)/,
      );
      if (aliasesMatch) {
        updatedFrontmatter = updatedFrontmatter.replace(
          /(aliases:\r?\n(?: {2}- .*\r?\n)*)/,
          `$1  - "${label}"${lineEnding}`,
        );
      }
    } else {
      updatedFrontmatter += `${lineEnding}aliases:${lineEnding}  - "${label}"`;
    }

    return content.replace(
      frontmatterRegex,
      `---${lineEnding}${updatedFrontmatter}${lineEnding}---`,
    );
  }
}
