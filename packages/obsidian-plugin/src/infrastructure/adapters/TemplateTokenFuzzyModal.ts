import { App, FuzzySuggestModal, type FuzzyMatch } from "obsidian";

import type { TemplateTokenChoice } from "./TemplateTokenInserter";

/**
 * TemplateTokenFuzzyModal — fuzzy picker for the editor "Insert template token"
 * command (homoiconic templating MVP). Interview Q5: reuse the `Apply profile`
 * FuzzySuggestModal UX (fuzzy search + native keyboard nav + a11y) rather than a
 * bespoke menu.
 *
 * Lifecycle contract (⚠ order matters — same as ProfileFuzzyModal, Issue #3561):
 *   - `onChooseItem` only RECORDS the chosen value (does NOT resolve).
 *   - `onClose` performs the single resolution, deferred to a microtask.
 *   - The Promise resolves exactly once; a `settled` flag suppresses Obsidian's
 *     double `onClose`.
 *
 * Why resolution is deferred (the picker-no-op bug): Obsidian's real
 * `SuggestModal.selectSuggestion` calls `close()` (→ `onClose`) BEFORE
 * `onChooseItem`, both synchronously in one selection. A synchronous resolve in
 * `onClose` would see no choice recorded yet and resolve `null` — making every
 * picker selection a silent no-op. The microtask runs after the synchronous
 * `selectSuggestion` stack, by which point `onChooseItem` has recorded the
 * choice; a cancel (Escape) records nothing and resolves `null`. Order-independent.
 */
export class TemplateTokenFuzzyModal extends FuzzySuggestModal<TemplateTokenChoice> {
  private chosen: TemplateTokenChoice | null = null;
  private settled = false;
  private readonly resolveChoice: (value: TemplateTokenChoice | null) => void;

  constructor(
    app: App,
    private readonly options: readonly TemplateTokenChoice[],
    title: string,
    resolve: (value: TemplateTokenChoice | null) => void,
  ) {
    super(app);
    this.resolveChoice = resolve;
    this.setPlaceholder(title);
  }

  getItems(): TemplateTokenChoice[] {
    return [...this.options];
  }

  /**
   * Fuzzy-searchable text — label first (so a user can type "uuid" / "date"),
   * then the description so the description is searchable too, not just
   * decorative.
   */
  getItemText(item: TemplateTokenChoice): string {
    return `${item.label} — ${item.description}`;
  }

  /**
   * Structured suggestion row: a title line (label) and a muted description
   * line. Both carry visible text, so assistive tech announces the full row
   * naturally — no redundant `aria-label` (which would override, not augment,
   * the text). The fuzzy picker itself is natively keyboard-navigable, which is
   * the a11y win (interview Q5). Overriding `renderSuggestion` replaces
   * Obsidian's default fuzzy-highlight rendering, acceptable for this small
   * curated list; `getItemText` still drives the fuzzy match.
   */
  override renderSuggestion(
    match: FuzzyMatch<TemplateTokenChoice>,
    el: HTMLElement,
  ): void {
    const item = match.item;
    el.addClass("exocortex-token-suggestion");
    el.createDiv({
      cls: "exocortex-token-suggestion__title",
      text: item.label,
    });
    el.createDiv({
      cls: "exocortex-token-suggestion__desc",
      text: item.description,
    });
  }

  onChooseItem(item: TemplateTokenChoice): void {
    // Record only — Obsidian fires this AFTER onClose (see class docstring), so
    // the single resolution happens in onClose's deferred microtask.
    this.chosen = item;
  }

  override onClose(): void {
    // Schedule the single resolution BEFORE super.onClose() so a throw from
    // Obsidian's DOM teardown cannot leave the awaiter pending forever. The
    // microtask still runs after the whole synchronous selectSuggestion stack
    // (close → onChooseItem), so `chosen` is populated for a real selection and
    // stays null for a cancel.
    if (!this.settled) {
      this.settled = true;
      queueMicrotask(() => this.resolveChoice(this.chosen));
    }
    super.onClose();
  }
}

/**
 * Open the token picker and resolve with the chosen token, or `null` when the
 * user dismisses it without selecting. Mirrors `ProfileCommands.fuzzyPick`.
 */
export function pickTemplateToken(
  app: App,
  options: readonly TemplateTokenChoice[],
  title: string,
): Promise<TemplateTokenChoice | null> {
  return new Promise((resolve) => {
    new TemplateTokenFuzzyModal(app, options, title, resolve).open();
  });
}
