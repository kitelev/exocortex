import type { IVaultContext, IVaultAdapter } from "exocortex";

/**
 * Single vault context implementation for backward compatibility.
 * Wraps an IVaultAdapter with vault identity information.
 */
export class SingleVaultContext implements IVaultContext {
  readonly vaultId: string;
  readonly vaultName: string;
  readonly vaultAdapter: IVaultAdapter;
  readonly isActive: boolean;
  readonly vaultPath?: string;

  constructor(
    vaultId: string,
    vaultName: string,
    vaultAdapter: IVaultAdapter,
    isActive: boolean = true,
    vaultPath?: string,
  ) {
    this.vaultId = vaultId;
    this.vaultName = vaultName;
    this.vaultAdapter = vaultAdapter;
    this.isActive = isActive;
    this.vaultPath = vaultPath;
  }
}
