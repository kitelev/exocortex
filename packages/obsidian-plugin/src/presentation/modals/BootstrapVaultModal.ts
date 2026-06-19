import { App, Modal } from "obsidian";

export interface BootstrapVaultUrls {
  exoUrl: string;
}

/**
 * The public exo *engine floor* repository, surfaced as the field's placeholder
 * example AND linked from the inline explainer (RFC 0002 §3.3 — "a link to the
 * floor repo"). Single source so the placeholder and the link never drift.
 *
 * EC7 note: this is a LINK + a greyed-out placeholder example, NOT a pre-fill.
 * The field starts empty (the `kitelev/exoas-*` repos materialise a specific
 * ontology and are not auto-filled as a generic default — see EC7 below); the
 * link only lets a user *view / fork* the public floor before they decide what
 * to enter.
 */
export const PUBLIC_EXO_FLOOR_URL = "https://github.com/kitelev/exoas-exo";

/**
 * BootstrapVaultModal — input gate for the `Exocortex: Bootstrap vault` palette
 * command (RFC 13da049f Phase 6.2).
 *
 * Collects ONLY the exo TS-floor AssetSpace URL (required) needed to cold-start
 * an empty vault. A clean bootstrap is **exo-only** — exo is the SDK/engine
 * floor and is all that is needed for a minimal clean start (decision
 * 2026-06-20, project Exocortex Alpha Launch). The exocmd UI-command library is
 * NOT part of the initial bootstrap: it (and any other AssetSpace) is added
 * afterwards, either explicitly via «Add AssetSpace by URL» or transitively
 * when a profile is applied (effective set / dependsOn DAG). The previous
 * second «exocmd URL» field was misleading (it implied exocmd was required for
 * a clean start) and has been removed.
 *
 * ## UX decisions
 *
 * - **EC7 — the field starts EMPTY.** The `kitelev/exoas-*` repos are NOT
 *   pre-filled (they materialise Andrey's own ontology and do not work as a
 *   generic floor for other users). It appears only as a greyed-out
 *   placeholder example.
 * - **R31 — no transitive auto-add.** A note tells the user they must add any
 *   further required AssetSpaces manually; dependencies are not resolved
 *   automatically.
 *
 * Resolves `{ exoUrl }` when the user clicks «Bootstrap» with a plausible exo
 * URL. Esc / Cancel / any close path resolves `null`. The promise resolves
 * exactly once.
 *
 * Authoritative URL validation (allowlist, traversal) happens downstream in
 * `BootstrapAssetSpaceCommands` / `GitHubRestClient.validateRepoURL`; this modal
 * only does a light non-empty + `https://github.com/` shape check so the user
 * gets immediate feedback before a pull is attempted.
 */
export class BootstrapVaultModal extends Modal {
  private resolved = false;
  private readonly resolveFn: (urls: BootstrapVaultUrls | null) => void;
  private exoInput: HTMLInputElement | null = null;
  private errorEl: HTMLElement | null = null;

  constructor(app: App, resolve: (urls: BootstrapVaultUrls | null) => void) {
    super(app);
    this.resolveFn = resolve;
  }

  private settle(value: BootstrapVaultUrls | null): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolveFn(value);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("bootstrap-vault");
    contentEl.createEl("h2", {
      cls: "bootstrap-vault-title",
      text: "Set up the engine",
    });
    // De-jargoned intro (RFC 0002 §3.3 / P6): plain language; drops the
    // "SDK/engine floor" framing the old copy led with. The only term-of-art
    // kept is the literal «Add AssetSpace by URL» command name (a pointer to a
    // real command the user can run next), not an unexplained concept.
    contentEl.createEl("p", {
      text:
        "Get this empty vault running by pulling the engine — the minimal " +
        "foundation an Exocortex vault needs — from a GitHub repository. That " +
        "is all a clean start needs; you can add more content afterwards from " +
        "«Add AssetSpace by URL» or by applying a profile.",
    });

