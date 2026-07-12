import { TFile } from "obsidian";
import { ILogger } from '@plugin/adapters/logging/ILogger';
import { MetadataExtractor, IVaultAdapter, IFile } from "@kitelev/exocortex-core";

export interface DailyNoteInfo {
  isDailyNote: boolean;
  day: string | null;
}

// UUID-canon (RFC-004 follow-up, 2026-05-16): class TBox files are renamed
// to `<uid>.md`, so `exo__Instance_class` in instances is now stored as
// `[[<uid>]]`. The symbolic alternative is retained as a fallback for
// vaults that have not migrated yet.
const PN_DAILYNOTE_UID = "b04e7a3e-6b49-4984-9f8d-b74e9f36818b";

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
      (c: string | null) =>
        c === "[[pn__DailyNote]]" ||
        c === "pn__DailyNote" ||
        c === `[[${PN_DAILYNOTE_UID}]]` ||
        c === PN_DAILYNOTE_UID,
    );

    if (!isDailyNote) {
      return { isDailyNote: false, day: null };
    }

    const dayProperty = metadata.pn__DailyNote_day;
    if (!dayProperty) {
      // Fallback: derive day from basename when frontmatter lacks the
      // explicit property. obsidian-calendar-plugin and most daily-note
      // templates name files `YYYY-MM-DD*` (e.g. "2026-05-17 Note.md"),
      // so the basename prefix is a reliable source of truth. This keeps
      // the Tasks section rendering for daily notes created by templates
      // that don't populate `pn__DailyNote_day` (regression seen on
      // vault-2025 daily notes from 2025-11 onward).
      const basenameDay = DailyNoteHelpers.extractDayFromBasename(file);
      if (basenameDay) {
        return { isDailyNote: true, day: basenameDay };
      }
      logger?.debug("No pn__DailyNote_day or YYYY-MM-DD basename for daily note");
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

  /**
   * Extract a `YYYY-MM-DD` day from a filename basename like
   * `2026-05-17 Note.md`. Returns null if the basename does not begin
   * with that pattern.
   */
  private static extractDayFromBasename(file: TFile | IFile): string | null {
    const basename = file.basename;
    if (!basename) return null;
    const match = basename.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : null;
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

  /**
   * Checks if an effort was CLOSED on a given day (req b2a33efc / issue #3781):
   * its `ems__Effort_resolutionTimestamp` OR (fallback) its
   * `ems__Effort_endTimestamp` falls within the day's local-timezone interval.
   *
   * This is the "Closed today" signal, distinct from {@link isEffortInDay}
   * (which matches start/end/plannedStart/plannedEnd). Both a DONE closure (sets
   * end + resolution) and a TRASHED closure (sets ONLY resolution) surface here;
   * a Trashed-only effort carries no start/end/planned timestamp so is invisible
   * to `isEffortInDay` — this predicate is the one that catches it.
   *
   * The day interval is computed in LOCAL timezone (identical to
   * `isEffortInDay`): a store-side SPARQL `STRSTARTS` on the UTC `xsd:dateTime`
   * literal would match the UTC day, off-by-tz from the note's local day in the
   * window near local midnight (issue #3781 design fork — the TS interval match
   * is tz-correct).
   *
   * @param metadata - Effort frontmatter metadata
   * @param dayStr - Day string in format "YYYY-MM-DD" (e.g., "2025-11-02")
   * @returns true if resolution OR end timestamp falls within the day interval
   */
  static isEffortClosedInDay(
    metadata: Record<string, unknown>,
    dayStr: string,
  ): boolean {
    const parts = dayStr.split("-").map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) {
      return false; // Invalid day format
    }

    const [year, month, day] = parts;

    // Create the day interval in local timezone (month is 0-indexed).
    const dayStart = new Date(year, month - 1, day, 0, 0, 0, 0);
    if (isNaN(dayStart.getTime())) {
      return false; // Invalid date
    }
    const dayEnd = new Date(year, month - 1, day, 23, 59, 59, 999);

    // Closure signals only: resolution (primary) OR end (fallback). NOT
    // start/planned — those are "touched the day", not "closed on the day".
    const closureFields = [
      metadata.ems__Effort_resolutionTimestamp,
      metadata.ems__Effort_endTimestamp,
    ];

    for (const timestampValue of closureFields) {
      if (!timestampValue) continue; // Skip empty fields

      const timestamp = new Date(timestampValue as string | number);
      if (isNaN(timestamp.getTime())) {
        continue; // Skip invalid timestamps
      }

      if (timestamp >= dayStart && timestamp <= dayEnd) {
        return true;
      }
    }

    return false; // No closure timestamp in day interval
  }
}
