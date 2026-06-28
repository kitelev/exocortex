import { App, FuzzySuggestModal } from "obsidian";

import type { OntologyChoice } from "./PluginVaultCheckReader";

/**
 * OntologyFuzzyModal — `FuzzySuggestModal` for `Scaffold validation settings`'s
 * ontology choice (RFC f402002b, M1.5). Resolves the caller's Promise with the
 * chosen ontology, or `null` when the user dismisses without selecting.
 *
 * Uses the deferred-microtask resolution contract proven necessary by the
 * picker-no-op bug (Issue #3561, see {@link ProfileFuzzyModal}): Obsidian's real
 * `SuggestModal.selectSuggestion` fires `close()` (→ `onClose`) BEFORE
 * `onChooseItem`, both synchronously. So `onChooseItem` only RECORDS the choice;
 * `onClose` schedules the single resolution on a microtask (queued before
 * `super.onClose()` so a teardown throw cannot strand the awaiter). The
 * microtask runs after the synchronous selection stack, so a real selection
 * resolves with the item and a cancel resolves with `null` — order-independent.
 */
export class OntologyFuzzyModal extends FuzzySuggestModal<OntologyChoice> {
  private chosen: OntologyChoice | null = null;
  private settled = false;
  private readonly resolveChoice: (value: OntologyChoice | null) => void;

  constructor(
    app: App,
    private readonly options: OntologyChoice[],
    title: string,
    resolve: (value: OntologyChoice | null) => void,
  ) {
    super(app);
    this.resolveChoice = resolve;
    this.setPlaceholder(title);
  }

  getItems(): OntologyChoice[] {
    return this.options;
  }

  /** Human label, never the UID (P10). Folder shown so duplicate labels disambiguate. */
  getItemText(item: OntologyChoice): string {
    return item.folder.length > 0 ? `${item.label} — ${item.folder}` : item.label;
  }

  onChooseItem(item: OntologyChoice): void {
    // Record only — resolution happens in onClose's deferred microtask.
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
