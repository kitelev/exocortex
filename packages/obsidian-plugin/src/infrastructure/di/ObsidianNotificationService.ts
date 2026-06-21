import { INotificationService } from "@kitelev/exocortex-core";
import { Notice } from "obsidian";
import type { ActivityLevel } from "../../adapters/logging/ActivityLogService";

/**
 * Sink that records a user-facing notification into the activity log (#3540).
 * Receives the activity `level` + the plain message (no toast emoji prefix —
 * the log renders its own level marker).
 */
export type NotificationActivityRecorder = (record: {
  level: ActivityLevel;
  message: string;
}) => void;

/**
 * Module-level default recorder. Set once in `ExocortexPlugin.onload()` so that
 * EVERY `ObsidianNotificationService` instance — including those constructed
 * inside command flows that never receive the plugin's `activityLog` (the
 * exocmd palette flow, `CommandManager`) — fans its toasts into the same
 * always-on buffer. This is the safety net that makes the activity log
 * complete: the bug it fixes was precisely that only a handful of producers
 * recorded, while the central toast sink did not. Explicit constructor
 * injection (used by unit tests) takes precedence over this default.
 */
let defaultActivityRecorder: NotificationActivityRecorder | undefined;

/** Wire (or clear, on plugin unload) the module-level default recorder. */
export function setDefaultNotificationActivityRecorder(
  recorder: NotificationActivityRecorder | undefined,
): void {
  defaultActivityRecorder = recorder;
}

export class ObsidianNotificationService implements INotificationService {
  private readonly DEFAULT_DURATION = 4000;
  private readonly recordActivity?: NotificationActivityRecorder;

  /**
   * @param options.recordActivity Explicit activity-log sink. When omitted the
   *   instance falls back to the module-level default recorder (see
   *   {@link setDefaultNotificationActivityRecorder}), so toasts are logged even
   *   when this service is built without direct access to the plugin's
   *   `activityLog`.
   */
  constructor(options?: { recordActivity?: NotificationActivityRecorder }) {
    this.recordActivity = options?.recordActivity;
  }

  /**
   * Fan one toast into the activity log. Resolves the explicit recorder first,
   * then the module default. Isolated so a recorder failure can never break the
   * user-facing Notice (the toast must still show).
   */
  private record(level: ActivityLevel, message: string): void {
    const sink = this.recordActivity ?? defaultActivityRecorder;
    if (!sink) return;
    try {
      sink({ level, message });
    } catch {
      // Recording must never break the toast — swallow listener failures.
    }
  }

  info(message: string, duration?: number): void {
    console.debug("[Exocortex] info:", message);
    this.record("info", message);
    new Notice(message, duration || this.DEFAULT_DURATION);
  }

  success(message: string, duration?: number): void {
    console.debug("[Exocortex] success:", message);
    this.record("info", message);
    new Notice(`✓ ${message}`, duration || this.DEFAULT_DURATION);
  }

  error(message: string, duration?: number): void {
    console.error("[Exocortex] error:", message);
    this.record("error", message);
    new Notice(`✗ ${message}`, duration || this.DEFAULT_DURATION);
  }

  warn(message: string, duration?: number): void {
    console.warn("[Exocortex] warn:", message);
    this.record("warn", message);
    new Notice(`⚠ ${message}`, duration || this.DEFAULT_DURATION);
  }

  async confirm(title: string, message: string): Promise<boolean> {
    return new Promise((resolve) => {
      const modal = document.createElement("div");
      modal.className = "modal-container mod-confirmation";

      const modalContent = document.createElement("div");
      modalContent.className = "modal";

      const titleEl = document.createElement("div");
      titleEl.className = "modal-title";
      titleEl.textContent = title;

      const messageEl = document.createElement("div");
      messageEl.className = "modal-content";
      messageEl.textContent = message;

      const buttonContainer = document.createElement("div");
      buttonContainer.className = "modal-button-container";

      const confirmButton = document.createElement("button");
      confirmButton.className = "mod-cta";
      confirmButton.textContent = "Confirm";
      confirmButton.onclick = () => {
        modal.remove();
        resolve(true);
      };

      const cancelButton = document.createElement("button");
      cancelButton.textContent = "Cancel";
      cancelButton.onclick = () => {
        modal.remove();
        resolve(false);
      };

      buttonContainer.appendChild(confirmButton);
      buttonContainer.appendChild(cancelButton);

      modalContent.appendChild(titleEl);
      modalContent.appendChild(messageEl);
      modalContent.appendChild(buttonContainer);

      modal.appendChild(modalContent);
      document.body.appendChild(modal);
    });
  }
}
