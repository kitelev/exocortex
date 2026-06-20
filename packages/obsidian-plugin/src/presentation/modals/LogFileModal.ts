import { App, Modal } from "obsidian";

/**
 * Minimal contract the modal needs from the file-log sink — kept narrow so
 * the modal is unit-testable with a tiny fake (no full FileLogChannel / Obsidian
 * DataAdapter required). Implemented by {@link FileLogChannel}.
 */
export interface LogFileSource {
  /** Vault-relative path of the active log file (the plugin data folder). */
  getLogFilePath(): string;
  /** Current log file content; "" when the file is absent / unreadable. */
  read(): Promise<string>;
}

/**
 * Hint shown when the log file is empty/absent. File logging captures only
 * warn/error by default, so a healthy startup frequently has no file content —
 * this is not an error. Point the user at the live in-memory activity stream.
 */
export const EMPTY_LOG_HINT =
  "No file logs yet. By default only warnings and errors are written to this " +
  "file (enable Info under Settings → Exocortex → Log channels for verbose " +
  "logging). For the live activity stream, use the «Open activity log» button " +
  "below.";

/**
 * LogFileModal — surfaces the persisted `exocortex-logs.txt` (GitHub #3588 P12).
 *
 * The «Exocortex: Open log file (saved)» command opens this. It reconciles the
 * long-standing docs mismatch (the file was documented as living in the vault
 * root, but the sink is the plugin data folder, `FileLogChannel`): the modal
 * shows the REAL path at the top and the file content below, so the user never
 * has to hunt for it. Reads via the DataAdapter and renders pure DOM (no
 * Node/fs/git) → works identically on desktop and mobile (Desktop↔Mobile
 * Command Parity).
 */
export class LogFileModal extends Modal {
  private readonly source: LogFileSource;
  private readonly onOpenActivityLog?: () => void;
  private bodyEl: HTMLElement | null = null;
  private loadedText = "";

  /**
   * @param onOpenActivityLog Optional cross-navigation hook — when provided, the
   *   footer gains an «Open activity log» button that switches to the live
   *   in-memory `ActivityLogModal`. Reciprocal of `ActivityLogModal`'s «Open log
   *   file» button: each log view offers a one-click bridge to the other so the
   *   user who opened the wrong one does not have to return to the palette.
   */
  constructor(
    app: App,
    source: LogFileSource,
    onOpenActivityLog?: () => void,
  ) {
    super(app);
    this.source = source;
    this.onOpenActivityLog = onOpenActivityLog;
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Exocortex logs" });

    // The real sink location — the headline fix for P12. Monospace so the
    // path is copy-pasteable verbatim.
    contentEl.createEl("div", {
      cls: "exocortex-log-file-path",
      text: this.source.getLogFilePath(),
    });

    // Scrollable monospace body — reuses the activity-log scroller styling.
    const body = contentEl.createEl("div", {
      cls: "exocortex-activity-log-list",
    });
    this.bodyEl = body;
    body.createEl("div", {
      cls: "exocortex-activity-log-empty",
      text: "Loading…",
    });

    const footer = contentEl.createEl("div", {
      cls: "modal-button-container",
    });
    const copyBtn = footer.createEl("button", { cls: "mod-cta", text: "Copy" });
    copyBtn.addEventListener("click", () => {
      void this.copyToClipboard();
    });
    if (this.onOpenActivityLog) {
      // Cross-nav to the live activity stream. Close this modal first so the two
      // log views never stack on top of each other.
      const openActivityBtn = footer.createEl("button", {
        text: "Open activity log",
      });
      openActivityBtn.addEventListener("click", () => {
        this.close();
        this.onOpenActivityLog?.();
      });
    }
    const doneBtn = footer.createEl("button", { text: "Done" });
    doneBtn.addEventListener("click", () => {
      this.close();
    });

    void this.load();
  }

  override onClose(): void {
    this.bodyEl = null;
    this.loadedText = "";
    this.contentEl.empty();
  }

  /** Read the log file (best-effort) and render its content or the empty hint. */
  private async load(): Promise<void> {
    let text = "";
    try {
      text = await this.source.read();
    } catch {
      // read() is already best-effort, but guard the await for safety.
      text = "";
    }
    this.loadedText = text;
    const body = this.bodyEl;
    if (!body) return; // modal closed before the read resolved
    body.empty();
    if (text.trim().length === 0) {
      body.createEl("div", {
        cls: "exocortex-activity-log-empty",
        text: EMPTY_LOG_HINT,
      });
      return;
    }
    body.createEl("div", {
      cls: "exocortex-activity-log-row",
      text,
    });
    // Scroll to the newest lines (bottom) — they are the most relevant.
    body.scrollTop = body.scrollHeight;
  }

  /** Copy the loaded log content to the clipboard. Best-effort. */
  private async copyToClipboard(): Promise<void> {
    const text =
      this.loadedText.trim().length === 0
        ? `${this.source.getLogFilePath()}\n${EMPTY_LOG_HINT}`
        : this.loadedText;
    try {
      await navigator?.clipboard?.writeText(text);
    } catch {
      // Clipboard unavailable / denied — best-effort, no user-facing error.
    }
  }
}
