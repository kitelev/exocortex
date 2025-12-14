import { injectable, inject } from "tsyringe";
import type { IVaultAdapter, IFile } from "../interfaces/IVaultAdapter";
import { AssetClass } from "../domain/constants";
import { FrontmatterService } from "../utilities/FrontmatterService";
import { LoggingService } from "./LoggingService";
import { DI_TOKENS } from "../interfaces/tokens";

/**
 * AssetConversionService
 *
 * Handles conversion between asset classes while preserving all metadata.
 * Converts asset types by updating the exo__Instance_class property.
 *
 * @module services
 * @since 1.0.0
 */
@injectable()
export class AssetConversionService {
  private frontmatterService: FrontmatterService;

  constructor(
    @inject(DI_TOKENS.IVaultAdapter) private vault: IVaultAdapter,
  ) {
    this.frontmatterService = new FrontmatterService();
  }

  /**
   * Convert a Task asset to a Project asset.
   *
   * Updates the exo__Instance_class from ems__Task to ems__Project.
   * Preserves all other metadata including:
   * - Asset UID, label, timestamps
   * - Effort status, relationships
   * - All other properties
   *
   * @param file - The task file to convert
   * @returns The updated file
   * @throws Error if file cannot be read or modified
   *
   * @example
   * ```typescript
   * const service = new AssetConversionService(vault);
   * await service.convertTaskToProject(taskFile);
   * ```
   */
  async convertTaskToProject(file: IFile): Promise<IFile> {
    try {
      // Read current file content
      const content = await this.vault.read(file);

      // Remove existing Instance_class (handles both single and multi-line)
      let updatedContent = this.removeInstanceClassProperty(content);

      // Add new Instance_class in single-line format
      updatedContent = this.frontmatterService.updateProperty(
        updatedContent,
        "exo__Instance_class",
        `["[[${AssetClass.PROJECT}]]"]`,
      );

      // Write updated content back to file
      await this.vault.modify(file, updatedContent);

      LoggingService.info(
        `Converted Task to Project: ${file.basename} (${file.path})`,
      );

      return file;
    } catch (error: unknown) {
      const message = `Failed to convert Task to Project: ${file.path}`;
      LoggingService.error(message, error instanceof Error ? error : undefined);
      throw new Error(message);
    }
  }

  /**
   * Convert a Project asset to a Task asset.
   *
   * Updates the exo__Instance_class from ems__Project to ems__Task.
   * Preserves all other metadata including:
   * - Asset UID, label, timestamps
   * - Effort status, relationships
   * - All other properties
   *
   * @param file - The project file to convert
   * @returns The updated file
   * @throws Error if file cannot be read or modified
   *
   * @example
   * ```typescript
   * const service = new AssetConversionService(vault);
   * await service.convertProjectToTask(projectFile);
   * ```
   */
  async convertProjectToTask(file: IFile): Promise<IFile> {
    try {
      // Read current file content
      const content = await this.vault.read(file);

      // Remove existing Instance_class (handles both single and multi-line)
      let updatedContent = this.removeInstanceClassProperty(content);

      // Add new Instance_class in single-line format
      updatedContent = this.frontmatterService.updateProperty(
        updatedContent,
        "exo__Instance_class",
        `["[[${AssetClass.TASK}]]"]`,
      );

      // Write updated content back to file
      await this.vault.modify(file, updatedContent);

      LoggingService.info(
        `Converted Project to Task: ${file.basename} (${file.path})`,
      );

      return file;
    } catch (error: unknown) {
      const message = `Failed to convert Project to Task: ${file.path}`;
      LoggingService.error(message, error instanceof Error ? error : undefined);
      throw new Error(message);
    }
  }

  /**
   * Remove the exo__Instance_class property including multi-line arrays.
   * Handles both single-line and multi-line YAML array formats.
   */
  private removeInstanceClassProperty(content: string): string {
    const parsed = this.frontmatterService.parse(content);
    if (!parsed.exists) {
      return content;
    }

    // Remove single-line or multi-line Instance_class
    // Pattern matches:
    // - exo__Instance_class: ["value"] (single line)
    // - exo__Instance_class:\n  - "value" (multi-line)
    const propertyRegex = /^exo__Instance_class:.*$(\n  -.*$)*/gm;
    const updatedFrontmatter = parsed.content.replace(propertyRegex, "").replace(/\n\n+/g, "\n").trim();

    return content.replace(
      /^---\n[\s\S]*?\n---/,
      `---\n${updatedFrontmatter}\n---`,
    );
  }
}
