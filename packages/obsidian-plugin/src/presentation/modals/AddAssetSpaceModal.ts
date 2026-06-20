import { App, Modal } from "obsidian";
import { derivePath } from "exocortex";
import { isLikelyGitHubUrl } from "./BootstrapVaultModal";

export interface AddAssetSpaceInput {
  url: string;
}

/**
 * AddAssetSpaceModal — input gate for the `Exocortex: Add AssetSpace by URL`
 * palette command (RFC 13da049f Phase 6.3).
 *
 * Collects a single public GitHub repo URL and live-previews the canonical
 * Maven path it will be materialised into — `assetspaces/<owner>/<repo>` via
 * `derivePath` (#3538), matching `invokeAddAssetSpace`, `bootstrap`, and
 * `apply-profile`. Falls back to the flat `assetspaces/<name>` (`exoas-` prefix
 * stripped) only when the URL is un-derivable, mirroring the command itself.
 *
 * Resolves `{ url }` only when the user clicks «Add» with a plausible GitHub
 * URL. Esc / Cancel / any close path resolves `null`. The promise resolves
 * exactly once.
 *
 * An optional `initialUrl` pre-fills the field — used by the first-run
 * onboarding panel (RFC 0002 §3.1 steps 3-4) to offer the public, stable
 * EKA registry / profiles URL one click away. The user still confirms; a
 * pre-fill is a recommended default, not an auto-action.
 */
export class AddAssetSpaceModal extends Modal {
  private resolved = false;
  private readonly resolveFn: (input: AddAssetSpaceInput | null) => void;
  private readonly deriveFolderName: (url: string) => string;
  private readonly initialUrl: string;
  private urlInput: HTMLInputElement | null = null;
  private previewEl: HTMLElement | null = null;
  private errorEl: HTMLElement | null = null;

  constructor(
    app: App,
    deriveFolderName: (url: string) => string,
    resolve: (input: AddAssetSpaceInput | null) => void,
    initialUrl?: string,
  ) {
    super(app);
    this.deriveFolderName = deriveFolderName;
    this.resolveFn = resolve;
    this.initialUrl = (initialUrl ?? "").trim();
  }

  private settle(value: AddAssetSpaceInput | null): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolveFn(value);
  }

  override onOpen(): void {
    const { contentEl } = this;
    // RFC 0002 §3.2 (P3) — coherent plain-language copy with the «Add a
    // knowledge pack» palette command (no «assetspace» jargon re-entry mid-flow).
    contentEl.createEl("h2", {
      cls: "add-assetspace-title",
      text: "Add a knowledge pack",
    });
    contentEl.createEl("p", {
      text:
        "Pull a single knowledge pack from a public GitHub repository into this " +
        "vault. The folder name is derived from the repository name.",
    });

    const wrap = contentEl.createEl("div", { cls: "add-assetspace-field" });
    // a11y (RFC 0002 §3.11 / P16): wire the visible <label> to the <input> via
    // for/id so assistive tech reads the field name when focus lands on it, and
    // add an aria-label so the field is named even out of visual context.
    const fieldId = "add-assetspace-url";
    const labelEl = wrap.createEl("label", { text: "Repository URL" });
    labelEl.setAttribute("for", fieldId);
    const input = wrap.createEl("input", {
      type: "text",
      placeholder: "https://github.com/kitelev/exoas-pmbok-ontology",
      cls: "add-assetspace-input bootstrap-modal-input",
      attr: { id: fieldId, "aria-label": "Repository URL" },
    });
    this.urlInput = input;
    // Pre-fill the recommended starter-registry URL when launched from the
    // first-run onboarding panel (RFC 0002 §3.1 step 2). The user still reviews
    // + confirms; the preview reflects the pre-filled value immediately.
    if (this.initialUrl.length > 0) {
      input.value = this.initialUrl;
    }

    this.previewEl = contentEl.createEl("p", {
      cls: "add-assetspace-preview",
    });
    this.refreshPreview();
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
    cancelBtn.setAttribute("aria-label", "Cancel — do not add a knowledge pack");
    cancelBtn.addEventListener("click", () => {
      this.settle(null);
      this.close();
    });
    const addBtn = actions.createEl("button", {
      cls: "mod-cta",
      text: "Add",
    });
    addBtn.setAttribute("aria-label", "Add the knowledge pack from this URL");
    addBtn.addEventListener("click", () => this.submit());

    // Managed focus (RFC 0002 §3.11 / P16) — land keyboard focus on the URL
    // field so a keyboard / screen-reader user starts at the input rather than
    // the dialog container. Focus-trap + Esc-close are provided by Obsidian's
    // Modal base. Guarded — jsdom / headless contexts may lack focus support.
    try {
      this.urlInput?.focus();
    } catch {
      /* focus is best-effort */
    }
  }

  private refreshPreview(): void {
    if (this.previewEl === null) return;
    const url = (this.urlInput?.value ?? "").trim();
    const { text, isPlaceholder } = this.previewState(url);
    this.previewEl.textContent = text;
    // Empty / invalid states are hints, not a real path — render them as a
    // muted placeholder so the auto-derived value reads as a live preview
    // rather than an unfinished field (F4 UX polish).
    this.previewEl.classList.toggle("is-placeholder", isPlaceholder);
  }

  private previewState(url: string): { text: string; isPlaceholder: boolean } {
    if (url.length === 0) {
      return {
        text: "Target folder: auto-derived from the repository URL",
        isPlaceholder: true,
      };
    }
    if (!isLikelyGitHubUrl(url)) {
      return {
        text: "Target folder: enter a valid GitHub URL",
        isPlaceholder: true,
      };
    }
    let path = "(unknown)";
    try {
      // Mirror invokeAddAssetSpace (#3538): canonical Maven path
      // `assetspaces/<owner>/<repo>` (derivePath), flat fallback only when the
      // URL is un-derivable. Keeps the preview honest vs the actual mount path.
      path = derivePath(url) ?? `assetspaces/${this.deriveFolderName(url)}`;
    } catch {
      path = "(unknown)";
    }
    return { text: `Target folder: ${path}`, isPlaceholder: false };
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
