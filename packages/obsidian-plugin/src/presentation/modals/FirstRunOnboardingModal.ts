import { App, Modal } from "obsidian";

/**
 * Action callbacks for the three onboarding steps + a one-time-close hook. The
 * panel is a thin, decoupled UI scaffold (RFC 0002 §3.1) — it owns no business
 * logic; each step just fires the injected action, which the plugin wires to the
 * existing Bootstrap / Add-AssetSpace / Apply-profile flows.
 */
export interface FirstRunOnboardingActions {
  /** Step 1 — open the Bootstrap dialog (fields stay empty per EC7). */
  onSetupEngine: () => void;
  /** Step 2 — open Add-AssetSpace pre-filled with the starter registry URL. */
  onAddStarter: () => void;
  /** Step 3 — open the profile picker narrowed to the `starter` profile. */
  onApplyStarterProfile: () => void;
  /**
   * Fired exactly once when the panel closes (any path: button, Esc, click-out).
   * Used to persist the device-local "onboarding completed" flag so the panel
   * is genuinely one-time (re-openable only via the `Setup` command).
   */
  onClosePanel?: () => void;
}

interface StepSpec {
  /** Plain-text step marker (NOT a glyph) so it is screen-reader reliable (P16). */
  marker: string;
  title: string;
  description: string;
  actionLabel: string;
  action: () => void;
}

/**
 * FirstRunOnboardingModal — the one-time "Welcome to Exocortex" panel
 * (RFC 0002 §3.1, resolves P1 first-run-has-zero-orientation + P2
 * sequence-not-discoverable).
 *
 * Renders a 3-step checklist that drives the canonical **starter** path:
 *   1. Set up the engine        → Bootstrap dialog (3.3)
 *   2. Add the starter content  → Add-AssetSpace pre-filled with the registry
 *   3. Apply the starter profile → profile picker on `starter` (3.4)
 *
 * The step sub-dialogs stack ON TOP of this panel (Obsidian modal stacking), so
 * the panel stays open underneath and the user can walk the sequence without
 * losing their place. It is re-openable via the `Setup (Getting Started)`
 * command (§3.2). On any close it fires `onClosePanel` once so the plugin can
 * persist the one-time flag.
 *
 * ## Accessibility (P16, §3.11)
 *
 * - Steps are a semantic `<ol>` so assistive tech announces "list, 3 items".
 * - Each action is a native `<button>` (keyboard-navigable + Enter/Space
 *   activation for free) with an explicit `aria-label`.
 * - Focus is managed: the first step's action button is focused on open.
 * - Step order uses a text marker ("Step 1 —"), never an icon/emoji alone.
 */
export class FirstRunOnboardingModal extends Modal {
  private readonly actions: FirstRunOnboardingActions;
  private closed = false;
  private firstActionButton: HTMLButtonElement | null = null;

  constructor(app: App, actions: FirstRunOnboardingActions) {
    super(app);
    this.actions = actions;
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("exocortex-onboarding");

    contentEl.createEl("h2", {
      cls: "exocortex-onboarding-title",
      // eslint-disable-next-line obsidianmd/ui/sentence-case -- "Exocortex" is the plugin's proper name (RFC 0002 §3.1 specifies this exact panel title)
      text: "Welcome to Exocortex",
    });
    contentEl.createEl("p", {
      cls: "exocortex-onboarding-intro",
      text:
        "Let's get this vault set up in three steps. Run them in order — each " +
        "opens a dialog; this panel stays open so you can come back to the next " +
        "step. You can reopen this panel any time from the command palette.",
    });

    const steps: StepSpec[] = [
      {
        marker: "Step 1",
        title: "Set up the engine",
        description:
          "Bootstrap this empty vault with the foundational exo AssetSpace — the " +
          "engine floor. The dialog's fields start empty on purpose: enter the public " +
          "floor repo (or your own fork). Leave the optional exocmd field blank for a " +
          "knowledge-only vault.",
        actionLabel: "Set up the engine",
        action: this.actions.onSetupEngine,
      },
      {
        marker: "Step 2",
        title: "Add the starter content",
        description:
          "Pull the public starter registry — a curated set of AssetSpaces that gives " +
          "you a ready-to-use Areas → Projects → Tasks structure. The recommended URL is " +
          "pre-filled for you; just confirm.",
        actionLabel: "Add the starter content",
        action: this.actions.onAddStarter,
      },
      {
        marker: "Step 3",
        title: "Apply the starter profile",
        description:
          "Materialise the «starter» profile — it mounts the AssetSpaces the starter " +
          "content needs. The picker opens narrowed to «starter»; select it to finish.",
        actionLabel: "Apply the starter profile",
        action: this.actions.onApplyStarterProfile,
      },
    ];

    const list = contentEl.createEl("ol", {
      cls: "exocortex-onboarding-steps",
    });
    list.setAttribute("aria-label", "Exocortex setup steps");

    steps.forEach((step, index) => {
      const item = list.createEl("li", { cls: "exocortex-onboarding-step" });

      const header = item.createEl("div", {
        cls: "exocortex-onboarding-step-header",
      });
      header.createEl("span", {
        cls: "exocortex-onboarding-step-marker",
        text: `${step.marker} — `,
      });
      header.createEl("span", {
        cls: "exocortex-onboarding-step-title",
        text: step.title,
      });

      item.createEl("p", {
        cls: "exocortex-onboarding-step-desc",
        text: step.description,
      });

      const button = item.createEl("button", {
        cls: "mod-cta exocortex-onboarding-step-action",
        text: step.actionLabel,
      });
      // Screen-reader label spells out the step number so the action is
      // unambiguous out of visual context (P16).
      button.setAttribute(
        "aria-label",
        `${step.marker}: ${step.actionLabel}`,
      );
      button.addEventListener("click", () => step.action());

      if (index === 0) this.firstActionButton = button;
    });

    const footer = contentEl.createEl("div", {
      cls: "modal-button-container exocortex-onboarding-footer",
    });
    const closeBtn = footer.createEl("button", {
      cls: "exocortex-onboarding-close",
      text: "Close",
    });
    closeBtn.setAttribute("aria-label", "Close the setup panel");
    closeBtn.addEventListener("click", () => this.close());

    // Managed focus (P16): land keyboard focus on the first actionable control
    // so a keyboard / screen-reader user starts at step 1, not on the dialog
    // container. Guarded — jsdom and headless contexts may lack focus support.
    try {
      this.firstActionButton?.focus();
    } catch {
      /* focus is best-effort */
    }
  }

  override onClose(): void {
    // Persist the one-time flag exactly once, regardless of close path
    // (button / Esc / click-outside). Best-effort — a throw here must not leave
    // the modal half-torn-down.
    if (!this.closed) {
      this.closed = true;
      try {
        this.actions.onClosePanel?.();
      } catch {
        /* persistence is best-effort; never block teardown */
      }
    }
    this.contentEl.empty();
  }
}
