import { App, Modal } from "obsidian";

/**
 * SimpleConfirmModal — a generic yes/no confirmation gate.
 *
 * Used by the Phase 6.2 bootstrap «clone-needs-fetch» (EC2) flow to confirm a
 * batch re-materialisation. Resolves `true` only on the explicit confirm button;
 * Esc / Cancel / any close path resolves `false`. The promise resolves exactly
 * once.
 */
export class SimpleConfirmModal extends Modal {
  private resolved = false;
  private readonly title: string;
  private readonly body: string;
  private readonly confirmLabel: string;
  private readonly resolveFn: (approved: boolean) => void;

  constructor(
    app: App,
    opts: { title: string; body: string; confirmLabel?: string },
    resolve: (approved: boolean) => void,
  ) {
    super(app);
    this.title = opts.title;
    this.body = opts.body;
    this.confirmLabel = opts.confirmLabel ?? "Confirm";
    this.resolveFn = resolve;
  }

  private settle(value: boolean): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolveFn(value);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: this.title });
    contentEl.createEl("p", { text: this.body });

    const actions = contentEl.createEl("div", {
      cls: "modal-button-container",
    });
    const cancelBtn = actions.createEl("button", { text: "Cancel" });
    cancelBtn.setAttribute("aria-label", "Cancel");
    cancelBtn.addEventListener("click", () => {
      this.settle(false);
      this.close();
    });
    const confirmBtn = actions.createEl("button", {
      cls: "mod-cta",
      text: this.confirmLabel,
    });
    // a11y (RFC 0002 §3.11 / P16) — name the confirm action for screen readers.
    confirmBtn.setAttribute("aria-label", this.confirmLabel);
    confirmBtn.addEventListener("click", () => {
      this.settle(true);
      this.close();
    });

    // Managed focus (P16, §3.11) — this is a non-destructive proceed gate
    // (mod-cta), so land focus on the primary action. Focus-trap + Esc-close
    // are provided by Obsidian's Modal base. Guarded for jsdom / headless.
    try {
      confirmBtn.focus();
    } catch {
      /* focus is best-effort */
    }
  }

  override onClose(): void {
    this.settle(false);
    this.contentEl.empty();
  }
}
