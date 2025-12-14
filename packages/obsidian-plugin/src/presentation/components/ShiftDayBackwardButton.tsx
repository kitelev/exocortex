import React from "react";
import { TFile } from "obsidian";
import { canShiftDayBackward, CommandVisibilityContext } from "exocortex";
import type { MetadataRecord } from '@plugin/types';

export interface ShiftDayBackwardButtonProps {
  instanceClass: string | string[] | null;
  metadata: MetadataRecord;
  sourceFile: TFile;
  onShiftDayBackward: () => Promise<void>;
}

export const ShiftDayBackwardButton: React.FC<ShiftDayBackwardButtonProps> = ({
  instanceClass,
  metadata,
  sourceFile,
  onShiftDayBackward,
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
    return canShiftDayBackward(context);
  }, [instanceClass, metadata, sourceFile]);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    await onShiftDayBackward();
  };

  if (!shouldShowButton) {
    return null;
  }

  return (
    <button
      className="exocortex-shift-day-backward-btn"
      onClick={handleClick}
      type="button"
    >
      ← Day
    </button>
  );
};
