import React from "react";
import { TFile, Notice } from "obsidian";
import { canRenameToUid } from "exocortex";
import { LoggingService } from "exocortex";
import type { MetadataRecord } from '@plugin/types';

interface RenameToUidButtonProps {
  file: TFile;
  metadata: MetadataRecord;
  onRename: () => Promise<void>;
}

export const RenameToUidButton: React.FC<RenameToUidButtonProps> = ({
  file,
  metadata,
  onRename,
}) => {
  const context = {
    instanceClass: (metadata.exo__Instance_class as string | string[] | null) || null,
    currentStatus: (metadata.ems__Effort_status as string | string[] | null) || null,
    metadata,
    isArchived: Boolean(metadata.archived ?? metadata.exo__Asset_isArchived ?? false),
    currentFolder: file.parent?.path || "",
    expectedFolder: null,
  };

  const visible = canRenameToUid(context, file.basename);

  if (!visible) {
    return null;
  }

  const handleClick = async () => {
    try {
      await onRename();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      new Notice(`Failed to rename: ${errorMessage}`);
      LoggingService.error(
        "Rename to UID error",
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  };

  return (
    <button
      className="exocortex-button exocortex-button-rename-to-uid"
      onClick={handleClick}
      type="button"
    >
      Rename to UID
    </button>
  );
};
