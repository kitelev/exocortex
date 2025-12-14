import { TFile } from "obsidian";
import { ILogger } from '@plugin/adapters/logging/ILogger';
import { MetadataExtractor, IVaultAdapter, IFile } from "exocortex";

export interface DailyNoteInfo {
  isDailyNote: boolean;
  day: string | null;
}

export class DailyNoteHelpers {
  /**
   * Checks if a file is a daily note and extracts the day property
   */
  static extractDailyNoteInfo(
    file: TFile | IFile,
    metadataExtractor: MetadataExtractor,
    logger?: ILogger,
  ): DailyNoteInfo {
    const metadata = metadataExtractor.extractMetadata(file);
    const instanceClass = metadataExtractor.extractInstanceClass(metadata);

    const classes = Array.isArray(instanceClass)
      ? instanceClass
      : [instanceClass];
    const isDailyNote = classes.some(
      (c: string | null) => c === "[[pn__DailyNote]]" || c === "pn__DailyNote",
    );

    if (!isDailyNote) {
      return { isDailyNote: false, day: null };
    }

    const dayProperty = metadata.pn__DailyNote_day;
    if (!dayProperty) {
      logger?.debug("No pn__DailyNote_day found for daily note");
      return { isDailyNote: true, day: null };
    }

    const dayMatch =
      typeof dayProperty === "string"
        ? dayProperty.match(/\[\[(.+?)\]\]/)
        : null;
    const day = dayMatch
      ? dayMatch[1]
      : String(dayProperty).replace(/^\[\[|\]\]$/g, "");

    return { isDailyNote: true, day };
  }

  static findDailyNoteByDate(
    vaultAdapter: IVaultAdapter,
    metadataExtractor: MetadataExtractor,
    dateStr: string,
  ): IFile | null {
    const files = vaultAdapter.getAllFiles();

    for (const file of files) {
      const dailyNoteInfo = this.extractDailyNoteInfo(
        file,
        metadataExtractor,
      );

      if (dailyNoteInfo.isDailyNote && dailyNoteInfo.day === dateStr) {
        return file;
      }
    }

    return null;
  }

  /**
   * Checks if an effort (task/project) should appear in a given day
   * based on timestamp fields falling within day's interval
   *
   * @param metadata - Effort frontmatter metadata
   * @param dayStr - Day string in format "YYYY-MM-DD" (e.g., "2025-11-02")
   * @returns true if ANY timestamp falls within day's 00:00:00 - 23:59:59 interval (local timezone)
   */
  static isEffortInDay(
    metadata: Record<string, unknown>,
    dayStr: string,
  ): boolean {
    // Parse day string to Date in local timezone
    // Split "YYYY-MM-DD" and use Date constructor with year, month, day
    const parts = dayStr.split("-").map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) {
      return false; // Invalid day format
    }
    
    const [year, month, day] = parts;
    
    // Create date in local timezone (month is 0-indexed)
    const dayStart = new Date(year, month - 1, day, 0, 0, 0, 0);
    if (isNaN(dayStart.getTime())) {
      return false; // Invalid date
    }

    const dayEnd = new Date(year, month - 1, day, 23, 59, 59, 999);

    // Collect all timestamp fields
    const timestampFields = [
      metadata.ems__Effort_startTimestamp,
      metadata.ems__Effort_endTimestamp,
      metadata.ems__Effort_plannedStartTimestamp,
      metadata.ems__Effort_plannedEndTimestamp,
    ];

    // Check if ANY timestamp falls within day interval
    for (const timestampValue of timestampFields) {
      if (!timestampValue) continue; // Skip empty fields

      const timestamp = new Date(timestampValue as string | number);
      if (isNaN(timestamp.getTime())) {
        continue; // Skip invalid timestamps
      }

      // Check if timestamp in day interval
      if (timestamp >= dayStart && timestamp <= dayEnd) {
        return true;
      }
    }

    return false; // No timestamps in day interval
  }
}
