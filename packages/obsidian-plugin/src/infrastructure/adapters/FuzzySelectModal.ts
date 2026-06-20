import { App, FuzzySuggestModal, type FuzzyMatch } from "obsidian";

/**
 * FuzzySelectModal — a generic fuzzy picker reusing the `Apply profile` /
 * MVP-token UX (fuzzy search + native keyboard nav + a11y), with the Issue
 * #3561 close-before-choose lifecycle fix baked in.
 *
 * Extracted so new pickers (e.g. the Веха 2 "Insert template" command) do not
 * re-implement the subtle resolution-ordering contract. The MVP
 * `TemplateTokenFuzzyModal` predates this and is left untouched (shipped,
 * working) — this generic form is for new callers.
 *
 * Lifecycle contract (⚠ order matters — Issue #3561): Obsidian's real
 * `SuggestModal.selectSuggestion` calls `close()` (→ `onClose`) BEFORE
 * `onChooseItem`, synchronously in one selection. `onChooseItem` therefore only
 * RECORDS the choice; the single resolution is deferred to a microtask in
 * `onClose` (runs after the synchronous select stack, so the choice is
 * populated for a real selection and stays null for an Escape cancel).
 */

/** A rendered picker row: a title line and an optional muted description line. */
export interface FuzzySelectRow {
  readonly title: string;
  readonly description?: string;
}

export class FuzzySelectModal<T> extends FuzzySuggestModal<T> {
  private chosen: T | null = null;
  private settled = false;
  private readonly resolveChoice: (value: T | null) => void;

  constructor(
    app: App,
    private readonly options: readonly T[],
    private readonly toRow: (item: T) => FuzzySelectRow,
    placeholder: string,
    resolve: (value: T | null) => void,
  ) {
    super(app);
    this.resolveChoice = resolve;
    this.setPlaceholder(placeholder);
  }

  getItems(): T[] {
    return [...this.options];
  }

  /** Fuzzy-searchable text — title first, then description (so both match). */
  getItemText(item: T): string {
    const row = this.toRow(item);
    return row.description ? `${row.title} — ${row.description}` : row.title;
  }

  /**
   * Structured suggestion row reusing the `exocortex-token-suggestion` CSS
   * (already shipped for the MVP picker) — title line + optional muted desc.
   * Both carry visible text so assistive tech announces the full row; the
   * fuzzy picker is natively keyboard-navigable (the a11y win).
   */
  override renderSuggestion(match: FuzzyMatch<T>, el: HTMLElement): void {
    const row = this.toRow(match.item);
    el.addClass("exocortex-token-suggestion");
    el.createDiv({
      cls: "exocortex-token-suggestion__title",
      text: row.title,
    });
    if (row.description) {
      el.createDiv({
        cls: "exocortex-token-suggestion__desc",
        text: row.description,
      });
    }
  }

  onChooseItem(item: T): void {
    // Record only — Obsidian fires this AFTER onClose (see class docstring).
    this.chosen = item;
  }

  override onClose(): void {
    if (!this.settled) {
      this.settled = true;
      queueMicrotask(() => this.resolveChoice(this.chosen));
    }
    super.onClose();
  }
}

/**
 * Open a fuzzy picker over `options` and resolve with the chosen item, or
 * `null` when dismissed (Escape) without a selection.
 */
export function fuzzySelect<T>(
  app: App,
  options: readonly T[],
  toRow: (item: T) => FuzzySelectRow,
  placeholder: string,
): Promise<T | null> {
  return new Promise((resolve) => {
    new FuzzySelectModal(app, options, toRow, placeholder, resolve).open();
  });
}
