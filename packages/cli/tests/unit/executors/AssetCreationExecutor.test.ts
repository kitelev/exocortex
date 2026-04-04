import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";

// Mock dependencies
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
  directoryExists: jest.fn(),
  createDirectory: jest.fn(),
  getMarkdownFiles: jest.fn(),
  findFileByUID: jest.fn(),
  deleteFile: jest.fn(),
};

const mockFrontmatterService = {
  updateProperty: jest.fn(),
  removeProperty: jest.fn(),
  parse: jest.fn(),
};

const mockDateFormatter = {
  toLocalTimestamp: jest.fn(() => "2026-04-04T12:00:00"),
  toISOTimestamp: jest.fn(),
  toTimestampAtStartOfDay: jest.fn(),
};

let capturedFrontmatter: Record<string, unknown> | null = null;

const mockMetadataHelpers = {
  buildFileContent: jest.fn((frontmatter: Record<string, unknown>) => {
    capturedFrontmatter = frontmatter;
    const lines = ["---"];
    for (const [key, value] of Object.entries(frontmatter)) {
      if (Array.isArray(value)) {
        lines.push(`${key}:`);
        for (const item of value) {
          lines.push(`  - ${item}`);
        }
      } else {
        lines.push(`${key}: ${value}`);
      }
    }
    lines.push("---");
    lines.push("");
    return lines.join("\n");
  }),
};

// Set up module mocks
jest.unstable_mockModule("uuid", () => ({
  v4: jest.fn(() => "test-uuid-1234-5678-9012-abcdef123456"),
}));

jest.unstable_mockModule("../../../src/utils/PathResolver.js", () => ({
  PathResolver: jest.fn(() => mockPathResolverInstance),
}));

jest.unstable_mockModule("../../../src/adapters/NodeFsAdapter.js", () => ({
  NodeFsAdapter: jest.fn(() => mockFsAdapterInstance),
}));

jest.unstable_mockModule("exocortex", () => ({
  FrontmatterService: jest.fn(() => mockFrontmatterService),
  DateFormatter: mockDateFormatter,
  MetadataHelpers: mockMetadataHelpers,
  FileAlreadyExistsError: class FileAlreadyExistsError extends Error {
    constructor(msg: string) {
      super(`File already exists: ${msg}`);
    }
  },
}));

// Dynamic import after mocks
const { AssetCreationExecutor } = await import(
  "../../../src/executors/commands/AssetCreationExecutor.js"
);

describe("AssetCreationExecutor", () => {
  let executor: InstanceType<typeof AssetCreationExecutor>;
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let processExitSpy: jest.SpiedFunction<typeof process.exit>;

  beforeEach(() => {
    jest.clearAllMocks();
    capturedFrontmatter = null;

    mockPathResolverInstance.resolve.mockImplementation(
      (path: string) => `/test/vault/${path}`,
    );
    mockPathResolverInstance.validate.mockImplementation(() => {});
    mockPathResolverInstance.getVaultRoot.mockReturnValue("/test/vault");

    mockFsAdapterInstance.fileExists.mockResolvedValue(false);
    mockFsAdapterInstance.createFile.mockResolvedValue("01 Inbox/file.md");

    executor = new AssetCreationExecutor({
      pathResolver: mockPathResolverInstance as any,
      fsAdapter: mockFsAdapterInstance as any,
      frontmatterService: mockFrontmatterService as any,
      dryRun: false,
    });

    consoleLogSpy = jest
      .spyOn(console, "log")
      .mockImplementation(() => {});
    processExitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Issue #2486: prototype property name", () => {
    it("should use exo__Asset_prototype (not ems__Effort_prototype) when prototype option is provided", async () => {
      await executor.executeCreateTask("task.md", "Test Task", {
        prototype: "proto-uuid-1234",
      });

      expect(mockMetadataHelpers.buildFileContent).toHaveBeenCalled();
      expect(capturedFrontmatter).not.toBeNull();
      expect(capturedFrontmatter!["exo__Asset_prototype"]).toBe(
        '"[[proto-uuid-1234]]"',
      );
      expect(capturedFrontmatter!["ems__Effort_prototype"]).toBeUndefined();
    });

    it("should not include prototype property when option is not provided", async () => {
      await executor.executeCreateTask("task.md", "Test Task", {});

      expect(capturedFrontmatter).not.toBeNull();
      expect(capturedFrontmatter!["exo__Asset_prototype"]).toBeUndefined();
      expect(capturedFrontmatter!["ems__Effort_prototype"]).toBeUndefined();
    });
  });
});
