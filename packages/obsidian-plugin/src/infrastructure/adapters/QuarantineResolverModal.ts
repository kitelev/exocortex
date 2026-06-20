import { App, Modal } from "obsidian";
import type {
  ConflictDetail,
  ResolvableConflict,
  ResolveChoice,
} from "exocortex";
import type { ResolverModalContext } from "./QuarantineResolverCommands";

/**
 * QuarantineResolverModal — the «Resolve sync conflicts» UI (finding a0a3d1d6,
 * design interview 2026-06-20).
 *
 * List → per-file resolve (interview Q): the modal shows the open conflicts;
 * picking one renders the two competing versions SIDE-BY-SIDE (local | remote,
 * responsive: stacked on a narrow modal via CSS) with three actions — Keep
 * local / Keep remote / Merge (an editable field seeded with the local version).
 * Applying a choice removes the conflict from the list and returns to it; when
 * the list empties the modal closes.
 *
 * Thin by design: ALL logic lives in {@link ResolverModalContext} (the testable
 * `QuarantineResolverCommands`). This file is render + a11y only.
 *
 * a11y (RFC 0002 §3.11 / P16): every action button carries an explicit
 * `aria-label` (never a glyph alone); the resolve actions reference a
 * `aria-describedby` consequence line; focus is managed on view transitions.
 */
export class QuarantineResolverModal extends Modal {
  private readonly ctx: ResolverModalContext;
  private remaining: ResolvableConflict[];

  constructor(app: App, ctx: ResolverModalContext) {
    super(app);
    this.ctx = ctx;
    this.remaining = [...ctx.conflicts];
  }

  override onOpen(): void {
    this.renderList();
  }

  override onClose(): void {
    this.contentEl.empty();
    // Release the D11 busy flag — a sync / apply may run again.
    this.ctx.onClose();
  }

  private renderList(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("exosync-resolver");
    contentEl.createEl("h2", {
      cls: "exosync-resolver-title",
      text: "Resolve sync conflicts",
    });
    contentEl.createEl("p", {
      cls: "exosync-resolver-intro",
      text:
        `${this.remaining.length} conflict${this.remaining.length === 1 ? "" : "s"} ` +
        "need a choice. Both versions are preserved until you confirm.",
    });

    const list = contentEl.createEl("div", { cls: "exosync-resolver-list" });
    for (const conflict of this.remaining) {
      const sides =
        `${conflict.hasLocal ? "local" : "(no local)"} vs ` +
        `${conflict.hasRemote ? "remote" : "(no remote)"}`;
      const row = list.createEl("button", {
        cls: "exosync-resolver-row",
        text: `${conflict.path}  —  ${sides}`,
      });
      row.setAttribute(
        "aria-label",
        `Open conflict ${conflict.path} (${sides}) in ${conflict.repoKey}`,
      );
      row.addEventListener("click", () => {
        void this.renderDetail(conflict);
      });
    }

    const actions = contentEl.createEl("div", {
      cls: "modal-button-container exosync-resolver-actions",
    });
    const closeBtn = actions.createEl("button", { text: "Close" });
    closeBtn.setAttribute("aria-label", "Close the resolver");
    closeBtn.addEventListener("click", () => this.close());
    this.tryFocus(list.querySelector("button") ?? closeBtn);
  }

