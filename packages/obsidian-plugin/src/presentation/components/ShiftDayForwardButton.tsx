import React from "react";
import { TFile } from "obsidian";
import { canShiftDayForward, CommandVisibilityContext } from "exocortex";
import type { MetadataRecord } from '@plugin/types';

export interface ShiftDayForwardButtonProps {
  instanceClass: string | string[] | null;
  metadata: MetadataRecord;
  sourceFile: TFile;
  onShiftDayForward: () => Promise<void>;
}

export const ShiftDayForwardButton: React.FC<ShiftDayForwardButtonProps> = ({
  instanceClass,
  metadata,
  sourceFile,
  onShiftDayForward,
}) => {
  const shouldShowButton = React.useMemo(() => {
    const context: CommandVisibilityContext = {
      instanceClass,
      currentStatus: null,
      metadata,
      isArchived: false,
      currentFolder: sourceFile.parent?.path || "",
      expectedFolder: null,
    };
    return canShiftDayForward(context);
  }, [instanceClass, metadata, sourceFile]);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    await onShiftDayForward();
  };

  if (!shouldShowButton) {
    return null;
  }

  return (
    <button
      className="exocortex-shift-day-forward-btn"
      onClick={handleClick}
      type="button"
    >
      Day →
    </button>
  );
};
