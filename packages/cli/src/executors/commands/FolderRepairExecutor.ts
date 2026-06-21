import path from "path";
import { extractAssetReference } from "@kitelev/exocortex-core";
import { BaseCommandExecutor, CommandContext } from "./BaseCommandExecutor.js";
import { ErrorHandler } from "../../utils/ErrorHandler.js";
import { ExitCodes } from "../../utils/ExitCodes.js";
import { findReferencedFile, normalizePath } from "../folderRepairHelpers.js";

/**
 * Result of folder repair operation
 */
export interface FolderRepairResult {
  moved: boolean;
  oldPath: string;
  newPath: string;
  expectedFolder: string;
}

/**
 * Executes folder repair command (repair-folder)
 *
 * Moves asset to correct folder based on exo__Asset_isDefinedBy reference.
 */
export class FolderRepairExecutor extends BaseCommandExecutor {
  constructor(context: CommandContext) {
    super(context);
  }

  /**
   * Repairs file folder location based on exo__Asset_isDefinedBy property.
   *
   * The file should be in the same folder as the asset it is defined by.
   */
  async executeRepairFolder(filepath: string): Promise<FolderRepairResult> {
    try {
      const { relativePath } = this.resolveAndValidate(filepath);
      const metadata = await this.fsAdapter.getFileMetadata(relativePath);

      // Check for required property
      const isDefinedBy = metadata?.exo__Asset_isDefinedBy;
      if (!isDefinedBy) {
        throw new Error(
          "Cannot determine expected folder: missing exo__Asset_isDefinedBy",
        );
      }

      // Extract reference from various formats
      const reference = extractAssetReference(isDefinedBy);
      if (!reference) {
        throw new Error(
          "Cannot determine expected folder: invalid exo__Asset_isDefinedBy format",
        );
      }

      // Find the referenced file
      const referencedFilePath = await findReferencedFile(
        this.fsAdapter,
        reference,
        relativePath,
      );
      if (!referencedFilePath) {
        throw new Error(
          `Cannot determine expected folder: referenced asset not found: ${reference}`,
        );
      }

      // Get expected folder (folder of referenced file)
      // Handle root folder case: path.dirname returns "." for root-level files
      const rawExpectedFolder = path.dirname(referencedFilePath);
      const expectedFolder = rawExpectedFolder === "." ? "" : rawExpectedFolder;
      const rawCurrentFolder = path.dirname(relativePath);
      const currentFolder = rawCurrentFolder === "." ? "" : rawCurrentFolder;

      // Check if already in correct folder
      if (normalizePath(currentFolder) === normalizePath(expectedFolder)) {
        console.log(`✅ Already in correct folder`);
        console.log(`   File: ${filepath}`);
        console.log(`   Folder: ${expectedFolder || "(root)"}`);
        process.exit(ExitCodes.SUCCESS);
        return {
          moved: false,
          oldPath: relativePath,
          newPath: relativePath,
          expectedFolder,
        };
      }

      // Dry-run mode: preview changes without modifying
      if (this.dryRun) {
        const fileName = path.basename(relativePath);
        const newPath = expectedFolder ? `${expectedFolder}/${fileName}` : fileName;

        console.log(`🔍 DRY RUN: Preview of changes (not applied)`);
        console.log(`   File: ${filepath}`);
        console.log(`   Current folder: ${currentFolder || "(root)"}`);
        console.log(`   Expected folder: ${expectedFolder || "(root)"}`);
        console.log(`   Would move to: ${newPath}`);
        console.log(`\n💡 Run without --dry-run to apply changes`);
        process.exit(ExitCodes.SUCCESS);
        return {
          moved: false,
          oldPath: relativePath,
          newPath,
          expectedFolder,
        };
      }

      // Construct new path
      const fileName = path.basename(relativePath);
      const newPath = expectedFolder ? `${expectedFolder}/${fileName}` : fileName;

      // Check if target already exists
      const targetExists = await this.fsAdapter.fileExists(newPath);
      if (targetExists) {
        throw new Error(`Cannot move file: ${newPath} already exists`);
      }

      // Ensure target folder exists
      if (expectedFolder) {
        const folderExists = await this.fsAdapter.directoryExists(expectedFolder);
        if (!folderExists) {
          await this.fsAdapter.createDirectory(expectedFolder);
        }
      }

      // Move the file
      await this.fsAdapter.renameFile(relativePath, newPath);

      console.log(`✅ Moved to correct folder`);
      console.log(`   Old path: ${relativePath}`);
      console.log(`   New path: ${newPath}`);
      console.log(`   Expected folder: ${expectedFolder || "(root)"}`);
      process.exit(ExitCodes.SUCCESS);

      return {
        moved: true,
        oldPath: relativePath,
        newPath,
        expectedFolder,
      };
    } catch (error) {
      ErrorHandler.handle(error as Error);
    }
  }
}
