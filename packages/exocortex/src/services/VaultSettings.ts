import { injectable } from "tsyringe";
import type { IVaultSettings } from "../interfaces/IVaultSettings";

export const DEFAULT_OWNER_IDENTITY = '"[[!kitelev]]"';
export const DEFAULT_INBOX_FOLDER = "01 Inbox";
export const DEFAULT_FLEETING_NOTE_CLASS_UID = "fca0a931-a01f-48e4-b72a-4af206c94bc7";

export interface VaultSettingsConfig {
  ownerIdentity?: string;
  defaultInboxFolder?: string;
  fleetingNoteClassUID?: string;
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
  private readonly fleetingNoteClassUID: string;

  constructor(config?: VaultSettingsConfig) {
    this.ownerIdentity = config?.ownerIdentity ?? DEFAULT_OWNER_IDENTITY;
    this.defaultInboxFolder = config?.defaultInboxFolder ?? DEFAULT_INBOX_FOLDER;
    this.fleetingNoteClassUID = config?.fleetingNoteClassUID ?? DEFAULT_FLEETING_NOTE_CLASS_UID;
  }

  getOwnerIdentity(): string {
    return this.ownerIdentity;
  }

  getDefaultInboxFolder(): string {
    return this.defaultInboxFolder;
  }

  getFleetingNoteClassUID(): string {
    return this.fleetingNoteClassUID;
  }
}
