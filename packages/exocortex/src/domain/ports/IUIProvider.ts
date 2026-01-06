/**
 * IUIProvider - Unified UI abstraction for CLI/Obsidian compatibility
 *
 * This interface allows ActionInterpreter to work in both Obsidian (with modals)
 * and CLI (headless mode). Actions check `ctx.uiProvider.isHeadless` to choose strategy.
 *
 * @see /Users/kitelev/vault-2025/03 Knowledge/concepts/RDF-Driven Architecture Implementation Plan (Note).md
 * Phase 2: IUIProvider + Headless Mode (lines 1244-1417)
 */

/**
 * Options for displaying input modal dialogs
 */
export interface ModalOptions {
  /** Modal dialog title */
  title: string;
  /** Placeholder text for input field */
  placeholder?: string;
  /** Default value to pre-populate */
  defaultValue?: string;
  /** Label for submit button */
  submitLabel?: string;
}

/**
 * Options for displaying selection modal dialogs
 * @template T - Type of items in the selection list
 */
export interface SelectOptions<T> {
  /** Modal dialog title */
  title: string;
  /** Items available for selection */
  items: T[];
  /** Function to extract display label from item */
  getLabel: (item: T) => string;
  /** Placeholder text for search/filter */
  placeholder?: string;
}

/**
 * UI Provider interface for CLI/Obsidian abstraction
 *
 * Implementations:
 * - ObsidianUIProvider: Uses Obsidian modals and notices
 * - CLIUIProvider: Headless mode, throws HeadlessError for interactive operations
 */
export interface IUIProvider {
  /**
   * Show input modal and get user input
   * @param options - Modal configuration options
   * @returns Promise resolving to user input string
   * @throws HeadlessError in CLI mode (use CLI arguments instead)
   */
  showInputModal(options: ModalOptions): Promise<string>;

  /**
   * Show selection modal and get selected item
   * @template T - Type of items in selection list
   * @param options - Selection modal configuration
   * @returns Promise resolving to selected item
   * @throws HeadlessError in CLI mode (use --select argument with item ID)
   */
  showSelectModal<T>(options: SelectOptions<T>): Promise<T>;

  /**
   * Show confirmation dialog
   * @param message - Confirmation message to display
   * @returns Promise resolving to user's boolean choice
   * @throws HeadlessError in CLI mode (use --force to skip confirmation)
   */
  showConfirm(message: string): Promise<boolean>;

  /**
   * Display notification message
   * - In Obsidian: Shows Notice popup
   * - In CLI: No-op or prints to stdout
   * @param message - Notification message
   * @param duration - Display duration in milliseconds (optional)
   */
  notify(message: string, duration?: number): void;

  /**
   * Navigate to an asset
   * - In Obsidian: Opens file in workspace
   * - In CLI: Prints path to stdout
   * @param target - Target asset path or identifier
   */
  navigate(target: string): Promise<void>;

  /**
   * Check if running in headless mode (CLI)
   * Actions should check this to choose appropriate strategy:
   * - true: Use CLI arguments, avoid interactive operations
   * - false: Can use modals and interactive UI
   */
  readonly isHeadless: boolean;
}

/**
 * Error thrown when an action requires UI but is running in headless (CLI) mode
 *
 * Contains guidance on CLI alternative approaches.
 *
 * @example
 * ```typescript
 * if (ctx.uiProvider.isHeadless) {
 *   throw new HeadlessError(
 *     'Select destination project',
 *     'Use --project <name> argument'
 *   );
 * }
 * ```
 */
export class HeadlessError extends Error {
  /**
   * Create a HeadlessError
   * @param action - Description of the action that requires UI
   * @param cliAlternative - Suggested CLI alternative approach
   */
  constructor(
    public readonly action: string,
    public readonly cliAlternative: string
  ) {
    super(`"${action}" requires UI. CLI alternative: ${cliAlternative}`);
    this.name = "HeadlessError";
  }
}
