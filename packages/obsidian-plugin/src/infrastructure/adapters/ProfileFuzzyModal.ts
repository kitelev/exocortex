import { App, FuzzySuggestModal, type FuzzyMatch } from "obsidian";

import type { ProfileChoice } from "./ProfileCommands";

/** Badge text for `exo__Profile_recommended` profiles (RFC 0002 §3.4 P7). */
export const RECOMMENDED_BADGE_TEXT = "Recommended for new users";

/**
 * ProfileFuzzyModal — thin Obsidian `FuzzySuggestModal` wrapper used by
 * `ProfileCommands.fuzzyPick` (RFC 0a0791c1 §B.11). Resolves the
 * caller's Promise with the chosen profile, or `null` when the user
 * dismisses the picker without selecting anything.
 *
 * Lifecycle contract (⚠ order matters — see «close-before-choose» below):
 *   - `onChooseItem` only RECORDS the chosen value (does NOT resolve).
 *   - `onClose` performs the single resolution, deferred to a microtask,
 *     using whatever `onChooseItem` recorded (or `null` on cancel).
 *   - The Promise resolves exactly once; a `settled` flag suppresses the
 *     double `onClose` that Obsidian can emit.
 *
 * ## Why resolution is deferred (the picker-no-op bug, Issue #3561)
 *
 * Obsidian's real `SuggestModal.selectSuggestion` runs (verified against
 * `obsidian.asar`):
 *
 *   selectSuggestion(e, t) {
 *     this.app.keymap.updateModifiers(t);
 *     this.close();                  // ← onClose() FIRES FIRST
 *     this.isOpen = false;
 *     this.onChooseSuggestion(e, t); // ← onChooseItem(e.item) AFTER close
 *   }
 *
 * and `FuzzySuggestModal.onChooseSuggestion(e,t)` → `onChooseItem(e.item, t)`.
 * So on a real selection `close()` (→ `onClose`) runs BEFORE `onChooseItem`,
 * both synchronously inside one `selectSuggestion` call.
 *
 * The previous implementation resolved synchronously inside `onClose`: it saw
 * no choice recorded yet, resolved with `null`, and the `onChooseItem` that
 * fired immediately afterwards was suppressed by the guard flag. Result —
 * `fuzzyPick` resolved `null`, `ProfileCommands.invokeApplyProfile` treated it
 * as «user cancelled» and returned silently → the human-path picker selection
 * was a NO-OP (apply only ran via the DevTools `applyProfile(uid)` workaround).
 *
 * The fix: `onChooseItem` records the choice; `onClose` schedules the single
 * resolution on a microtask. The microtask runs after the synchronous
 * `selectSuggestion` stack completes — by which point `onChooseItem` has
 * recorded the chosen item — so a selection resolves with the item and a
 * cancel (Escape, no choice) resolves with `null`. Order-independent.
 *
 * Active profile is decorated с trailing «✓ (active)» so users can see
 * the current selection без duplicating the picker state.
 */
export class ProfileFuzzyModal extends FuzzySuggestModal<ProfileChoice> {
  private chosen: ProfileChoice | null = null;
  private settled = false;
  private readonly resolve: (value: ProfileChoice | null) => void;
  private readonly initialQuery: string;

  constructor(
    app: App,
    private readonly options: ProfileChoice[],
    title: string,
    resolve: (value: ProfileChoice | null) => void,
    initialQuery?: string,
  ) {
    super(app);
    this.resolve = resolve;
    this.initialQuery = (initialQuery ?? "").trim();
    this.setPlaceholder(title);
  }

  /**
   * Pre-narrow the fuzzy filter when launched from the first-run onboarding
   * panel (RFC 0002 §3.1 step 3 — open the picker on `starter`). Sets the
   * search input and fires an `input` event so Obsidian re-filters. Best-effort
   * — the full list is still present, so a context where the synthetic event is
   * ignored just shows the unfiltered picker with the query pre-typed.
   */
  override onOpen(): void {
    super.onOpen();
    if (this.initialQuery.length > 0) {
      try {
        this.inputEl.value = this.initialQuery;
        this.inputEl.dispatchEvent(new Event("input"));
      } catch {
        /* pre-narrow is best-effort; the picker still lists every profile */
      }
    }
  }

  getItems(): ProfileChoice[] {
    return this.options;
  }

  /**
   * Fuzzy-searchable text for an item. Includes the description and the
   * «recommended» marker so a user can type either to find a profile (the
   * description is searchable, not just decorative). The «show all» sentinel
   * returns its label verbatim. Order — label first — so the existing
   * label-only assertions and the e2e `allTextContents` label check still hold.
   */
  getItemText(item: ProfileChoice): string {
    if (item.kind === "show-all") return item.label;
    let text = item.label;
    if (item.isRecommended) text += " (recommended)";
    if (item.description !== undefined && item.description.length > 0) {
      text += ` — ${item.description}`;
    }
    if (item.isActive) text += " ✓ (active)";
    return text;
  }

  /**
   * Render a structured, accessible suggestion row: a title line (label +
   * active marker + «recommended» badge) and, when present, a muted
   * description line (RFC 0002 §3.4 P7/P10 — human label + description, never
   * the raw UID). The «show all profiles» sentinel renders as a single muted
   * line. Overriding `renderSuggestion` replaces Obsidian's default
   * fuzzy-highlight rendering, which is acceptable for this small, curated
   * list; `getItemText` still drives the fuzzy match.
   */
  override renderSuggestion(match: FuzzyMatch<ProfileChoice>, el: HTMLElement): void {
    const item = match.item;
    el.addClass("exocortex-profile-suggestion");

    if (item.kind === "show-all") {
      el.addClass("exocortex-profile-suggestion--show-all");
      el.createDiv({
        cls: "exocortex-profile-suggestion__title",
        text: item.label,
      });
      return;
    }

    const titleEl = el.createDiv({ cls: "exocortex-profile-suggestion__title" });
    // Human label, never the UID (P10).
    titleEl.createSpan({
      cls: "exocortex-profile-suggestion__label",
      text: item.label,
    });
    if (item.isActive) {
      titleEl.createSpan({
        cls: "exocortex-profile-suggestion__active",
        text: " ✓ (active)",
      });
    }
    if (item.isRecommended) {
      titleEl.createSpan({
        cls: "exocortex-profile-suggestion__badge",
        text: RECOMMENDED_BADGE_TEXT,
        // a11y — the visual badge already reads as text; aria-label keeps the
        // semantic explicit for assistive tech even if styling hides glyphs.
        attr: { "aria-label": RECOMMENDED_BADGE_TEXT },
      });
    }

    if (item.description !== undefined && item.description.length > 0) {
      el.createDiv({
        cls: "exocortex-profile-suggestion__desc",
        text: item.description,
      });
    }
  }

  onChooseItem(item: ProfileChoice): void {
    // Record only. Obsidian fires this AFTER onClose (see class docstring),
    // so resolving here would race a close that has already run. The single
    // resolution happens in onClose's deferred microtask, reading `chosen`.
    this.chosen = item;
  }

  override onClose(): void {
    // Schedule the single resolution BEFORE super.onClose() so a throw from
    // Obsidian's DOM teardown cannot leave the awaiter pending forever
    // (code-reviewer medium catch). The microtask still runs after the whole
    // synchronous selectSuggestion stack (close → onChooseItem), so `chosen`
    // is populated for a real selection and stays null for a cancel.
    if (!this.settled) {
      this.settled = true;
      queueMicrotask(() => this.resolve(this.chosen));
    }
    super.onClose();
  }
}
