import { App, Modal } from "obsidian";

export interface BootstrapVaultUrls {
  exoUrl: string;
}

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
    contentEl.createEl("h2", {
      cls: "bootstrap-vault-title",
      text: "Bootstrap vault",
    });
    contentEl.createEl("p", {
      text:
        "Cold-start this empty vault with the foundational exo AssetSpace " +
        "(the SDK/engine floor), pulled from a public GitHub repository. " +
        "That is all a clean start needs — add any further AssetSpaces " +
        "(such as the exocmd UI-command library) afterwards via «Add " +
        "AssetSpace by URL», or by applying a profile.",
    });

    this.exoInput = this.createUrlField(
      contentEl,
      "exo ontology URL (required)",
      "https://github.com/kitelev/exoas-exo",
    );

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
