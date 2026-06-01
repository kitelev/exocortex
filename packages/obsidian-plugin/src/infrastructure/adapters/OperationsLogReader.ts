import type { App } from "obsidian";

import type { SwitchJournalEntry } from "./FocusProfileSwitchManager";

/**
 * OperationsLogReader — formats the B.4 switch journal для UI display
 * (RFC 0a0791c1 §B.8 Section 4 «Operations log»).
 *
 * Source data: \`.exocortex/switch-journal.jsonl\` (one JSON entry per line)
 * written by \`FocusProfileSwitchManager\` (B.4).
 *
 * UI requirement (Architect #11 / RFC §B.8 Section 4):
 *   «Last 10 switches displayed as `<timestamp> | <profile-label> | <elapsedMs>ms | <status>`»
 *
 * Profile labels are not in the journal (only UIDs are). The reader accepts
 * a \`labelLookup\` callback that resolves UID → label, with а fallback к
 * UID's first 8 chars when the asset is missing.
 */

export interface OperationsLogEntry {
  /** ISO timestamp of the entry — для UI sort + display. */
  ts: string;
  /** Profile UID. */
  targetUid: string;
  /** Resolved label (falls back to UID prefix). */
  profileLabel: string;
  /** «starting» / «completed» / «failed». */
  status: SwitchJournalEntry["phase"];
  /** ms duration; null если status≠completed (no elapsedMs recorded). */
  elapsedMs: number | null;
  /** Redacted error message; null если status≠failed. */
  error: string | null;
}

export interface OperationsLogReaderOptions {
  app: App;
  /** Journal path; defaults к \`.exocortex/switch-journal.jsonl\` (B.4 default). */
  journalPath?: string;
}

const DEFAULT_JOURNAL_PATH = ".exocortex/switch-journal.jsonl";

export class OperationsLogReader {
  private readonly app: App;
  private readonly journalPath: string;

  constructor(options: OperationsLogReaderOptions) {
    this.app = options.app;
    this.journalPath = options.journalPath ?? DEFAULT_JOURNAL_PATH;
  }

  /**
   * Read last \`limit\` switches from journal, newest first.
   *
   * @param limit Max entries to return. Default 10 (UI shows last 10).
   * @param labelLookup Optional UID → label resolver. Pass plugin's
   * profile-asset lookup; when omitted, label = UID[:8].
   */
  async readLast(
    limit = 10,
    labelLookup?: (uid: string) => string | null,
  ): Promise<OperationsLogEntry[]> {
    const lines = await this.readLines();
    if (lines.length === 0) return [];

    // Parse from end, accumulate up to `limit`
    const entries: OperationsLogEntry[] = [];
    for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
      const parsed = OperationsLogReader.parseLine(lines[i]);
      if (parsed === null) continue;
      const label = labelLookup ? labelLookup(parsed.targetUid) : null;
      entries.push({
        ts: parsed.ts,
        targetUid: parsed.targetUid,
        profileLabel: label ?? parsed.targetUid.slice(0, 8),
        status: parsed.phase,
        elapsedMs: parsed.elapsedMs ?? null,
        error: parsed.error ?? null,
      });
    }
    return entries;
  }

  /** Format an entry for plain-text display в UI. */
  static formatEntry(entry: OperationsLogEntry): string {
    const ts = entry.ts;
    const label = entry.profileLabel;
    const elapsed = entry.elapsedMs !== null ? `${entry.elapsedMs}ms` : "—";
    return `${ts} | ${label} | ${elapsed} | ${entry.status}`;
  }

  private async readLines(): Promise<string[]> {
    try {
      const exists = await this.app.vault.adapter.exists(this.journalPath);
      if (!exists) return [];
      const text = await this.app.vault.adapter.read(this.journalPath);
      return text.split("\n").filter((l) => l.trim().length > 0);
    } catch {
      return [];
    }
  }

  /**
   * Strict line parser. Returns null for malformed lines (caller skips them
   * — don't throw, log lines may be partially corrupt после crash).
   */
  static parseLine(line: string): SwitchJournalEntry | null {
    try {
      const parsed = JSON.parse(line) as Partial<SwitchJournalEntry>;
      if (
        typeof parsed.phase !== "string" ||
        typeof parsed.targetUid !== "string" ||
        typeof parsed.ts !== "string"
      ) {
        return null;
      }
      const phaseOk = parsed.phase === "starting" || parsed.phase === "completed" || parsed.phase === "failed";
      if (!phaseOk) return null;
      return parsed as SwitchJournalEntry;
    } catch {
      return null;
    }
  }
}
