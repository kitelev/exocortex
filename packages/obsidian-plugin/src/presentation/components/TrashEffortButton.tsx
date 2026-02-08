import React from "react";
import { TFile } from "obsidian";
import { canTrashEffort, CommandVisibilityContext } from "exocortex";

/**
 * Red X icon for the Trash button.
 * Uses inline SVG for crisp rendering and CSS color inheritance.
 */
const TrashXIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="exocortex-trash-icon"
    aria-hidden="true"
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export interface TrashEffortButtonProps {
  instanceClass: string | string[] | null;
  currentStatus: string | string[] | null;
  sourceFile: TFile;
  onTrash: () => Promise<void>;
}

export const TrashEffortButton: React.FC<TrashEffortButtonProps> = ({
  instanceClass,
  currentStatus,
  sourceFile,
  onTrash,
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
    return canTrashEffort(context);
  }, [instanceClass, currentStatus, sourceFile]);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    await onTrash();
  };

  if (!shouldShowButton) {
    return null;
  }

  return (
    <button
      className="exocortex-trash-btn"
      onClick={handleClick}
      type="button"
      title="Trash"
      aria-label="Trash effort"
    >
      <TrashXIcon />
    </button>
  );
};
