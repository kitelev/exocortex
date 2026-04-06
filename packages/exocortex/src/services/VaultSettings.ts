import { injectable } from "tsyringe";
import type { IVaultSettings } from "../interfaces/IVaultSettings";

export const DEFAULT_OWNER_IDENTITY = '"[[!kitelev]]"';
export const DEFAULT_INBOX_FOLDER = "01 Inbox";

export interface VaultSettingsConfig {
  ownerIdentity?: string;
  defaultInboxFolder?: string;
}

/**
 * Provides vault-level settings such as owner identity and default folders.
 *
 * Values are supplied at construction time (typically by the plugin layer)
 * and fall back to sensible defaults when not configured.
 */
@injectable()
export class VaultSettings implements IVaultSettings {
  private readonly ownerIdentity: string;
  private readonly defaultInboxFolder: string;

  constructor(config?: VaultSettingsConfig) {
    this.ownerIdentity = config?.ownerIdentity ?? DEFAULT_OWNER_IDENTITY;
    this.defaultInboxFolder = config?.defaultInboxFolder ?? DEFAULT_INBOX_FOLDER;
  }

  getOwnerIdentity(): string {
    return this.ownerIdentity;
  }

  getDefaultInboxFolder(): string {
    return this.defaultInboxFolder;
  }
}
