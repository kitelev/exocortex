import type { IVaultAdapter } from "./IVaultAdapter";

/**
 * Represents a vault context with identity information.
 * Wraps IVaultAdapter with vault identification for multi-vault support.
 */
export interface IVaultContext {
  /**
   * Unique identifier for this vault instance.
   * Used to distinguish between multiple vaults in a multi-vault setup.
   */
  readonly vaultId: string;

  /**
   * Human-readable name for the vault.
   * Typically the vault folder name or user-defined name.
   */
  readonly vaultName: string;

  /**
   * The underlying vault adapter for file operations.
   */
  readonly vaultAdapter: IVaultAdapter;

  /**
   * Whether this vault is currently active (focused).
   * Only one vault can be active at a time in single-focus mode.
   */
  readonly isActive: boolean;

  /**
   * Optional path to the vault root directory.
   * Useful for CLI operations and cross-vault references.
   */
  readonly vaultPath?: string;
}
