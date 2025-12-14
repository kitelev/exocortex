import React from "react";
import { TFile } from "obsidian";
import { canStartEffort, CommandVisibilityContext } from "exocortex";

export interface StartEffortButtonProps {
  instanceClass: string | string[] | null;
  currentStatus: string | string[] | null;
  sourceFile: TFile;
  onStartEffort: () => Promise<void>;
}

export const StartEffortButton: React.FC<StartEffortButtonProps> = ({
  instanceClass,
  currentStatus,
  sourceFile,
  onStartEffort,
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
    return canStartEffort(context);
  }, [instanceClass, currentStatus, sourceFile]);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    await onStartEffort();
  };

  if (!shouldShowButton) {
    return null;
  }

  return (
    <button
      className="exocortex-start-effort-btn"
      onClick={handleClick}
      type="button"
    >
      Start Effort
    </button>
  );
};
