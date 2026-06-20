import { App, Modal } from "obsidian";
import { renderPatSetupHelper } from "../settings/patSetupHelper";
import {
  describePatConnection,
  type PatConnectionResult,
} from "../settings/patConnectionTest";

/**
 * Action callbacks for the five onboarding steps + a one-time-close hook. The
 * panel is a thin, decoupled UI scaffold (RFC 0002 §3.1) — it owns no business
 * logic; each step just fires the injected action, which the plugin wires to the
 * existing Save-PAT / Bootstrap / Add-AssetSpace / Apply-profile flows. The
 * materialise steps follow the EKA D12 bootstrap order: bootstrap the exo SDK
 * floor → add the AssetSpace registry → add the profiles AssetSpace → apply a
 * chosen profile (which resolves its `dependsOn` closure over the now-present
 * registry descriptors).
 */
export interface FirstRunOnboardingActions {
  /**
   * Step 1 (PAT, optional) — persist the entered token device-local
   * (`data.local.json`, Sync-excluded). Called with the raw field value; the
   * wiring trims it and an empty value clears the stored token (the "skip"
   * path). It MUST run before the materialise steps so a private-repo token is
   * in place when Bootstrap/Add/Apply read it (cd9444bd, RFC 0002 §3.1). Async
   * so the panel can surface a save failure.
   */
  onSavePat: (pat: string) => Promise<void>;
  /**
   * Step 1 (PAT, optional) — read a token from the clipboard for the Paste
   * affordance (mobile onboarding parity, RFC 0002 §3.9 / P14). Returns the
   * normalised token, or null when the clipboard is empty / unreadable. Omit to
   * hide the Paste button (e.g. in a context with no clipboard).
   */
  onPastePat?: () => Promise<string | null>;
  /**
   * Step 1 (PAT, optional) — verify the entered token reaches GitHub WITHOUT
   * saving it, reusing the same validate logic as the Settings "Test
   * connection" button (RFC 0002). Called with the raw field value; the wiring
   * trims it, builds a `GitHubRestClient`, and resolves a structured
   * {@link PatConnectionResult} the panel renders as an inline status. Omit to
   * hide the "Test connection" button (e.g. a context with no GitHub client).
   * Never rejects — a rejected token / network error resolves `{ ok: false }`.
   */
  onTestPat?: (pat: string) => Promise<PatConnectionResult>;
  /** Step 2 — open the Bootstrap dialog for the exo SDK floor (fields stay empty per EC7). */
  onSetupEngine: () => void;
  /** Step 3 — open Add-AssetSpace pre-filled with the EKA registry URL. */
  onAddRegistry: () => void;
  /** Step 4 — open Add-AssetSpace pre-filled with the EKA profiles URL. */
  onAddProfiles: () => void;
  /** Step 5 — open the profile picker (lists every profile; user picks one). */
  onApplyProfile: () => void;
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
 * Renders a 5-step checklist that drives the EKA D12 bootstrap path:
 *   1. Add your GitHub token (OPTIONAL) → saves the PAT device-local FIRST so
 *      the later steps can clone/pull private `exoas-*` repos (cd9444bd)
 *   2. Set up the engine          → Bootstrap the exo SDK floor (3.3)
 *   3. Add the AssetSpace registry → Add-AssetSpace pre-filled with exoas-registry
 *   4. Add the profiles AssetSpace → Add-AssetSpace pre-filled with exoas-profiles
 *   5. Apply a profile            → profile picker (lists every profile; pick one)
 *
 * ## Why the token step is FIRST (cd9444bd)
 *
 * Bootstrap / Add-AssetSpace / Apply-profile can pull **private** `exoas-*`
 * repos, which need a GitHub PAT to clone/pull. The materialise paths read the
 * token fresh at command-execution time (Issue #3382), so a token saved in
 * step 1 is in place by the time steps 2-5 run. The step is **optional**: a
 * public-only tester skips it (leaves it blank, moves to step 2) and the
 * materialise steps pull anonymously (the public registry + profiles, and a
 * fully-public profile such as `$$core`) — the public flow is never blocked.
 *
 * The step sub-dialogs stack ON TOP of this panel (Obsidian modal stacking), so
 * the panel stays open underneath and the user can walk the sequence without
 * losing their place. It is re-openable via the `Setup (Getting Started)`
 * command (§3.2). On any close it fires `onClosePanel` once so the plugin can
 * persist the one-time flag.
 *
 * ## Accessibility (P16, §3.11)
 *
 * - Steps are a semantic `<ol>` so assistive tech announces "list, 5 items".
 * - Each action is a native `<button>` (keyboard-navigable + Enter/Space
 *   activation for free) with an explicit `aria-label`; the token field is a
 *   native `<input>` with an `aria-label`.
 * - Focus is managed: the token input (the first actionable control) is focused
 *   on open.
 * - Step order uses a text marker ("Step 1 —"), never an icon/emoji alone.
 */
export class FirstRunOnboardingModal extends Modal {
  private readonly actions: FirstRunOnboardingActions;
  private closed = false;
  private firstFocusable: HTMLElement | null = null;

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
        "Let's get this vault set up. Start with your GitHub token if you'll use " +
        "private content (optional), then run the remaining steps in order — each " +
        "opens a dialog; this panel stays open so you can come back to the next " +
        "step. You can reopen this panel any time from the command palette.",
    });