    // Plain-language field label (was "exo ontology URL (required)" — jargon).
    this.exoInput = this.createUrlField(
      contentEl,
      "Engine repository URL (required)",
      PUBLIC_EXO_FLOOR_URL,
    );

    // Inline explainer + link to the floor repo (RFC 0002 §3.3): tells the user
    // what the field wants and where to get a floor repo, without pre-filling it
    // (EC7). The link is a native <a> with an explicit aria-label that states it
    // leaves Obsidian (P16 a11y), and target=_blank paired with
    // rel="noopener noreferrer" (no reverse-tabnabbing).
    const explainer = contentEl.createEl("p", {
      cls: "bootstrap-vault-explainer",
    });
    explainer.createEl("span", {
      text:
        "This is the engine floor — use the public floor repo, or your own " +
        "fork. ",
    });
    explainer.createEl("a", {
      cls: "bootstrap-vault-floor-link",
      text: "View the public floor repo on GitHub",
      href: PUBLIC_EXO_FLOOR_URL,
      attr: {
        target: "_blank",
        rel: "noopener noreferrer",
        "aria-label":
          "View the public floor repository (opens GitHub in your browser)",
      },
    });

    contentEl.createEl("p", {
      cls: "bootstrap-vault-note",
      text:
        "The example URL above is a placeholder only — enter the repository " +
        "you want to use. Add any further AssetSpaces afterwards via " +
        "«Add AssetSpace by URL»; dependencies are not added automatically.",
    });

    this.errorEl = contentEl.createEl("p", {
      cls: "bootstrap-vault-error mod-warning bootstrap-modal-error",
      text: "",
    });

    const actions = contentEl.createEl("div", {
      cls: "modal-button-container bootstrap-vault-actions",
    });
    const cancelBtn = actions.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => {
      this.settle(null);
      this.close();
    });
    const bootstrapBtn = actions.createEl("button", {
      cls: "mod-cta",
      text: "Bootstrap",
    });
    bootstrapBtn.addEventListener("click", () => this.submit());
  }

  private createUrlField(
    parent: HTMLElement,
    label: string,
    placeholder: string,
  ): HTMLInputElement {
    const wrap = parent.createEl("div", { cls: "bootstrap-vault-field" });
    wrap.createEl("label", { text: label });
    const input = wrap.createEl("input", {
      type: "text",
      placeholder,
      cls: "bootstrap-vault-input bootstrap-modal-input",
      // Screen-reader label mirrors the visible <label> so the field is named
      // even out of visual context (P16 a11y).
      attr: { "aria-label": label },
    });
    return input;
  }

  private submit(): void {
    const exoUrl = (this.exoInput?.value ?? "").trim();
    const problem = firstUrlProblem(exoUrl);
    if (problem !== null) {
      this.showError(problem);
      return;
    }
    this.settle({ exoUrl });
    this.close();
  }

  private showError(message: string): void {
    if (this.errorEl === null) return;
    this.errorEl.textContent = message;
    this.errorEl.classList.add("is-visible");
  }

  override onClose(): void {
    // Dismissed without explicit Bootstrap → treat as cancel.
    this.settle(null);
    this.contentEl.empty();
  }
}

/**
 * Light shape check for the bootstrap URL. Returns a human-readable problem
 * string, or null when the input looks plausible. Authoritative validation is
 * downstream.
 *
 * Exo-only (decision 2026-06-20): a clean bootstrap requires only the exo URL.
 * The exocmd library — and any other AssetSpace — is added later via «Add
 * AssetSpace by URL» or transitively via a profile, so this modal no longer
 * collects an exocmd URL.
 */
export function firstUrlProblem(exoUrl: string): string | null {
  if (exoUrl.length === 0) {
    return "The exo URL is required.";
  }
  if (!isLikelyGitHubUrl(exoUrl)) {
    return "exo URL must look like https://github.com/<owner>/<repo>.";
  }
  return null;
}

export function isLikelyGitHubUrl(url: string): boolean {
  return /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+$/.test(url);
}
