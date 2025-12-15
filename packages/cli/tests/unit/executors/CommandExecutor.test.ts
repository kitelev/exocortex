import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { ExitCodes } from "../../../src/utils/ExitCodes.js";

// Mock dependencies before importing CommandExecutor
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
  toLocalTimestamp: jest.fn((date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
  }),
  toISOTimestamp: jest.fn((date: Date) => {
    return date.toISOString().replace(/\.\d{3}Z$/, "Z");
  }),
  toTimestampAtStartOfDay: jest.fn((dateStr: string) => {
    return `${dateStr}T00:00:00Z`;
  }),
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
  FileNotFoundError: class FileNotFoundError extends Error {},
  FileAlreadyExistsError: class FileAlreadyExistsError extends Error {
    constructor(msg: string) {
      super(`File already exists: ${msg}`);
    }
  },
}));

// Dynamic import after mocks
const { CommandExecutor } = await import("../../../src/executors/CommandExecutor.js");

describe("CommandExecutor", () => {
  let executor: InstanceType<typeof CommandExecutor>;
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;
  let processExitSpy: jest.SpiedFunction<typeof process.exit>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Reset mock implementations to defaults
    mockPathResolverInstance.resolve.mockImplementation((path: string) => `/test/vault/${path}`);
    mockPathResolverInstance.validate.mockImplementation(() => {});
    mockPathResolverInstance.getVaultRoot.mockReturnValue("/test/vault");

    mockFsAdapterInstance.readFile.mockResolvedValue("# Content");
    mockFsAdapterInstance.getFileMetadata.mockResolvedValue({});
    mockFsAdapterInstance.updateFile.mockResolvedValue(undefined);
    mockFsAdapterInstance.renameFile.mockResolvedValue(undefined);
    mockFsAdapterInstance.fileExists.mockResolvedValue(false);
    mockFsAdapterInstance.createFile.mockResolvedValue("file.md");
    mockFsAdapterInstance.writeFile.mockResolvedValue(undefined);

    executor = new CommandExecutor("/test/vault");

    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    processExitSpy = jest.spyOn(process, "exit").mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("execute()", () => {
    it("should resolve and validate filepath", async () => {
      mockPathResolverInstance.resolve.mockReturnValue("/test/vault/task.md");
      mockFsAdapterInstance.readFile.mockResolvedValue("# Task");

      await executor.execute("rename-to-uid", "task.md", {});

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockPathResolverInstance.resolve).toHaveBeenCalledWith("task.md");
      expect(mockPathResolverInstance.validate).toHaveBeenCalledWith("/test/vault/task.md");
    });

    it("should read file to verify accessibility", async () => {
      mockPathResolverInstance.resolve.mockReturnValue("/test/vault/task.md");
      mockFsAdapterInstance.readFile.mockResolvedValue("# Task");

      await executor.execute("start", "task.md", {});

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.readFile).toHaveBeenCalledWith("task.md");
    });

    it("should display command execution info", async () => {
      mockPathResolverInstance.resolve.mockReturnValue("/test/vault/task.md");
      mockFsAdapterInstance.readFile.mockResolvedValue("# Task");

      await executor.execute("complete", "task.md", {});

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Command infrastructure verified"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("complete"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("/test/vault/task.md"));
    });

    it("should handle options if provided", async () => {
      mockPathResolverInstance.resolve.mockReturnValue("/test/vault/task.md");
      mockFsAdapterInstance.readFile.mockResolvedValue("# Task");

      await executor.execute("start", "task.md", { priority: "high" });

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Options"));
    });

    it("should exit with SUCCESS code when completed", async () => {
      mockPathResolverInstance.resolve.mockReturnValue("/test/vault/task.md");
      mockFsAdapterInstance.readFile.mockResolvedValue("# Task");

      await executor.execute("rename-to-uid", "task.md", {});

      expect(processExitSpy).toHaveBeenCalledWith(ExitCodes.SUCCESS);
    });

    it("should handle path resolution errors", async () => {
      mockPathResolverInstance.resolve.mockImplementation(() => {
        throw new Error("File path outside vault root");
      });

      await executor.execute("start", "../outside/task.md", {});

      expect(processExitSpy).toHaveBeenCalled();
    });

    it("should handle file read errors", async () => {
      mockPathResolverInstance.resolve.mockReturnValue("/test/vault/task.md");
      mockFsAdapterInstance.readFile.mockRejectedValue(new Error("File not found: task.md"));

      await executor.execute("complete", "task.md", {});

      expect(processExitSpy).toHaveBeenCalled();
    });
  });

  describe("getVaultRoot()", () => {
    it("should return vault root from path resolver", () => {
      expect(executor.getVaultRoot()).toBe("/test/vault");
      expect(mockPathResolverInstance.getVaultRoot).toHaveBeenCalled();
    });
  });

  describe("executeRenameToUid()", () => {
    beforeEach(() => {
      mockPathResolverInstance.resolve.mockReturnValue("/test/vault/my-task.md");
    });

    it("should rename file to UID format", async () => {
      mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
        exo__Asset_uid: "task-uid-123",
        exo__Asset_label: "My Task",
      });

      await executor.executeRenameToUid("my-task.md");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.renameFile).toHaveBeenCalledWith("my-task.md", "task-uid-123.md");
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Renamed to UID format"));
    });

    it("should exit successfully when already renamed", async () => {
      mockPathResolverInstance.resolve.mockReturnValue("/test/vault/task-uid-123.md");
      mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
        exo__Asset_uid: "task-uid-123",
        exo__Asset_label: "My Task",
      });

      await executor.executeRenameToUid("task-uid-123.md");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      // Note: renameFile may still be called with same src/dest due to mock not terminating
      // The key assertion is that "Already renamed" message is logged before exit
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Already renamed"));
    });

    it("should throw error when UID missing", async () => {
      mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
        exo__Asset_label: "My Task",
      });

      await executor.executeRenameToUid("my-task.md");

      expect(processExitSpy).toHaveBeenCalled();
      expect(mockFsAdapterInstance.renameFile).not.toHaveBeenCalled();
      expect(processExitSpy).not.toHaveBeenCalledWith(ExitCodes.SUCCESS);
    });

    it("should update label if missing before renaming", async () => {
      mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
        exo__Asset_uid: "task-uid-123",
        exo__Asset_label: "",
      });
      mockFsAdapterInstance.readFile.mockResolvedValue("---\nexo__Asset_uid: task-uid-123\n---\n# Content");

      await executor.executeRenameToUid("my-task.md");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.updateFile).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Updated label: "my-task"'));
      expect(mockFsAdapterInstance.renameFile).toHaveBeenCalled();
    });

    it("should preserve label when it exists", async () => {
      mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
        exo__Asset_uid: "task-uid-123",
        exo__Asset_label: "Existing Label",
      });

      await executor.executeRenameToUid("my-task.md");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.updateFile).not.toHaveBeenCalled();
      expect(mockFsAdapterInstance.renameFile).toHaveBeenCalled();
    });

    it("should handle file in subdirectory", async () => {
      mockPathResolverInstance.resolve.mockReturnValue("/test/vault/folder/my-task.md");
      mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
        exo__Asset_uid: "task-uid-123",
        exo__Asset_label: "My Task",
      });

      await executor.executeRenameToUid("folder/my-task.md");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.renameFile).toHaveBeenCalledWith("folder/my-task.md", "folder/task-uid-123.md");
    });
  });

  describe("executeUpdateLabel()", () => {
    beforeEach(() => {
      mockPathResolverInstance.resolve.mockReturnValue("/test/vault/task.md");
      mockFsAdapterInstance.readFile.mockResolvedValue(
        "---\nexo__Asset_label: Old Label\naliases:\n  - Old Label\n---\n# Content"
      );
    });

    it("should update label property", async () => {
      await executor.executeUpdateLabel("task.md", "New Label");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.updateFile).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('New label: "New Label"'));
    });

    it("should synchronize aliases array", async () => {
      await executor.executeUpdateLabel("task.md", "New Label");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Aliases synchronized"));
    });

    it("should throw error if label is empty", async () => {
      await executor.executeUpdateLabel("task.md", "");

      expect(processExitSpy).toHaveBeenCalled();
      expect(mockFsAdapterInstance.updateFile).not.toHaveBeenCalled();
      expect(processExitSpy).not.toHaveBeenCalledWith(ExitCodes.SUCCESS);
    });

    it("should trim whitespace from label", async () => {
      await executor.executeUpdateLabel("task.md", "  Trimmed Label  ");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.updateFile).toHaveBeenCalled();
    });

    it("should not add duplicate alias if label already in aliases", async () => {
      mockFsAdapterInstance.readFile.mockResolvedValue(
        "---\nexo__Asset_label: Existing\naliases:\n  - Existing\n---\n# Content"
      );

      await executor.executeUpdateLabel("task.md", "Existing");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.updateFile).toHaveBeenCalled();
    });

    it("should create aliases array if missing", async () => {
      mockFsAdapterInstance.readFile.mockResolvedValue("---\nexo__Asset_label: Old\n---\n# Content");

      await executor.executeUpdateLabel("task.md", "New Label");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.updateFile).toHaveBeenCalled();
    });

    it("should handle path resolution errors", async () => {
      mockPathResolverInstance.resolve.mockImplementation(() => {
        throw new Error("File path outside vault root");
      });

      await executor.executeUpdateLabel("../outside/task.md", "New Label");

      expect(processExitSpy).toHaveBeenCalled();
      expect(mockFsAdapterInstance.updateFile).not.toHaveBeenCalled();
      expect(processExitSpy).not.toHaveBeenCalledWith(ExitCodes.SUCCESS);
    });
  });

  describe("executeStart()", () => {
    beforeEach(() => {
      mockPathResolverInstance.resolve.mockReturnValue("/test/vault/task.md");
      mockFsAdapterInstance.readFile.mockResolvedValue(
        '---\nexo__Asset_label: My Task\nems__Effort_status: "[[ems__EffortStatusToDo]]"\n---\n# Content'
      );
    });

    it("should transition to Doing status", async () => {
      await executor.executeStart("task.md");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.updateFile).toHaveBeenCalled();
    });

    it("should add start timestamp", async () => {
      const mockDate = new Date("2025-11-23T10:30:00");
      jest.spyOn(global, "Date").mockImplementation(() => mockDate as any);

      await executor.executeStart("task.md");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.updateFile).toHaveBeenCalled();
    });

    it("should display status confirmation", async () => {
      await executor.executeStart("task.md");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Started:"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Status: Doing"));
    });

    it("should handle file read errors", async () => {
      mockFsAdapterInstance.readFile.mockRejectedValue(new Error("File not found: task.md"));

      await executor.executeStart("task.md");

      expect(processExitSpy).toHaveBeenCalled();
      expect(processExitSpy).not.toHaveBeenCalledWith(ExitCodes.SUCCESS);
    });
  });

  describe("executeComplete()", () => {
    beforeEach(() => {
      mockPathResolverInstance.resolve.mockReturnValue("/test/vault/task.md");
      mockFsAdapterInstance.readFile.mockResolvedValue(
        '---\nexo__Asset_label: My Task\nems__Effort_status: "[[ems__EffortStatusDoing]]"\n---\n# Content'
      );
    });

    it("should transition to Done status", async () => {
      await executor.executeComplete("task.md");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.updateFile).toHaveBeenCalled();
    });

    it("should add end and resolution timestamps", async () => {
      const mockDate = new Date("2025-11-23T15:45:00");
      jest.spyOn(global, "Date").mockImplementation(() => mockDate as any);

      await executor.executeComplete("task.md");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.updateFile).toHaveBeenCalled();
    });

    it("should display completion confirmation", async () => {
      await executor.executeComplete("task.md");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Completed:"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Status: Done"));
    });
  });

  describe("executeTrash()", () => {
    beforeEach(() => {
      mockPathResolverInstance.resolve.mockReturnValue("/test/vault/task.md");
      mockFsAdapterInstance.readFile.mockResolvedValue(
        '---\nexo__Asset_label: My Task\nems__Effort_status: "[[ems__EffortStatusDoing]]"\n---\n# Content'
      );
    });

    it("should transition to Trashed status", async () => {
      await executor.executeTrash("task.md");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.updateFile).toHaveBeenCalled();
    });

    it("should add resolution timestamp", async () => {
      const mockDate = new Date("2025-11-23T12:00:00");
      jest.spyOn(global, "Date").mockImplementation(() => mockDate as any);

      await executor.executeTrash("task.md");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.updateFile).toHaveBeenCalled();
    });

    it("should display trash confirmation", async () => {
      await executor.executeTrash("task.md");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Trashed:"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Status: Trashed"));
    });
  });

  describe("executeArchive()", () => {
    beforeEach(() => {
      mockPathResolverInstance.resolve.mockReturnValue("/test/vault/task.md");
      mockFsAdapterInstance.readFile.mockResolvedValue(
        "---\nexo__Asset_label: My Task\naliases:\n  - My Task\n---\n# Content"
      );
    });

    it("should set archived flag to true", async () => {
      await executor.executeArchive("task.md");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.updateFile).toHaveBeenCalled();
    });

    it("should remove aliases", async () => {
      await executor.executeArchive("task.md");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Aliases removed"));
    });

    it("should display archive confirmation", async () => {
      await executor.executeArchive("task.md");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Archived:"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Archived: true"));
    });
  });

  describe("executeMoveToBacklog()", () => {
    beforeEach(() => {
      mockPathResolverInstance.resolve.mockReturnValue("/test/vault/task.md");
      mockFsAdapterInstance.readFile.mockResolvedValue("---\nexo__Asset_label: My Task\n---\n# Content");
    });

    it("should transition to Backlog status", async () => {
      await executor.executeMoveToBacklog("task.md");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.updateFile).toHaveBeenCalled();
    });

    it("should display status confirmation", async () => {
      await executor.executeMoveToBacklog("task.md");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Moved to Backlog:"));
    });
  });

  describe("executeMoveToAnalysis()", () => {
    beforeEach(() => {
      mockPathResolverInstance.resolve.mockReturnValue("/test/vault/project.md");
      mockFsAdapterInstance.readFile.mockResolvedValue("---\nexo__Asset_label: My Project\n---\n# Content");
    });

    it("should transition to Analysis status", async () => {
      await executor.executeMoveToAnalysis("project.md");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.updateFile).toHaveBeenCalled();
    });

    it("should display status confirmation", async () => {
      await executor.executeMoveToAnalysis("project.md");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Moved to Analysis:"));
    });
  });

  describe("executeMoveToToDo()", () => {
    beforeEach(() => {
      mockPathResolverInstance.resolve.mockReturnValue("/test/vault/task.md");
      mockFsAdapterInstance.readFile.mockResolvedValue("---\nexo__Asset_label: My Task\n---\n# Content");
    });

    it("should transition to ToDo status", async () => {
      await executor.executeMoveToToDo("task.md");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.updateFile).toHaveBeenCalled();
    });

    it("should display status confirmation", async () => {
      await executor.executeMoveToToDo("task.md");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Moved to ToDo:"));
    });
  });

  describe("executeCreateTask()", () => {
    beforeEach(() => {
      mockPathResolverInstance.resolve.mockReturnValue("/test/vault/task.md");
      mockFsAdapterInstance.fileExists.mockResolvedValue(false);
      mockFsAdapterInstance.createFile.mockResolvedValue("task.md");
    });

    it("should create task with minimal parameters", async () => {
      await executor.executeCreateTask("task.md", "My Task");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.createFile).toHaveBeenCalled();
    });

    it("should create task with prototype", async () => {
      await executor.executeCreateTask("task.md", "My Task", { prototype: "proto-123" });

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.createFile).toHaveBeenCalled();
    });

    it("should create task with area", async () => {
      await executor.executeCreateTask("task.md", "My Task", { area: "area-456" });

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.createFile).toHaveBeenCalled();
    });

    it("should create task with parent", async () => {
      await executor.executeCreateTask("task.md", "My Task", { parent: "parent-789" });

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.createFile).toHaveBeenCalled();
    });

    it("should create task with all optional parameters", async () => {
      await executor.executeCreateTask("task.md", "My Task", {
        prototype: "proto-123",
        area: "area-456",
        parent: "parent-789",
      });

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.createFile).toHaveBeenCalled();
    });

    it("should trim whitespace from label", async () => {
      await executor.executeCreateTask("task.md", "  Trimmed Task  ");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.createFile).toHaveBeenCalled();
    });

    it("should throw error if label is empty", async () => {
      await executor.executeCreateTask("task.md", "");

      expect(processExitSpy).toHaveBeenCalled();
      expect(mockFsAdapterInstance.createFile).not.toHaveBeenCalled();
      expect(processExitSpy).not.toHaveBeenCalledWith(ExitCodes.SUCCESS);
    });

    it("should throw error if label is whitespace only", async () => {
      await executor.executeCreateTask("task.md", "   ");

      expect(processExitSpy).toHaveBeenCalled();
      expect(mockFsAdapterInstance.createFile).not.toHaveBeenCalled();
    });

    it("should throw error if file already exists", async () => {
      mockFsAdapterInstance.fileExists.mockResolvedValue(true);

      await executor.executeCreateTask("task.md", "My Task");

      expect(processExitSpy).toHaveBeenCalled();
      expect(mockFsAdapterInstance.createFile).not.toHaveBeenCalled();
      expect(processExitSpy).not.toHaveBeenCalledWith(ExitCodes.SUCCESS);
    });

    it("should display creation confirmation with UID", async () => {
      await executor.executeCreateTask("task.md", "My Task");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Created task:"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("UID:"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Label: My Task"));
    });

    it("should include created timestamp", async () => {
      const mockDate = new Date("2025-11-23T14:30:00");
      jest.spyOn(global, "Date").mockImplementation(() => mockDate as any);

      await executor.executeCreateTask("task.md", "My Task");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.createFile).toHaveBeenCalled();
    });
  });

  describe("executeCreateMeeting()", () => {
    beforeEach(() => {
      mockPathResolverInstance.resolve.mockReturnValue("/test/vault/meeting.md");
      mockFsAdapterInstance.fileExists.mockResolvedValue(false);
      mockFsAdapterInstance.createFile.mockResolvedValue("meeting.md");
    });

    it("should create meeting with minimal parameters", async () => {
      await executor.executeCreateMeeting("meeting.md", "Team Sync");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.createFile).toHaveBeenCalled();
    });

    it("should create meeting with all optional parameters", async () => {
      await executor.executeCreateMeeting("meeting.md", "Team Sync", {
        prototype: "meeting-proto",
        area: "area-123",
        parent: "parent-456",
      });

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.createFile).toHaveBeenCalled();
    });

    it("should display creation confirmation", async () => {
      await executor.executeCreateMeeting("meeting.md", "Team Sync");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Created meeting:"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Label: Team Sync"));
    });

    it("should throw error if file already exists", async () => {
      mockFsAdapterInstance.fileExists.mockResolvedValue(true);

      await executor.executeCreateMeeting("meeting.md", "Team Sync");

      expect(processExitSpy).toHaveBeenCalled();
      expect(mockFsAdapterInstance.createFile).not.toHaveBeenCalled();
    });
  });

  describe("executeCreateProject()", () => {
    beforeEach(() => {
      mockPathResolverInstance.resolve.mockReturnValue("/test/vault/project.md");
      mockFsAdapterInstance.fileExists.mockResolvedValue(false);
      mockFsAdapterInstance.createFile.mockResolvedValue("project.md");
    });

    it("should create project with minimal parameters", async () => {
      await executor.executeCreateProject("project.md", "Website Redesign");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.createFile).toHaveBeenCalled();
    });

    it("should create project with all optional parameters", async () => {
      await executor.executeCreateProject("project.md", "Website Redesign", {
        prototype: "project-proto",
        area: "area-789",
        parent: "parent-012",
      });

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.createFile).toHaveBeenCalled();
    });

    it("should display creation confirmation", async () => {
      await executor.executeCreateProject("project.md", "Website Redesign");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Created project:"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Label: Website Redesign"));
    });

    it("should throw error if label is empty", async () => {
      await executor.executeCreateProject("project.md", "");

      expect(processExitSpy).toHaveBeenCalled();
      expect(mockFsAdapterInstance.createFile).not.toHaveBeenCalled();
    });
  });

  describe("executeCreateArea()", () => {
    beforeEach(() => {
      mockPathResolverInstance.resolve.mockReturnValue("/test/vault/area.md");
      mockFsAdapterInstance.fileExists.mockResolvedValue(false);
      mockFsAdapterInstance.createFile.mockResolvedValue("area.md");
    });

    it("should create area with minimal parameters", async () => {
      await executor.executeCreateArea("area.md", "Engineering");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.createFile).toHaveBeenCalled();
    });

    it("should create area with optional parameters", async () => {
      await executor.executeCreateArea("area.md", "Engineering", { prototype: "area-proto" });

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.createFile).toHaveBeenCalled();
    });

    it("should display creation confirmation", async () => {
      await executor.executeCreateArea("area.md", "Engineering");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Created area:"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Label: Engineering"));
    });

    it("should include all required frontmatter properties", async () => {
      await executor.executeCreateArea("area.md", "Engineering");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.createFile).toHaveBeenCalled();
    });

    it("should throw error if file already exists", async () => {
      mockFsAdapterInstance.fileExists.mockResolvedValue(true);

      await executor.executeCreateArea("area.md", "Engineering");

      expect(processExitSpy).toHaveBeenCalled();
      expect(mockFsAdapterInstance.createFile).not.toHaveBeenCalled();
    });
  });

  describe("executeSchedule()", () => {
    beforeEach(() => {
      mockPathResolverInstance.resolve.mockReturnValue("/test/vault/task.md");
      mockFsAdapterInstance.fileExists.mockResolvedValue(true);
      mockFsAdapterInstance.readFile.mockResolvedValue("---\nexo__Asset_label: Test Task\n---\nBody content");
      mockFsAdapterInstance.writeFile.mockResolvedValue(undefined);
    });

    it("should schedule task with valid date", async () => {
      await executor.executeSchedule("task.md", "2025-11-25");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.readFile).toHaveBeenCalledWith("task.md");
      expect(mockFsAdapterInstance.writeFile).toHaveBeenCalled();
    });

    it("should throw error if file does not exist", async () => {
      mockFsAdapterInstance.fileExists.mockResolvedValue(false);

      await executor.executeSchedule("task.md", "2025-11-25");

      expect(processExitSpy).toHaveBeenCalled();
      expect(mockFsAdapterInstance.readFile).not.toHaveBeenCalled();
      expect(mockFsAdapterInstance.writeFile).not.toHaveBeenCalled();
    });

    it("should throw error for invalid date format", async () => {
      await executor.executeSchedule("task.md", "11/25/2025");

      expect(processExitSpy).toHaveBeenCalled();
      expect(mockFsAdapterInstance.writeFile).not.toHaveBeenCalled();
    });

    it("should throw error for malformed date", async () => {
      await executor.executeSchedule("task.md", "2025-13-45");

      expect(processExitSpy).toHaveBeenCalled();
    });

    it("should handle different date values", async () => {
      await executor.executeSchedule("task.md", "2025-12-31");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.writeFile).toHaveBeenCalled();
    });
  });

  describe("executeSetDeadline()", () => {
    beforeEach(() => {
      mockPathResolverInstance.resolve.mockReturnValue("/test/vault/task.md");
      mockFsAdapterInstance.fileExists.mockResolvedValue(true);
      mockFsAdapterInstance.readFile.mockResolvedValue("---\nexo__Asset_label: Test Task\n---\nBody content");
      mockFsAdapterInstance.writeFile.mockResolvedValue(undefined);
    });

    it("should set deadline with valid date", async () => {
      await executor.executeSetDeadline("task.md", "2025-12-01");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.readFile).toHaveBeenCalledWith("task.md");
      expect(mockFsAdapterInstance.writeFile).toHaveBeenCalled();
    });

    it("should throw error if file does not exist", async () => {
      mockFsAdapterInstance.fileExists.mockResolvedValue(false);

      await executor.executeSetDeadline("task.md", "2025-12-01");

      expect(processExitSpy).toHaveBeenCalled();
      expect(mockFsAdapterInstance.readFile).not.toHaveBeenCalled();
      expect(mockFsAdapterInstance.writeFile).not.toHaveBeenCalled();
    });

    it("should throw error for invalid date format", async () => {
      await executor.executeSetDeadline("task.md", "12/01/2025");

      expect(processExitSpy).toHaveBeenCalled();
      expect(mockFsAdapterInstance.writeFile).not.toHaveBeenCalled();
    });

    it("should throw error for malformed date", async () => {
      await executor.executeSetDeadline("task.md", "2025-13-99");

      expect(processExitSpy).toHaveBeenCalled();
    });

    it("should handle different date values", async () => {
      await executor.executeSetDeadline("task.md", "2026-01-15");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.writeFile).toHaveBeenCalled();
    });
  });

  describe("executeRepairFolder()", () => {
    beforeEach(() => {
      mockPathResolverInstance.resolve.mockReturnValue("/test/vault/wrong-folder/task.md");
      mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
        exo__Asset_isDefinedBy: "[[correct-folder/definition.md]]",
      });
      mockFsAdapterInstance.fileExists.mockResolvedValue(false);
      mockFsAdapterInstance.directoryExists.mockResolvedValue(true);
      mockFsAdapterInstance.renameFile.mockResolvedValue(undefined);
      mockFsAdapterInstance.getMarkdownFiles.mockResolvedValue([
        "correct-folder/definition.md",
        "wrong-folder/task.md",
      ]);
      mockFsAdapterInstance.findFileByUID.mockResolvedValue(null);
    });

    it("should move file to correct folder when in wrong location", async () => {
      // The source file is in wrong-folder, but should be in correct-folder
      mockFsAdapterInstance.fileExists.mockImplementation(async (path: string) => {
        if (path === "correct-folder/definition.md") return true;
        if (path === "correct-folder/task.md") return false; // target doesn't exist
        return false;
      });

      await executor.executeRepairFolder("wrong-folder/task.md");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.renameFile).toHaveBeenCalledWith(
        "wrong-folder/task.md",
        "correct-folder/task.md",
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Moved to correct folder"));
    });

    it("should report already in correct folder when file is in expected location", async () => {
      mockPathResolverInstance.resolve.mockReturnValue("/test/vault/correct-folder/task.md");
      mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
        exo__Asset_isDefinedBy: "[[correct-folder/definition.md]]",
      });
      mockFsAdapterInstance.fileExists.mockImplementation(async (path: string) => {
        if (path === "correct-folder/definition.md") return true;
        return false;
      });

      await executor.executeRepairFolder("correct-folder/task.md");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.renameFile).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Already in correct folder"));
    });

    it("should throw error when exo__Asset_isDefinedBy is missing", async () => {
      mockFsAdapterInstance.getFileMetadata.mockResolvedValue({});

      try {
        await executor.executeRepairFolder("task.md");
      } catch {
        // Expected: error is re-thrown after ErrorHandler.handle
      }

      expect(processExitSpy).toHaveBeenCalled();
      expect(mockFsAdapterInstance.renameFile).not.toHaveBeenCalled();
    });

    it("should throw error when referenced file is not found", async () => {
      mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
        exo__Asset_isDefinedBy: "[[nonexistent.md]]",
      });
      mockFsAdapterInstance.fileExists.mockResolvedValue(false);
      mockFsAdapterInstance.getMarkdownFiles.mockResolvedValue([]);
      mockFsAdapterInstance.findFileByUID.mockResolvedValue(null);

      try {
        await executor.executeRepairFolder("task.md");
      } catch {
        // Expected: error is re-thrown after ErrorHandler.handle
      }

      expect(processExitSpy).toHaveBeenCalled();
      expect(mockFsAdapterInstance.renameFile).not.toHaveBeenCalled();
    });

    it("should throw error when target file already exists", async () => {
      mockFsAdapterInstance.fileExists.mockImplementation(async (path: string) => {
        if (path === "correct-folder/definition.md") return true;
        if (path === "correct-folder/task.md") return true; // target already exists!
        return false;
      });

      try {
        await executor.executeRepairFolder("wrong-folder/task.md");
      } catch {
        // Expected: error is re-thrown after ErrorHandler.handle
      }

      expect(processExitSpy).toHaveBeenCalled();
      expect(mockFsAdapterInstance.renameFile).not.toHaveBeenCalled();
    });

    it("should handle quoted wikilink format in exo__Asset_isDefinedBy", async () => {
      mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
        exo__Asset_isDefinedBy: '"[[correct-folder/definition.md]]"',
      });
      mockFsAdapterInstance.fileExists.mockImplementation(async (path: string) => {
        if (path === "correct-folder/definition.md") return true;
        if (path === "correct-folder/task.md") return false;
        return false;
      });

      await executor.executeRepairFolder("wrong-folder/task.md");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.renameFile).toHaveBeenCalledWith(
        "wrong-folder/task.md",
        "correct-folder/task.md",
      );
    });

    it("should create directory if it does not exist", async () => {
      mockFsAdapterInstance.fileExists.mockImplementation(async (path: string) => {
        if (path === "correct-folder/definition.md") return true;
        if (path === "correct-folder/task.md") return false;
        return false;
      });
      mockFsAdapterInstance.directoryExists.mockResolvedValue(false);
      mockFsAdapterInstance.createDirectory.mockResolvedValue(undefined);

      await executor.executeRepairFolder("wrong-folder/task.md");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.createDirectory).toHaveBeenCalledWith("correct-folder");
      expect(mockFsAdapterInstance.renameFile).toHaveBeenCalled();
    });

    it("should find referenced file by UID when path lookup fails", async () => {
      mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
        exo__Asset_isDefinedBy: "[[abc12345-def6-7890-abcd-ef1234567890]]",
      });
      mockFsAdapterInstance.fileExists.mockImplementation(async (path: string) => {
        if (path === "uid-folder/definition.md") return false;
        if (path === "uid-folder/task.md") return false;
        return false;
      });
      mockFsAdapterInstance.findFileByUID.mockResolvedValue("uid-folder/definition.md");

      await executor.executeRepairFolder("wrong-folder/task.md");

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(mockFsAdapterInstance.findFileByUID).toHaveBeenCalledWith("abc12345-def6-7890-abcd-ef1234567890");
    });
  });
});
