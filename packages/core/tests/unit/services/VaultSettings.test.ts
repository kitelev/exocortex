import "reflect-metadata";
import { VaultSettings, DEFAULT_OWNER_IDENTITY, DEFAULT_INBOX_FOLDER, DEFAULT_FLEETING_NOTE_CLASS_UID } from "../../../src/services/VaultSettings";

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

  describe("getFleetingNoteClassUID", () => {
    it("should return configured class UID when provided", () => {
      const settings = new VaultSettings({ fleetingNoteClassUID: "custom-uid-1234" });

      expect(settings.getFleetingNoteClassUID()).toBe("custom-uid-1234");
    });

    it("should return default class UID when config has undefined fleetingNoteClassUID", () => {
      const settings = new VaultSettings({ fleetingNoteClassUID: undefined });

      expect(settings.getFleetingNoteClassUID()).toBe(DEFAULT_FLEETING_NOTE_CLASS_UID);
    });

    it("should return default class UID when no config is provided", () => {
      const settings = new VaultSettings();

      expect(settings.getFleetingNoteClassUID()).toBe(DEFAULT_FLEETING_NOTE_CLASS_UID);
    });

    it("should return default class UID when config is undefined", () => {
      const settings = new VaultSettings(undefined);

      expect(settings.getFleetingNoteClassUID()).toBe("fca0a931-a01f-48e4-b72a-4af206c94bc7");
    });
  });

  describe("default values consistency", () => {
    it("should preserve backward-compatible defaults when no configuration given", () => {
      const settings = new VaultSettings();

      expect(settings.getOwnerIdentity()).toBe('"[[!kitelev]]"');
      expect(settings.getDefaultInboxFolder()).toBe("01 Inbox");
      expect(settings.getFleetingNoteClassUID()).toBe("fca0a931-a01f-48e4-b72a-4af206c94bc7");
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

    it("should allow overriding all three values simultaneously", () => {
      const settings = new VaultSettings({
        ownerIdentity: '"[[!team-vault]]"',
        defaultInboxFolder: "Incoming",
        fleetingNoteClassUID: "custom-uid",
      });

      expect(settings.getOwnerIdentity()).toBe('"[[!team-vault]]"');
      expect(settings.getDefaultInboxFolder()).toBe("Incoming");
      expect(settings.getFleetingNoteClassUID()).toBe("custom-uid");
    });
  });

  describe("exported constants", () => {
    it("DEFAULT_OWNER_IDENTITY should match the hardcoded default", () => {
      expect(DEFAULT_OWNER_IDENTITY).toBe('"[[!kitelev]]"');
    });

    it("DEFAULT_INBOX_FOLDER should match the hardcoded default", () => {
      expect(DEFAULT_INBOX_FOLDER).toBe("01 Inbox");
    });

    it("DEFAULT_FLEETING_NOTE_CLASS_UID should match the ztlk__FleetingNote class UID", () => {
      expect(DEFAULT_FLEETING_NOTE_CLASS_UID).toBe("fca0a931-a01f-48e4-b72a-4af206c94bc7");
    });
  });
});
