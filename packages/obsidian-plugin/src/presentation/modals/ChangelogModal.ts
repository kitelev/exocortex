import { App, Modal } from "obsidian";

/**
 * Returns `true` when the changelog modal should be displayed for the given
 * plugin version. Fresh installs (lastShown undefined/empty) always show,
 * and any version mismatch (upgrade or downgrade) also triggers display.
 * Equal versions suppress the modal so it appears at most once per version.
 */
export function shouldShowChangelog(
  lastShownVersion: string | undefined,
  currentVersion: string,
): boolean {
  if (!lastShownVersion) return true;
  return lastShownVersion !== currentVersion;
}

/**
 * First-launch-after-upgrade changelog modal (RFC-024 Phase 0).
 *
 * Informs the user about the new built-in button recoloring so the visual
 * change is not silent. Dismissed state is persisted by the caller via the
 * `onDismiss` callback — the modal itself owns no durable state.
 */
export class ChangelogModal extends Modal {
  constructor(
    app: App,
    private readonly version: string,
    private readonly onDismiss: (version: string) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("exocortex-changelog-modal");

    contentEl.createEl("h2", {
      text: `Exocortex ${this.version} — what changed`,
    });

    contentEl.createEl("p", {
      cls: "exocortex-changelog-intro",
      text:
        "Command buttons now use semantic default colors out of the box — " +
        "no vault changes required. Creation actions are prominent, " +
        "maintenance commands recede, and status/criticality actions keep " +
        "their intent clear at a glance.",
    });

    const list = contentEl.createEl("ul", {
      cls: "exocortex-changelog-list",
    });
    list.createEl("li", { text: "Creation → primary" });
    list.createEl("li", { text: "Criticality → warning" });
    list.createEl("li", { text: "Maintenance → muted" });
    list.createEl("li", {
      text: "Status sub-actions (done / blocked / cancelled) remap as sub-categories roll out",
    });

    contentEl.createEl("p", {
      cls: "exocortex-changelog-customize",
      text:
        "Customize in your vault by setting `exocmd__CommandBinding_variant` " +
        "on individual bindings. Explicit binding variants always win over " +
        "these defaults.",
    });

    const buttonContainer = contentEl.createDiv({
      cls: "modal-button-container",
    });
    const dismissButton = buttonContainer.createEl("button", {
      text: "Got it",
      cls: "mod-cta",
    });
    dismissButton.addEventListener("click", () => this.dismiss());
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  /**
   * User-facing dismiss handler: persists the current version via the
   * injected callback and closes the modal. Exposed for unit testability
   * (`dismissButton.click` is routed here).
   */
  dismiss(): void {
    this.onDismiss(this.version);
    this.close();
  }
}
