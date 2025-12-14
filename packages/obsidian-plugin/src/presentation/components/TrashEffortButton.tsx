import React from "react";
import { TFile } from "obsidian";
import { canTrashEffort, CommandVisibilityContext } from "exocortex";

export interface TrashEffortButtonProps {
  instanceClass: string | string[] | null;
  currentStatus: string | string[] | null;
  sourceFile: TFile;
  onTrash: () => Promise<void>;
}

export const TrashEffortButton: React.FC<TrashEffortButtonProps> = ({
  instanceClass,
  currentStatus,
  sourceFile,
  onTrash,
}) => {
  const shouldShowButton = React.useMemo(() => {
    const context: CommandVisibilityContext = {
      instanceClass,
      currentStatus,
      metadata: {},
      isArchived: false,
      currentFolder: sourceFile.parent?.path || "",
      expectedFolder: null,
    };
    return canTrashEffort(context);
  }, [instanceClass, currentStatus, sourceFile]);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    await onTrash();
  };

  if (!shouldShowButton) {
    return null;
  }

  return (
    <button className="exocortex-trash-btn" onClick={handleClick} type="button">
      Trash
    </button>
  );
};
