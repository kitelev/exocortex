import React from "react";
import { TFile } from "obsidian";
import { canPlanOnToday, CommandVisibilityContext } from "exocortex";
import type { MetadataRecord } from '@plugin/types';

export interface PlanOnTodayButtonProps {
  instanceClass: string | string[] | null;
  metadata: MetadataRecord;
  sourceFile: TFile;
  onPlanOnToday: () => Promise<void>;
}

export const PlanOnTodayButton: React.FC<PlanOnTodayButtonProps> = ({
  instanceClass,
  metadata,
  sourceFile,
  onPlanOnToday,
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
    return canPlanOnToday(context);
  }, [instanceClass, metadata, sourceFile]);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    await onPlanOnToday();
  };

  if (!shouldShowButton) {
    return null;
  }

  return (
    <button
      className="exocortex-plan-on-today-btn"
      onClick={handleClick}
      type="button"
    >
      Plan on today
    </button>
  );
};
