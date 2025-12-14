import React from "react";
import { TFile } from "obsidian";
import { canCreateInstance, CommandVisibilityContext } from "exocortex";
import type { MetadataRecord } from '@plugin/types';

export interface CreateInstanceButtonProps {
  instanceClass: string | string[] | null;
  metadata: MetadataRecord;
  sourceFile: TFile;
  onInstanceCreate: () => Promise<void>;
}

export const CreateInstanceButton: React.FC<CreateInstanceButtonProps> = ({
  instanceClass,
  metadata,
  sourceFile,
  onInstanceCreate,
}) => {
  // Use centralized visibility logic from CommandVisibility
  const shouldShowButton = React.useMemo(() => {
    const context: CommandVisibilityContext = {
      instanceClass,
      currentStatus: null,
      metadata,
      isArchived: false,
      currentFolder: sourceFile.parent?.path || "",
      expectedFolder: null,
    };
    return canCreateInstance(context);
  }, [instanceClass, metadata, sourceFile]);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();

    // Call the callback to create the instance
    // The service will handle all the details
    await onInstanceCreate();
  };

  if (!shouldShowButton) {
    return null;
  }

  return (
    <button
      className="exocortex-create-instance-btn"
      onClick={handleClick}
      type="button"
    >
      Create Instance
    </button>
  );
};
