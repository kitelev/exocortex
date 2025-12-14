interface EffortItem {
  isTrashed: boolean;
  isDone: boolean;
  metadata: Record<string, any>;
  startTime?: string;
}

interface TimestampItem {
  startTimestamp: string | number | null;
}

export class EffortSortingHelpers {
  /**
   * Extracts time portion (HH:mm:ss) from a timestamp.
   * Returns "00:00:00" if timestamp is null/invalid.
   */
  static getTimeFromTimestamp(timestamp: string | number | null): string {
    if (!timestamp) return "00:00:00";

    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return "00:00:00";

    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");

    return `${hours}:${minutes}:${seconds}`;
  }

  /**
   * Compares two items by their start time.
   * Tasks with specific time (not 00:00:00) come first, sorted by time ascending.
   * Tasks with 00:00:00 (no specific time) come last.
   */
  static sortByStartTime<T extends TimestampItem>(a: T, b: T): number {
    const timeA = EffortSortingHelpers.getTimeFromTimestamp(a.startTimestamp);
    const timeB = EffortSortingHelpers.getTimeFromTimestamp(b.startTimestamp);

    const aIsZero = timeA === "00:00:00";
    const bIsZero = timeB === "00:00:00";

    // Tasks without time (00:00:00) go to the end
    if (aIsZero && !bIsZero) return 1;
    if (!aIsZero && bIsZero) return -1;

    // Both with time or both without - sort by time ascending
    return timeA.localeCompare(timeB);
  }

  static sortByPriority<T extends EffortItem>(a: T, b: T): number {
    if (a.isTrashed !== b.isTrashed) {
      return a.isTrashed ? 1 : -1;
    }

    if (a.isDone !== b.isDone) {
      return a.isDone ? 1 : -1;
    }

    const aVotes =
      typeof a.metadata.ems__Effort_votes === "number"
        ? a.metadata.ems__Effort_votes
        : 0;
    const bVotes =
      typeof b.metadata.ems__Effort_votes === "number"
        ? b.metadata.ems__Effort_votes
        : 0;

    if (aVotes !== bVotes) {
      return bVotes - aVotes;
    }

    if (a.startTime && b.startTime) {
      return a.startTime.localeCompare(b.startTime);
    }

    if (a.startTime) return -1;
    if (b.startTime) return 1;

    return 0;
  }
}
