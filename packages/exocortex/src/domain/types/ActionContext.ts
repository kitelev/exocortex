/**
 * ActionContext - Context object for Action handlers
 *
 * Provides Actions with access to all necessary services and state
 * for executing operations in both Obsidian and CLI environments.
 *
 * @see /Users/kitelev/vault-2025/03 Knowledge/concepts/RDF-Driven Architecture Implementation Plan (Note).md
 * Phase 2: IUIProvider + Headless Mode (lines 1386-1403)
 *
 * Issue #1400: Add uiProvider to ActionContext
 * @see https://github.com/kitelev/exocortex/issues/1400
 */

import { ITripleStore } from "../../interfaces/ITripleStore";
import { IUIProvider } from "../ports/IUIProvider";
import { IFile } from "../../interfaces/IVaultAdapter";

/**
 * Context object passed to Action handlers.
 *
 * Actions receive this context to access:
 * - tripleStore: For SPARQL queries and triple manipulation
 * - uiProvider: For UI operations (modals, notifications, navigation)
 * - currentAsset: The currently active file (optional)
 * - cliArgs: CLI arguments when running in headless mode (optional)
 *
 * @example
 * ```typescript
 * async function handleAction(ctx: ActionContext): Promise<void> {
 *   // Check if running headless (CLI)
 *   if (ctx.uiProvider.isHeadless) {
 *     // Use CLI arguments instead of modal
 *     const targetProject = ctx.cliArgs?.project;
 *     if (!targetProject) {
 *       throw new HeadlessError('Select project', 'Use --project <name>');
 *     }
 *   } else {
 *     // Show interactive modal
 *     const targetProject = await ctx.uiProvider.showInputModal({
 *       title: 'Select Project',
 *       placeholder: 'Enter project name...'
 *     });
 *   }
 * }
 * ```
 */
export interface ActionContext {
  /** Current asset file (if any) */
  currentAsset?: IFile;

  /** Triple store for SPARQL queries */
  tripleStore: ITripleStore;

  /**
   * UI provider (Obsidian modals or CLI fallback)
   *
   * Use `uiProvider.isHeadless` to check execution mode:
   * - true: CLI mode, avoid interactive operations
   * - false: Obsidian mode, can use modals and UI
   */
  uiProvider: IUIProvider;

  /** CLI arguments (if running in CLI mode) */
  cliArgs?: Record<string, string>;
}
