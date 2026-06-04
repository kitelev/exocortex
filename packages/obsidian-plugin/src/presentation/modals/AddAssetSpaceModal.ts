import { App, Modal } from "obsidian";
import { isLikelyGitHubUrl } from "./BootstrapVaultModal";

export interface AddAssetSpaceInput {
  url: string;
}

/**
 * AddAssetSpaceModal — input gate for the `Exocortex: Add AssetSpace by URL`
 * palette command (RFC 13da049f Phase 6.3).
 *
 * Collects a single public GitHub repo URL and live-previews the folder it will
 * be materialised into (`assetspaces/<folder>`, with the `exoas-` prefix
 * stripped, mirroring the CLI `assetspace-add` default).
 *
 * Resolves `{ url }` only when the user clicks «Add» with a plausible GitHub
 * URL. Esc / Cancel / any close path resolves `null`. The promise resolves
 * exactly once.
 */
export class AddAssetSpaceModal extends Modal {
  private resolved = false;
  private readonly resolveFn: (input: AddAssetSpaceInput | null) => void;
  private readonly deriveFolderName: (url: string) => string;
  private urlInput: HTMLInputElement | null = null;
  private previewEl: HTMLElement | null = null;
  private errorEl: HTMLElement | null = null;

  constructor(
    app: App,
    deriveFolderName: (url: string) => string,
    resolve: (input: AddAssetSpaceInput | null) => void,
  ) {
    super(app);
    this.deriveFolderName = deriveFolderName;
    this.resolveFn = resolve;
  }

  private settle(value: AddAssetSpaceInput | null): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolveFn(value);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", {
      cls: "add-assetspace-title",
      text: "Add assetspace by URL",
    });
    contentEl.createEl("p", {
      text:
        "Pull a single assetspace from a public GitHub repository into this " +
        "vault. The folder name is derived from the repository name.",
    });

    const wrap = contentEl.createEl("div", { cls: "add-assetspace-field" });
    wrap.createEl("label", { text: "Repository URL" });
    const input = wrap.createEl("input", {
      type: "text",
      placeholder: "https://github.com/kitelev/exoas-pmbok-ontology",
      cls: "add-assetspace-input bootstrap-modal-input",
    });
    this.urlInput = input;

    this.previewEl = contentEl.createEl("p", {
      cls: "add-assetspace-preview",
      text: this.previewText(""),
    });
    input.addEventListener("input", () => this.refreshPreview());

    contentEl.createEl("p", {
      cls: "add-assetspace-note",
      text:
        "Add any AssetSpaces this one depends on manually — dependencies are " +
        "not added automatically.",
    });

    this.errorEl = contentEl.createEl("p", {
      cls: "add-assetspace-error mod-warning bootstrap-modal-error",
      text: "",
    });

    const actions = contentEl.createEl("div", {
      cls: "modal-button-container add-assetspace-actions",
    });
    const cancelBtn = actions.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => {
      this.settle(null);
      this.close();
    });
    const addBtn = actions.createEl("button", {
      cls: "mod-cta",
      text: "Add",
    });
    addBtn.addEventListener("click", () => this.submit());
  }

  private refreshPreview(): void {
    if (this.previewEl === null) return;
    const url = (this.urlInput?.value ?? "").trim();
    this.previewEl.textContent = this.previewText(url);
  }

  private previewText(url: string): string {
    if (url.length === 0) return "Target folder: (enter a URL)";
    if (!isLikelyGitHubUrl(url)) return "Target folder: (invalid URL)";
    let folder = "(unknown)";
    try {
      folder = this.deriveFolderName(url);
    } catch {
      folder = "(unknown)";
    }
    return `Target folder: assetspaces/${folder}`;
  }

  private submit(): void {
    const url = (this.urlInput?.value ?? "").trim();
    if (url.length === 0) {
      this.showError("A GitHub URL is required.");
      return;
    }
    if (!isLikelyGitHubUrl(url)) {
      this.showError("URL must look like https://github.com/<owner>/<repo>.");
      return;
    }
    this.settle({ url });
    this.close();
  }

  private showError(message: string): void {
    if (this.errorEl === null) return;
    this.errorEl.textContent = message;
    this.errorEl.classList.add("is-visible");
  }

  override onClose(): void {
    this.settle(null);
    this.contentEl.empty();
  }
}
