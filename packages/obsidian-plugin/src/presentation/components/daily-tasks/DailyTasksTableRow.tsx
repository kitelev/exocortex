import React from "react";
import type { DailyTask, WikiLink } from './types';
import {
  calculateTimeFromTimestamps,
  formatTimeEstimate,
  formatTimeDisplay,
  getDisplayName,
  parseWikiLink,
} from './helpers';

interface DailyTasksTableRowProps {
  task: DailyTask;
  index: number;
  style?: React.CSSProperties;
  showTime: boolean;
  showStatus: boolean;
  showEffortArea: boolean;
  showEffortVotes: boolean;
  showTimeEstimate: boolean;
  showFullDateInEffortTimes: boolean;
  hasOverlap: boolean;
  onTaskClick?: (path: string, event: React.MouseEvent) => void;
  getAssetLabel?: (path: string) => string | null;
  getEffortArea?: (metadata: Record<string, unknown>) => string | null;
}

export const DailyTasksTableRow: React.FC<DailyTasksTableRowProps> = ({
  task,
  index,
  style,
  showTime,
  showStatus,
  showEffortArea,
  showEffortVotes,
  showTimeEstimate,
  showFullDateInEffortTimes,
  hasOverlap,
  onTaskClick,
  getAssetLabel,
  getEffortArea,
}) => {
  if (task.isEmptySlot) {
    return (
      <tr
        key={`${task.path}-${index}`}
        data-path={task.path}
        data-empty-slot="true"
        className="empty-slot-row"
        style={{
          ...style,
          opacity: 0.5,
        }}
      >
        <td className="task-name empty-slot-cell">-</td>
        {showTime && (
          <>
            <td className="task-start empty-slot-cell">
              {formatTimeDisplay(task.startTimestamp, task.startTime, showFullDateInEffortTimes)}
            </td>
            <td className="task-end empty-slot-cell">
              {formatTimeDisplay(task.endTimestamp, task.endTime, showFullDateInEffortTimes)}
            </td>
          </>
        )}
        {showStatus && <td className="task-status empty-slot-cell">-</td>}
        {showEffortArea && <td className="task-effort-area empty-slot-cell">-</td>}
        {showEffortVotes && <td className="task-effort-votes empty-slot-cell">-</td>}
        {showTimeEstimate && (
          <td className="task-time-estimate empty-slot-cell">
            {formatTimeEstimate(calculateTimeFromTimestamps(task.metadata))}
          </td>
        )}
      </tr>
    );
  }

  let effortArea: unknown = null;
  if (getEffortArea) {
    effortArea = getEffortArea(task.metadata);
  }
  if (!effortArea) {
    effortArea = task.metadata.ems__Effort_area;
  }

  let effortAreaParsed: WikiLink | null = null;
  if (effortArea) {
    const effortAreaStr = String(effortArea);
    if (/\[\[.*?\]\]/.test(effortAreaStr)) {
      effortAreaParsed = parseWikiLink(effortAreaStr);
    } else if (effortAreaStr.includes("|")) {
      const parts = effortAreaStr.split("|");
      effortAreaParsed = {
        target: parts[0].trim(),
        alias: parts[1]?.trim(),
      };
    } else {
      effortAreaParsed = { target: effortAreaStr.trim() };
    }
  }

  const displayName = getDisplayName(task, getAssetLabel);

  return (
    <tr
      key={`${task.path}-${index}`}
      data-path={task.path}
      className={hasOverlap ? "task-overlap-conflict" : undefined}
      style={style}
    >
      <td className="task-name" title={displayName}>
        <a
          data-href={task.path}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onTaskClick?.(task.path, e);
          }}
          className="internal-link"
          style={{ cursor: "pointer" }}
          title={displayName}
        >
          {displayName}
        </a>
      </td>
      {showTime && (
        <>
          <td className="task-start">
            {formatTimeDisplay(task.startTimestamp, task.startTime, showFullDateInEffortTimes)}
          </td>
          <td className="task-end">
            {formatTimeDisplay(task.endTimestamp, task.endTime, showFullDateInEffortTimes)}
          </td>
        </>
      )}
      {showStatus && (
        <td className="task-status">
          {task.status
            ? (() => {
                const isWikiLink =
                  typeof task.status === "string" &&
                  /\[\[.*?\]\]/.test(task.status);
                const parsed = isWikiLink
                  ? parseWikiLink(task.status)
                  : { target: task.status };
                const displayText = parsed.alias || parsed.target;

                return (
                  <a
                    data-href={parsed.target}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onTaskClick?.(parsed.target, e);
                    }}
                    className="internal-link"
                    style={{ cursor: "pointer" }}
                  >
                    {displayText}
                  </a>
                );
              })()
            : "-"}
        </td>
      )}
      {showEffortArea && (
        <td className="task-effort-area">
          {effortAreaParsed ? (
            <a
              data-href={effortAreaParsed.target}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onTaskClick?.(effortAreaParsed.target, e);
              }}
              className="internal-link"
              style={{ cursor: "pointer" }}
            >
              {getAssetLabel?.(effortAreaParsed.target) ||
                effortAreaParsed.alias ||
                effortAreaParsed.target}
            </a>
          ) : (
            "-"
          )}
        </td>
      )}
      {showEffortVotes && (
        <td className="task-effort-votes">
          {typeof task.metadata.ems__Effort_votes === "number"
            ? task.metadata.ems__Effort_votes
            : "-"}
        </td>
      )}
      {showTimeEstimate && (
        <td className="task-time-estimate">
          {formatTimeEstimate(
            (task.metadata.ems__Effort_timeEstimateMinutes as number | null | undefined)
              ?? calculateTimeFromTimestamps(task.metadata)
          )}
        </td>
      )}
    </tr>
  );
};
