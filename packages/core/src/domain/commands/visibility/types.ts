/**
 * Command Visibility Types
 *
 * Shared types used across visibility rule files.
 */

/**
 * Context for command visibility checks
 */
export interface CommandVisibilityContext {
  instanceClass: string | string[] | null;
  currentStatus: string | string[] | null;
  metadata: Record<string, unknown>;
  isArchived: boolean;
  currentFolder: string;
  expectedFolder: string | null;
  /** Whether the asset's class is an instance of exo__Prototype (Issue #2261) */
  classIsPrototype?: boolean;
}
