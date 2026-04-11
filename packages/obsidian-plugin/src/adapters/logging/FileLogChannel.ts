import type { DataAdapter } from "obsidian";

const LOG_FILE_NAME = "exocortex-logs.txt";

/**
 * Appends log lines to a file in the vault root.
 * Uses Obsidian's DataAdapter (vault.adapter) for mobile compatibility.
 */
export class FileLogChannel {
  private buffer: string[] = [];
  private flushScheduled = false;
  private fileReady = false;

  constructor(private readonly adapter: DataAdapter) {}

  /**
   * Ensure the log file exists on disk. Must be called once at startup
   * before any log lines are flushed.
   *
   * Obsidian's DataAdapter.append() silently no-ops when the target file
   * does not exist (resolves without error), so we cannot rely on a
   * catch-and-create fallback inside flush().
   */
  async ensureFileExists(): Promise<void> {
    try {
      const exists = await this.adapter.exists(LOG_FILE_NAME);
      if (!exists) {
        await this.adapter.write(LOG_FILE_NAME, "");
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
    queueMicrotask(() => this.flush());
  }

  private flush(): void {
    const lines = this.buffer.join("");
    this.buffer = [];
    this.flushScheduled = false;
    if (!lines) return;

    if (this.fileReady) {
      void this.adapter.append(LOG_FILE_NAME, lines).catch(() => {
        // Silently fail — file may have been deleted mid-session
      });
    } else {
      // File was not pre-created (ensureFileExists failed or was not called).
      // Write creates the file; subsequent flushes will use append.
      void this.adapter.write(LOG_FILE_NAME, lines)
        .then(() => { this.fileReady = true; })
        .catch(() => { /* Silently fail */ });
    }
  }
}
