import { App, Modal } from "obsidian";
import type {
  BootstrapResultInfo,
  BootstrapFailureCause,
  BootstrapOperation,
} from "../../infrastructure/adapters/BootstrapAssetSpaceCommands";

/**
 * Action callbacks for the durable bootstrap-result panel. The panel owns no
 * business logic — its forward actions fire the injected callbacks, which the
 * plugin wires to the Add-AssetSpace flow (success nudge) and to re-running the
 * failed operation (failure recovery).
 */
export interface BootstrapResultModalActions {
  /**
   * Next-step nudge (success outcomes, §3.3) — open «Add AssetSpace by URL»
   * pre-filled with the public starter-registry URL so the user can pull the
   * starter content right away. The user still reviews + confirms in that modal.
   */
  onAddStarterContent: () => void;
  /**
   * Failure recovery (§3.10) — re-run the operation that failed (bootstrap OR
   * add-AssetSpace), so a wrong URL / dropped network / mis-scoped token is one
   * click to retry after the user fixes it. Optional — when absent the failure
   * panel shows the cause + recovery text without a retry button.
   */
  onRetry?: (operation: BootstrapOperation) => void;
}

/**
 * BootstrapResultModal — the **durable, in-context** bootstrap result panel
 * (RFC 0002 §3.3 + §3.10).
 *
 * The bootstrap flow already fires an unconditional toast (`notifier.info` →
 * `new Notice`) plus an always-on activity-log entry, so feedback is NOT
 * missing. The residual UX gap is that the toast is **transient (~4-5 s)** and
 * easy to miss mid-action, and the activity log is a surface a first-run user
 * won't think to open. This panel adds **durability**: a persistent result the
 * user can read after the toast fades, stating what happened **and what to do
 * next** — so the action dead-ends nowhere.
 *
 * Fires on the terminal bootstrap outcomes (driven by {@link BootstrapResultInfo}):
 *   - `bootstrapped` — a cold bootstrap materialised the engine floor (§3.3).
 *   - `fetched` — the EC2 clone-needs-fetch path restored tracked AssetSpaces.
 *   - `already-bootstrapped` — the guard fired on an already-set-up vault.
 *   - `failed` — a Bootstrap / Add operation failed (§3.10, resolves P15): the
 *     panel surfaces the **classified cause** (bad URL / network / PAT) + a
 *     **recovery step**, with a one-click "Try again" of the failed operation,
 *     instead of a toast that fades before the user can act on it.
 *
 * ## Accessibility (P16, §3.11)
 * - Native `<button>`s (keyboard-navigable, Enter/Space activation) with explicit
 *   `aria-label`s.
 * - Managed focus: the most likely next move (the forward action, else Done) is
 *   focused on open, guarded for jsdom / headless contexts.
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
    const isFailure = this.result.kind === "failed";
    if (isFailure) contentEl.addClass("bootstrap-result-failed");

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

    // The "what to do next" / recovery-step nudge.
    contentEl.createEl("p", {
      cls: "bootstrap-result-next",
      text: copy.nextHint,
    });

    const actions = contentEl.createEl("div", {
      cls: "modal-button-container bootstrap-result-actions",
    });

    if (this.result.kind === "failed") {
      // Failure recovery (§3.10) — one-click retry of the failed operation.
      if (this.actions.onRetry !== undefined) {
        const operation = this.result.operation;
        const onRetry = this.actions.onRetry;
        const retryBtn = actions.createEl("button", {
          cls: "mod-cta bootstrap-result-retry-action",
          text: "Try again",
        });
        retryBtn.setAttribute(
          "aria-label",
          operation === "bootstrap"
            ? "Try setting up the engine again"
            : "Try adding the knowledge pack again",
        );
        retryBtn.addEventListener("click", () => {
          // Close first, then re-run — the operation's own modal stacks cleanly
          // rather than under a now-stale result panel.
          this.close();
          onRetry(operation);
        });
        this.firstFocusable = retryBtn;
      }
    } else {
      // Success (§3.3) — the next-step nudge + one-click forward action.
      const nextBtn = actions.createEl("button", {
        cls: "mod-cta bootstrap-result-next-action",
        text: "Add the starter content",
      });
      nextBtn.setAttribute(
        "aria-label",
        "Add the starter content (opens a dialog pre-filled with the recommended starter registry)",
      );
      nextBtn.addEventListener("click", () => {
        this.close();
        this.actions.onAddStarterContent();
      });
      this.firstFocusable = nextBtn;
    }

    const doneBtn = actions.createEl("button", {
      cls: "bootstrap-result-done",
      text: isFailure ? "Dismiss" : "Done",
    });
    doneBtn.setAttribute(
      "aria-label",
      isFailure ? "Dismiss the setup error" : "Close the setup result",
    );
    doneBtn.addEventListener("click", () => this.close());

    // Managed focus (P16) — land on the forward action, or Done when there is
    // no forward action (e.g. a failure panel with no retry wired).
    if (this.firstFocusable === null) this.firstFocusable = doneBtn;
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
    case "failed":
      return failureCopy(result.operation, result.cause, result.detail);
  }
}

/**
 * Durable failure copy (RFC 0002 §3.10, resolves P15b) — title + cause summary +
 * recovery step, per classified {@link BootstrapFailureCause}. Pure so the
 * per-cause recovery wording is unit-testable.
 */
function failureCopy(
  operation: BootstrapOperation,
  cause: BootstrapFailureCause,
  detail: string,
): ResultCopy {
  const what =
    operation === "bootstrap" ? "Set up the engine" : "Add a knowledge pack";
  const title = `${what} didn't finish`;
  switch (cause) {
    case "bad-url":
      return {
        title,
        summary: `The repository URL was rejected: ${detail}`,
        nextHint:
          "Next: check the URL — it should look like " +
          "https://github.com/<owner>/exoas-<name> — then try again.",
      };
    case "network":
      return {
        title,
        summary: `Couldn't reach GitHub — ${detail}`,
        nextHint:
          "Next: check your internet connection (and any VPN / proxy / firewall), " +
          "then try again.",
      };
    case "auth":
      return {
        title,
        summary:
          "GitHub rejected the request — the token is missing, expired, or lacks " +
          `access to this repository. (${detail})`,
        nextHint:
          "Next: open Settings → GitHub PAT, create a fine-grained token with " +
          "Contents: Read-only (or Read and write, to also push) scoped to this " +
          "repo, save it, then try again. If the repository is public, double-check " +
          "the URL instead.",
      };
    case "unknown":
      return {
        title,
        summary: `The operation failed — ${detail}`,
        nextHint:
          "Next: open «Open log file (saved)» from the command palette for the " +
          "full error, then try again.",
      };
  }
}
