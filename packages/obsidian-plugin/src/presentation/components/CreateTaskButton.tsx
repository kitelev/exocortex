import React from "react";
import { TFile } from "obsidian";
import { canCreateTask, CommandVisibilityContext } from "exocortex";
import type { MetadataRecord } from '@plugin/types';

export interface CreateTaskButtonProps {
  instanceClass: string | string[] | null;
  metadata: MetadataRecord;
  sourceFile: TFile;
  onTaskCreate: () => Promise<void>;
}

export const CreateTaskButton: React.FC<CreateTaskButtonProps> = ({
  instanceClass,
  metadata,
  sourceFile,
  onTaskCreate,
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
    return canCreateTask(context);
  }, [instanceClass, metadata, sourceFile]);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();

    // Call the callback to create the file
    // The service will handle all the details
    await onTaskCreate();
  };

  if (!shouldShowButton) {
    return null;
  }

  return (
    <button
      className="exocortex-create-task-btn"
      onClick={handleClick}
      type="button"
    >
      Create Task
    </button>
  );
};
