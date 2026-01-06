/**
 * ActionTypes - Type definitions for Action system
 *
 * Provides type-safe interfaces for the ActionInterpreter runtime.
 * All handlers follow consistent contracts defined here.
 *
 * @see /Users/kitelev/vault-2025/03 Knowledge/concepts/RDF-Driven Architecture Implementation Plan (Note).md
 * Phase 3: ActionInterpreter Runtime (lines 1426-1467)
 *
 * Issue #1403: Create ActionTypes.ts with interfaces
 * @see https://github.com/kitelev/exocortex/issues/1403
 */

import { IFile } from "../../interfaces/IVaultAdapter";
import { ActionContext } from "./ActionContext";

/**
 * Result object returned by Action handlers.
 *
 * @example Success with navigation
 * ```typescript
 * const result: ActionResult = {
 *   success: true,
 *   message: "Task created successfully",
 *   navigateTo: newTaskFile,
 *   refresh: true
 * };
 * ```
 *
 * @example Failure with error message
 * ```typescript
 * const result: ActionResult = {
 *   success: false,
 *   message: "Failed to create task: missing required property"
 * };
 * ```
 */
export interface ActionResult {
  /** Whether action succeeded */
  success: boolean;

  /** Success/error message */
  message?: string;

  /** Asset to navigate to after action */
  navigateTo?: IFile;

  /** Whether to refresh UI */
  refresh?: boolean;

  /** Data returned by action (for composite actions) */
  data?: unknown;
}

/**
 * Definition of an action loaded from RDF.
 *
 * Actions are defined in the triple store using exo-ui ontology,
 * and this interface represents the parsed definition.
 *
 * @example
 * ```typescript
 * const definition: ActionDefinition = {
 *   type: "exo-ui:CreateAssetAction",
 *   params: {
 *     assetClass: "Task",
 *     defaultStatus: "active"
 *   }
 * };
 * ```
 */
export interface ActionDefinition {
  /** Action type URI (e.g., exo-ui:CreateAssetAction) */
  type: string;

  /** Action parameters from RDF */
  params: Record<string, unknown>;
}

/**
 * Handler function for executing actions.
 *
 * Handlers receive the action definition (from RDF) and execution context,
 * and return a result indicating success/failure and any side effects.
 *
 * @example
 * ```typescript
 * const createAssetHandler: ActionHandler = async (definition, context) => {
 *   const assetClass = definition.params.assetClass as string;
 *
 *   // Check if running headless
 *   if (context.uiProvider.isHeadless) {
 *     // Use CLI args instead of modal
 *     const name = context.cliArgs?.name;
 *     if (!name) {
 *       return { success: false, message: "Missing --name argument" };
 *     }
 *   } else {
 *     // Show interactive modal
 *     const name = await context.uiProvider.showInputModal({
 *       title: `Create ${assetClass}`,
 *       placeholder: "Enter name..."
 *     });
 *   }
 *
 *   // Create asset using triple store
 *   // ...
 *
 *   return { success: true, navigateTo: newFile, refresh: true };
 * };
 * ```
 */
export type ActionHandler = (
  definition: ActionDefinition,
  context: ActionContext
) => Promise<ActionResult>;
