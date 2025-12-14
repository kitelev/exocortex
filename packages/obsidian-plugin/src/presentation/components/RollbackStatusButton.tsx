import React from "react";
import { TFile } from "obsidian";
import { canRollbackStatus, CommandVisibilityContext } from "exocortex";
import type { MetadataRecord } from '@plugin/types';

export interface RollbackStatusButtonProps {
  instanceClass: string | string[] | null;
  currentStatus: string | string[] | null;
  metadata: MetadataRecord;
  sourceFile: TFile;
  onRollbackStatus: () => Promise<void>;
}

export const RollbackStatusButton: React.FC<RollbackStatusButtonProps> = ({
  instanceClass,
  currentStatus,
  metadata,
  sourceFile,
  onRollbackStatus,
}) => {
  const shouldShowButton = React.useMemo(() => {
    const context: CommandVisibilityContext = {
      instanceClass,
      currentStatus,
      metadata,
      isArchived: false,
      currentFolder: sourceFile.parent?.path || "",
      expectedFolder: null,
    };
    return canRollbackStatus(context);
  }, [instanceClass, currentStatus, metadata, sourceFile]);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    await onRollbackStatus();
  };

  if (!shouldShowButton) {
    return null;
  }

  return (
    <button
      className="exocortex-rollback-status-btn"
      onClick={handleClick}
      type="button"
    >
      Rollback Status
    </button>
  );
};
