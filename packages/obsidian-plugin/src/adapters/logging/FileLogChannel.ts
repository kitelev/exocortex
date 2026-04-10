import type { DataAdapter } from "obsidian";

const LOG_FILE_NAME = "exocortex-logs.txt";

/**
 * Appends log lines to a file in the vault root.
 * Uses Obsidian's DataAdapter (vault.adapter) for mobile compatibility.
 */
export class FileLogChannel {
  private buffer: string[] = [];
  private flushScheduled = false;

  constructor(private readonly adapter: DataAdapter) {}

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
    // Fire-and-forget — logging should never block the caller
    void this.adapter.append(LOG_FILE_NAME, lines).catch(() => {
      // If file doesn't exist yet, create it then append
      void this.adapter.write(LOG_FILE_NAME, lines).catch(() => {
        // Silently fail — we can't log a logging failure
      });
    });
  }
}
