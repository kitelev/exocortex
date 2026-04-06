import "reflect-metadata";
import { VaultSettings, DEFAULT_OWNER_IDENTITY, DEFAULT_INBOX_FOLDER } from "../../../src/services/VaultSettings";

describe("VaultSettings", () => {
  describe("getOwnerIdentity", () => {
    it("should return configured owner identity when provided", () => {
      const settings = new VaultSettings({ ownerIdentity: '"[[!custom-owner]]"' });

      expect(settings.getOwnerIdentity()).toBe('"[[!custom-owner]]"');
    });

    it("should return default owner identity when config has undefined ownerIdentity", () => {
      const settings = new VaultSettings({ ownerIdentity: undefined });

      expect(settings.getOwnerIdentity()).toBe(DEFAULT_OWNER_IDENTITY);
    });

    it("should return default owner identity when no config is provided", () => {
      const settings = new VaultSettings();

      expect(settings.getOwnerIdentity()).toBe(DEFAULT_OWNER_IDENTITY);
    });

    it("should return default owner identity when config is undefined", () => {
      const settings = new VaultSettings(undefined);

      expect(settings.getOwnerIdentity()).toBe('"[[!kitelev]]"');
    });
  });

  describe("getDefaultInboxFolder", () => {
    it("should return configured inbox folder when provided", () => {
      const settings = new VaultSettings({ defaultInboxFolder: "02 Custom Inbox" });

      expect(settings.getDefaultInboxFolder()).toBe("02 Custom Inbox");
    });

    it("should return default inbox folder when config has undefined defaultInboxFolder", () => {
      const settings = new VaultSettings({ defaultInboxFolder: undefined });

      expect(settings.getDefaultInboxFolder()).toBe(DEFAULT_INBOX_FOLDER);
    });

    it("should return default inbox folder when no config is provided", () => {
      const settings = new VaultSettings();

      expect(settings.getDefaultInboxFolder()).toBe(DEFAULT_INBOX_FOLDER);
    });

    it("should return default inbox folder when config is undefined", () => {
      const settings = new VaultSettings(undefined);

      expect(settings.getDefaultInboxFolder()).toBe("01 Inbox");
    });
  });

  describe("default values consistency", () => {
    it("should preserve backward-compatible defaults when no configuration given", () => {
      const settings = new VaultSettings();

      expect(settings.getOwnerIdentity()).toBe('"[[!kitelev]]"');
      expect(settings.getDefaultInboxFolder()).toBe("01 Inbox");
    });

    it("should allow overriding only owner identity while keeping default inbox", () => {
      const settings = new VaultSettings({ ownerIdentity: '"[[!other-user]]"' });

      expect(settings.getOwnerIdentity()).toBe('"[[!other-user]]"');
      expect(settings.getDefaultInboxFolder()).toBe("01 Inbox");
    });

    it("should allow overriding only inbox folder while keeping default owner", () => {
      const settings = new VaultSettings({ defaultInboxFolder: "My Inbox" });

      expect(settings.getOwnerIdentity()).toBe('"[[!kitelev]]"');
      expect(settings.getDefaultInboxFolder()).toBe("My Inbox");
    });

    it("should allow overriding both values simultaneously", () => {
      const settings = new VaultSettings({
        ownerIdentity: '"[[!team-vault]]"',
        defaultInboxFolder: "Incoming",
      });

      expect(settings.getOwnerIdentity()).toBe('"[[!team-vault]]"');
      expect(settings.getDefaultInboxFolder()).toBe("Incoming");
    });
  });

  describe("exported constants", () => {
    it("DEFAULT_OWNER_IDENTITY should match the hardcoded default", () => {
      expect(DEFAULT_OWNER_IDENTITY).toBe('"[[!kitelev]]"');
    });

    it("DEFAULT_INBOX_FOLDER should match the hardcoded default", () => {
      expect(DEFAULT_INBOX_FOLDER).toBe("01 Inbox");
    });
  });
});
