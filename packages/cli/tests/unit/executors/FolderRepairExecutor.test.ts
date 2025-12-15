import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { ExitCodes } from "../../../src/utils/ExitCodes.js";

// Mock dependencies before importing FolderRepairExecutor
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
  createDirectory: jest.fn(),
  directoryExists: jest.fn(),
  getMarkdownFiles: jest.fn(),
  findFileByUID: jest.fn(),
};

const mockFrontmatterService = {
  updateProperty: jest.fn((content: string, prop: string, value: string) => {
    return content.replace(/---\n([\s\S]*?)\n---/, (match, fm) => {
      return `---\n${fm}\n${prop}: ${value}\n---`;
    });
  }),
  parse: jest.fn((content: string) => ({
    exists: content.includes("---"),
    content: content.match(/---\n([\s\S]*?)\n---/)?.[1] || "",
    originalContent: content,
  })),
};

const mockDateFormatter = {
  toLocalTimestamp: jest.fn(),
};

const mockMetadataHelpers = {
  buildFileContent: jest.fn((frontmatter: Record<string, any>) => {
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
  FileNotFoundError: class FileNotFoundError extends Error {},
  FileAlreadyExistsError: class FileAlreadyExistsError extends Error {
    constructor(msg: string) {
      super(`File already exists: ${msg}`);
    }
  },
}));

// Dynamic import after mocks
// FolderRepairExecutor is indirectly used through CommandExecutor.executeRepairFolder()
await import("../../../src/executors/commands/FolderRepairExecutor.js");
const { CommandExecutor } = await import("../../../src/executors/CommandExecutor.js");

