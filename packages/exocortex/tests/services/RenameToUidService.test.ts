import { RenameToUidService } from "../../src/services/RenameToUidService";
import { IVaultAdapter, IFile } from "../../src/interfaces/IVaultAdapter";

describe("RenameToUidService", () => {
  let service: RenameToUidService;
  let mockVault: jest.Mocked<IVaultAdapter>;
  let mockFile: IFile;

  beforeEach(() => {
    mockVault = {
      rename: jest.fn(),
      process: jest.fn().mockResolvedValue(""),
      updateLinks: jest.fn(),
    } as any;

    mockFile = {
      path: "/folder/old-name.md",
      name: "old-name.md",
      basename: "old-name",
      parent: {
        path: "/folder",
      },
    } as IFile;

    service = new RenameToUidService(mockVault);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("renameToUid", () => {
    it("should rename file to UID", async () => {
      const metadata = {
        exo__Asset_uid: "asset-123",
        exo__Asset_label: "Existing Label",
      };

      await service.renameToUid(mockFile, metadata);

      expect(mockVault.rename).toHaveBeenCalledWith(mockFile, "/folder/asset-123.md");
      expect(mockVault.process).not.toHaveBeenCalled();
    });

    it("should throw error when no UID property", async () => {
      const metadata = {
        exo__Asset_label: "Some Label",
      };

      await expect(service.renameToUid(mockFile, metadata)).rejects.toThrow(
        "Asset has no exo__Asset_uid property",
      );

      expect(mockVault.rename).not.toHaveBeenCalled();
      expect(mockVault.process).not.toHaveBeenCalled();
    });

    it("should throw error when file already named with UID", async () => {
      const fileWithUidName: IFile = {
        path: "/folder/asset-123.md",
        name: "asset-123.md",
        basename: "asset-123",
        parent: {
          path: "/folder",
        },
      } as IFile;

      const metadata = {
        exo__Asset_uid: "asset-123",
        exo__Asset_label: "Label",
      };

      await expect(service.renameToUid(fileWithUidName, metadata)).rejects.toThrow(
        "File is already named according to UID",
      );

      expect(mockVault.rename).not.toHaveBeenCalled();
      expect(mockVault.process).not.toHaveBeenCalled();
    });

    it("should update label when missing", async () => {
      const metadata = {
        exo__Asset_uid: "asset-123",
      };

      await service.renameToUid(mockFile, metadata);

      expect(mockVault.process).toHaveBeenCalledWith(mockFile, expect.any(Function));
      expect(mockVault.rename).toHaveBeenCalledWith(mockFile, "/folder/asset-123.md");
    });

    it("should update label when empty string", async () => {
      const metadata = {
        exo__Asset_uid: "asset-123",
        exo__Asset_label: "",
      };

      await service.renameToUid(mockFile, metadata);

      expect(mockVault.process).toHaveBeenCalled();
      expect(mockVault.rename).toHaveBeenCalled();
    });

    it("should update label when whitespace only", async () => {
      const metadata = {
        exo__Asset_uid: "asset-123",
        exo__Asset_label: "   ",
      };

      await service.renameToUid(mockFile, metadata);

      expect(mockVault.process).toHaveBeenCalled();
      expect(mockVault.rename).toHaveBeenCalled();
    });

    it("should not update label when valid label exists", async () => {
      const metadata = {
        exo__Asset_uid: "asset-123",
        exo__Asset_label: "Valid Label",
      };

      await service.renameToUid(mockFile, metadata);

      expect(mockVault.process).not.toHaveBeenCalled();
      expect(mockVault.rename).toHaveBeenCalledWith(mockFile, "/folder/asset-123.md");
    });

    it("should handle file in root folder", async () => {
      const rootFile: IFile = {
        path: "old-name.md",
        name: "old-name.md",
        basename: "old-name",
        parent: null,
      } as any;

      const metadata = {
        exo__Asset_uid: "asset-123",
        exo__Asset_label: "Label",
      };

      await service.renameToUid(rootFile, metadata);

      expect(mockVault.rename).toHaveBeenCalledWith(rootFile, "asset-123.md");
    });

    it("should handle file with undefined parent path", async () => {
      const fileWithUndefinedParent: IFile = {
        path: "old-name.md",
        name: "old-name.md",
        basename: "old-name",
        parent: {
          path: undefined as any,
        },
      } as any;

      const metadata = {
        exo__Asset_uid: "asset-123",
        exo__Asset_label: "Label",
      };

      await service.renameToUid(fileWithUndefinedParent, metadata);

      expect(mockVault.rename).toHaveBeenCalledWith(fileWithUndefinedParent, "asset-123.md");
    });

    it("should call process with correct function", async () => {
      const metadata = {
        exo__Asset_uid: "asset-123",
      };

      mockVault.process.mockImplementation(async (file, fn) => {
        const content = "---\ntitle: Test\n---\nContent";
        const result = fn(content);
        expect(result).toContain("exo__Asset_label");
        expect(result).toContain("old-name");
        return result;
      });

      await service.renameToUid(mockFile, metadata);

      expect(mockVault.process).toHaveBeenCalled();
    });

    it("should handle content without frontmatter when updating label", async () => {
      const metadata = {
        exo__Asset_uid: "asset-123",
      };

      mockVault.process.mockImplementation(async (file, fn) => {
        const content = "Content without frontmatter.";
        const result = fn(content);
        expect(result).toBe(content);
        return result;
      });

      await service.renameToUid(mockFile, metadata);

      expect(mockVault.process).toHaveBeenCalled();
    });
  });

  describe("archived asset handling", () => {
    it("should NOT add alias for archived asset (exo__Asset_isArchived: true)", async () => {
      const metadata = {
        exo__Asset_uid: "asset-123",
        exo__Asset_isArchived: true,
      };

      mockVault.process.mockImplementation(async (file, fn) => {
        const content = "---\ntitle: Test\n---\nContent";
        const result = fn(content);
        expect(result).toContain("exo__Asset_label: old-name");
        expect(result).not.toContain("aliases:");
        return result;
      });

      await service.renameToUid(mockFile, metadata);

      expect(mockVault.process).toHaveBeenCalled();
      expect(mockVault.rename).toHaveBeenCalled();
    });

    it("should NOT add alias for archived asset (archived: true)", async () => {
      const metadata = {
        exo__Asset_uid: "asset-123",
        archived: true,
      };

      mockVault.process.mockImplementation(async (file, fn) => {
        const content = "---\ntitle: Test\n---\nContent";
        const result = fn(content);
        expect(result).toContain("exo__Asset_label: old-name");
        expect(result).not.toContain("aliases:");
        return result;
      });

      await service.renameToUid(mockFile, metadata);

      expect(mockVault.process).toHaveBeenCalled();
    });

    it("should support multi-format archived values (string 'true')", async () => {
      const metadata = {
        exo__Asset_uid: "asset-123",
        exo__Asset_isArchived: "true",
      };

      mockVault.process.mockImplementation(async (file, fn) => {
        const content = "---\ntitle: Test\n---\nContent";
        const result = fn(content);
        expect(result).not.toContain("aliases:");
        return result;
      });

      await service.renameToUid(mockFile, metadata);

      expect(mockVault.process).toHaveBeenCalled();
    });

    it("should support multi-format archived values (string 'yes')", async () => {
      const metadata = {
        exo__Asset_uid: "asset-123",
        archived: "yes",
      };

      mockVault.process.mockImplementation(async (file, fn) => {
        const content = "---\ntitle: Test\n---\nContent";
        const result = fn(content);
        expect(result).not.toContain("aliases:");
        return result;
      });

      await service.renameToUid(mockFile, metadata);

      expect(mockVault.process).toHaveBeenCalled();
    });

    it("should support multi-format archived values (number 1)", async () => {
      const metadata = {
        exo__Asset_uid: "asset-123",
        exo__Asset_isArchived: 1,
      };

      mockVault.process.mockImplementation(async (file, fn) => {
        const content = "---\ntitle: Test\n---\nContent";
        const result = fn(content);
        expect(result).not.toContain("aliases:");
        return result;
      });

      await service.renameToUid(mockFile, metadata);

      expect(mockVault.process).toHaveBeenCalled();
    });

    it("should NOT add alias when both archived properties are true", async () => {
      const metadata = {
        exo__Asset_uid: "asset-123",
        exo__Asset_isArchived: true,
        archived: true,
      };

      mockVault.process.mockImplementation(async (file, fn) => {
        const content = "---\ntitle: Test\n---\nContent";
        const result = fn(content);
        expect(result).toContain("exo__Asset_label: old-name");
        expect(result).not.toContain("aliases:");
        return result;
      });

      await service.renameToUid(mockFile, metadata);

      expect(mockVault.process).toHaveBeenCalled();
    });

    it("SHOULD add alias for non-archived asset (backward compatibility)", async () => {
      const metadata = {
        exo__Asset_uid: "asset-123",
        exo__Asset_isArchived: false,
      };

      mockVault.process.mockImplementation(async (file, fn) => {
        const content = "---\ntitle: Test\n---\nContent";
        const result = fn(content);
        expect(result).toContain("exo__Asset_label: old-name");
        expect(result).toContain("aliases:");
        expect(result).toContain("- old-name");
        return result;
      });

      await service.renameToUid(mockFile, metadata);

      expect(mockVault.process).toHaveBeenCalled();
    });

    it("SHOULD add alias when no archived property (backward compatibility)", async () => {
      const metadata = {
        exo__Asset_uid: "asset-123",
      };

      mockVault.process.mockImplementation(async (file, fn) => {
        const content = "---\ntitle: Test\n---\nContent";
        const result = fn(content);
        expect(result).toContain("exo__Asset_label: old-name");
        expect(result).toContain("aliases:");
        expect(result).toContain("- old-name");
        return result;
      });

      await service.renameToUid(mockFile, metadata);

      expect(mockVault.process).toHaveBeenCalled();
    });

    it("SHOULD add alias when archived: false (backward compatibility)", async () => {
      const metadata = {
        exo__Asset_uid: "asset-123",
        archived: false,
      };

      mockVault.process.mockImplementation(async (file, fn) => {
        const content = "---\ntitle: Test\n---\nContent";
        const result = fn(content);
        expect(result).toContain("exo__Asset_label: old-name");
        expect(result).toContain("aliases:");
        expect(result).toContain("- old-name");
        return result;
      });

      await service.renameToUid(mockFile, metadata);

      expect(mockVault.process).toHaveBeenCalled();
    });

    it("SHOULD add alias when archived: null (backward compatibility)", async () => {
      const metadata = {
        exo__Asset_uid: "asset-123",
        archived: null,
      };

      mockVault.process.mockImplementation(async (file, fn) => {
        const content = "---\ntitle: Test\n---\nContent";
        const result = fn(content);
        expect(result).toContain("aliases:");
        return result;
      });

      await service.renameToUid(mockFile, metadata);

      expect(mockVault.process).toHaveBeenCalled();
    });

    it("should handle archived asset with existing label (no frontmatter modification)", async () => {
      const metadata = {
        exo__Asset_uid: "asset-123",
        exo__Asset_label: "Existing Label",
        exo__Asset_isArchived: true,
      };

      await service.renameToUid(mockFile, metadata);

      expect(mockVault.process).not.toHaveBeenCalled();
      expect(mockVault.rename).toHaveBeenCalledWith(mockFile, "/folder/asset-123.md");
    });
  });

  describe("updateLinks integration", () => {
    it("should call updateLinks before rename", async () => {
      const metadata = {
        exo__Asset_uid: "asset-123",
        exo__Asset_label: "Existing Label",
      };

      const callOrder: string[] = [];
      mockVault.updateLinks.mockImplementation(async () => {
        callOrder.push("updateLinks");
      });
      mockVault.rename.mockImplementation(async () => {
        callOrder.push("rename");
      });

      await service.renameToUid(mockFile, metadata);

      expect(callOrder).toEqual(["updateLinks", "rename"]);
    });

    it("should call updateLinks with correct parameters", async () => {
      const metadata = {
        exo__Asset_uid: "asset-123",
        exo__Asset_label: "Existing Label",
      };

      await service.renameToUid(mockFile, metadata);

      expect(mockVault.updateLinks).toHaveBeenCalledWith(
        "/folder/old-name.md",
        "/folder/asset-123.md",
        "old-name"
      );
      expect(mockVault.rename).toHaveBeenCalledWith(mockFile, "/folder/asset-123.md");
    });

    it("should call updateLinks when label is updated", async () => {
      const metadata = {
        exo__Asset_uid: "asset-123",
      };

      const callOrder: string[] = [];
      mockVault.process.mockImplementation(async () => {
        callOrder.push("process");
        return "";
      });
      mockVault.updateLinks.mockImplementation(async () => {
        callOrder.push("updateLinks");
      });
      mockVault.rename.mockImplementation(async () => {
        callOrder.push("rename");
      });

      await service.renameToUid(mockFile, metadata);

      expect(callOrder).toEqual(["process", "updateLinks", "rename"]);
      expect(mockVault.updateLinks).toHaveBeenCalledWith(
        "/folder/old-name.md",
        "/folder/asset-123.md",
        "old-name"
      );
    });

    it("should handle updateLinks for file in root folder", async () => {
      const rootFile: IFile = {
        path: "old-name.md",
        name: "old-name.md",
        basename: "old-name",
        parent: null,
      } as any;

      const metadata = {
        exo__Asset_uid: "asset-123",
        exo__Asset_label: "Label",
      };

      await service.renameToUid(rootFile, metadata);

      expect(mockVault.updateLinks).toHaveBeenCalledWith(
        "old-name.md",
        "asset-123.md",
        "old-name"
      );
      expect(mockVault.rename).toHaveBeenCalledWith(rootFile, "asset-123.md");
    });

    it("should not call updateLinks if rename validation fails", async () => {
      const metadata = {
        exo__Asset_uid: "asset-123",
      };

      const fileWithUidName: IFile = {
        path: "/folder/asset-123.md",
        name: "asset-123.md",
        basename: "asset-123",
        parent: {
          path: "/folder",
        },
      } as IFile;

      await expect(service.renameToUid(fileWithUidName, metadata)).rejects.toThrow();

      expect(mockVault.updateLinks).not.toHaveBeenCalled();
      expect(mockVault.rename).not.toHaveBeenCalled();
    });
  });
});
