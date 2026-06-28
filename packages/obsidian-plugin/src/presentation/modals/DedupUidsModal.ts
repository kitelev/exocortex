import { App, Modal } from "obsidian";
import type { DedupUidGroup } from "@kitelev/exocortex-core";

/**
 * DedupUidsModal — the report-first + confirm gate for «Exocortex: Deduplicate
 * uids» (#3676). Renders every duplicate `exo__Asset_uid` and the paths that
 * declare it (the "report"), then a Cancel / Deduplicate gate. Resolves `true`
 * only on the explicit Deduplicate button; Esc / Cancel / any close path
 * resolves `false`. The promise resolves exactly once.
 *
 * A plain Obsidian Modal (no renderer dependency) so the command logic stays
 * testable with an injected `confirm` callback; this class is the presentation
 * the wiring injects.
 */
export class DedupUidsModal extends Modal {
  private resolved = false;
  private readonly groups: readonly DedupUidGroup[];
  private readonly resolveFn: (approved: boolean) => void;

  constructor(
    app: App,
    groups: readonly DedupUidGroup[],
    resolve: (approved: boolean) => void,
  ) {
    super(app);
    this.groups = groups;
    this.resolveFn = resolve;
  }

  private settle(value: boolean): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolveFn(value);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Deduplicate uids" });

    const fileCount = this.groups.reduce((n, g) => n + g.paths.length, 0);
    contentEl.createEl("p", {
      text: `Found ${this.groups.length} duplicate uid(s) across ${fileCount} file(s). Reassign a fresh uuid to every duplicate but the first (the files are never renamed)? Run Sync afterwards to propagate.`,
    });

    // The report — each shared uid + the paths declaring it.
    const list = contentEl.createEl("ul");
    for (const group of this.groups) {
      const item = list.createEl("li", {
        text: `${group.uid} — ${group.paths.length} files:`,
      });
      const paths = item.createEl("ul");
      for (const path of group.paths) paths.createEl("li", { text: path });
    }

    const actions = contentEl.createEl("div", {
      cls: "modal-button-container",
    });
    const cancelBtn = actions.createEl("button", { text: "Cancel" });
    cancelBtn.setAttribute("aria-label", "Cancel");
    cancelBtn.addEventListener("click", () => {
      this.settle(false);
      this.close();
    });
    const confirmBtn = actions.createEl("button", {
      cls: "mod-cta",
      text: "Deduplicate",
    });
    confirmBtn.setAttribute("aria-label", "Deduplicate");
    confirmBtn.addEventListener("click", () => {
      this.settle(true);
      this.close();
    });

    try {
      confirmBtn.focus();
    } catch {
      /* focus is best-effort */
    }
  }

  override onClose(): void {
    this.settle(false);
    this.contentEl.empty();
  }
}
