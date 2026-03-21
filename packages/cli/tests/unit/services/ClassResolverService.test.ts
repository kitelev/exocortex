import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// Mock NodeFsAdapter
const mockFsAdapter = {
  getMarkdownFiles: jest.fn<() => Promise<string[]>>(),
  getFileMetadata: jest.fn<(file: string) => Promise<Record<string, unknown>>>(),
  readFile: jest.fn(),
  fileExists: jest.fn(),
  createFile: jest.fn(),
  updateFile: jest.fn(),
  writeFile: jest.fn(),
  deleteFile: jest.fn(),
  renameFile: jest.fn(),
  createDirectory: jest.fn(),
  directoryExists: jest.fn(),
  findFilesByMetadata: jest.fn(),
  findFileByUID: jest.fn(),
};

jest.unstable_mockModule("../../../src/adapters/NodeFsAdapter.js", () => ({
  NodeFsAdapter: jest.fn(() => mockFsAdapter),
}));

const { ClassResolverService, ClassNotFoundError } = await import(
  "../../../src/services/ClassResolverService.js"
);

describe("ClassResolverService", () => {
  let resolver: InstanceType<typeof ClassResolverService>;

  beforeEach(() => {
    jest.clearAllMocks();
    resolver = new ClassResolverService(mockFsAdapter as any);
  });

  describe("resolve()", () => {
    it("should resolve class short name to UUID", async () => {
      mockFsAdapter.getMarkdownFiles.mockResolvedValue([
        "03 Knowledge/classes/ztlk__PermanentNote.md",
      ]);
      mockFsAdapter.getFileMetadata.mockResolvedValue({
        exo__Instance_class: ['"[[ims__Class]]"'],
        exo__Asset_uid: "abc-123-def-456",
        exo__Asset_label: "Permanent Note",
      });

      const uuid = await resolver.resolve("/vault", "ztlk__PermanentNote");

      expect(uuid).toBe("abc-123-def-456");
    });

    it("should resolve class by label", async () => {
      mockFsAdapter.getMarkdownFiles.mockResolvedValue([
        "03 Knowledge/classes/some-file.md",
      ]);
      mockFsAdapter.getFileMetadata.mockResolvedValue({
        exo__Instance_class: ['"[[ims__Class]]"'],
        exo__Asset_uid: "uuid-from-label",
        exo__Asset_label: "ztlk__PermanentNote",
      });

      const uuid = await resolver.resolve("/vault", "ztlk__PermanentNote");

      expect(uuid).toBe("uuid-from-label");
    });

    it("should throw ClassNotFoundError for unknown class", async () => {
      mockFsAdapter.getMarkdownFiles.mockResolvedValue([]);

      await expect(
        resolver.resolve("/vault", "xyz__Unknown"),
      ).rejects.toThrow("Class 'xyz__Unknown' not found in vault");

      await expect(
        resolver.resolve("/vault", "xyz__Unknown"),
      ).rejects.toBeInstanceOf(ClassNotFoundError);
    });

    it("should pass through UUID values", async () => {
      const uuid = "a3f9c2d1-1234-4567-8901-abcdef123456";

      const result = await resolver.resolve("/vault", uuid);

      expect(result).toBe(uuid);
      // Should NOT scan vault files for UUID pass-through
      expect(mockFsAdapter.getMarkdownFiles).not.toHaveBeenCalled();
    });

    it("should cache index after first scan", async () => {
      mockFsAdapter.getMarkdownFiles.mockResolvedValue([
        "class1.md",
      ]);
      mockFsAdapter.getFileMetadata.mockResolvedValue({
        exo__Instance_class: ['"[[ims__Class]]"'],
        exo__Asset_uid: "cached-uuid",
        exo__Asset_label: "TestClass",
      });

      // First call - builds index
      await resolver.resolve("/vault", "class1");

      // Second call - uses cache
      await resolver.resolve("/vault", "class1");

      // getMarkdownFiles should only be called once (cached)
      expect(mockFsAdapter.getMarkdownFiles).toHaveBeenCalledTimes(1);
    });

    it("should skip files without exo__Instance_class containing ims__Class", async () => {
      mockFsAdapter.getMarkdownFiles.mockResolvedValue([
        "task.md",
        "class.md",
      ]);
      mockFsAdapter.getFileMetadata
        .mockResolvedValueOnce({
          exo__Instance_class: ['"[[ems__Task]]"'],
          exo__Asset_uid: "task-uuid",
        })
        .mockResolvedValueOnce({
          exo__Instance_class: ['"[[ims__Class]]"'],
          exo__Asset_uid: "class-uuid",
        });

      const uuid = await resolver.resolve("/vault", "class");

      expect(uuid).toBe("class-uuid");
    });

    it("should skip files without exo__Asset_uid", async () => {
      mockFsAdapter.getMarkdownFiles.mockResolvedValue(["no-uid.md"]);
      mockFsAdapter.getFileMetadata.mockResolvedValue({
        exo__Instance_class: ['"[[ims__Class]]"'],
        // No exo__Asset_uid
      });

      await expect(
        resolver.resolve("/vault", "no-uid"),
      ).rejects.toThrow(ClassNotFoundError);
    });

    it("should handle files that cannot be read", async () => {
      mockFsAdapter.getMarkdownFiles.mockResolvedValue([
        "broken.md",
        "good.md",
      ]);
      mockFsAdapter.getFileMetadata
        .mockRejectedValueOnce(new Error("Cannot read file"))
        .mockResolvedValueOnce({
          exo__Instance_class: ['"[[ims__Class]]"'],
          exo__Asset_uid: "good-uuid",
        });

      const uuid = await resolver.resolve("/vault", "good");

      expect(uuid).toBe("good-uuid");
    });

    it("should handle exo__Instance_class as string (not array)", async () => {
      mockFsAdapter.getMarkdownFiles.mockResolvedValue(["class.md"]);
      mockFsAdapter.getFileMetadata.mockResolvedValue({
        exo__Instance_class: '"[[ims__Class]]"',
        exo__Asset_uid: "string-class-uuid",
      });

      const uuid = await resolver.resolve("/vault", "class");

      expect(uuid).toBe("string-class-uuid");
    });
  });

  describe("listClasses()", () => {
    it("should return all known class names", async () => {
      mockFsAdapter.getMarkdownFiles.mockResolvedValue([
        "ems__Task.md",
        "ztlk__PermanentNote.md",
      ]);
      mockFsAdapter.getFileMetadata
        .mockResolvedValueOnce({
          exo__Instance_class: ['"[[ims__Class]]"'],
          exo__Asset_uid: "task-class-uuid",
        })
        .mockResolvedValueOnce({
          exo__Instance_class: ['"[[ims__Class]]"'],
          exo__Asset_uid: "note-class-uuid",
        });

      const classes = await resolver.listClasses("/vault");

      expect(classes).toContain("ems__Task");
      expect(classes).toContain("ztlk__PermanentNote");
    });
  });
});
