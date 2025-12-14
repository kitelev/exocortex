import type {
  IMultiVaultManager,
  IVaultContext,
  VaultChangeCallback,
} from "exocortex";

/**
 * Single vault manager implementation for backward compatibility.
 * Manages a single vault context, providing a no-op implementation
 * for multi-vault operations that don't apply to single-vault scenarios.
 */
export class SingleVaultManager implements IMultiVaultManager {
  private vault: IVaultContext;
  private callbacks: Set<VaultChangeCallback> = new Set();

  constructor(vault: IVaultContext) {
    this.vault = vault;
  }

  getCurrentVault(): IVaultContext {
    return this.vault;
  }

  async setCurrentVault(vaultId: string): Promise<void> {
    if (vaultId !== this.vault.vaultId) {
      throw new Error(
        `Cannot switch to vault ${vaultId}: only single vault ${this.vault.vaultId} is available`,
      );
    }
  }

  getVault(vaultId: string): IVaultContext | null {
    if (vaultId === this.vault.vaultId) {
      return this.vault;
    }
    return null;
  }

  listVaults(): IVaultContext[] {
    return [this.vault];
  }

  registerVault(context: IVaultContext): void {
    if (context.vaultId === this.vault.vaultId) {
      return;
    }
    throw new Error(
      `SingleVaultManager does not support multiple vaults. Cannot register vault ${context.vaultId}`,
    );
  }

  unregisterVault(vaultId: string): void {
    if (vaultId === this.vault.vaultId) {
      throw new Error("Cannot unregister the only vault in SingleVaultManager");
    }
  }

  onVaultChanged(callback: VaultChangeCallback): () => void {
    this.callbacks.add(callback);
    return () => {
      this.callbacks.delete(callback);
    };
  }

  hasVault(vaultId: string): boolean {
    return vaultId === this.vault.vaultId;
  }

  getVaultCount(): number {
    return 1;
  }
}
