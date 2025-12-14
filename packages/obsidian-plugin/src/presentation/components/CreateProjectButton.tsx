import React from "react";
import { TFile } from "obsidian";
import { canCreateProject, CommandVisibilityContext } from "exocortex";
import type { MetadataRecord } from '@plugin/types';

export interface CreateProjectButtonProps {
  instanceClass: string | string[] | null;
  metadata: MetadataRecord;
  sourceFile: TFile;
  onProjectCreate: () => Promise<void>;
}

export const CreateProjectButton: React.FC<CreateProjectButtonProps> = ({
  instanceClass,
  metadata,
  sourceFile,
  onProjectCreate,
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
    return canCreateProject(context);
  }, [instanceClass, metadata, sourceFile]);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    await onProjectCreate();
  };

  if (!shouldShowButton) {
    return null;
  }

  return (
    <button
      className="exocortex-create-project-btn"
      onClick={handleClick}
      type="button"
    >
      Create Project
    </button>
  );
};