    const list = contentEl.createEl("ol", {
      cls: "exocortex-onboarding-steps",
    });
    list.setAttribute("aria-label", "Exocortex setup steps");

    // Step 1 — the optional, token-first step (cd9444bd). Rendered specially
    // (input + paste/save + reusable §3.5 helper) BEFORE the generic action
    // steps so it is unmistakably first.
    this.renderPatStep(list);

    const steps: StepSpec[] = [
      {
        marker: "Step 2",
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
        marker: "Step 3",
        title: "Add the AssetSpace registry",
        description:
          "Pull the public registry — the catalog of every AssetSpace and the " +
          "knowledge profiles that group them. The recommended URL is pre-filled; " +
          "just confirm. It's public, so no token is needed for this step.",
        actionLabel: "Add the AssetSpace registry",
        action: this.actions.onAddRegistry,
      },
      {
        marker: "Step 4",
        title: "Add the profiles AssetSpace",
        description:
          "Pull the public profiles AssetSpace — the knowledge profiles you'll pick " +
          "from in the next step. The recommended URL is pre-filled; just confirm. " +
          "Public, so no token is needed here either.",
        actionLabel: "Add the profiles AssetSpace",
        action: this.actions.onAddProfiles,
      },
      {
        marker: "Step 5",
        title: "Apply a profile",
        description:
          "Pick a knowledge profile to materialise — it mounts the AssetSpaces that " +
          "profile needs (resolving them through the registry you just added). Your " +
          "own private profile needs the token from step 1; the public «$$core» " +
          "profile (exo only) works with no token.",
        actionLabel: "Apply a profile",
        action: this.actions.onApplyProfile,
      },
    ];

    steps.forEach((step) => this.renderActionStep(list, step));

    const footer = contentEl.createEl("div", {
      cls: "modal-button-container exocortex-onboarding-footer",
    });
    const closeBtn = footer.createEl("button", {
      cls: "exocortex-onboarding-close",
      text: "Close",
    });
    closeBtn.setAttribute("aria-label", "Close the setup panel");
    closeBtn.addEventListener("click", () => this.close());

