import { App, Modal } from "obsidian";
import type {
  ConflictDetail,
  ResolvableConflict,
  ResolveChoice,
} from "exocortex";
import type { ResolverModalContext } from "./QuarantineResolverCommands";
import { buildPaneModel, type DiffRow } from "./conflictDiff";

/**
 * QuarantineResolverModal — the «Resolve sync conflicts» UI (finding a0a3d1d6,
 * design interviews 2026-06-20 + 2026-06-21).
 *
 * List → per-file resolve. Picking a conflict renders an IntelliJ-style 3-pane
 * view — **Local (yours) | Merge (result, editable) | Remote (theirs)** — with
 * line-level diff colouring (green = added, red = removed, amber = conflict),
 * per-hunk accept actions, and Prev/Next conflict navigation. The centre Merge
 * pane is seeded with a diff3 auto-merge (non-conflicting changes pre-applied,
 * conflicts default to the local side); the user edits it freely. Applying a
 * choice removes the conflict from the list and returns to it; an empty list
 * closes the modal.
 *
 * Thin by design: ALL resolve logic lives in {@link ResolverModalContext} (the
 * testable `QuarantineResolverCommands`) and the diff maths in the pure
 * {@link buildPaneModel}. This file is render + a11y only; it NEVER touches the
 * zero-loss resolve path — the user's choice still flows out as a `ResolveChoice`.
 *
 * a11y (RFC 0002 §3.11 / P16): every action button (incl. per-hunk + nav)
 * carries an explicit `aria-label`; the resolve actions reference an
 * `aria-describedby` consequence line; diff lines convey meaning by a prefix
 * marker + screen-reader text, not colour alone (WCAG 1.4.1); focus is managed
 * on view transitions.
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

    const model = buildPaneModel(detail);
    // Per-hunk choices: index → side. Default "local" (matches the auto-merge
    // seed); flipping a hunk to "remote" rebuilds the merge text.
    const choices: ("local" | "remote")[] = model.hunks.map(() => "local");
    // Nav anchors — the first DOM element of each conflict hunk per pane.
    const navAnchors: { local: HTMLElement; remote: HTMLElement }[] = [];

    // ── Navigation bar (conflict counter + Prev/Next) ──────────────────────
    // The arrow glyphs are decorative (aria-hidden); the text + aria-label carry
    // the meaning. Keeping the glyph in a separate span keeps the button text in
    // sentence case (the first letter stays the capital).
    const navBar = contentEl.createEl("div", {
      cls: "exosync-resolver-navbar",
    });
    const prevBtn = navBar.createEl("button", {
      cls: "exosync-resolver-nav-btn",
    });
    prevBtn.createEl("span", { text: "◀ ", attr: { "aria-hidden": "true" } });
    prevBtn.createEl("span", { text: "Prev conflict" });
    prevBtn.setAttribute("aria-label", "Scroll to the previous conflict hunk");
    const nextBtn = navBar.createEl("button", {
      cls: "exosync-resolver-nav-btn",
    });
    nextBtn.createEl("span", { text: "Next conflict" });
    nextBtn.createEl("span", { text: " ▶", attr: { "aria-hidden": "true" } });
    nextBtn.setAttribute("aria-label", "Scroll to the next conflict hunk");
    navBar.createEl("span", {
      cls: "exosync-resolver-nav-count",
      text:
        `${model.hunkCount} conflict hunk${model.hunkCount === 1 ? "" : "s"}` +
        ` · ${model.autoMergedCount} auto-merged`,
    });
    // Disabled state is set AFTER the panes render — it keys on the number of
    // navigable (line-level) hunks, which is 0 for a whole-side add/delete
    // conflict (hunkCount === 1 there, but its rows are added/removed, not
    // conflict, so no nav anchor is registered). See the post-renderPane block.

    // ── 3-pane grid: Local | Merge (editable) | Remote ─────────────────────
    const grid = contentEl.createEl("div", { cls: "exosync-resolver-3pane" });

    // The merge textarea is created first so the pane accept-buttons can target
    // it; it is appended into the centre pane below.
    const area = document.createElement("textarea");
    area.className = "exosync-resolver-merge-area";
    area.setAttribute("id", "exosync-resolver-merge-area");
    area.setAttribute("aria-label", `Merged content for ${conflict.path}`);
    area.value = model.autoMerge;

    const applyHunkChoice = (
      hunkIndex: number,
      side: "local" | "remote",
    ): void => {
      choices[hunkIndex] = side;
      area.value = model.rebuildMerge(choices);
      this.tryFocus(area);
    };

    this.renderPane(
      grid,
      "local",
      "Local (yours)",
      conflict.path,
      model.localRows,
      navAnchors,
      applyHunkChoice,
    );
    this.renderMergePane(grid, area);
    this.renderPane(
      grid,
      "remote",
      "Remote (theirs)",
      conflict.path,
      model.remoteRows,
      navAnchors,
      applyHunkChoice,
    );

    // Wire navigation now that anchors exist. Nav is only meaningful when there
    // are line-level conflict hunks to scroll between.
    const navigable = navAnchors.length;
    prevBtn.toggleAttribute("disabled", navigable === 0);
    nextBtn.toggleAttribute("disabled", navigable === 0);
    let activeHunk = -1;
    const gotoHunk = (delta: number): void => {
      if (navAnchors.length === 0) return;
      activeHunk = (activeHunk + delta + navAnchors.length) % navAnchors.length;
      for (let i = 0; i < navAnchors.length; i++) {
        const on = i === activeHunk;
        navAnchors[i].local.toggleClass("is-active-conflict", on);
        navAnchors[i].remote.toggleClass("is-active-conflict", on);
      }
      this.scrollIntoView(navAnchors[activeHunk].local);
      this.scrollIntoView(navAnchors[activeHunk].remote);
    };
    prevBtn.addEventListener("click", () => gotoHunk(-1));
    nextBtn.addEventListener("click", () => gotoHunk(+1));

    // ── Action bar (the three ResolveChoice + back) ────────────────────────
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

    const keepMerged = actions.createEl("button", {
      cls: "mod-cta",
      text: "Resolve with merge",
    });
    keepMerged.setAttribute(
      "aria-label",
      `Resolve ${conflict.path} with the merged content`,
    );
    keepMerged.setAttribute("aria-describedby", consequenceId);
    keepMerged.addEventListener("click", () => {
      void this.applyChoice(conflict, { take: "merged", content: area.value });
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

    this.backButton(actions);
    this.tryFocus(keepLocal.hasAttribute("disabled") ? keepRemote : keepLocal);
  }

  /**
   * Render one read-only side pane (Local or Remote) from its diff rows.
   * Consecutive conflict rows form a hunk: the first row is the nav anchor and
   * the run is followed by a per-hunk accept button.
   */
  private renderPane(
    grid: HTMLElement,
    side: "local" | "remote",
    heading: string,
    path: string,
    rows: DiffRow[],
    navAnchors: { local: HTMLElement; remote: HTMLElement }[],
    applyHunkChoice: (hunkIndex: number, side: "local" | "remote") => void,
  ): void {
    const pane = grid.createEl("div", {
      cls: `exosync-resolver-pane exosync-resolver-pane--${side}`,
    });
    pane.setAttribute("role", "group");
    pane.setAttribute("aria-label", `${heading} version of ${path}`);
    pane.createEl("h3", { cls: "exosync-resolver-pane-title", text: heading });
    const body = pane.createEl("div", { cls: "exosync-resolver-pane-body" });

    let hunkIndex = 0;
    let i = 0;
    while (i < rows.length) {
      const row = rows[i];
      if (row.cls === "conflict" && row.conflictStart) {
        // Group the whole conflict run.
        const hunk = body.createEl("div", { cls: "exosync-diff-hunk" });
        const thisHunkIndex = hunkIndex;
        let firstAnchor: HTMLElement | null = null;
        do {
          const lineEl = this.renderLine(hunk, rows[i]);
          if (firstAnchor === null) firstAnchor = lineEl;
          i++;
        } while (
          i < rows.length &&
          rows[i].cls === "conflict" &&
          !rows[i].conflictStart
        );

        // Per-hunk accept button.
        const acceptBtn = hunk.createEl("button", {
          cls: "exosync-resolver-hunk-btn",
          text: side === "local" ? "◀ use local" : "use remote ▶",
        });
        acceptBtn.setAttribute(
          "aria-label",
          `Use the ${side} version of conflict hunk ${thisHunkIndex + 1} in the merge`,
        );
        acceptBtn.addEventListener("click", () =>
          applyHunkChoice(thisHunkIndex, side),
        );

        // Register / reuse the nav anchor slot for this hunk (both panes write
        // into the SAME slot index, in document order).
        const anchorEl = firstAnchor ?? hunk;
        if (!navAnchors[thisHunkIndex]) {
          navAnchors[thisHunkIndex] = {
            local: anchorEl,
            remote: anchorEl,
          };
        }
        navAnchors[thisHunkIndex][side] = anchorEl;
        hunkIndex++;
      } else {
        this.renderLine(body, row);
        i++;
      }
    }
  }

  /** Render one diff line: marker + SR text + content (meaning ≠ colour only). */
  private renderLine(parent: HTMLElement, row: DiffRow): HTMLElement {
    const line = parent.createEl("div", {
      cls: `exosync-diff-line exosync-diff-${row.cls}`,
    });
    const marker = MARKERS[row.cls];
    line.createEl("span", {
      cls: "exosync-diff-marker",
      text: marker.glyph,
      attr: { "aria-hidden": "true" },
    });
    if (marker.sr) {
      line.createEl("span", {
        cls: "exosync-visually-hidden",
        text: `${marker.sr}: `,
      });
    }
    line.createEl("span", { cls: "exosync-diff-text", text: row.text });
    return line;
  }

  private renderMergePane(grid: HTMLElement, area: HTMLTextAreaElement): void {
    const pane = grid.createEl("div", {
      cls: "exosync-resolver-pane exosync-resolver-pane--merge",
    });
    pane.setAttribute("role", "group");
    pane.setAttribute("aria-label", "Merged result (editable)");
    pane.createEl("h3", {
      cls: "exosync-resolver-pane-title",
      text: "Merge (result) ✎",
    });
    pane.appendChild(area);
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

  private scrollIntoView(el: HTMLElement): void {
    try {
      el.scrollIntoView?.({ block: "nearest" });
    } catch {
      /* scrollIntoView is best-effort (jsdom / headless) */
    }
  }
}

const MARKERS: Record<DiffRow["cls"], { glyph: string; sr: string }> = {
  context: { glyph: " ", sr: "" },
  added: { glyph: "+", sr: "added" },
  removed: { glyph: "-", sr: "removed" },
  conflict: { glyph: "‼", sr: "conflict" }, // ‼
};
