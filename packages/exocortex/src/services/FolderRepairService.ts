import { injectable, inject } from "tsyringe";
import type { IVaultAdapter, IFile } from "../interfaces/IVaultAdapter";
import { DI_TOKENS } from "../interfaces/tokens";

/**
 * Service for repairing asset folder locations based on exo__Asset_isDefinedBy references
 */
@injectable()
export class FolderRepairService {
  constructor(
    @inject(DI_TOKENS.IVaultAdapter) private vault: IVaultAdapter,
  ) {}

  /**
   * Get the expected folder for an asset based on its exo__Asset_isDefinedBy property
   * Returns null if no expected folder can be determined
   */
  async getExpectedFolder(
    file: IFile,
    metadata: Record<string, any>,
  ): Promise<string | null> {
    const isDefinedBy = metadata?.exo__Asset_isDefinedBy;

    if (!isDefinedBy) {
      return null;
    }

    // Extract the reference (handle both [[Reference]] and "[[Reference]]" formats)
    const reference = this.extractReference(isDefinedBy);
    if (!reference) {
      return null;
    }

    // Find the referenced file
    const referencedFile = this.vault.getFirstLinkpathDest(
      reference,
      file.path,
    );

    if (!referencedFile) {
      return null;
    }

    // Get the folder of the referenced file
    return this.getFileFolder(referencedFile);
  }

  /**
   * Move asset to its expected folder based on exo__Asset_isDefinedBy
   */
  async repairFolder(file: IFile, expectedFolder: string): Promise<void> {
    // Construct new path
    const newPath = `${expectedFolder}/${file.name}`;

    // Check if target path already exists
    const existingFile = this.vault.getAbstractFileByPath(newPath);
    if (existingFile) {
      throw new Error(`Cannot move file: ${newPath} already exists`);
    }

    // Ensure target folder exists
    await this.ensureFolderExists(expectedFolder);

    // Move the file
    await this.vault.rename(file, newPath);
  }

  /**
   * Get the folder path for a file
   */
  private getFileFolder(file: IFile): string {
    const folderPath = file.parent?.path || "";
    return folderPath;
  }

  /**
   * Extract reference from various formats:
   * - [[Reference]] -> Reference
   * - "[[Reference]]" -> Reference
   * - Reference -> Reference
   */
  private extractReference(value: any): string | null {
    if (typeof value !== "string") {
      return null;
    }

    // Remove quotes if present
    let cleaned = value.trim().replace(/^["']|["']$/g, "");

    // Remove wiki-link brackets if present
    cleaned = cleaned.replace(/^\[\[|\]\]$/g, "");

    return cleaned || null;
  }

  /**
   * Ensure a folder exists, creating it if necessary
   */
  private async ensureFolderExists(folderPath: string): Promise<void> {
    if (!folderPath) {
      return;
    }

    const folder = this.vault.getAbstractFileByPath(folderPath);
    if (folder && "children" in folder) {
      return;
    }

    try {
      await this.vault.createFolder(folderPath);
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("Folder already exists")) {
        return;
      }
      throw error;
    }
  }
}
