import React from "react";
import { TFile } from "obsidian";
import { canMarkDone, CommandVisibilityContext } from "exocortex";

export interface MarkTaskDoneButtonProps {
  instanceClass: string | string[] | null;
  currentStatus: string | string[] | null;
  sourceFile: TFile;
  onMarkDone: () => Promise<void>;
}

export const MarkTaskDoneButton: React.FC<MarkTaskDoneButtonProps> = ({
  instanceClass,
  currentStatus,
  sourceFile,
  onMarkDone,
}) => {
  // Use centralized visibility logic from CommandVisibility
  const shouldShowButton = React.useMemo(() => {
    const context: CommandVisibilityContext = {
      instanceClass,
      currentStatus,
      metadata: {},
      isArchived: false,
      currentFolder: sourceFile.parent?.path || "",
      expectedFolder: null,
    };
    return canMarkDone(context);
  }, [instanceClass, currentStatus, sourceFile]);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    await onMarkDone();
  };

  if (!shouldShowButton) {
    return null;
  }

  return (
    <button
      className="exocortex-mark-done-btn"
      onClick={handleClick}
      type="button"
    >
      Done
    </button>
  );
};
