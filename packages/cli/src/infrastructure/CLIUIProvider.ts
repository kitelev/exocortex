/**
 * CLIUIProvider - Headless UI provider for CLI mode
 *
 * Implements IUIProvider interface for command-line execution.
 * All UI-interactive methods throw HeadlessError with CLI alternatives.
 *
 * @see /Users/kitelev/vault-2025/03 Knowledge/concepts/RDF-Driven Architecture Implementation Plan (Note).md
 * Phase 2: IUIProvider + Headless Mode (lines 1344-1384)
 */

import type { IUIProvider, ModalOptions, SelectOptions } from "exocortex";
import { HeadlessError } from "exocortex";

/**
 * CLI implementation of IUIProvider (headless mode).
 *
 * In CLI mode:
 * - Interactive operations (modals, confirmations) throw HeadlessError
 * - Non-interactive operations (notify, navigate) print to stdout
 * - Actions should check `isHeadless` and use CLI arguments instead
 *
 * @example
 * ```typescript
 * const provider = new CLIUIProvider();
 *
 * // This will throw HeadlessError
 * await provider.showInputModal({ title: "Enter name" });
 *
 * // This will print to stdout
 * provider.notify("Operation completed");
 * ```
 */
export class CLIUIProvider implements IUIProvider {
  /**
   * Always true for CLI mode - indicates headless environment.
   */
  readonly isHeadless = true;

  /**
   * Show input modal - throws HeadlessError in CLI mode.
   *
   * @param options - Modal configuration options
   * @throws HeadlessError - Always thrown in CLI mode
   */
  async showInputModal(options: ModalOptions): Promise<string> {
    throw new HeadlessError(
      `Input modal: "${options.title}"`,
      `Use CLI argument instead of modal`
    );
  }

  /**
   * Show selection modal - throws HeadlessError in CLI mode.
   *
   * @template T - Type of items in selection list
   * @param options - Selection modal configuration
   * @throws HeadlessError - Always thrown in CLI mode
   */
  async showSelectModal<T>(options: SelectOptions<T>): Promise<T> {
    throw new HeadlessError(
      `Selection: "${options.title}"`,
      `Use --select argument with item ID`
    );
  }

  /**
   * Show confirmation dialog - throws HeadlessError in CLI mode.
   *
   * @param message - Confirmation message to display
   * @throws HeadlessError - Always thrown in CLI mode
   */
  async showConfirm(message: string): Promise<boolean> {
    throw new HeadlessError(
      `Confirmation: "${message}"`,
      `Use --force to skip confirmation`
    );
  }

  /**
   * Display notification message by printing to stdout.
   *
   * @param message - Notification message
   * @param _duration - Ignored in CLI mode (optional, for Obsidian compatibility)
   */
  notify(message: string, _duration?: number): void {
    console.log(message);
  }

  /**
   * Navigate to an asset by printing the target path to stdout.
   *
   * @param target - Target asset path or identifier
   */
  async navigate(target: string): Promise<void> {
    console.log(`Target: ${target}`);
  }
}