  private async renderDetail(conflict: ResolvableConflict): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", {
      cls: "exosync-resolver-title",
      text: conflict.path,
    });

    const consequenceId = "exosync-resolver-consequence";
    const consequence = contentEl.createEl("p", {
      cls: "exosync-resolver-consequence",
      text:
        "Choosing writes the kept version to disk AND to the remote; the other " +
        "version stays recoverable (remote in git history, local in a .conflict.local.txt backup).",
    });
    consequence.setAttribute("id", consequenceId);

    let detail: ConflictDetail;
    try {
      detail = await this.ctx.loadConflict(conflict);
    } catch (err) {
      contentEl.createEl("p", {
        cls: "exosync-resolver-error",
        text: `Could not load both versions: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
      this.backButton(contentEl);
      return;
    }

    const cols = contentEl.createEl("div", { cls: "exosync-resolver-cols" });
    this.versionColumn(cols, "Local (yours)", detail.local);
    this.versionColumn(cols, "Remote (theirs)", detail.remote);

    // Merge field — seeded with local (or remote when local is absent).
    const mergeWrap = contentEl.createEl("div", { cls: "exosync-resolver-merge" });
    mergeWrap.createEl("label", {
      cls: "exosync-resolver-merge-label",
      text: "Merge manually (edit, then resolve with merged):",
      attr: { for: "exosync-resolver-merge-area" },
    });
    const area = mergeWrap.createEl("textarea", {
      cls: "exosync-resolver-merge-area",
    });
    area.setAttribute("id", "exosync-resolver-merge-area");
    area.setAttribute("aria-label", `Merged content for ${conflict.path}`);
    area.value = detail.local ?? detail.remote ?? "";

    const actions = contentEl.createEl("div", {
      cls: "modal-button-container exosync-resolver-detail-actions",
    });

    const keepLocal = actions.createEl("button", {
      cls: "mod-cta",
      text: "Keep local",
    });
    keepLocal.setAttribute(
      "aria-label",
      `Keep your local version of ${conflict.path} (overwrites the remote)`,
    );
    keepLocal.setAttribute("aria-describedby", consequenceId);
    keepLocal.toggleAttribute("disabled", !conflict.hasLocal);
    keepLocal.addEventListener("click", () => {
      void this.applyChoice(conflict, { take: "local" });
    });

    const keepRemote = actions.createEl("button", { text: "Keep remote" });
    keepRemote.setAttribute(
      "aria-label",
      `Keep the remote version of ${conflict.path} (your local is backed up first)`,
    );
    keepRemote.setAttribute("aria-describedby", consequenceId);
    keepRemote.addEventListener("click", () => {
      void this.applyChoice(conflict, { take: "remote" });
    });

    const keepMerged = actions.createEl("button", { text: "Resolve with merged" });
    keepMerged.setAttribute(
      "aria-label",
      `Resolve ${conflict.path} with your hand-merged content`,
    );
    keepMerged.setAttribute("aria-describedby", consequenceId);
    keepMerged.addEventListener("click", () => {
      void this.applyChoice(conflict, { take: "merged", content: area.value });
    });

    this.backButton(actions);
    this.tryFocus(keepLocal.hasAttribute("disabled") ? keepRemote : keepLocal);
  }

  private versionColumn(
    parent: HTMLElement,
    heading: string,
    content: string | undefined,
  ): void {
    const col = parent.createEl("div", { cls: "exosync-resolver-col" });
    col.createEl("h3", { cls: "exosync-resolver-col-title", text: heading });
    col.createEl("pre", {
      cls: "exosync-resolver-col-body",
      text: content ?? "(deleted on this side)",
    });
  }

  private backButton(parent: HTMLElement): void {
    const back = parent.createEl("button", { text: "Back to list" });
    back.setAttribute("aria-label", "Back to the conflict list");
    back.addEventListener("click", () => this.renderList());
  }

  private async applyChoice(
    conflict: ResolvableConflict,
    choice: ResolveChoice,
  ): Promise<void> {
    const result = await this.ctx.resolveOne(conflict, choice);
    if (result === null) {
      // Failure already surfaced — keep the conflict listed for a retry.
      return;
    }
    this.remaining = this.remaining.filter(
      (c) => !(c.repoKey === conflict.repoKey && c.path === conflict.path),
    );
    if (this.remaining.length === 0) {
      this.ctx.notify("All sync conflicts resolved ✅ — run Sync to finalise.");
      this.close();
      return;
    }
    this.renderList();
  }

  private tryFocus(el: HTMLElement | null): void {
    try {
      el?.focus();
    } catch {
      /* focus is best-effort (jsdom / headless) */
    }
  }
}
