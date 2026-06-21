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

    it("should resolve class by exo__Asset_label when file is named by UUID", async () => {
      // Real-world scenario: class file named by UUID, label holds the class name
      mockFsAdapter.getMarkdownFiles.mockResolvedValue([
        "03 Knowledge/ztlk/38b234f7-949a-4da0-bab0-c4ca559808d1.md",
      ]);
      mockFsAdapter.getFileMetadata.mockResolvedValue({
        exo__Instance_class: ['"[[exo__Class]]"'],
        exo__Asset_uid: "38b234f7-949a-4da0-bab0-c4ca559808d1",
        exo__Asset_label: "ztlk__PermanentNote",
      });

      const uuid = await resolver.resolve("/vault", "ztlk__PermanentNote");

      expect(uuid).toBe("38b234f7-949a-4da0-bab0-c4ca559808d1");
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

    it("should recognize exo__Class in exo__Instance_class (not just ims__Class)", async () => {
      mockFsAdapter.getMarkdownFiles.mockResolvedValue([
        "03 Knowledge/ztlk/some-uuid.md",
      ]);
      mockFsAdapter.getFileMetadata.mockResolvedValue({
        exo__Instance_class: ['"[[exo__Class]]"'],
        exo__Asset_uid: "exo-class-uuid",
        exo__Asset_label: "ztlk__PermanentNote",
      });

      const uuid = await resolver.resolve("/vault", "ztlk__PermanentNote");

      expect(uuid).toBe("exo-class-uuid");
    });

    // Production-shape (UID-canon TBox, RFC 7c7859d1 dogfood W1): class
    // definitions reference the exo__Class metaclass BY UUID, not by a
    // label-form wikilink. The metaclass UID is discovered from a sibling file
    // whose label is exactly "exo__Class". Before the fix, isClassDefinition
    // only matched the literal "exo__Class"/"ims__Class" strings, so a UID-form
    // reference never matched and `--class ems__Task` threw ClassNotFoundError
    // while `--class <uuid>` worked via pass-through.
    it("should resolve UID-canon class def referencing the exo__Class metaclass by UUID", async () => {
      const META_UID = "8619c4fc-64f1-4869-b17e-e34186cacca9";
      const TASK_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";
      mockFsAdapter.getMarkdownFiles.mockResolvedValue([
        `assetspaces/exo/${META_UID}.md`, // exo__Class metaclass (UUID-named)
        `assetspaces/ems/${TASK_UID}.md`, // ems__Task class definition
      ]);
      mockFsAdapter.getFileMetadata
        .mockResolvedValueOnce({
          // The metaclass file — label "exo__Class" is how it is discovered.
          exo__Asset_uid: META_UID,
          exo__Asset_label: "exo__Class",
        })
        .mockResolvedValueOnce({
          // Real UID-canon shape: instance_class is a [[<uuid>]] wikilink string
          // (yaml.load strips the quotes), NOT a label-form wikilink.
          exo__Instance_class: [`[[${META_UID}]]`],
          exo__Asset_uid: TASK_UID,
          exo__Asset_label: "ems__Task",
        });

      const uuid = await resolver.resolve("/vault", "ems__Task");

      expect(uuid).toBe(TASK_UID);
    });

    // Guard: without a metaclass file in the vault, a UID-only reference must
    // NOT be treated as a class definition (no false-positive metaclass UID).
    it("should NOT index a UID-form ref when no exo__Class metaclass is present", async () => {
      // A clearly-fictional metaclass UID that no file in this fixture declares
      // via label — so it is never discovered and the ref is not a class def.
      const UNDISCOVERED_META_UID = "99999999-9999-4999-8999-999999999999";
      mockFsAdapter.getMarkdownFiles.mockResolvedValue([
        "assetspaces/ems/1b20a8f0-d745-4e93-91db-4531b3df120e.md",
      ]);
      mockFsAdapter.getFileMetadata.mockResolvedValue({
        exo__Instance_class: [`[[${UNDISCOVERED_META_UID}]]`],
        exo__Asset_uid: "1b20a8f0-d745-4e93-91db-4531b3df120e",
        exo__Asset_label: "ems__Task",
      });

      await expect(
        resolver.resolve("/vault", "ems__Task"),
      ).rejects.toBeInstanceOf(ClassNotFoundError);
    });

    it("should throw ClassNotFoundError with available class suggestions", async () => {
      mockFsAdapter.getMarkdownFiles.mockResolvedValue([
        "class1.md",
        "class2.md",
      ]);
      mockFsAdapter.getFileMetadata
        .mockResolvedValueOnce({
          exo__Instance_class: ['"[[exo__Class]]"'],
          exo__Asset_uid: "uuid-1",
          exo__Asset_label: "ztlk__PermanentNote",
        })
        .mockResolvedValueOnce({
          exo__Instance_class: ['"[[exo__Class]]"'],
          exo__Asset_uid: "uuid-2",
          exo__Asset_label: "ems__Task",
        });

      await expect(
        resolver.resolve("/vault", "xyz__Unknown"),
      ).rejects.toThrow(/xyz__Unknown/);

      // Should include available class names as suggestions
      await expect(
        resolver.resolve("/vault", "xyz__Unknown"),
      ).rejects.toThrow(/Available classes:/);
    });

    it("should throw ClassNotFoundError for unknown class with no available classes", async () => {
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

    it("should skip files without exo__Instance_class containing class marker", async () => {
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

    it("should use UUID from filename when exo__Asset_uid is missing but filename is UUID", async () => {
      mockFsAdapter.getMarkdownFiles.mockResolvedValue([
        "03 Knowledge/ztlk/38b234f7-949a-4da0-bab0-c4ca559808d1.md",
      ]);
      mockFsAdapter.getFileMetadata.mockResolvedValue({
        exo__Instance_class: ['"[[exo__Class]]"'],
        // No exo__Asset_uid — but filename IS a UUID
        exo__Asset_label: "ztlk__PermanentNote",
      });

      const uuid = await resolver.resolve("/vault", "ztlk__PermanentNote");

      expect(uuid).toBe("38b234f7-949a-4da0-bab0-c4ca559808d1");
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

    it("should return classes with exo__Class instance type", async () => {
      mockFsAdapter.getMarkdownFiles.mockResolvedValue([
        "38b234f7-949a-4da0-bab0-c4ca559808d1.md",
      ]);
      mockFsAdapter.getFileMetadata.mockResolvedValue({
        exo__Instance_class: ['"[[exo__Class]]"'],
        exo__Asset_uid: "38b234f7-949a-4da0-bab0-c4ca559808d1",
        exo__Asset_label: "ztlk__PermanentNote",
      });

      const classes = await resolver.listClasses("/vault");

      expect(classes).toContain("ztlk__PermanentNote");
    });
  });
});
