/**
 * Vault-level configuration interface for dependency injection.
 * Provides access to vault owner identity and default folder paths,
 * replacing hardcoded values across creation services.
 */
export interface IVaultSettings {
  /**
   * Returns the vault owner identity as a quoted wikilink.
   * Example: '"[[!kitelev]]"'
   */
  getOwnerIdentity(): string;

  /**
   * Returns the default inbox folder path for new assets.
   * Example: "01 Inbox"
   */
  getDefaultInboxFolder(): string;
}
