import { App, Modal } from "obsidian";
import type { IConfirmGate, ApplyPlan } from "exocortex";

/**
 * ModalConfirmGate — plugin-side implementation of `IConfirmGate`
 * (RFC 22b50a17 Phase 1b).
 *
 * Opens an interactive Obsidian `Modal` describing the impending hard
 * switch:
 *   1. Assetspaces being torn down (grouped, with file counts).
 *   2. File-by-file list of what will be deleted (first 100, then
 *      summary suffix).
 *   3. Assetspaces being materialized (newly added).
 *
 * Resolves `true` only when the user clicks the explicit «Apply»
 * button (`mod-warning` class — red destructive variant). Esc / Cancel /
 * any close path resolves `false` to abort. Promise is guaranteed to
 * resolve exactly once, even if the user clicks before Obsidian's
 * teardown lifecycle.
 */
export class ModalConfirmGate implements IConfirmGate {
  constructor(private readonly app: App) {}

  confirmApply(plan: ApplyPlan): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const modal = new ApplyConfirmModal(this.app, plan, resolve);
      modal.open();
    });
  }
}

/**
 * Cap on per-file rows rendered inside the modal. Beyond this we show a
 * «... and N more» summary line. Mirrors the budget RFC §UX-1 documents.
 */
export const MODAL_FILE_LIST_CAP = 100;

class ApplyConfirmModal extends Modal {
  private resolved = false;
  private readonly plan: ApplyPlan;
  private readonly resolve: (approved: boolean) => void;

  constructor(
    app: App,
    plan: ApplyPlan,
    resolve: (approved: boolean) => void,
  ) {
    super(app);
    this.plan = plan;
    this.resolve = resolve;
  }

  private settle(value: boolean): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolve(value);
  }

  override onOpen(): void {
    const { contentEl } = this;
    // Render title inside contentEl rather than relying on Modal.titleEl
    // — keeps the adapter testable without a custom Modal mock.
    contentEl.createEl("h2", {
      cls: "apply-confirm-title",
      text: `Apply к profile: ${this.plan.targetProfileLabel}`,
    });

    contentEl.createEl("p", {
      text: "This will modify the vault filesystem:",
    });

    // Section 1 — Assetspaces about to be removed
    const tearSection = contentEl.createEl("div", {
      cls: "apply-confirm-tear-section",
    });
    tearSection.createEl("h3", { text: "Assetspaces to remove" });
    if (this.plan.assetSpacesBeingTornDown.length === 0) {
      tearSection.createEl("p", { text: "(none)" });
    } else {
      const tearList = tearSection.createEl("ul");
      for (const as of this.plan.assetSpacesBeingTornDown) {
        tearList.createEl("li", {
          text: `${as.asLabel} (${as.fileCount} files)`,
        });
      }
    }

    // Section 2 — File-by-file destroy list (capped)
    const totalFiles = Array.from(this.plan.filesToDestroy.values()).reduce(
      (sum, files) => sum + files.length,
      0,
    );
    const filesSection = contentEl.createEl("div", {
      cls: "apply-confirm-files-section",
    });
    filesSection.createEl("h3", {
      text: `Files to be removed (${totalFiles} total)`,
    });
    if (totalFiles === 0) {
      filesSection.createEl("p", { text: "(none)" });
    } else {
      const filesList = filesSection.createEl("ul");
      let shown = 0;
      outer: for (const files of this.plan.filesToDestroy.values()) {
        for (const file of files) {
          if (shown >= MODAL_FILE_LIST_CAP) break outer;
          filesList.createEl("li", { text: file });
          shown++;
        }
      }
      if (totalFiles > MODAL_FILE_LIST_CAP) {
        filesSection.createEl("p", {
          text: `... and ${totalFiles - MODAL_FILE_LIST_CAP} more`,
        });
      }
    }

    // Section 3 — Assetspaces being materialized
    const matSection = contentEl.createEl("div", {
      cls: "apply-confirm-mat-section",
    });
    matSection.createEl("h3", { text: "Assetspaces to materialize" });
    if (this.plan.assetSpacesBeingMaterialized.length === 0) {
      matSection.createEl("p", { text: "(none)" });
    } else {
      const matList = matSection.createEl("ul");
      for (const as of this.plan.assetSpacesBeingMaterialized) {
        matList.createEl("li", { text: as.asLabel });
      }
    }

    // Confirm / Cancel buttons
    const buttonRow = contentEl.createEl("div", {
      cls: "apply-confirm-buttons",
    });
    const confirmBtn = buttonRow.createEl("button", {
      text: "Apply",
      cls: "mod-warning",
    });
    // a11y (RFC 0002 §3.11 / P16): the destructive intent is conveyed by the
    // `mod-warning` styling AND this text marker (never a glyph alone) so it is
    // unambiguous for assistive tech, not only sighted users.
    confirmBtn.setAttribute(
      "aria-label",
      "Apply — proceed with this destructive change (removes the listed files)",
    );
    confirmBtn.addEventListener("click", () => {
      this.settle(true);
      this.close();
    });
    const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
    cancelBtn.setAttribute(
      "aria-label",
      "Cancel — abort without modifying the vault",
    );
    cancelBtn.addEventListener("click", () => {
      this.settle(false);
      this.close();
    });

    // Managed focus (P16, §3.11) — this is a DESTRUCTIVE confirm, so land focus
    // on the SAFE default (Cancel) rather than the irreversible action, so a
    // keyboard / screen-reader user does not trigger the destroy by pressing
    // Enter on open. Focus-trap + Esc-close are provided by Obsidian's Modal
    // base. Guarded for jsdom / headless contexts.
    try {
      cancelBtn.focus();
    } catch {
      /* focus is best-effort */
    }
  }

  override onClose(): void {
    // Resolve BEFORE DOM teardown so a thrown Obsidian teardown cannot
    // leave the awaiter pending forever. Pattern mirrors
    // ProfileFuzzyModal.onClose (RFC 0a0791c1 §B.11 code-reviewer
    // medium catch).
    this.settle(false);
    if (typeof this.contentEl.empty === "function") {
      this.contentEl.empty();
    }
  }
}
