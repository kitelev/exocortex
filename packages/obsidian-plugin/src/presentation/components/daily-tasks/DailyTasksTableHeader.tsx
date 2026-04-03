import React from "react";

interface DailyTasksTableHeaderProps {
  showTime: boolean;
  showStatus: boolean;
  showEffortArea: boolean;
  showEffortVotes: boolean;
  showTimeEstimate: boolean;
  sortState: { column: string | null; order: "asc" | "desc" };
  onSort: (column: string) => void;
}

const SortIndicator: React.FC<{ column: string; sortState: { column: string | null; order: "asc" | "desc" } }> = ({
  column,
  sortState,
}) => {
  if (sortState.column !== column) return null;
  return <>{sortState.order === "asc" ? "\u2191" : "\u2193"}</>;
};

export const DailyTasksTableHeader: React.FC<DailyTasksTableHeaderProps> = ({
  showTime,
  showStatus,
  showEffortArea,
  showEffortVotes,
  showTimeEstimate,
  sortState,
  onSort,
}) => (
  <thead>
    <tr>
      <th
        onClick={() => onSort("name")}
        className="sortable task-name-header"
        style={{ cursor: "pointer" }}
      >
        Name <SortIndicator column="name" sortState={sortState} />
      </th>
      {showTime && (
        <>
          <th
            onClick={() => onSort("start")}
            className="sortable task-start-header"
            style={{ cursor: "pointer" }}
          >
            Start <SortIndicator column="start" sortState={sortState} />
          </th>
          <th
            onClick={() => onSort("end")}
            className="sortable task-end-header"
            style={{ cursor: "pointer" }}
          >
            End <SortIndicator column="end" sortState={sortState} />
          </th>
        </>
      )}
      {showStatus && (
        <th
          onClick={() => onSort("status")}
          className="sortable task-status-header"
          style={{ cursor: "pointer" }}
        >
          Status <SortIndicator column="status" sortState={sortState} />
        </th>
      )}
      {showEffortArea && (
        <th
          onClick={() => onSort("effortArea")}
          className="sortable task-effort-area-header"
          style={{ cursor: "pointer" }}
        >
          Effort Area <SortIndicator column="effortArea" sortState={sortState} />
        </th>
      )}
      {showEffortVotes && (
        <th
          onClick={() => onSort("votes")}
          className="sortable task-votes-header"
          style={{ cursor: "pointer" }}
        >
          Votes <SortIndicator column="votes" sortState={sortState} />
        </th>
      )}
      {showTimeEstimate && (
        <th
          onClick={() => onSort("timeEstimate")}
          className="sortable task-time-estimate-header"
          style={{ cursor: "pointer" }}
        >
          Time <SortIndicator column="timeEstimate" sortState={sortState} />
        </th>
      )}
    </tr>
  </thead>
);

interface DailyTasksColGroupProps {
  showTime: boolean;
  showStatus: boolean;
  showEffortArea: boolean;
  showEffortVotes: boolean;
  showTimeEstimate: boolean;
  nameColumnWidth?: number;
  forBody?: boolean;
}

export const DailyTasksColGroup: React.FC<DailyTasksColGroupProps> = ({
  showTime,
  showStatus,
  showEffortArea,
  showEffortVotes,
  showTimeEstimate,
  nameColumnWidth,
  forBody = false,
}) => (
  <colgroup>
    <col
      className="col-name"
      style={forBody && nameColumnWidth ? { width: `${nameColumnWidth}px` } : undefined}
    />
    {showTime && (
      <>
        <col className="col-start" style={{ width: "90px" }} />
        <col className="col-end" style={{ width: "90px" }} />
      </>
    )}
    {showStatus && <col className="col-status" style={{ width: "100px" }} />}
    {showEffortArea && <col className="col-effort-area" style={{ width: "120px" }} />}
    {showEffortVotes && <col className="col-votes" style={{ width: "70px" }} />}
    {showTimeEstimate && <col className="col-time-estimate" style={{ width: "80px" }} />}
  </colgroup>
);
