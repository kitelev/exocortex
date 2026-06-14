import { App, Modal } from "obsidian";
import type {
  ActivityEntry,
  ActivityLogService,
} from "../../adapters/logging/ActivityLogService";

/**
 * Render one activity entry as a single monospace line:
 * `HH:MM:SS [category] message`, with an uppercased level marker for
 * warn/error (info is unmarked to keep the common case clean).
 */
export function formatActivityEntry(e: ActivityEntry): string {
  const d = new Date(e.ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const lvl = e.level === "info" ? "" : ` ${e.level.toUpperCase()}`;
  return `${hh}:${mm}:${ss} [${e.category}]${lvl} ${e.message}`;
}

/** Pixels of slack when deciding whether the list is "scrolled to bottom". */
const AUTOSCROLL_THRESHOLD_PX = 4;

/**
 * Should a newly-appended row scroll the list to the bottom? True only when the
 * user is already at (near) the bottom — a manual scroll-up pauses auto-scroll
 * so they can read history without being yanked down. An empty/unscrollable
 * list (clientHeight ≈ scrollHeight) counts as "at bottom".
 */
export function shouldAutoScroll(metrics: {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}): boolean {
  return (
    metrics.scrollTop + metrics.clientHeight >=
    metrics.scrollHeight - AUTOSCROLL_THRESHOLD_PX
  );
}

/**
 * ActivityLogModal — real-time view of plugin activity (GitHub #3540),
 * structurally modelled on Obsidian Sync's «Sync log»: header + scrollable
 * monospace list (oldest top, newest bottom) + Copy / Clear / Done footer.
 *
 * Backed by {@link ActivityLogService} (in-memory ring buffer + pub/sub):
 * `onOpen` renders the current snapshot and subscribes for live appends;
 * `onClose` unsubscribes. Pure DOM + in-memory buffer (no Node/fs/git) → works
 * identically on desktop and mobile (Desktop↔Mobile Command Parity).
 *
 * MVP intentionally omits the Sync-style category dropdown + text filter
 * (single chronological stream); they are a documented future enhancement.
 */
export class ActivityLogModal extends Modal {
  private readonly svc: ActivityLogService;
  private listEl: HTMLElement | null = null;
  private unsub: (() => void) | null = null;
  private unsubClear: (() => void) | null = null;

  constructor(app: App, svc: ActivityLogService) {
    super(app);
    this.svc = svc;
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Activity log" });

    // Bounded monospace scroller mirroring the Sync activity log body — styling
    // lives in styles.css (.exocortex-activity-log-list); the lint rule forbids
    // inline element.style assignments.
    const list = contentEl.createEl("div", {
      cls: "exocortex-activity-log-list",
    });
    this.listEl = list;

    this.renderSnapshot();

    const footer = contentEl.createEl("div", {
      cls: "modal-button-container",
    });
    const copyBtn = footer.createEl("button", {
      cls: "mod-cta",
      text: "Copy",
    });
    copyBtn.addEventListener("click", () => {
      void this.copyToClipboard();
    });
    const clearBtn = footer.createEl("button", { text: "Clear" });
    clearBtn.addEventListener("click", () => {
      // clear() fires the onClear subscription below → re-renders empty.
      this.svc.clear();
    });
    const doneBtn = footer.createEl("button", { text: "Done" });
    doneBtn.addEventListener("click", () => {
      this.close();
    });

    // Live updates: append new entries; re-render on external clear.
    this.unsub = this.svc.subscribe((entry) => this.appendRow(entry));
    this.unsubClear = this.svc.onClear(() => this.renderSnapshot());
  }

  override onClose(): void {
    this.unsub?.();
    this.unsubClear?.();
    this.unsub = null;
    this.unsubClear = null;
    this.listEl = null;
    this.contentEl.empty();
  }

  /** Clear and repopulate the list from the current snapshot. */
  private renderSnapshot(): void {
    const list = this.listEl;
    if (!list) return;
    list.empty();
    const snapshot = this.svc.getSnapshot();
    if (snapshot.length === 0) {
      list.createEl("div", {
        cls: "exocortex-activity-log-empty",
        text: "No activity recorded yet.",
      });
      return;
    }
    for (const entry of snapshot) {
      this.appendRow(entry);
    }
  }

  /** Append one row, auto-scrolling to bottom only if already at the bottom. */
  private appendRow(entry: ActivityEntry): void {
    const list = this.listEl;
    if (!list) return;
    // Drop the «no activity» placeholder once the first real row arrives.
    const placeholder = list.querySelector(".exocortex-activity-log-empty");
    if (placeholder) placeholder.remove();
    const atBottom = shouldAutoScroll({
      scrollTop: list.scrollTop,
      clientHeight: list.clientHeight,
      scrollHeight: list.scrollHeight,
    });
    list.createEl("div", {
      cls: "exocortex-activity-log-row",
      text: formatActivityEntry(entry),
    });
    if (atBottom) {
      list.scrollTop = list.scrollHeight;
    }
  }

  /** Copy the full buffered log (formatted) to the clipboard. Best-effort. */
  private async copyToClipboard(): Promise<void> {
    const text = this.svc
      .getSnapshot()
      .map(formatActivityEntry)
      .join("\n");
    try {
      await navigator?.clipboard?.writeText(text);
    } catch {
      // Clipboard unavailable / denied — best-effort, no user-facing error.
    }
  }
}
