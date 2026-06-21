import { injectable, inject } from "tsyringe";
import type { IVaultAdapter, IFile } from "../interfaces/IVaultAdapter";
import { DI_TOKENS } from "../interfaces/tokens";

/**
 * Service for managing effort voting functionality
 * Handles incrementing ems__Effort_votes property on Tasks/Projects
 */
@injectable()
export class EffortVotingService {
  constructor(
    @inject(DI_TOKENS.IVaultAdapter) private vault: IVaultAdapter,
  ) {}

  /**
   * Increment the vote count for an effort
   * Creates property if it doesn't exist (starts at 1)
   * @param effortFile - The file representing the effort (Task or Project)
   * @returns The new vote count after increment
   */
  async incrementEffortVotes(effortFile: IFile): Promise<number> {
    const fileContent = await this.vault.read(effortFile);
    const currentVotes = this.extractVoteCount(fileContent);
    const newVoteCount = currentVotes + 1;

    const updatedContent = this.updateFrontmatterWithVotes(
      fileContent,
      newVoteCount,
    );
    await this.vault.modify(effortFile, updatedContent);

    return newVoteCount;
  }

  /**
   * Extract current vote count from file content
   * Returns 0 if property doesn't exist
   * @param content - The file content to parse
   * @returns Current vote count (0 if property doesn't exist)
   */
  private extractVoteCount(content: string): number {
    // Support both Unix (\n) and Windows (\r\n) line endings
    const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---/;
    const match = content.match(frontmatterRegex);

    if (!match) return 0;

    const frontmatterContent = match[1];
    const votesMatch = frontmatterContent.match(/ems__Effort_votes:\s*(\d+)/);

    if (votesMatch && votesMatch[1]) {
      return parseInt(votesMatch[1], 10);
    }

    return 0;
  }

  /**
   * Update frontmatter with new vote count
   * Creates frontmatter if it doesn't exist
   * Adds or updates ems__Effort_votes property
   * @param content - Original file content
   * @param voteCount - New vote count to set
   * @returns Updated file content with new vote count
   */
  private updateFrontmatterWithVotes(
    content: string,
    voteCount: number,
  ): string {
    // Support both Unix (\n) and Windows (\r\n) line endings
    const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---/;
    const match = content.match(frontmatterRegex);

    // Detect line ending style from original content
    const lineEnding = content.includes("\r\n") ? "\r\n" : "\n";

    if (!match) {
      // No frontmatter - create it
      const newFrontmatter = `---${lineEnding}ems__Effort_votes: ${voteCount}${lineEnding}---${lineEnding}${content}`;
      return newFrontmatter;
    }

    // Update existing frontmatter
    const frontmatterContent = match[1];
    let updatedFrontmatter = frontmatterContent;

    if (updatedFrontmatter.includes("ems__Effort_votes:")) {
      // Update existing property
      updatedFrontmatter = updatedFrontmatter.replace(
        /ems__Effort_votes:.*$/m,
        `ems__Effort_votes: ${voteCount}`,
      );
    } else {
      // Add new property (preserving line ending style)
      updatedFrontmatter += `${lineEnding}ems__Effort_votes: ${voteCount}`;
    }

    return content.replace(
      frontmatterRegex,
      `---${lineEnding}${updatedFrontmatter}${lineEnding}---`,
    );
  }
}
