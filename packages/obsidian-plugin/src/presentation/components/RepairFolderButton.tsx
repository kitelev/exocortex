import React from "react";
import { TFile } from "obsidian";
import { canRepairFolder, CommandVisibilityContext } from "exocortex";

export interface RepairFolderButtonProps {
  sourceFile: TFile;
  currentFolder: string;
  expectedFolder: string | null;
  onRepair: () => Promise<void>;
}

export const RepairFolderButton: React.FC<RepairFolderButtonProps> = ({
  currentFolder,
  expectedFolder,
  onRepair,
}) => {
  // Use centralized visibility logic from CommandVisibility
  const needsRepair = React.useMemo(() => {
    const context: CommandVisibilityContext = {
      instanceClass: null,
      currentStatus: null,
      metadata: {},
      isArchived: false,
      currentFolder,
      expectedFolder,
    };
    return canRepairFolder(context);
  }, [currentFolder, expectedFolder]);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    await onRepair();
  };

  if (!needsRepair) {
    return null;
  }

  return (
    <button
      className="exocortex-repair-folder-btn"
      onClick={handleClick}
      type="button"
      title={`Move to ${expectedFolder}`}
    >
      Repair Folder
    </button>
  );
};
