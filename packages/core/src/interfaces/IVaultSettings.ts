/**
 * Vault-level configuration interface for dependency injection.
 * Provides access to vault owner identity, default folder paths, and
 * class UIDs, replacing hardcoded values across creation services.
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

  /**
   * Returns the UID of the ztlk__FleetingNote class asset, used to populate
   * `exo__Instance_class` frontmatter on created fleeting notes.
   * (FleetingNoteCreationService removed in RFC 1429fcd0
   * PR-3 — the create-fleeting-note command is now driven by the vault
   * exocmd asset 692aa011-... via ExocmdCommandPaletteRegistrar.)
   */
  getFleetingNoteClassUID(): string;
}
