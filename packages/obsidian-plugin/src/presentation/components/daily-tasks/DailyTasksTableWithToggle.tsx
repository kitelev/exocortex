import React from "react";
import { useUIStore } from '@plugin/presentation/stores';
import type { DailyTasksTableWithToggleProps } from './types';
import { DailyTasksTable } from './DailyTasksTable';

export const DailyTasksTableWithToggle: React.FC<
  DailyTasksTableWithToggleProps
> = ({
  showEffortArea: propShowEffortArea,
  onToggleEffortArea,
  showEffortVotes: propShowEffortVotes,
  onToggleEffortVotes,
  showArchived: propShowArchived,
  onToggleArchived,
  showFullDateInEffortTimes: propShowFullDate,
  onToggleFullDate,
  focusMode: propFocusMode,
  onToggleFocusMode,
  showEmptySlots: propShowEmptySlots,
  onToggleEmptySlots,
  showTime: propShowTime,
  onToggleTime,
  showStatus: propShowStatus,
  onToggleStatus,
  showTimeEstimate: propShowTimeEstimate,
  onToggleTimeEstimate,
  ...props
}) => {
  const storeShowEffortArea = useUIStore((state) => state.showEffortArea);
  const storeShowEffortVotes = useUIStore((state) => state.showEffortVotes);
  const storeShowArchived = useUIStore((state) => state.showArchived);
  const storeShowFullDate = useUIStore(
    (state) => state.showFullDateInEffortTimes,
  );
  const storeFocusMode = useUIStore((state) => state.focusMode);
  const storeShowEmptySlots = useUIStore((state) => state.showEmptySlots);
  const storeShowTime = useUIStore((state) => state.showTime);
  const storeShowStatus = useUIStore((state) => state.showStatus);
  const storeShowTimeEstimate = useUIStore((state) => state.showTimeEstimate);

  const storeToggleEffortArea = useUIStore((state) => state.toggleEffortArea);
  const storeToggleEffortVotes = useUIStore((state) => state.toggleEffortVotes);
  const storeToggleArchived = useUIStore((state) => state.toggleArchived);
  const storeToggleFullDate = useUIStore((state) => state.toggleFullDate);
  const storeToggleFocusMode = useUIStore((state) => state.toggleFocusMode);
  const storeToggleEmptySlots = useUIStore((state) => state.toggleEmptySlots);
  const storeToggleTime = useUIStore((state) => state.toggleTime);
  const storeToggleStatus = useUIStore((state) => state.toggleStatus);
  const storeToggleTimeEstimate = useUIStore((state) => state.toggleTimeEstimate);

  const showEffortArea = propShowEffortArea ?? storeShowEffortArea;
  const showEffortVotes = propShowEffortVotes ?? storeShowEffortVotes;
  const showArchived = propShowArchived ?? storeShowArchived;
  const showFullDateInEffortTimes = propShowFullDate ?? storeShowFullDate;
  const focusMode = propFocusMode ?? storeFocusMode;
  const showEmptySlots = propShowEmptySlots ?? storeShowEmptySlots;
  const showTime = propShowTime ?? storeShowTime;
  const showStatus = propShowStatus ?? storeShowStatus;
  const showTimeEstimate = propShowTimeEstimate ?? storeShowTimeEstimate;

  const handleToggleEffortArea = () => {
    if (onToggleEffortArea) {
      onToggleEffortArea();
    } else {
      storeToggleEffortArea();
    }
  };

  const handleToggleEffortVotes = () => {
    if (onToggleEffortVotes) {
      onToggleEffortVotes();
    } else {
      storeToggleEffortVotes();
    }
  };

  const handleToggleArchived = () => {
    if (onToggleArchived) {
      onToggleArchived();
    } else {
      storeToggleArchived();
    }
  };

  const handleToggleFullDate = () => {
    if (onToggleFullDate) {
      onToggleFullDate();
    } else {
      storeToggleFullDate();
    }
  };

  const handleToggleFocusMode = () => {
    if (onToggleFocusMode) {
      onToggleFocusMode();
    } else {
      storeToggleFocusMode();
    }
  };

  const handleToggleEmptySlots = () => {
    if (onToggleEmptySlots) {
      onToggleEmptySlots();
    } else {
      storeToggleEmptySlots();
    }
  };

  const handleToggleTime = () => {
    if (onToggleTime) {
      onToggleTime();
    } else {
      storeToggleTime();
    }
  };

  const handleToggleStatus = () => {
    if (onToggleStatus) {
      onToggleStatus();
    } else {
      storeToggleStatus();
    }
  };

  const handleToggleTimeEstimate = () => {
    if (onToggleTimeEstimate) {
      onToggleTimeEstimate();
    } else {
      storeToggleTimeEstimate();
    }
  };

  const toggleButtonStyle: React.CSSProperties = {
    marginBottom: "8px",
    marginRight: "8px",
    padding: "4px 8px",
    cursor: "pointer",
    fontSize: "12px",
  };

  return (
    <div className="exocortex-daily-tasks-wrapper">
      <div className="exocortex-daily-tasks-controls">
        <button
          className="exocortex-toggle-effort-area"
          onClick={handleToggleEffortArea}
          style={toggleButtonStyle}
        >
          {showEffortArea ? "Hide" : "Show"} Effort Area
        </button>
        <button
          className="exocortex-toggle-effort-votes"
          onClick={handleToggleEffortVotes}
          style={toggleButtonStyle}
        >
          {showEffortVotes ? "Hide" : "Show"} Votes
        </button>
        <button
          className="exocortex-toggle-archived"
          onClick={handleToggleArchived}
          style={toggleButtonStyle}
        >
          {showArchived ? "Hide" : "Show"} Archived
        </button>
        <button
          className="exocortex-toggle-full-date"
          onClick={handleToggleFullDate}
          style={toggleButtonStyle}
        >
          {showFullDateInEffortTimes ? "HH:mm" : "MM-DD HH:mm"}
        </button>
        <button
          className="exocortex-toggle-focus-mode"
          onClick={handleToggleFocusMode}
          style={toggleButtonStyle}
        >
          {focusMode ? "\uD83C\uDFAF focused" : "\uD83C\uDFAF focus"}
        </button>
        <button
          className="exocortex-toggle-empty-slots"
          onClick={handleToggleEmptySlots}
          style={toggleButtonStyle}
        >
          {showEmptySlots ? "Hide" : "Show"} Empty Slots
        </button>
        <button
          className="exocortex-toggle-time"
          onClick={handleToggleTime}
          style={toggleButtonStyle}
        >
          {showTime ? "Hide" : "Show"} Time
        </button>
        <button
          className="exocortex-toggle-status"
          onClick={handleToggleStatus}
          style={toggleButtonStyle}
        >
          {showStatus ? "Hide" : "Show"} Status
        </button>
        <button
          className="exocortex-toggle-time-estimate"
          onClick={handleToggleTimeEstimate}
          style={{
            ...toggleButtonStyle,
            marginRight: undefined,
          }}
        >
          {showTimeEstimate ? "Hide" : "Show"} Time Est
        </button>
      </div>
      <DailyTasksTable
        {...props}
        showEffortArea={showEffortArea}
        showEffortVotes={showEffortVotes}
        showArchived={showArchived}
        showFullDateInEffortTimes={showFullDateInEffortTimes}
        focusMode={focusMode}
        showEmptySlots={showEmptySlots}
        showTime={showTime}
        showStatus={showStatus}
        showTimeEstimate={showTimeEstimate}
      />
    </div>
  );
};
