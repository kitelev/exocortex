import React from "react";
import { TFile } from "obsidian";
import { canVoteOnEffort, CommandVisibilityContext } from "exocortex";
import type { MetadataRecord } from '@plugin/types';

export interface VoteOnEffortButtonProps {
  instanceClass: string | string[] | null;
  metadata: MetadataRecord;
  isArchived: boolean;
  sourceFile: TFile;
  onVote: () => Promise<void>;
}

export const VoteOnEffortButton: React.FC<VoteOnEffortButtonProps> = ({
  instanceClass,
  metadata,
  isArchived,
  sourceFile,
  onVote,
}) => {
  // Use centralized visibility logic from CommandVisibility
  const shouldShowButton = React.useMemo(() => {
    const context: CommandVisibilityContext = {
      instanceClass,
      currentStatus: null,
      metadata,
      isArchived,
      currentFolder: sourceFile.parent?.path || "",
      expectedFolder: null,
    };
    return canVoteOnEffort(context);
  }, [instanceClass, metadata, isArchived, sourceFile]);

  // Extract current vote count from metadata
  const currentVotes = React.useMemo(() => {
    const votes = metadata?.ems__Effort_votes;
    if (typeof votes === "number") {
      return votes;
    }
    return 0;
  }, [metadata]);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    await onVote();
  };

  if (!shouldShowButton) {
    return null;
  }

  return (
    <button
      className="exocortex-vote-btn"
      onClick={handleClick}
      type="button"
      title={`Vote on this effort (current votes: ${currentVotes})`}
    >
      {currentVotes > 0 ? `Vote (${currentVotes})` : "Vote"}
    </button>
  );
};
