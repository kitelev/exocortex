import type { IVaultContext } from "./IVaultContext";

/**
 * Callback function for vault change events.
 */
export type VaultChangeCallback = (vault: IVaultContext) => void;

/**
 * Manages multiple vault contexts and provides vault switching capabilities.
 * Implements the multi-vault coordination pattern for cross-vault operations.
 */
export interface IMultiVaultManager {
  /**
   * Gets the currently active vault context.
   * @returns The active vault context.
   * @throws Error if no vault is currently active.
   */
  getCurrentVault(): IVaultContext;

  /**
   * Sets the active vault by its identifier.
   * @param vaultId - The unique identifier of the vault to activate.
   * @returns Promise that resolves when the vault is activated.
   * @throws Error if the vault with the given ID is not found.
   */
  setCurrentVault(vaultId: string): Promise<void>;

  /**
   * Gets a vault context by its identifier.
   * @param vaultId - The unique identifier of the vault.
   * @returns The vault context or null if not found.
   */
  getVault(vaultId: string): IVaultContext | null;

  /**
   * Lists all registered vault contexts.
   * @returns Array of all registered vault contexts.
   */
  listVaults(): IVaultContext[];

  /**
   * Registers a new vault context.
   * @param context - The vault context to register.
   * @throws Error if a vault with the same ID is already registered.
   */
  registerVault(context: IVaultContext): void;

  /**
   * Unregisters a vault context by its identifier.
   * @param vaultId - The unique identifier of the vault to unregister.
   * @throws Error if trying to unregister the currently active vault.
   */
  unregisterVault(vaultId: string): void;

  /**
   * Subscribes to vault change events.
   * @param callback - Function to call when the active vault changes.
   * @returns Unsubscribe function to remove the callback.
   */
  onVaultChanged(callback: VaultChangeCallback): () => void;

  /**
   * Checks if a vault with the given ID is registered.
   * @param vaultId - The unique identifier to check.
   * @returns True if the vault is registered, false otherwise.
   */
  hasVault(vaultId: string): boolean;

  /**
   * Gets the number of registered vaults.
   * @returns The count of registered vaults.
   */
  getVaultCount(): number;
}
