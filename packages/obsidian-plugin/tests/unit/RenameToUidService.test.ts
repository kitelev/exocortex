import { RenameToUidService, type IVaultAdapter } from "exocortex";

describe("RenameToUidService", () => {
  let service: RenameToUidService;
  let mockVaultAdapter: IVaultAdapter;

  beforeEach(() => {
    mockVaultAdapter = {
      rename: jest.fn().mockResolvedValue(undefined),
      process: jest.fn((file, callback) => {
        const content = `---
exo__Asset_isDefinedBy: "[[!user]]"
exo__Asset_uid: test-uid-123
---

Test content`;
        return Promise.resolve(callback(content));
      }),
      read: jest.fn().mockResolvedValue(""),
      create: jest.fn().mockResolvedValue({} as any),
      modify: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue(false),
      getAbstractFileByPath: jest.fn().mockReturnValue(null),
      getAllFiles: jest.fn().mockReturnValue([]),
      getFrontmatter: jest.fn().mockReturnValue(null),
      updateFrontmatter: jest.fn().mockResolvedValue(undefined),
      createFolder: jest.fn().mockResolvedValue(undefined),
      getFirstLinkpathDest: jest.fn().mockReturnValue(null),
      updateLinks: jest.fn().mockResolvedValue(undefined),
    } as any;

    service = new RenameToUidService(mockVaultAdapter);
  });

  describe("renameToUid", () => {
    it("should throw error when asset has no UID", async () => {
      const mockFile = {
        basename: "Old Name",
        parent: { path: "03 Knowledge/user" },
      } as any;

      const metadata = {};

      await expect(service.renameToUid(mockFile, metadata)).rejects.toThrow(
        "Asset has no exo__Asset_uid property",
      );
    });

    it("should throw error when filename already matches UID", async () => {
      const mockFile = {
        basename: "test-uid-123",
        parent: { path: "03 Knowledge/user" },
      } as any;

      const metadata = {
        exo__Asset_uid: "test-uid-123",
      };

      await expect(service.renameToUid(mockFile, metadata)).rejects.toThrow(
        "File is already named according to UID",
      );
    });

    it("should rename file to UID and add label when no label exists", async () => {
      const mockFile = {
        basename: "Old Task Name",
        parent: { path: "03 Knowledge/user" },
      } as any;

      const metadata = {
        exo__Asset_uid: "abc-123-def",
        exo__Asset_isDefinedBy: '"[[!user]]"',
      };

      await service.renameToUid(mockFile, metadata);

      expect(mockVaultAdapter.process).toHaveBeenCalledTimes(1);
      expect(mockVaultAdapter.rename).toHaveBeenCalledWith(
        mockFile,
        "03 Knowledge/user/abc-123-def.md",
      );
    });

    it("should rename file but not add label when label already exists", async () => {
      const mockFile = {
        basename: "Old Task Name",
        parent: { path: "03 Knowledge/user" },
      } as any;

      const metadata = {
        exo__Asset_uid: "abc-123-def",
        exo__Asset_label: "Existing Label",
      };

      await service.renameToUid(mockFile, metadata);

      expect(mockVaultAdapter.process).not.toHaveBeenCalled();
      expect(mockVaultAdapter.rename).toHaveBeenCalledWith(
        mockFile,
        "03 Knowledge/user/abc-123-def.md",
      );
    });

    it("should handle files in root folder (no parent)", async () => {
      const mockFile = {
        basename: "Old Name",
        parent: null,
      } as any;

      const metadata = {
        exo__Asset_uid: "root-uid-123",
      };

      await service.renameToUid(mockFile, metadata);

      expect(mockVaultAdapter.rename).toHaveBeenCalledWith(
        mockFile,
        "root-uid-123.md",
      );
    });

    it("should add label property to frontmatter when needed", async () => {
      const mockFile = {
        basename: "Task with Spaces",
        parent: { path: "03 Knowledge/user" },
      } as any;

      const metadata = {
        exo__Asset_uid: "abc-123-def",
      };

      let processedContent = "";
      mockVaultAdapter.process.mockImplementation(
        (file: any, callback: any) => {
          const originalContent = `---
exo__Asset_isDefinedBy: "[[!user]]"
exo__Asset_uid: abc-123-def
---

Test content`;
          processedContent = callback(originalContent);
          return Promise.resolve();
        },
      );

      await service.renameToUid(mockFile, metadata);

      expect(processedContent).toContain("exo__Asset_label: Task with Spaces");
    });

    it("should treat empty string label as no label", async () => {
      const mockFile = {
        basename: "Old Name",
        parent: { path: "03 Knowledge/user" },
      } as any;

      const metadata = {
        exo__Asset_uid: "abc-123-def",
        exo__Asset_label: "",
      };

      await service.renameToUid(mockFile, metadata);

      expect(mockVaultAdapter.process).toHaveBeenCalledTimes(1);
    });

    it("should treat whitespace-only label as no label", async () => {
      const mockFile = {
        basename: "Old Name",
        parent: { path: "03 Knowledge/user" },
      } as any;

      const metadata = {
        exo__Asset_uid: "abc-123-def",
        exo__Asset_label: "   ",
      };

      await service.renameToUid(mockFile, metadata);

      expect(mockVaultAdapter.process).toHaveBeenCalledTimes(1);
    });
  });
});