describe("FolderRepairExecutor", () => {
  let executor: InstanceType<typeof CommandExecutor>;
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;
  let processExitSpy: jest.SpiedFunction<typeof process.exit>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Reset mock implementations to defaults
    mockPathResolverInstance.resolve.mockImplementation(
      (path: string) => `/test/vault/${path}`,
    );
    mockPathResolverInstance.validate.mockImplementation(() => {});
    mockPathResolverInstance.getVaultRoot.mockReturnValue("/test/vault");

    mockFsAdapterInstance.readFile.mockResolvedValue("# Content");
    mockFsAdapterInstance.getFileMetadata.mockResolvedValue({});
    mockFsAdapterInstance.updateFile.mockResolvedValue(undefined);
    mockFsAdapterInstance.renameFile.mockResolvedValue(undefined);
    mockFsAdapterInstance.fileExists.mockResolvedValue(false);
    mockFsAdapterInstance.createFile.mockResolvedValue("file.md");
    mockFsAdapterInstance.writeFile.mockResolvedValue(undefined);
    mockFsAdapterInstance.createDirectory.mockResolvedValue(undefined);
    mockFsAdapterInstance.directoryExists.mockResolvedValue(false);
    mockFsAdapterInstance.getMarkdownFiles.mockResolvedValue([]);
    mockFsAdapterInstance.findFileByUID.mockResolvedValue(null);

    executor = new CommandExecutor("/test/vault");

    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    processExitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("executeRepairFolder()", () => {
    describe("error cases", () => {
      it("should throw error when exo__Asset_isDefinedBy is missing", async () => {
        mockPathResolverInstance.resolve.mockReturnValue(
          "/test/vault/tasks/task.md",
        );
        mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
          exo__Asset_label: "My Task",
          // No exo__Asset_isDefinedBy
        });

        await executor.executeRepairFolder("tasks/task.md");

        expect(processExitSpy).toHaveBeenCalled();
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining("missing exo__Asset_isDefinedBy"),
        );
        expect(mockFsAdapterInstance.renameFile).not.toHaveBeenCalled();
      });

      it("should throw error when referenced asset not found", async () => {
        mockPathResolverInstance.resolve.mockReturnValue(
          "/test/vault/tasks/task.md",
        );
        mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
          exo__Asset_label: "My Task",
          exo__Asset_isDefinedBy: "[[nonexistent-project]]",
        });
        mockFsAdapterInstance.fileExists.mockResolvedValue(false);
        mockFsAdapterInstance.findFileByUID.mockResolvedValue(null);
        mockFsAdapterInstance.getMarkdownFiles.mockResolvedValue([]);

        await executor.executeRepairFolder("tasks/task.md");

        expect(processExitSpy).toHaveBeenCalled();
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining("referenced asset not found"),
        );
        expect(mockFsAdapterInstance.renameFile).not.toHaveBeenCalled();
      });

      it("should throw error when target file already exists", async () => {
        mockPathResolverInstance.resolve.mockReturnValue(
          "/test/vault/wrong-folder/task.md",
        );
        mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
          exo__Asset_label: "My Task",
          exo__Asset_isDefinedBy: "[[projects/my-project]]",
        });
        // Referenced file exists
        mockFsAdapterInstance.fileExists.mockImplementation(async (path: string) => {
          if (path === "projects/my-project.md") return true;
          if (path === "projects/task.md") return true; // Target exists!
          return false;
        });

        await executor.executeRepairFolder("wrong-folder/task.md");

        expect(processExitSpy).toHaveBeenCalled();
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining("already exists"),
        );
        expect(mockFsAdapterInstance.renameFile).not.toHaveBeenCalled();
      });
    });

    describe("success cases", () => {
      it("should move file to correct folder", async () => {
        mockPathResolverInstance.resolve.mockReturnValue(
          "/test/vault/wrong-folder/task.md",
        );
        mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
          exo__Asset_label: "My Task",
          exo__Asset_isDefinedBy: "[[projects/my-project]]",
        });
        // Referenced file exists, target does not
        mockFsAdapterInstance.fileExists.mockImplementation(async (path: string) => {
          if (path === "projects/my-project.md") return true;
          if (path === "projects/task.md") return false; // Target doesn't exist
          return false;
        });
        mockFsAdapterInstance.directoryExists.mockResolvedValue(true);

        await executor.executeRepairFolder("wrong-folder/task.md");

        expect(processExitSpy).toHaveBeenCalledWith(ExitCodes.SUCCESS);
        expect(mockFsAdapterInstance.renameFile).toHaveBeenCalledWith(
          "wrong-folder/task.md",
          "projects/task.md",
        );
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining("Moved to correct folder"),
        );
      });

      it("should handle file already in correct folder", async () => {
        mockPathResolverInstance.resolve.mockReturnValue(
          "/test/vault/projects/task.md",
        );
        mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
          exo__Asset_label: "My Task",
          exo__Asset_isDefinedBy: "[[projects/my-project]]",
        });
        // Referenced file exists in same folder
        mockFsAdapterInstance.fileExists.mockImplementation(async (path: string) => {
          if (path === "projects/my-project.md") return true;
          return false;
        });

        await executor.executeRepairFolder("projects/task.md");

        expect(processExitSpy).toHaveBeenCalledWith(ExitCodes.SUCCESS);
        expect(mockFsAdapterInstance.renameFile).not.toHaveBeenCalled();
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining("Already in correct folder"),
        );
      });

      it("should create target folder if it does not exist", async () => {
        mockPathResolverInstance.resolve.mockReturnValue(
          "/test/vault/wrong-folder/task.md",
        );
        mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
          exo__Asset_label: "My Task",
          exo__Asset_isDefinedBy: "[[new-folder/my-project]]",
        });
        mockFsAdapterInstance.fileExists.mockImplementation(async (path: string) => {
          if (path === "new-folder/my-project.md") return true;
          return false;
        });
        mockFsAdapterInstance.directoryExists.mockResolvedValue(false);

        await executor.executeRepairFolder("wrong-folder/task.md");

        expect(processExitSpy).toHaveBeenCalledWith(ExitCodes.SUCCESS);
        expect(mockFsAdapterInstance.createDirectory).toHaveBeenCalledWith("new-folder");
        expect(mockFsAdapterInstance.renameFile).toHaveBeenCalled();
      });
    });

    describe("reference format handling", () => {
      it("should handle [[Reference]] format", async () => {
        mockPathResolverInstance.resolve.mockReturnValue(
          "/test/vault/tasks/task.md",
        );
        mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
          exo__Asset_isDefinedBy: "[[projects/my-project]]",
        });
        mockFsAdapterInstance.fileExists.mockImplementation(async (path: string) => {
          if (path === "projects/my-project.md") return true;
          return false;
        });
        mockFsAdapterInstance.directoryExists.mockResolvedValue(true);

        await executor.executeRepairFolder("tasks/task.md");

        expect(processExitSpy).toHaveBeenCalledWith(ExitCodes.SUCCESS);
        expect(mockFsAdapterInstance.renameFile).toHaveBeenCalledWith(
          "tasks/task.md",
          "projects/task.md",
        );
      });

      it('should handle "[[Reference]]" format with quotes', async () => {
        mockPathResolverInstance.resolve.mockReturnValue(
          "/test/vault/tasks/task.md",
        );
        mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
          exo__Asset_isDefinedBy: '"[[projects/my-project]]"',
        });
        mockFsAdapterInstance.fileExists.mockImplementation(async (path: string) => {
          if (path === "projects/my-project.md") return true;
          return false;
        });
        mockFsAdapterInstance.directoryExists.mockResolvedValue(true);

        await executor.executeRepairFolder("tasks/task.md");

        expect(processExitSpy).toHaveBeenCalledWith(ExitCodes.SUCCESS);
        expect(mockFsAdapterInstance.renameFile).toHaveBeenCalled();
      });

      it("should handle plain reference without brackets", async () => {
        mockPathResolverInstance.resolve.mockReturnValue(
          "/test/vault/tasks/task.md",
        );
        mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
          exo__Asset_isDefinedBy: "projects/my-project",
        });
        mockFsAdapterInstance.fileExists.mockImplementation(async (path: string) => {
          if (path === "projects/my-project.md") return true;
          return false;
        });
        mockFsAdapterInstance.directoryExists.mockResolvedValue(true);

        await executor.executeRepairFolder("tasks/task.md");

        expect(processExitSpy).toHaveBeenCalledWith(ExitCodes.SUCCESS);
        expect(mockFsAdapterInstance.renameFile).toHaveBeenCalled();
      });

      it("should find referenced file by UID", async () => {
        mockPathResolverInstance.resolve.mockReturnValue(
          "/test/vault/tasks/task.md",
        );
        mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
          exo__Asset_isDefinedBy: "[[abc123-def456]]",
        });
        mockFsAdapterInstance.fileExists.mockResolvedValue(false);
        mockFsAdapterInstance.findFileByUID.mockResolvedValue("projects/abc123-def456.md");
        mockFsAdapterInstance.directoryExists.mockResolvedValue(true);

        await executor.executeRepairFolder("tasks/task.md");

        expect(processExitSpy).toHaveBeenCalledWith(ExitCodes.SUCCESS);
        expect(mockFsAdapterInstance.findFileByUID).toHaveBeenCalledWith("abc123-def456");
        expect(mockFsAdapterInstance.renameFile).toHaveBeenCalledWith(
          "tasks/task.md",
          "projects/task.md",
        );
      });

      it("should find referenced file by filename search", async () => {
        mockPathResolverInstance.resolve.mockReturnValue(
          "/test/vault/tasks/task.md",
        );
        mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
          exo__Asset_isDefinedBy: "[[my-project]]",
        });
        mockFsAdapterInstance.fileExists.mockResolvedValue(false);
        mockFsAdapterInstance.findFileByUID.mockResolvedValue(null);
        mockFsAdapterInstance.getMarkdownFiles.mockResolvedValue([
          "projects/my-project.md",
          "other/some-file.md",
        ]);
        mockFsAdapterInstance.directoryExists.mockResolvedValue(true);

        await executor.executeRepairFolder("tasks/task.md");

        expect(processExitSpy).toHaveBeenCalledWith(ExitCodes.SUCCESS);
        expect(mockFsAdapterInstance.renameFile).toHaveBeenCalledWith(
          "tasks/task.md",
          "projects/task.md",
        );
      });
    });

    describe("dry-run mode", () => {
      let dryRunExecutor: InstanceType<typeof CommandExecutor>;

      beforeEach(() => {
        dryRunExecutor = new CommandExecutor("/test/vault", true);
      });

      it("should preview move without modifying files", async () => {
        mockPathResolverInstance.resolve.mockReturnValue(
          "/test/vault/wrong-folder/task.md",
        );
        mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
          exo__Asset_label: "My Task",
          exo__Asset_isDefinedBy: "[[projects/my-project]]",
        });
        mockFsAdapterInstance.fileExists.mockImplementation(async (path: string) => {
          if (path === "projects/my-project.md") return true;
          return false;
        });

        await dryRunExecutor.executeRepairFolder("wrong-folder/task.md");

        expect(processExitSpy).toHaveBeenCalledWith(ExitCodes.SUCCESS);
        expect(mockFsAdapterInstance.renameFile).not.toHaveBeenCalled();
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining("DRY RUN"),
        );
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining("Would move to"),
        );
      });

      it("should show current and expected folders in dry-run", async () => {
        mockPathResolverInstance.resolve.mockReturnValue(
          "/test/vault/wrong-folder/task.md",
        );
        mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
          exo__Asset_isDefinedBy: "[[correct-folder/project]]",
        });
        mockFsAdapterInstance.fileExists.mockImplementation(async (path: string) => {
          if (path === "correct-folder/project.md") return true;
          return false;
        });

        await dryRunExecutor.executeRepairFolder("wrong-folder/task.md");

        expect(processExitSpy).toHaveBeenCalledWith(ExitCodes.SUCCESS);
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining("Current folder"),
        );
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining("Expected folder"),
        );
      });
    });

    describe("edge cases", () => {
      it("should handle file at vault root", async () => {
        mockPathResolverInstance.resolve.mockReturnValue(
          "/test/vault/task.md",
        );
        mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
          exo__Asset_isDefinedBy: "[[projects/project]]",
        });
        mockFsAdapterInstance.fileExists.mockImplementation(async (path: string) => {
          if (path === "projects/project.md") return true;
          return false;
        });
        mockFsAdapterInstance.directoryExists.mockResolvedValue(true);

        await executor.executeRepairFolder("task.md");

        expect(processExitSpy).toHaveBeenCalledWith(ExitCodes.SUCCESS);
        expect(mockFsAdapterInstance.renameFile).toHaveBeenCalledWith(
          "task.md",
          "projects/task.md",
        );
      });

      it("should handle referenced file at vault root", async () => {
        mockPathResolverInstance.resolve.mockReturnValue(
          "/test/vault/subfolder/task.md",
        );
        mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
          exo__Asset_isDefinedBy: "[[root-project]]",
        });
        mockFsAdapterInstance.fileExists.mockImplementation(async (path: string) => {
          if (path === "root-project.md") return true;
          if (path === "task.md") return false;
          return false;
        });
        // Need to mock getMarkdownFiles to find the file at root
        mockFsAdapterInstance.getMarkdownFiles.mockResolvedValue([
          "root-project.md",
          "subfolder/task.md",
        ]);

        await executor.executeRepairFolder("subfolder/task.md");

        expect(processExitSpy).toHaveBeenCalledWith(ExitCodes.SUCCESS);
        expect(mockFsAdapterInstance.renameFile).toHaveBeenCalledWith(
          "subfolder/task.md",
          "task.md",
        );
      });

      it("should handle invalid reference format (non-string)", async () => {
        mockPathResolverInstance.resolve.mockReturnValue(
          "/test/vault/task.md",
        );
        mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
          exo__Asset_isDefinedBy: { invalid: "object" },
        });

        await executor.executeRepairFolder("task.md");

        expect(processExitSpy).toHaveBeenCalled();
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining("invalid exo__Asset_isDefinedBy format"),
        );
      });

      it("should handle empty reference string", async () => {
        mockPathResolverInstance.resolve.mockReturnValue(
          "/test/vault/task.md",
        );
        mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
          exo__Asset_isDefinedBy: "",
        });

        await executor.executeRepairFolder("task.md");

        expect(processExitSpy).toHaveBeenCalled();
        expect(mockFsAdapterInstance.renameFile).not.toHaveBeenCalled();
      });
    });
  });
});
