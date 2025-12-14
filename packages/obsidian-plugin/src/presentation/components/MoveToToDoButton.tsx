import React from "react";
import { TFile } from "obsidian";
import { canMoveToToDo, CommandVisibilityContext } from "exocortex";

export interface MoveToToDoButtonProps {
  instanceClass: string | string[] | null;
  currentStatus: string | string[] | null;
  sourceFile: TFile;
  onMoveToToDo: () => Promise<void>;
}

export const MoveToToDoButton: React.FC<MoveToToDoButtonProps> = ({
  instanceClass,
  currentStatus,
  sourceFile,
  onMoveToToDo,
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
    return canMoveToToDo(context);
  }, [instanceClass, currentStatus, sourceFile]);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    await onMoveToToDo();
  };

  if (!shouldShowButton) {
    return null;
  }

  return (
    <button
      className="exocortex-move-to-todo-btn"
      onClick={handleClick}
      type="button"
    >
      To ToDo
    </button>
  );
};
