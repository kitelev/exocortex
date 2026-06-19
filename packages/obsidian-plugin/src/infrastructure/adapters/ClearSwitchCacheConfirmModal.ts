import { App, Modal } from "obsidian";

/**
 * ClearSwitchCacheConfirmModal — destructive-op confirm gate for the
 * `Exocortex: Clear switch cache` palette command (RFC 22b50a17 Decision #6).
 *
 * Wipe-all semantics: removes ALL cached AssetSpace tarballs across all
 * profiles. Operation cannot be undone — modal surfaces summary stats
 * (count + total size) before user commits.
 *
 * Resolves `true` only when the user clicks the explicit «Clear» button
 * (`mod-warning` class). Esc / Cancel / any close path resolves `false`
 * to abort. Promise resolves exactly once even if user clicks before
 * Obsidian's teardown lifecycle.
 */
export class ClearSwitchCacheConfirmModal extends Modal {
  private resolved = false;
  private readonly entryCount: number;
  private readonly totalSize: number;
  private readonly resolveFn: (approved: boolean) => void;

  constructor(
    app: App,
    summary: { entryCount: number; totalSize: number },
    resolve: (approved: boolean) => void,
  ) {
    super(app);
    this.entryCount = summary.entryCount;
    this.totalSize = summary.totalSize;
    this.resolveFn = resolve;
  }

  private settle(value: boolean): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolveFn(value);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", {
      cls: "clear-switch-cache-title",
      text: "Clear switch cache?",
    });
    // a11y (RFC 0002 §3.11 / P16): id this consequence line (count + size +
    // irreversibility) so the destructive Clear button can reference it via
    // aria-describedby — a screen-reader user hears the impact, not only the
    // button name.
    const consequenceId = "clear-switch-cache-consequence";
    const consequenceEl = contentEl.createEl("p", {
      text:
        `${this.entryCount} cached AssetSpace ${this.entryCount === 1 ? "entry" : "entries"} ` +
        `will be removed (${formatBytes(this.totalSize)}). This cannot be undone.`,
    });
    consequenceEl.setAttribute("id", consequenceId);
    contentEl.createEl("p", {
      cls: "clear-switch-cache-detail",
      text:
        "Wipe-all semantics per RFC 22b50a17 Decision #6 — no per-profile " +
        "selection. Cached profiles will require fresh pulls on next switch.",
    });

    const actions = contentEl.createEl("div", {
      cls: "modal-button-container clear-switch-cache-actions",
    });

    const cancelBtn = actions.createEl("button", { text: "Cancel" });
    cancelBtn.setAttribute(
      "aria-label",
      "Cancel — keep the cached profiles",
    );
    cancelBtn.addEventListener("click", () => {
      this.settle(false);
      this.close();
    });

    const confirmBtn = actions.createEl("button", {
      cls: "mod-warning",
      text: "Clear",
    });
    // a11y (RFC 0002 §3.11 / P16): destructive intent via `mod-warning` styling
    // AND this text marker (never a glyph alone) for assistive tech.
    confirmBtn.setAttribute(
      "aria-label",
      "Clear — permanently remove all cached profiles (cannot be undone)",
    );
    confirmBtn.setAttribute("aria-describedby", consequenceId);
    confirmBtn.addEventListener("click", () => {
      this.settle(true);
      this.close();
    });

    // Managed focus (P16, §3.11) — DESTRUCTIVE confirm lands on the safe default
    // (Cancel), not the irreversible wipe. Focus-trap + Esc-close come from
    // Obsidian's Modal base. Guarded for jsdom / headless contexts.
    try {
      cancelBtn.focus();
    } catch {
      /* focus is best-effort */
    }
  }

  override onClose(): void {
    // If user dismissed without explicit Clear, treat as Cancel.
    this.settle(false);
    this.contentEl.empty();
  }
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
