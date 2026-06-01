import { App, FuzzySuggestModal } from "obsidian";

import type { FocusProfileChoice } from "./FocusProfileCommands";

/**
 * ProfileFuzzyModal — thin Obsidian `FuzzySuggestModal` wrapper used by
 * `FocusProfileCommands.fuzzyPick` (RFC 0a0791c1 §B.11). Resolves the
 * caller's Promise with the chosen profile, or `null` when the user
 * dismisses the picker without selecting anything.
 *
 * Lifecycle contract:
 *   - On `onChooseItem` → resolve with the chosen value.
 *   - On `onClose` without a prior choice → resolve with `null`.
 *   - The Promise resolves exactly once; double-fire is suppressed via
 *     a private flag so the «choose then close» sequence does not call
 *     `resolve` twice.
 *
 * Active profile is decorated с trailing «✓ (active)» so users can see
 * the current selection без duplicating the picker state.
 */
export class ProfileFuzzyModal extends FuzzySuggestModal<FocusProfileChoice> {
  private resolved = false;
  private readonly resolve: (value: FocusProfileChoice | null) => void;

  constructor(
    app: App,
    private readonly options: FocusProfileChoice[],
    title: string,
    resolve: (value: FocusProfileChoice | null) => void,
  ) {
    super(app);
    this.resolve = resolve;
    this.setPlaceholder(title);
  }

  getItems(): FocusProfileChoice[] {
    return this.options;
  }

  getItemText(item: FocusProfileChoice): string {
    return item.isActive ? `${item.label} ✓ (active)` : item.label;
  }

  onChooseItem(item: FocusProfileChoice): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolve(item);
  }

  override onClose(): void {
    // Resolve BEFORE super.onClose() so a throw from Obsidian's lifecycle
    // teardown cannot leave the awaiter pending forever (code-reviewer
    // medium catch — Obsidian's FuzzySuggestModal.onClose runs DOM
    // cleanup; rare, but if it throws the resolve below would be
    // skipped → memory leak).
    if (!this.resolved) {
      this.resolved = true;
      this.resolve(null);
    }
    super.onClose();
  }
}
