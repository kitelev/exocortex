import { App, Modal } from "obsidian";

export interface BootstrapVaultUrls {
  exoUrl: string;
  exocmdUrl: string;
}

/**
 * BootstrapVaultModal — input gate for the `Exocortex: Bootstrap vault` palette
 * command (RFC 13da049f Phase 6.2).
 *
 * Collects the two TS-floor AssetSpace URLs (exo + exocmd) needed to cold-start
 * an empty vault.
 *
 * ## UX decisions
 *
 * - **EC7 — fields start EMPTY.** The `kitelev/exoas-*` repos are NOT pre-filled
 *   (they materialise Andrey's own ontology and do not work as a generic floor
 *   for other users). They appear only as greyed-out placeholder examples.
 * - **R31 — no transitive auto-add.** A note tells the user they must add any
 *   further required AssetSpaces manually; dependencies are not resolved
 *   automatically.
 *
 * Resolves `{ exoUrl, exocmdUrl }` only when the user clicks «Bootstrap» with
 * both fields populated with a plausible GitHub URL. Esc / Cancel / any close
 * path resolves `null`. The promise resolves exactly once.
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
  private exocmdInput: HTMLInputElement | null = null;
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
    contentEl.createEl("h2", {
      cls: "bootstrap-vault-title",
      text: "Bootstrap vault",
    });
    contentEl.createEl("p", {
      text:
        "Cold-start this empty vault with the foundational exo AssetSpace " +
        "(the SDK/engine floor), pulled from a public GitHub repository. " +
        "exocmd (the optional UI-command library) can be added too, or left " +
        "blank for a knowledge-only / SPARQL-only vault.",
    });

    this.exoInput = this.createUrlField(
      contentEl,
      "exo ontology URL (required)",
      "https://github.com/kitelev/exoas-exo",
    );
    this.exocmdInput = this.createUrlField(
      contentEl,
      "exocmd ontology URL (optional)",
      "https://github.com/kitelev/exoas-exocmd",
    );

    contentEl.createEl("p", {
      cls: "bootstrap-vault-note",
      text:
        "The example URLs above are placeholders only — enter the repositories " +
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
    });
    return input;
  }

  private submit(): void {
    const exoUrl = (this.exoInput?.value ?? "").trim();
    const exocmdUrl = (this.exocmdInput?.value ?? "").trim();
    const problem = firstUrlProblem(exoUrl, exocmdUrl);
    if (problem !== null) {
      this.showError(problem);
      return;
    }
    this.settle({ exoUrl, exocmdUrl });
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
 * Light shape check for the bootstrap URLs. Returns a human-readable problem
 * string, or null when the inputs look plausible. Authoritative validation is
 * downstream.
 *
 * Core-only (RFC 5aa2a73a B3 / alt-G rejection #3426): only the exo URL is
 * required. exocmd is the optional UI-command library — an empty exocmd field
 * yields a knowledge-only / SPARQL-only vault and is a first-class config. When
 * exocmd IS provided it must still be a plausible GitHub URL.
 */
export function firstUrlProblem(
  exoUrl: string,
  exocmdUrl: string,
): string | null {
  if (exoUrl.length === 0) {
    return "The exo URL is required.";
  }
  if (!isLikelyGitHubUrl(exoUrl)) {
    return "exo URL must look like https://github.com/<owner>/<repo>.";
  }
  if (exocmdUrl.length > 0 && !isLikelyGitHubUrl(exocmdUrl)) {
    return "exocmd URL must look like https://github.com/<owner>/<repo>.";
  }
  return null;
}

export function isLikelyGitHubUrl(url: string): boolean {
  return /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+$/.test(url);
}