    // Managed focus (P16): land keyboard focus on the first actionable control —
    // the token input — so a keyboard / screen-reader user starts at step 1, not
    // on the dialog container. Guarded — jsdom and headless contexts may lack
    // focus support.
    try {
      this.firstFocusable?.focus();
    } catch {
      /* focus is best-effort */
    }
  }

  /**
   * Render the optional token-first step (cd9444bd, RFC 0002 §3.1): the §3.5
   * create-token helper (deep-link + scope list, reused verbatim), a masked
   * input, a Paste affordance (mobile parity §3.9) and an explicit Save button.
   * Explicit Save (not keystroke-onChange) mirrors the Settings PAT field so a
   * partial token is never persisted.
   */
  private renderPatStep(list: HTMLElement): void {
    const item = list.createEl("li", {
      cls: "exocortex-onboarding-step exocortex-onboarding-step-pat",
    });

    const header = item.createEl("div", {
      cls: "exocortex-onboarding-step-header",
    });
    header.createEl("span", {
      cls: "exocortex-onboarding-step-marker",
      text: "Step 1 — ",
    });
    header.createEl("span", {
      cls: "exocortex-onboarding-step-title",
      text: "Add your GitHub token (optional)",
    });

    item.createEl("p", {
      cls: "exocortex-onboarding-step-desc",
      text:
        "Only needed if you'll use private AssetSpaces — the later steps clone/pull " +
        "your private exoas-* repos and need a token to do so. Add it first and the " +
        "remaining steps can reach private content. Using only public content? Skip " +
        "this and go straight to step 2.",
    });

    // §3.5 helper — identical create-token deep-link + permission list as the
    // Settings PAT section (single source, no copy drift).
    renderPatSetupHelper(item);

    const row = item.createEl("div", { cls: "exocortex-onboarding-pat-row" });

    const input = row.createEl("input", {
      cls: "exocortex-onboarding-pat-input",
    }) as HTMLInputElement;
    input.type = "password";
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- placeholder shows the literal PAT format (matches the Settings PAT field)
    input.placeholder = "github_pat_…";
    input.setAttribute("aria-label", "GitHub personal access token (optional)");
    this.firstFocusable = input;

    // Paste affordance (mobile parity §3.9 / P14) — only when a clipboard
    // reader is wired. Fills the field from the clipboard so a long token need
    // not be typed on a phone.
    if (this.actions.onPastePat) {
      const pasteBtn = row.createEl("button", {
        cls: "exocortex-onboarding-pat-paste",
        text: "Paste",
      });
      pasteBtn.setAttribute("aria-label", "Paste a GitHub token from the clipboard");
      pasteBtn.addEventListener("click", () => {
        void (async () => {
          try {
            const pasted = await this.actions.onPastePat?.();
            if (pasted) input.value = pasted;
          } catch {
            /* paste is best-effort; the user can still type the token */
          }
        })();
      });
    }

    const saveBtn = row.createEl("button", {
      cls: "mod-cta exocortex-onboarding-pat-save",
      text: "Save token",
    });
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- "Step 1:" a11y prefix (matches the step-numbered aria-labels above) + "GitHub" proper noun
    saveBtn.setAttribute("aria-label", "Step 1: Save your GitHub token");
    saveBtn.addEventListener("click", () => {
      void this.actions.onSavePat(input.value).catch(() => {
        /* save failure is surfaced by the wiring (notifier); never throw here */
      });
    });

    // Test connection (RFC 0002) — verify the token reaches GitHub BEFORE the
    // user relies on it, reusing the Settings validate logic (onTestPat). Only
    // rendered when wired (parity with the optional Paste affordance). The
    // result lands in an inline aria-live status so the outcome is announced
    // without a transient toast.
    if (this.actions.onTestPat) {
      const onTestPat = this.actions.onTestPat;

      const testBtn = row.createEl("button", {
        cls: "exocortex-onboarding-pat-test",
        text: "Test connection",
      });
      // eslint-disable-next-line obsidianmd/ui/sentence-case -- "Step 1:" a11y prefix (matches the step-numbered aria-labels above) + "GitHub" proper noun
      testBtn.setAttribute("aria-label", "Step 1: Test the GitHub token connection");

      // Status line: role=status + aria-live=polite so assistive tech announces
      // the outcome; the textual message (and is-valid / is-invalid colour
      // class) carries valid/invalid + reason — never a glyph alone (P16).
      const status = item.createEl("p", {
        cls: "exocortex-onboarding-pat-status",
      });
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");

      testBtn.addEventListener("click", () => {
        void (async () => {
          testBtn.disabled = true;
          status.classList.remove("is-valid", "is-invalid");
          status.classList.add("is-pending");
          // aria-busy while the request is in flight so assistive tech knows the
          // status region is updating (cleared in finally).
          status.setAttribute("aria-busy", "true");
          status.textContent = "Testing the connection…";
          try {
            const result = await onTestPat(input.value);
            status.classList.remove("is-pending");
            status.classList.add(result.ok ? "is-valid" : "is-invalid");
            status.textContent = describePatConnection(result);
          } catch {
            // onTestPat is contracted never to reject (it returns a failure
            // result), but guard so a wiring bug never throws into the handler.
            status.classList.remove("is-pending");
            status.classList.add("is-invalid");
            status.textContent = "Test connection failed: unexpected error.";
          } finally {
            status.removeAttribute("aria-busy");
            testBtn.disabled = false;
          }
        })();
      });
    }
  }

  /** Render a generic single-action step (steps 2-5). */
  private renderActionStep(list: HTMLElement, step: StepSpec): void {
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
    button.setAttribute("aria-label", `${step.marker}: ${step.actionLabel}`);
    button.addEventListener("click", () => step.action());
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
