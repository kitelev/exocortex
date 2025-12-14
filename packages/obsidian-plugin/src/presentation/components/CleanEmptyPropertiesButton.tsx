import React from "react";
import { TFile } from "obsidian";
import { canCleanProperties, CommandVisibilityContext } from "exocortex";
import type { MetadataRecord } from '@plugin/types';

export interface CleanEmptyPropertiesButtonProps {
  sourceFile: TFile;
  metadata: MetadataRecord;
  onCleanup: () => Promise<void>;
}

export const CleanEmptyPropertiesButton: React.FC<
  CleanEmptyPropertiesButtonProps
> = ({ sourceFile, metadata, onCleanup }) => {
  // Use centralized visibility logic from CommandVisibility
  const hasEmptyProperties = React.useMemo(() => {
    const context: CommandVisibilityContext = {
      instanceClass: null,
      currentStatus: null,
      metadata,
      isArchived: false,
      currentFolder: sourceFile.parent?.path || "",
      expectedFolder: null,
    };
    return canCleanProperties(context);
  }, [metadata, sourceFile]);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    await onCleanup();
  };

  if (!hasEmptyProperties) {
    return null;
  }

  return (
    <button
      className="exocortex-clean-properties-btn"
      onClick={handleClick}
      type="button"
    >
      Clean Empty Properties
    </button>
  );
};
