import { FolderRepairService } from "../../../src/services/FolderRepairService";
import type { IVaultAdapter, IFile, IFolder } from "../../../src/interfaces/IVaultAdapter";

describe("FolderRepairService", () => {
  let service: FolderRepairService;
  let mockVault: jest.Mocked<IVaultAdapter>;

  const createMockFile = (overrides?: Partial<IFile>): IFile => ({
    path: "wrong-folder/asset.md",
    basename: "asset",
    name: "asset.md",
    parent: { path: "wrong-folder", name: "wrong-folder" },
    ...overrides,
  });

  beforeEach(() => {
    mockVault = {
      getFrontmatter: jest.fn(),
      getAllFiles: jest.fn(),
      read: jest.fn(),
      create: jest.fn(),
      modify: jest.fn(),
      delete: jest.fn(),
      exists: jest.fn(),
      getAbstractFileByPath: jest.fn(),
      updateFrontmatter: jest.fn(),
      rename: jest.fn(),
      updateLinks: jest.fn(),
      createFolder: jest.fn(),
      getFirstLinkpathDest: jest.fn(),
      process: jest.fn(),
      getDefaultNewFileParent: jest.fn(),
    } as jest.Mocked<IVaultAdapter>;

    service = new FolderRepairService(mockVault);
  });

  describe("getExpectedFolder", () => {
    it("should return null when metadata is null/undefined", async () => {
      const file = createMockFile();

      const result = await service.getExpectedFolder(file, null as any);

      expect(result).toBeNull();
    });

    it("should return null when exo__Asset_isDefinedBy is missing", async () => {
      const file = createMockFile();

      const result = await service.getExpectedFolder(file, {});

      expect(result).toBeNull();
    });

    it("should return null when exo__Asset_isDefinedBy is empty string", async () => {
      const file = createMockFile();

      const result = await service.getExpectedFolder(file, { exo__Asset_isDefinedBy: "" });

      expect(result).toBeNull();
    });

    it("should return null when reference is not a string (e.g. number)", async () => {
      const file = createMockFile();

      const result = await service.getExpectedFolder(file, { exo__Asset_isDefinedBy: 123 });

      expect(result).toBeNull();
    });

    it("should return null when referenced file not found in vault", async () => {
      const file = createMockFile();
      mockVault.getFirstLinkpathDest.mockReturnValue(null);

      const result = await service.getExpectedFolder(file, {
        exo__Asset_isDefinedBy: "[[NonExistentFile]]",
      });

      expect(result).toBeNull();
    });

    it("should return folder path of referenced file", async () => {
      const file = createMockFile();
      const referencedFile = createMockFile({
        path: "correct-folder/ontology.md",
        parent: { path: "correct-folder", name: "correct-folder" },
      });
      mockVault.getFirstLinkpathDest.mockReturnValue(referencedFile);

      const result = await service.getExpectedFolder(file, {
        exo__Asset_isDefinedBy: "[[ontology]]",
      });

      expect(result).toBe("correct-folder");
    });

    it("should handle quoted wiki-link reference: \"[[Reference]]\"", async () => {
      const file = createMockFile();
      const referencedFile = createMockFile({
        path: "target/ref.md",
        parent: { path: "target", name: "target" },
      });
      mockVault.getFirstLinkpathDest.mockReturnValue(referencedFile);

      const result = await service.getExpectedFolder(file, {
        exo__Asset_isDefinedBy: '"[[MyOntology]]"',
      });

      expect(result).toBe("target");
      expect(mockVault.getFirstLinkpathDest).toHaveBeenCalledWith(
        "MyOntology",
        file.path,
      );
    });

    it("should handle plain reference without brackets", async () => {
      const file = createMockFile();
      const referencedFile = createMockFile({
        path: "folder/plain.md",
        parent: { path: "folder", name: "folder" },
      });
      mockVault.getFirstLinkpathDest.mockReturnValue(referencedFile);

      const result = await service.getExpectedFolder(file, {
        exo__Asset_isDefinedBy: "PlainReference",
      });

      expect(result).toBe("folder");
    });

    it("should return empty string when referenced file is in root", async () => {
      const file = createMockFile();
      const referencedFile = createMockFile({
        path: "root-file.md",
        parent: null,
      });
      mockVault.getFirstLinkpathDest.mockReturnValue(referencedFile);

      const result = await service.getExpectedFolder(file, {
        exo__Asset_isDefinedBy: "[[root-file]]",
      });

      expect(result).toBe("");
    });

    it("should handle single-quoted wiki-link reference", async () => {
      const file = createMockFile();
      const referencedFile = createMockFile({
        path: "target/ref.md",
        parent: { path: "target", name: "target" },
      });
      mockVault.getFirstLinkpathDest.mockReturnValue(referencedFile);

      const result = await service.getExpectedFolder(file, {
        exo__Asset_isDefinedBy: "'[[MyOntology]]'",
      });

      expect(result).toBe("target");
    });
  });

  describe("repairFolder", () => {
    it("should move file to expected folder", async () => {
      const file = createMockFile();
      mockVault.getAbstractFileByPath.mockReturnValue(null);
      // Mock folder exists
      mockVault.createFolder.mockResolvedValue(undefined);

      await service.repairFolder(file, "correct-folder");

      expect(mockVault.rename).toHaveBeenCalledWith(file, "correct-folder/asset.md");
    });

    it("should throw when target path already exists", async () => {
      const file = createMockFile();
      const existingFile = createMockFile({ path: "correct-folder/asset.md" });
      mockVault.getAbstractFileByPath.mockReturnValue(existingFile);

      await expect(service.repairFolder(file, "correct-folder")).rejects.toThrow(
        "Cannot move file: correct-folder/asset.md already exists",
      );
    });

    it("should create folder if it does not exist", async () => {
      const file = createMockFile();
      // getAbstractFileByPath returns null for target file AND folder
      mockVault.getAbstractFileByPath.mockReturnValue(null);
      mockVault.createFolder.mockResolvedValue(undefined);

      await service.repairFolder(file, "new-folder");

      expect(mockVault.createFolder).toHaveBeenCalledWith("new-folder");
    });

    it("should not create folder if it already exists (has children)", async () => {
      const file = createMockFile();
      // First call: check target file - null (doesn't exist)
      // Second call: check folder - returns folder object
      mockVault.getAbstractFileByPath
        .mockReturnValueOnce(null) // target file
        .mockReturnValueOnce({ path: "existing-folder", name: "existing-folder", children: [] } as any); // folder

      await service.repairFolder(file, "existing-folder");

      expect(mockVault.createFolder).not.toHaveBeenCalled();
      expect(mockVault.rename).toHaveBeenCalled();
    });

    it("should handle 'Folder already exists' error during createFolder", async () => {
      const file = createMockFile();
      mockVault.getAbstractFileByPath.mockReturnValue(null);
      mockVault.createFolder.mockRejectedValue(new Error("Folder already exists: new-folder"));

      await service.repairFolder(file, "new-folder");

      expect(mockVault.rename).toHaveBeenCalledWith(file, "new-folder/asset.md");
    });

    it("should re-throw non-'Folder already exists' errors during createFolder", async () => {
      const file = createMockFile();
      mockVault.getAbstractFileByPath.mockReturnValue(null);
      mockVault.createFolder.mockRejectedValue(new Error("Permission denied"));

      await expect(service.repairFolder(file, "new-folder")).rejects.toThrow(
        "Permission denied",
      );
    });

    it("should re-throw non-Error exceptions during createFolder", async () => {
      const file = createMockFile();
      mockVault.getAbstractFileByPath.mockReturnValue(null);
      mockVault.createFolder.mockRejectedValue("string error");

      await expect(service.repairFolder(file, "new-folder")).rejects.toBe("string error");
    });

    it("should not create folder when expectedFolder is empty string (root)", async () => {
      const file = createMockFile();
      mockVault.getAbstractFileByPath.mockReturnValue(null);

      await service.repairFolder(file, "");

      expect(mockVault.createFolder).not.toHaveBeenCalled();
      expect(mockVault.rename).toHaveBeenCalledWith(file, "/asset.md");
    });
  });
});
