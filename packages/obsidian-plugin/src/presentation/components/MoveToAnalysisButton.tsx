import React from "react";
import { TFile } from "obsidian";
import { canMoveToAnalysis, CommandVisibilityContext } from "exocortex";

export interface MoveToAnalysisButtonProps {
  instanceClass: string | string[] | null;
  currentStatus: string | string[] | null;
  sourceFile: TFile;
  onMoveToAnalysis: () => Promise<void>;
}

export const MoveToAnalysisButton: React.FC<MoveToAnalysisButtonProps> = ({
  instanceClass,
  currentStatus,
  sourceFile,
  onMoveToAnalysis,
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
    return canMoveToAnalysis(context);
  }, [instanceClass, currentStatus, sourceFile]);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    await onMoveToAnalysis();
  };

  if (!shouldShowButton) {
    return null;
  }

  return (
    <button
      className="exocortex-move-to-analysis-btn"
      onClick={handleClick}
      type="button"
    >
      To Analysis
    </button>
  );
};
