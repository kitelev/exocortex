import { App, Modal } from "obsidian";
import type { BootstrapResultInfo } from "../../infrastructure/adapters/BootstrapAssetSpaceCommands";

/**
 * Action callbacks for the durable bootstrap-result panel. The panel owns no
 * business logic — its single forward action fires the injected callback, which
 * the plugin wires to the Add-AssetSpace flow pre-filled with the starter
 * registry (RFC 0002 §3.3 next-step nudge → §3.1 step 2).
 */
export interface BootstrapResultModalActions {
  /**
   * Next-step nudge — open «Add AssetSpace by URL» pre-filled with the public
   * starter-registry URL so the user can pull the starter content right away.
   * The user still reviews + confirms in that modal.
   */
  onAddStarterContent: () => void;
}

/**
 * BootstrapResultModal — the **durable, in-context** bootstrap result panel
 * (RFC 0002 §3.3, resolves P5).
 *
 * The bootstrap flow already fires an unconditional toast (`notifier.info` →
 * `new Notice`) plus an always-on activity-log entry, so feedback is NOT
 * missing. The residual UX gap (P5, rev-2-corrected) is that the toast is
 * **transient (~4-5 s)** and easy to miss mid-action, and the activity log is a
 * surface a first-run user won't think to open. This panel adds **durability**:
 * a persistent result the user can read after the toast fades, stating what
 * happened **and what to do next** — so the action dead-ends nowhere.
 *
 * It fires on the three terminal bootstrap outcomes that have a meaningful
 * "what next" (driven by {@link BootstrapResultInfo}):
 *   - `bootstrapped` — a cold bootstrap materialised the engine floor.
 *   - `fetched` — the EC2 clone-needs-fetch path restored tracked AssetSpaces.
 *   - `already-bootstrapped` — the guard fired on an already-set-up vault.
 *
 * It deliberately does NOT fire on hard failures / cancels — those are surfaced
 * by the toast, and a "next step" nudge would be wrong there (error-recovery is
 * P15, a separate scope).
 *
 * ## Accessibility (P16, §3.11)
 * - Native `<button>`s (keyboard-navigable, Enter/Space activation) with explicit
 *   `aria-label`s.
 * - Managed focus: the forward action (the most likely next move) is focused on
 *   open, guarded for jsdom / headless contexts.
 * - No icon/emoji-only signalling — every cue is plain text.
 */
export class BootstrapResultModal extends Modal {
  private readonly result: BootstrapResultInfo;
  private readonly actions: BootstrapResultModalActions;
  private firstFocusable: HTMLElement | null = null;

  constructor(
    app: App,
    result: BootstrapResultInfo,
    actions: BootstrapResultModalActions,
  ) {
    super(app);
    this.result = result;
    this.actions = actions;
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("bootstrap-result");

    const copy = resultCopy(this.result);

    contentEl.createEl("h2", {
      cls: "bootstrap-result-title",
      text: copy.title,
    });

    // The durable "what happened" line — survives the toast fade.
    contentEl.createEl("p", {
      cls: "bootstrap-result-summary",
      text: copy.summary,
    });

    // The "what to do next" nudge + a one-click forward action.
    contentEl.createEl("p", {
      cls: "bootstrap-result-next",
      text: copy.nextHint,
    });

    const actions = contentEl.createEl("div", {
      cls: "modal-button-container bootstrap-result-actions",
    });

    const nextBtn = actions.createEl("button", {
      cls: "mod-cta bootstrap-result-next-action",
      text: "Add the starter content",
    });
    nextBtn.setAttribute(
      "aria-label",
      "Add the starter content (opens a dialog pre-filled with the recommended starter registry)",
    );
    nextBtn.addEventListener("click", () => {
      // Close the panel first, then hand off — the Add-AssetSpace modal stacks
      // cleanly on its own rather than under a now-stale result panel.
      this.close();
      this.actions.onAddStarterContent();
    });
    this.firstFocusable = nextBtn;

    const doneBtn = actions.createEl("button", {
      cls: "bootstrap-result-done",
      text: "Done",
    });
    doneBtn.setAttribute("aria-label", "Close the setup result");
    doneBtn.addEventListener("click", () => this.close());

    // Managed focus (P16) — land on the forward action. Guarded: jsdom /
    // headless contexts may lack focus support.
    try {
      this.firstFocusable?.focus();
    } catch {
      /* focus is best-effort */
    }
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

interface ResultCopy {
  title: string;
  summary: string;
  nextHint: string;
}

/**
 * Map a {@link BootstrapResultInfo} to durable, plain-language panel copy. Pure
 * (no DOM / Obsidian) so the per-outcome wording is unit-testable in isolation.
 */
export function resultCopy(result: BootstrapResultInfo): ResultCopy {
  switch (result.kind) {
    case "bootstrapped":
      return {
        title: "Engine ready",
        summary:
          `The engine floor landed — ${result.folderName} @ ${result.sha}. ` +
          "Reload Obsidian if the new assets do not appear yet.",
        nextHint:
          "Next: add the starter content — a ready-to-use Areas → Projects → " +
          "Tasks structure.",
      };
    case "fetched":
      return {
        title: "Content restored",
        summary:
          `Restored ${result.fetched} of ${result.total} tracked AssetSpace(s) ` +
          "from their recorded URLs.",
        nextHint:
          "Next: add the starter content, or apply a profile to mount what you " +
          "need.",
      };
    case "already-bootstrapped":
      return {
        title: "Vault already set up",
        summary:
          "This vault already has AssetSpaces materialised — there is nothing " +
          "to bootstrap.",
        nextHint:
          "Next: add the starter content, or use «Add AssetSpace by URL» to " +
          "pull another AssetSpace.",
      };
  }
}
