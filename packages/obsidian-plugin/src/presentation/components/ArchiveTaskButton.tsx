import React from "react";
import { TFile } from "obsidian";
import { canArchiveTask, CommandVisibilityContext } from "exocortex";

export interface ArchiveTaskButtonProps {
  instanceClass: string | string[] | null;
  currentStatus: string | string[] | null;
  isArchived: boolean | string | number | null;
  sourceFile: TFile;
  onArchive: () => Promise<void>;
}

export const ArchiveTaskButton: React.FC<ArchiveTaskButtonProps> = ({
  instanceClass,
  currentStatus,
  isArchived,
  sourceFile,
  onArchive,
}) => {
  // Use centralized visibility logic from CommandVisibility
  const shouldShowButton = React.useMemo(() => {
    // Normalize isArchived to boolean (handle string/number/boolean)
    const normalizedArchived = Boolean(
      isArchived === true ||
        isArchived === "true" ||
        isArchived === "yes" ||
        isArchived === 1,
    );

    const context: CommandVisibilityContext = {
      instanceClass,
      currentStatus,
      metadata: {},
      isArchived: normalizedArchived,
      currentFolder: sourceFile.parent?.path || "",
      expectedFolder: null,
    };
    return canArchiveTask(context);
  }, [instanceClass, currentStatus, isArchived, sourceFile]);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    await onArchive();
  };

  if (!shouldShowButton) {
    return null;
  }

  return (
    <button
      className="exocortex-archive-task-btn"
      onClick={handleClick}
      type="button"
    >
      To Archive
    </button>
  );
};
