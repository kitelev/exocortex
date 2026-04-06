import "reflect-metadata";
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { SessionEventService } from "../../../src/services/SessionEventService";
import type { IVaultAdapter, IFile } from "../../../src/interfaces/IVaultAdapter";
import type { IVaultSettings } from "../../../src/interfaces/IVaultSettings";

function createMockVaultSettings(): IVaultSettings {
  return {
    getOwnerIdentity: jest.fn<() => string>().mockReturnValue('"[[!kitelev]]"'),
    getDefaultInboxFolder: jest.fn<() => string>().mockReturnValue("01 Inbox"),
    getFleetingNoteClassUID: jest.fn<() => string>().mockReturnValue("fca0a931-a01f-48e4-b72a-4af206c94bc7"),
  };
}

describe("SessionEventService - branch coverage", () => {
  let service: SessionEventService;
  let mockVault: jest.Mocked<IVaultAdapter>;
  let mockVaultSettings: IVaultSettings;

  beforeEach(() => {
    mockVault = {
      create: jest.fn<(path: string, content: string) => Promise<IFile>>(),
      createFolder: jest.fn<(path: string) => Promise<void>>(),
      exists: jest.fn<(path: string) => Promise<boolean>>(),
      getDefaultNewFileParent: jest.fn(),
    } as unknown as jest.Mocked<IVaultAdapter>;

    mockVault.create.mockResolvedValue({ path: "inbox/test.md" } as IFile);
    mockVault.exists.mockResolvedValue(true);

    mockVaultSettings = createMockVaultSettings();

    service = new (SessionEventService as any)(mockVault, mockVaultSettings);
  });

  describe("createSessionStartEvent", () => {
    it("should create a start event file", async () => {
      mockVault.getDefaultNewFileParent.mockReturnValue({ path: "01 Inbox", name: "01 Inbox" });

      const result = await service.createSessionStartEvent("MyArea");

      expect(mockVault.create).toHaveBeenCalledWith(
        expect.stringContaining("01 Inbox/"),
        expect.any(String),
      );
      expect(result).toBeDefined();
    });

    it("should include SessionStartEvent class", async () => {
      mockVault.getDefaultNewFileParent.mockReturnValue({ path: "01 Inbox", name: "01 Inbox" });

      await service.createSessionStartEvent("MyArea");

      const content = mockVault.create.mock.calls[0][1];
      expect(content).toContain("ems__SessionStartEvent");
    });

    it("should include area reference", async () => {
      mockVault.getDefaultNewFileParent.mockReturnValue({ path: "01 Inbox", name: "01 Inbox" });

      await service.createSessionStartEvent("Development");

      const content = mockVault.create.mock.calls[0][1];
      expect(content).toContain("[[Development]]");
    });
  });

  describe("createSessionEndEvent", () => {
    it("should create an end event file", async () => {
      mockVault.getDefaultNewFileParent.mockReturnValue({ path: "01 Inbox", name: "01 Inbox" });

      const result = await service.createSessionEndEvent("MyArea");

      expect(mockVault.create).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it("should include SessionEndEvent class", async () => {
      mockVault.getDefaultNewFileParent.mockReturnValue({ path: "01 Inbox", name: "01 Inbox" });

      await service.createSessionEndEvent("MyArea");

      const content = mockVault.create.mock.calls[0][1];
      expect(content).toContain("ems__SessionEndEvent");
    });
  });

  describe("folder creation", () => {
    it("should create folder if not exists", async () => {
      mockVault.getDefaultNewFileParent.mockReturnValue({ path: "events", name: "events" });
      mockVault.exists.mockResolvedValue(false);

      await service.createSessionStartEvent("MyArea");

      expect(mockVault.createFolder).toHaveBeenCalledWith("events");
    });

    it("should not create folder if already exists", async () => {
      mockVault.getDefaultNewFileParent.mockReturnValue({ path: "events", name: "events" });
      mockVault.exists.mockResolvedValue(true);

      await service.createSessionStartEvent("MyArea");

      expect(mockVault.createFolder).not.toHaveBeenCalled();
    });

    it("should handle null default folder parent", async () => {
      mockVault.getDefaultNewFileParent.mockReturnValue(null);

      await service.createSessionStartEvent("MyArea");

      // Should create file at root level
      const filePath = mockVault.create.mock.calls[0][0];
      expect(filePath).toMatch(/^[0-9a-f-]+\.md$/);
    });

    it("should cache folder path after first call", async () => {
      mockVault.getDefaultNewFileParent.mockReturnValue({ path: "cached-folder", name: "cached-folder" });

      await service.createSessionStartEvent("Area1");
      await service.createSessionEndEvent("Area1");

      // getDefaultNewFileParent should only be called once due to caching
      expect(mockVault.getDefaultNewFileParent).toHaveBeenCalledTimes(1);
    });

    it("should handle empty folder path (no folder creation needed)", async () => {
      mockVault.getDefaultNewFileParent.mockReturnValue(null);

      await service.createSessionStartEvent("MyArea");

      // Empty folder path should not trigger createFolder
      expect(mockVault.createFolder).not.toHaveBeenCalled();
    });
  });
});
