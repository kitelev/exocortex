import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";

// Mock dependencies before importing BatchExecutor
const mockPathResolverInstance = {
  resolve: jest.fn(),
  validate: jest.fn(),
  getVaultRoot: jest.fn().mockReturnValue("/test/vault"),
};

const mockFsAdapterInstance = {
  readFile: jest.fn(),
  getFileMetadata: jest.fn(),
  updateFile: jest.fn(),
  renameFile: jest.fn(),
  fileExists: jest.fn(),
  createFile: jest.fn(),
  writeFile: jest.fn(),
  findFileByUID: jest.fn(),
  getMarkdownFiles: jest.fn(),
  directoryExists: jest.fn(),
};

const mockFrontmatterService = {
  updateProperty: jest.fn((content: string, prop: string, value: string) => {
    return content.replace(/---\n([\s\S]*?)\n---/, (match, fm) => {
      return `---\n${fm}\n${prop}: ${value}\n---`;
    });
  }),
  removeProperty: jest.fn((content: string, prop: string) => {
    return content.replace(new RegExp(`${prop}:.*\\n`, "g"), "");
  }),
  parse: jest.fn((content: string) => ({
    exists: content.includes("---"),
    content: content.match(/---\n([\s\S]*?)\n---/)?.[1] || "",
    originalContent: content,
  })),
};

const mockDateFormatter = {
  toLocalTimestamp: jest.fn(() => "2025-12-14T10:00:00"),
  toTimestampAtStartOfDay: jest.fn((dateStr: string) => `${dateStr}T00:00:00Z`),
};

const mockTransactionManager = {
  begin: jest.fn(),
  verify: jest.fn(),
  commit: jest.fn(),
  rollback: jest.fn(),
  getTrackedFiles: jest.fn(),
};

// Set up module mocks
jest.unstable_mockModule("../../../src/utils/PathResolver.js", () => ({
  PathResolver: jest.fn(() => mockPathResolverInstance),
}));

jest.unstable_mockModule("../../../src/adapters/NodeFsAdapter.js", () => ({
  NodeFsAdapter: jest.fn(() => mockFsAdapterInstance),
}));

jest.unstable_mockModule("exocortex", () => ({
  FrontmatterService: jest.fn(() => mockFrontmatterService),
  DateFormatter: mockDateFormatter,
}));

jest.unstable_mockModule("../../../src/utils/TransactionManager.js", () => ({
  TransactionManager: jest.fn(() => mockTransactionManager),
}));

// Dynamic import after mocks
const { BatchExecutor } = await import(
  "../../../src/executors/BatchExecutor.js"
);

