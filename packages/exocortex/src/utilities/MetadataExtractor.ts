import { CommandVisibilityContext } from "../domain/commands/CommandVisibility";
import { IVaultAdapter, IFile } from "../interfaces/IVaultAdapter";
import { MetadataHelpers } from "./MetadataHelpers";

export class MetadataExtractor {
  constructor(private vault: IVaultAdapter) {}

  extractMetadata(file: IFile | null): Record<string, unknown> {
    if (!file) return {};

    return this.vault.getFrontmatter(file) || {};
  }

  extractInstanceClass(
    metadata: Record<string, unknown>,
  ): string | string[] | null {
    return (metadata.exo__Instance_class as string | string[] | undefined) || null;
  }

  extractStatus(metadata: Record<string, unknown>): string | string[] | null {
    return (metadata.ems__Effort_status as string | string[] | undefined) || null;
  }

  extractIsArchived(metadata: Record<string, unknown>): boolean {
    return MetadataHelpers.isAssetArchived(metadata);
  }

  static extractIsDefinedBy(sourceMetadata: Record<string, unknown>): string {
    let isDefinedBy: unknown = sourceMetadata.exo__Asset_isDefinedBy || '""';
    if (Array.isArray(isDefinedBy)) {
      isDefinedBy = isDefinedBy[0] || '""';
    }
    return String(isDefinedBy);
  }

  extractExpectedFolder(metadata: Record<string, unknown>): string | null {
    const isDefinedBy = metadata.exo__Asset_isDefinedBy;
    if (!isDefinedBy) return null;

    const definedByValue = Array.isArray(isDefinedBy)
      ? isDefinedBy[0]
      : isDefinedBy;
    if (!definedByValue || typeof definedByValue !== "string") return null;

    const cleanValue = definedByValue.replace(/["'[\]]/g, "").trim();
    if (!cleanValue) return null;

    const parts = cleanValue.split("/");
    parts.pop();
    return parts.join("/");
  }

  extractCommandVisibilityContext(file: IFile): CommandVisibilityContext {
    const metadata = this.extractMetadata(file);
    const instanceClass = this.extractInstanceClass(metadata);
    const currentStatus = this.extractStatus(metadata);
    const isArchived = this.extractIsArchived(metadata);
    const currentFolder = file.parent?.path || "";
    const expectedFolder = this.extractExpectedFolder(metadata);

    return {
      instanceClass,
      currentStatus,
      metadata,
      isArchived,
      currentFolder,
      expectedFolder,
    };
  }

  extractCache(file: IFile | null): Record<string, unknown> | null {
    if (!file) return null;
    return this.vault.getFrontmatter(file);
  }
}
