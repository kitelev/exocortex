/**
 * ActivityLogService — in-memory, event-driven activity stream for the
 * «Exocortex: Open activity log» command (GitHub #3540).
 *
 * A bounded ring buffer of recent plugin activity (ExoSync steps, profile
 * apply/materialize phases, AssetSpace mount/unmount, bootstrap) plus a
 * pub/sub so an open {@link ActivityLogModal} can append rows in real time.
 *
 * Design notes:
 *  - **Always-on from onload.** A single instance is created in
 *    `ExocortexPlugin.onload()` and hoisted on the plugin so every activity
 *    source can `record(...)` regardless of whether the modal is open. Opening
 *    the modal later still shows the history of the current session (AC3).
 *  - **Ephemeral.** No persistence — the buffer is cleared on plugin reload.
 *    The durable `exocortex-logs.txt` file sink (#3498) stays an independent
 *    opt-in concern; this service does not write to disk.
 *  - **No Node/Obsidian dependency** — pure data structure, so the command
 *    works identically on desktop and mobile (Desktop↔Mobile Command Parity).
 *  - **Errors are a `level`, not a category** — an ExoSync failure stays
 *    `category:"exosync"` with `level:"error"`.
 */

export type ActivityCategory = "exosync" | "profile" | "mount" | "bootstrap";
export type ActivityLevel = "info" | "warn" | "error";

export interface ActivityEntry {
  /** Epoch millis the entry was recorded. */
  ts: number;
  category: ActivityCategory;
  level: ActivityLevel;
  message: string;
}

/** Caller-supplied fields; `ts` is stamped by the service. */
export type ActivityRecordInput = Omit<ActivityEntry, "ts">;

/** Default ring-buffer capacity (oldest entries evicted past this). */
const DEFAULT_CAPACITY = 1000;

export interface ActivityLogServiceOptions {
  /** Ring-buffer capacity. Non-positive / missing → {@link DEFAULT_CAPACITY}. */
  capacity?: number;
  /** Injectable clock for deterministic tests. Defaults to `Date.now`. */
  now?: () => number;
}

export class ActivityLogService {
  private readonly buffer: ActivityEntry[] = [];
  private readonly capacity: number;
  private readonly clock: () => number;
  private readonly subscribers = new Set<(entry: ActivityEntry) => void>();
  private readonly clearSubscribers = new Set<() => void>();

  constructor(options: ActivityLogServiceOptions = {}) {
    this.capacity =
      options.capacity && options.capacity > 0
        ? options.capacity
        : DEFAULT_CAPACITY;
    this.clock = options.now ?? (() => Date.now());
  }

  /**
   * Append an entry to the buffer (evicting the oldest past capacity) and
   * notify subscribers. Subscriber errors are isolated so one bad listener
   * cannot break recording or starve the others.
   */
  record(input: ActivityRecordInput): void {
    const entry: ActivityEntry = {
      ts: this.clock(),
      category: input.category,
      level: input.level,
      message: input.message,
    };
    this.buffer.push(entry);
    if (this.buffer.length > this.capacity) {
      this.buffer.splice(0, this.buffer.length - this.capacity);
    }
    for (const cb of this.subscribers) {
      try {
        cb(entry);
      } catch {
        // Isolate subscriber failures — a broken modal listener must not
        // break the activity stream for other listeners or the producer.
      }
    }
  }

  /**
   * Subscribe to newly recorded entries. Returns an unsubscribe function.
   * Does NOT replay the existing buffer — call {@link getSnapshot} for that.
   */
  subscribe(cb: (entry: ActivityEntry) => void): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  /** Subscribe to `clear()` events. Returns an unsubscribe function. */
  onClear(cb: () => void): () => void {
    this.clearSubscribers.add(cb);
    return () => {
      this.clearSubscribers.delete(cb);
    };
  }

  /** Current buffer as an immutable copy (for initial modal render). */
  getSnapshot(): readonly ActivityEntry[] {
    return this.buffer.slice();
  }

  /** Empty the buffer and notify clear-subscribers. */
  clear(): void {
    this.buffer.length = 0;
    for (const cb of this.clearSubscribers) {
      try {
        cb();
      } catch {
        // Isolate subscriber failures (see record()).
      }
    }
  }

  /** Number of entries currently buffered. */
  get size(): number {
    return this.buffer.length;
  }
}
