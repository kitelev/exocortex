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
  metadata: Record<string, any>;
  isArchived: boolean;
  currentFolder: string;
  expectedFolder: string | null;
}