describe("BatchExecutor - repair-folder command", () => {
  let executor: InstanceType<typeof BatchExecutor>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset mock implementations to defaults
    mockPathResolverInstance.resolve.mockImplementation(
      (path: string) => `/test/vault/${path}`,
    );
    mockPathResolverInstance.validate.mockImplementation(() => {});
    mockPathResolverInstance.getVaultRoot.mockReturnValue("/test/vault");

    mockFsAdapterInstance.readFile.mockResolvedValue(
      "---\nexo__Asset_label: Test\n---\n# Content",
    );
    mockFsAdapterInstance.updateFile.mockResolvedValue(undefined);
    mockFsAdapterInstance.renameFile.mockResolvedValue(undefined);

    mockTransactionManager.begin.mockResolvedValue(undefined);
    mockTransactionManager.commit.mockResolvedValue(undefined);
    mockTransactionManager.rollback.mockResolvedValue(undefined);

    executor = new BatchExecutor("/test/vault");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("repair-folder command", () => {
    it("should move file to correct folder based on exo__Asset_isDefinedBy", async () => {
      mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
        exo__Asset_isDefinedBy: "[[definition]]",
      });

      // Setup for reference resolution and move
      mockFsAdapterInstance.fileExists.mockImplementation(async (path: string) => {
        // Direct path and same folder checks return false
        // Target file doesn't exist (allowing move)
        if (path === "03 Knowledge/kitelev/task.md") return false;
        return false;
      });
      mockFsAdapterInstance.findFileByUID.mockResolvedValue(null);
      mockFsAdapterInstance.getMarkdownFiles.mockResolvedValue([
        "03 Knowledge/kitelev/definition.md",
      ]);

      const result = await executor.executeBatch([
        { command: "repair-folder", filepath: "01 Inbox/task.md" },
      ]);

      expect(result.success).toBe(true);
      expect(result.results[0].success).toBe(true);
      expect(result.results[0].action).toBe("Moved to 03 Knowledge/kitelev");
      expect(result.results[0].changes?.moved).toBe(true);
      expect(result.results[0].changes?.newPath).toBe("03 Knowledge/kitelev/task.md");
      expect(mockFsAdapterInstance.renameFile).toHaveBeenCalledWith(
        "01 Inbox/task.md",
        "03 Knowledge/kitelev/task.md",
      );
    });

    it("should report already in correct folder when no move needed", async () => {
      mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
        exo__Asset_isDefinedBy: "[[definition]]",
      });

      // Definition is in same folder
      mockFsAdapterInstance.fileExists.mockImplementation(async (path: string) => {
        if (path === "03 Knowledge/kitelev/definition.md") return true;
        return false;
      });

      const result = await executor.executeBatch([
        { command: "repair-folder", filepath: "03 Knowledge/kitelev/task.md" },
      ]);

      expect(result.success).toBe(true);
      expect(result.results[0].success).toBe(true);
      expect(result.results[0].action).toBe("Already in correct folder");
      expect(result.results[0].changes?.moved).toBe(false);
      expect(mockFsAdapterInstance.renameFile).not.toHaveBeenCalled();
    });

    it("should fail when exo__Asset_isDefinedBy is missing", async () => {
      mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
        exo__Asset_label: "Test Task",
        // No exo__Asset_isDefinedBy property
      });

      const result = await executor.executeBatch([
        { command: "repair-folder", filepath: "task.md" },
      ]);

      expect(result.success).toBe(false);
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].error).toContain("missing exo__Asset_isDefinedBy");
    });

    it("should fail when referenced asset is not found", async () => {
      mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
        exo__Asset_isDefinedBy: "[[nonexistent-definition]]",
      });

      // Nothing found anywhere
      mockFsAdapterInstance.fileExists.mockResolvedValue(false);
      mockFsAdapterInstance.findFileByUID.mockResolvedValue(null);
      mockFsAdapterInstance.getMarkdownFiles.mockResolvedValue([]);

      const result = await executor.executeBatch([
        { command: "repair-folder", filepath: "task.md" },
      ]);

      expect(result.success).toBe(false);
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].error).toContain("referenced asset not found");
    });

    it("should fail when target path already exists", async () => {
      mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
        exo__Asset_isDefinedBy: "[[definition]]",
      });

      mockFsAdapterInstance.fileExists.mockImplementation(async (path: string) => {
        // Reference resolution
        if (path === "definition.md") return false;
        // Target already exists - conflict!
        if (path === "03 Knowledge/kitelev/task.md") return true;
        return false;
      });
      mockFsAdapterInstance.findFileByUID.mockResolvedValue(null);
      mockFsAdapterInstance.getMarkdownFiles.mockResolvedValue([
        "03 Knowledge/kitelev/definition.md",
      ]);

      const result = await executor.executeBatch([
        { command: "repair-folder", filepath: "01 Inbox/task.md" },
      ]);

      expect(result.success).toBe(false);
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].error).toContain("already exists");
    });

    it("should handle quoted wiki-link format", async () => {
      mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
        exo__Asset_isDefinedBy: '"[[definition]]"',
      });

      mockFsAdapterInstance.fileExists.mockResolvedValue(false);
      mockFsAdapterInstance.findFileByUID.mockResolvedValue(null);
      mockFsAdapterInstance.getMarkdownFiles.mockResolvedValue([
        "folder/definition.md",
      ]);

      const result = await executor.executeBatch([
        { command: "repair-folder", filepath: "other/task.md" },
      ]);

      expect(result.success).toBe(true);
      expect(result.results[0].success).toBe(true);
      expect(result.results[0].changes?.newPath).toBe("folder/task.md");
    });

    it("should resolve reference by direct path when includes slash", async () => {
      mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
        exo__Asset_isDefinedBy: "[[03 Knowledge/kitelev/definition]]",
      });

      mockFsAdapterInstance.fileExists.mockImplementation(async (path: string) => {
        // Direct path check succeeds
        if (path === "03 Knowledge/kitelev/definition.md") return true;
        // Target doesn't exist
        return false;
      });

      const result = await executor.executeBatch([
        { command: "repair-folder", filepath: "01 Inbox/task.md" },
      ]);

      expect(result.success).toBe(true);
      expect(result.results[0].success).toBe(true);
      expect(result.results[0].changes?.newPath).toBe("03 Knowledge/kitelev/task.md");
    });

    it("should resolve reference by UID", async () => {
      mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
        exo__Asset_isDefinedBy: "abc123-def456",
      });

      mockFsAdapterInstance.fileExists.mockResolvedValue(false);
      mockFsAdapterInstance.findFileByUID.mockResolvedValue("folder/definition.md");
      mockFsAdapterInstance.getMarkdownFiles.mockResolvedValue([]);

      const result = await executor.executeBatch([
        { command: "repair-folder", filepath: "wrong/task.md" },
      ]);

      expect(result.success).toBe(true);
      expect(result.results[0].success).toBe(true);
      expect(result.results[0].changes?.newPath).toBe("folder/task.md");
      expect(mockFsAdapterInstance.findFileByUID).toHaveBeenCalledWith("abc123-def456");
    });

    it("should process multiple files in batch", async () => {
      mockFsAdapterInstance.getFileMetadata
        .mockResolvedValueOnce({ exo__Asset_isDefinedBy: "[[def1]]" })
        .mockResolvedValueOnce({ exo__Asset_isDefinedBy: "[[def2]]" })
        .mockResolvedValueOnce({ exo__Asset_label: "No definition" }); // Missing

      mockFsAdapterInstance.fileExists.mockResolvedValue(false);
      mockFsAdapterInstance.findFileByUID.mockResolvedValue(null);
      mockFsAdapterInstance.getMarkdownFiles
        .mockResolvedValueOnce(["folder1/def1.md"])
        .mockResolvedValueOnce(["folder2/def2.md"])
        .mockResolvedValueOnce([]);

      const result = await executor.executeBatch([
        { command: "repair-folder", filepath: "inbox/task1.md" },
        { command: "repair-folder", filepath: "inbox/task2.md" },
        { command: "repair-folder", filepath: "inbox/task3.md" },
      ]);

      expect(result.total).toBe(3);
      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.results[0].success).toBe(true);
      expect(result.results[1].success).toBe(true);
      expect(result.results[2].success).toBe(false);
    });

    it("should not modify files in dry run mode", async () => {
      const dryRunExecutor = new BatchExecutor("/test/vault", true);

      mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
        exo__Asset_isDefinedBy: "[[definition]]",
      });

      const result = await dryRunExecutor.executeBatch([
        { command: "repair-folder", filepath: "task.md" },
      ]);

      expect(result.success).toBe(true);
      expect(result.results[0].action).toContain("dry-run");
      expect(mockFsAdapterInstance.renameFile).not.toHaveBeenCalled();
    });
  });
});
