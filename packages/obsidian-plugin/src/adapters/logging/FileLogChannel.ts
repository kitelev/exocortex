import type { DataAdapter } from "obsidian";

const LOG_FILE_BASENAME = "exocortex-logs.txt";

// Rotate when current file exceeds this size on next flush.
// Keeps disk usage bounded to ~2 MB worst case (active + rotated).
const MAX_FILE_SIZE_BYTES = 1_000_000;

/**
 * Appends log lines to a file in the plugin data directory.
 * Uses Obsidian's DataAdapter (vault.adapter) for mobile compatibility.
 *
 * The log directory is the plugin's own data folder (Plugin.manifest.dir,
 * usually `<vault>/.obsidian/plugins/exocortex`), so the file is not part
 * of the user's notes, not picked up by Obsidian Sync as content, and not
 * indexed by SPARQL/file scanners that walk the vault root. The exact
 * config-dir prefix (`.obsidian` vs user-customised) follows whatever
 * Obsidian reports for this plugin.
 *
 * Size-based single-generation rotation: when the active file exceeds
 * MAX_FILE_SIZE_BYTES, it is renamed to `*.1` (overwriting any previous `.1`)
 * and a fresh file is started on the next write.
 */
export class FileLogChannel {
  private readonly logDir: string;
  private readonly logFilePath: string;
  private readonly rotatedFilePath: string;
  private buffer: string[] = [];
  private flushScheduled = false;
  private fileReady = false;

  /**
   * @param adapter - Obsidian DataAdapter (vault.adapter).
   * @param pluginDir - Plugin's data directory (`Plugin.manifest.dir`).
   *   Required: hardcoding `.obsidian` breaks for users with a customised
   *   `configDir` (e.g. `.obsidian-mobile`).
   */
  constructor(private readonly adapter: DataAdapter, pluginDir: string) {
    this.logDir = pluginDir;
    this.logFilePath = `${pluginDir}/${LOG_FILE_BASENAME}`;
    this.rotatedFilePath = `${this.logFilePath}.1`;
  }

  /**
   * Ensure the log directory and log file exist on disk. Must be called once
   * at startup before any log lines are flushed.
   *
   * Obsidian's DataAdapter.append() silently no-ops when the target file
   * does not exist (resolves without error), so we cannot rely on a
   * catch-and-create fallback inside flush(). The directory is created
   * explicitly because adapter.write() does not auto-create parents.
   */
  async ensureFileExists(): Promise<void> {
    try {
      const dirExists = await this.adapter.exists(this.logDir);
      if (!dirExists) {
        await this.adapter.mkdir(this.logDir);
      }
      const exists = await this.adapter.exists(this.logFilePath);
      if (!exists) {
        await this.adapter.write(this.logFilePath, "");
      }
      this.fileReady = true;
    } catch {
      // Best-effort — flush() will retry via write() if needed
    }
  }

  append(level: string, context: string, message: string): void {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${level.toUpperCase()}] [${context}] ${message}\n`;
    this.buffer.push(line);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    // Microtask batching — collects multiple log calls in the same tick
    queueMicrotask(() => {
      void this.flush();
    });
  }

  private async flush(): Promise<void> {
    const lines = this.buffer.join("");
    this.buffer = [];
    this.flushScheduled = false;
    if (!lines) return;

    await this.rotateIfNeeded();

    if (this.fileReady) {
      try {
        await this.adapter.append(this.logFilePath, lines);
      } catch {
        // Silently fail — file may have been deleted mid-session
      }
    } else {
      try {
        await this.adapter.write(this.logFilePath, lines);
        this.fileReady = true;
      } catch {
        // Silently fail
      }
    }
  }

  /**
   * Rotate the log file when it exceeds MAX_FILE_SIZE_BYTES. Single-generation:
   * the previous `.1` (if any) is removed before rename. Resets fileReady so
   * the next flush re-creates a fresh active file via write().
   */
  private async rotateIfNeeded(): Promise<void> {
    if (!this.fileReady) return;
    try {
      const stat = await this.adapter.stat(this.logFilePath);
      if (!stat || stat.size <= MAX_FILE_SIZE_BYTES) return;

      const rotatedExists = await this.adapter.exists(this.rotatedFilePath);
      if (rotatedExists) {
        await this.adapter.remove(this.rotatedFilePath);
      }
      await this.adapter.rename(this.logFilePath, this.rotatedFilePath);
      this.fileReady = false;
    } catch {
      // Best-effort — if stat/rename fails, continue with append
    }
  }
}
