import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// Mock NodeFsAdapter
const mockFsAdapter = {
  getMarkdownFiles: jest.fn(),
  getFileMetadata: jest.fn(),
  readFile: jest.fn(),
  fileExists: jest.fn<(path: string) => Promise<boolean>>(),
  createFile: jest.fn(),
  updateFile: jest.fn(),
  writeFile: jest.fn(),
  deleteFile: jest.fn(),
  renameFile: jest.fn(),
  createDirectory: jest.fn(),
  directoryExists: jest.fn(),
  findFilesByMetadata: jest.fn(),
  findFileByUID: jest.fn<(uid: string) => Promise<string | null>>(),
  findFileByUidFilename:
    jest.fn<(uid: string) => Promise<string | null>>(),
};

jest.unstable_mockModule("../../../src/adapters/NodeFsAdapter.js", () => ({
  NodeFsAdapter: jest.fn(() => mockFsAdapter),
}));

const { WikilinkValidator, WikilinkNotFoundError } = await import(
  "../../../src/services/WikilinkValidator.js"
);

describe("WikilinkValidator", () => {
  let validator: InstanceType<typeof WikilinkValidator>;

  beforeEach(() => {
    jest.clearAllMocks();
    validator = new WikilinkValidator(mockFsAdapter as any);
  });

  describe("validatePropertyValues()", () => {
    it("should pass for existing UUID wikilinks", async () => {
      mockFsAdapter.findFileByUidFilename.mockResolvedValue(
        "some/path/a3f9c2d1-1234-4567-8901-abcdef123456.md",
      );

      await expect(
        validator.validatePropertyValues({
          "ztlk__Note_developedFrom":
            "[[a3f9c2d1-1234-4567-8901-abcdef123456|Label1]]",
        }),
      ).resolves.toBeUndefined();

      expect(mockFsAdapter.findFileByUidFilename).toHaveBeenCalledWith(
        "a3f9c2d1-1234-4567-8901-abcdef123456",
      );
    });

    it("should throw WikilinkNotFoundError for missing UUID", async () => {
      mockFsAdapter.findFileByUidFilename.mockResolvedValue(null);
      mockFsAdapter.findFileByUID.mockResolvedValue(null);

      await expect(
        validator.validatePropertyValues({
          "ztlk__Note_developedFrom":
            "[[deadbeef-0000-0000-0000-000000000000|Missing]]",
        }),
      ).rejects.toThrow(
        "Wikilink [[deadbeef-0000-0000-0000-000000000000|Missing]] \u2014 file not found in vault",
      );
    });

    it("should throw WikilinkNotFoundError instance", async () => {
      mockFsAdapter.findFileByUidFilename.mockResolvedValue(null);
      mockFsAdapter.findFileByUID.mockResolvedValue(null);

      await expect(
        validator.validatePropertyValues({
          prop: "[[deadbeef-0000-0000-0000-000000000000]]",
        }),
      ).rejects.toBeInstanceOf(WikilinkNotFoundError);
    });

    it("should validate multiple wikilinks in one value", async () => {
      mockFsAdapter.findFileByUidFilename.mockResolvedValue("some/path.md");

      await expect(
        validator.validatePropertyValues({
          "prop":
            "[[aaaaaaaa-1111-2222-3333-444444444444|L1]],[[bbbbbbbb-5555-6666-7777-888888888888|L2]]",
        }),
      ).resolves.toBeUndefined();

      expect(mockFsAdapter.findFileByUidFilename).toHaveBeenCalledTimes(2);
    });

    it("should fail on first missing wikilink", async () => {
      mockFsAdapter.findFileByUidFilename
        .mockResolvedValueOnce("some/path.md") // First exists
        .mockResolvedValueOnce(null); // Second does not
      mockFsAdapter.findFileByUID.mockResolvedValue(null);

      await expect(
        validator.validatePropertyValues({
          "prop":
            "[[aaaaaaaa-1111-2222-3333-444444444444|OK]],[[deadbeef-0000-0000-0000-000000000000|Missing]]",
        }),
      ).rejects.toThrow(WikilinkNotFoundError);
    });

    it("should skip non-UUID wikilinks (e.g., date references)", async () => {
      // Date wikilinks like [[2025-01-01]] should be skipped
      await expect(
        validator.validatePropertyValues({
          "ems__Effort_day": "[[2025-01-01]]",
        }),
      ).resolves.toBeUndefined();

      expect(mockFsAdapter.findFileByUidFilename).not.toHaveBeenCalled();
    });

    it("should skip non-UUID wikilinks like class names", async () => {
      await expect(
        validator.validatePropertyValues({
          "exo__Instance_class": "[[ems__Task]]",
        }),
      ).resolves.toBeUndefined();

      expect(mockFsAdapter.findFileByUidFilename).not.toHaveBeenCalled();
    });

    it("should validate across multiple properties", async () => {
      mockFsAdapter.findFileByUidFilename.mockResolvedValue("some/path.md");

      await expect(
        validator.validatePropertyValues({
          "prop1": "[[aaaaaaaa-1111-2222-3333-444444444444|L1]]",
          "prop2": "[[bbbbbbbb-5555-6666-7777-888888888888|L2]]",
        }),
      ).resolves.toBeUndefined();

      expect(mockFsAdapter.findFileByUidFilename).toHaveBeenCalledTimes(2);
    });

    it("should handle properties without wikilinks", async () => {
      await expect(
        validator.validatePropertyValues({
          "simple_prop": "just a string value",
          "number_prop": "42",
        }),
      ).resolves.toBeUndefined();

      expect(mockFsAdapter.findFileByUidFilename).not.toHaveBeenCalled();
    });

    it("should find file by UID frontmatter fallback when filename does not match", async () => {
      // Filename lookup misses (e.g. asset is not UID-named) but the
      // frontmatter exo__Asset_uid scan finds it — must NOT throw.
      mockFsAdapter.findFileByUidFilename.mockResolvedValue(null);
      mockFsAdapter.findFileByUID.mockResolvedValue("some/path/to/file.md");

      await expect(
        validator.validatePropertyValues({
          "prop": "[[aaaaaaaa-1111-2222-3333-444444444444|Found by UID]]",
        }),
      ).resolves.toBeUndefined();

      expect(mockFsAdapter.findFileByUidFilename).toHaveBeenCalledWith(
        "aaaaaaaa-1111-2222-3333-444444444444",
      );
      expect(mockFsAdapter.findFileByUID).toHaveBeenCalledWith(
        "aaaaaaaa-1111-2222-3333-444444444444",
      );
    });
  });

  describe("extractWikilinks()", () => {
    it("should extract UUID and label from [[uuid|label]]", () => {
      const result = validator.extractWikilinks(
        "[[a3f9c2d1-1234-4567-8901-abcdef123456|My Label]]",
      );

      expect(result).toHaveLength(1);
      expect(result[0].uuid).toBe("a3f9c2d1-1234-4567-8901-abcdef123456");
      expect(result[0].label).toBe("My Label");
    });

    it("should extract UUID without label from [[uuid]]", () => {
      const result = validator.extractWikilinks(
        "[[a3f9c2d1-1234-4567-8901-abcdef123456]]",
      );

      expect(result).toHaveLength(1);
      expect(result[0].uuid).toBe("a3f9c2d1-1234-4567-8901-abcdef123456");
      expect(result[0].label).toBeUndefined();
    });

    it("should extract multiple wikilinks", () => {
      const result = validator.extractWikilinks(
        "[[uuid1-1111-2222-3333-444444444444|L1]],[[uuid2-5555-6666-7777-888888888888|L2]]",
      );

      expect(result).toHaveLength(2);
      expect(result[0].uuid).toBe("uuid1-1111-2222-3333-444444444444");
      expect(result[1].uuid).toBe("uuid2-5555-6666-7777-888888888888");
    });

    it("should return empty array for strings without wikilinks", () => {
      const result = validator.extractWikilinks("just a regular string");

      expect(result).toHaveLength(0);
    });
  });
});
