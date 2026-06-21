import { injectable, inject } from "tsyringe";
import type { IVaultAdapter, IFile } from "../interfaces/IVaultAdapter";
import { DI_TOKENS } from "../interfaces/tokens";
import { extractAssetReference } from "../utilities/extractAssetReference";

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
    metadata: Record<string, unknown>,
  ): Promise<string | null> {
    return this.getExpectedFolderSync(file, metadata);
  }

  /**
   * Sync sibling of getExpectedFolder for use in Obsidian's synchronous
   * checkCallback (command palette / context menu visibility). Underlying
   * vault APIs (getFirstLinkpathDest, getAbstractFileByPath) are already
   * synchronous, so this returns the same value without a Promise wrapper.
   */
  getExpectedFolderSync(
    file: IFile,
    metadata: Record<string, unknown>,
  ): string | null {
    const isDefinedBy = metadata?.exo__Asset_isDefinedBy;

    if (!isDefinedBy) {
      return null;
    }

    const reference = extractAssetReference(isDefinedBy);
    if (!reference) {
      return null;
    }

    const referencedFile = this.vault.getFirstLinkpathDest(
      reference,
      file.path,
    );

    if (!referencedFile) {
      return null;
    }

    return this.getFileFolder(referencedFile);
  }

  /**
   * Move asset to its expected folder based on exo__Asset_isDefinedBy
   */
  async repairFolder(file: IFile, expectedFolder: string): Promise<void> {
    // Construct new path. For a root-level target (expectedFolder === "") the
    // file lands at the vault root as `<name>`, NOT `/<name>`: a leading-slash
    // path is an *absolute* filesystem path. `FileSystemVaultAdapter.resolvePath`
    // returns absolute paths verbatim, so `/<name>` would `fs.move` the asset to
    // the OS filesystem root — out of the vault entirely (lost). This mirrors the
    // CLI `FolderRepairExecutor`/`BatchExecutor`, which already build
    // `expectedFolder ? \`${expectedFolder}/${fileName}\` : fileName`.
    const newPath = expectedFolder ? `${expectedFolder}/${file.name}` : file.name;

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
