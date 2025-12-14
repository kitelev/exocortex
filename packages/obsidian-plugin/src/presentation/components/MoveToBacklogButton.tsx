import React from "react";
import { TFile } from "obsidian";
import { canMoveToBacklog, CommandVisibilityContext } from "exocortex";

export interface MoveToBacklogButtonProps {
  instanceClass: string | string[] | null;
  currentStatus: string | string[] | null;
  sourceFile: TFile;
  onMoveToBacklog: () => Promise<void>;
}

export const MoveToBacklogButton: React.FC<MoveToBacklogButtonProps> = ({
  instanceClass,
  currentStatus,
  sourceFile,
  onMoveToBacklog,
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
    return canMoveToBacklog(context);
  }, [instanceClass, currentStatus, sourceFile]);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    await onMoveToBacklog();
  };

  if (!shouldShowButton) {
    return null;
  }

  return (
    <button
      className="exocortex-move-to-backlog-btn"
      onClick={handleClick}
      type="button"
    >
      To Backlog
    </button>
  );
};
