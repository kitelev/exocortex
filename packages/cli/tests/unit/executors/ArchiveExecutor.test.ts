import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
} from "@jest/globals";

// Mock dependencies
const mockFsAdapterInstance = {
  readFile: jest.fn(),
  getFileMetadata: jest.fn(),
  updateFile: jest.fn(),
  fileExists: jest.fn(),
  getMarkdownFiles: jest.fn(),
  writeFile: jest.fn(),
};

const mockFrontmatterService = {
  updateProperty: jest.fn((content, prop, value) => {
    return content.replace(/---\n([\s\S]*?)\n---/, (_match, fm) => {
      return `---\n${fm}\n${prop}: ${value}\n---`;
    });
  }),
  removeProperty: jest.fn((content, prop) => {
    return content.replace(new RegExp(`${prop}:.*\\n`, "g"), "");
  }),
};

const mockFsExtra = {
  pathExists: jest.fn(),
  ensureDir: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
  remove: jest.fn(),
  copy: jest.fn(),
  readdir: jest.fn(),
  rmdir: jest.fn(),
};

jest.unstable_mockModule("../../../src/adapters/NodeFsAdapter.js", () => ({
  NodeFsAdapter: jest.fn(() => mockFsAdapterInstance),
}));

jest.unstable_mockModule("exocortex", () => ({
  FrontmatterService: jest.fn(() => mockFrontmatterService),
}));

jest.unstable_mockModule("fs-extra", () => ({
  default: mockFsExtra,
}));

const { ArchiveExecutor } = await import(
  "../../../src/executors/ArchiveExecutor.js"
);

describe("ArchiveExecutor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFsAdapterInstance.fileExists.mockResolvedValue(true);
    mockFsExtra.pathExists.mockResolvedValue(true);
    mockFsExtra.ensureDir.mockResolvedValue(undefined);
    mockFsExtra.writeFile.mockResolvedValue(undefined);
    mockFsExtra.remove.mockResolvedValue(undefined);
    mockFsExtra.readdir.mockResolvedValue(["some-file.md"]);
  });

  describe("execute", () => {
    it("should identify and move archived assets", async () => {
      mockFsAdapterInstance.getMarkdownFiles.mockResolvedValue([
        "tasks/archived-task.md",
        "tasks/active-task.md",
      ]);

      mockFsAdapterInstance.getFileMetadata.mockImplementation(
        async (file) => {
          if (file === "tasks/archived-task.md") {
            return {
              exo__Asset_isArchived: true,
              exo__Instance_class: ["[[ems__Task]]"],
              ems__Effort_resolutionTimestamp: "2025-06-15T10:00:00",
            };
          }
          return {
            exo__Instance_class: ["[[ems__Task]]"],
            ems__Effort_status: '"[[ems__EffortStatusDoing]]"',
          };
        },
      );

      mockFsAdapterInstance.readFile.mockResolvedValue(
        "---\nexo__Asset_isArchived: true\n---\nContent",
      );

      mockFsExtra.readFile.mockResolvedValue(
        "---\nexo__Asset_isArchived: true\n---\nContent",
      );

      const executor = new ArchiveExecutor({
        vaultPath: "/test/vault",
        archiveVaultPath: "/test/archive",
        dryRun: false,
      });

      const report = await executor.execute();

      expect(report.moved).toBe(1);
      expect(report.blocked).toBe(0);
      expect(report.skipped).toBe(0);
      expect(report.details[0].filepath).toBe("tasks/archived-task.md");
      expect(report.details[0].status).toBe("moved");
    });

    it("should block assets referenced by active content", async () => {
      mockFsAdapterInstance.getMarkdownFiles.mockResolvedValue([
        "tasks/archived-task.md",
        "projects/active-project.md",
      ]);

      mockFsAdapterInstance.getFileMetadata.mockImplementation(
        async (file) => {
          if (file === "tasks/archived-task.md") {
            return {
              exo__Asset_isArchived: true,
              exo__Instance_class: ["[[ems__Task]]"],
            };
          }
          return {
            exo__Instance_class: ["[[ems__Project]]"],
          };
        },
      );

      // Active project references the archived task
      mockFsAdapterInstance.readFile.mockImplementation(
        async (file) => {
          if (file === "projects/active-project.md") {
            return "---\nexo__Instance_class: ems__Project\n---\nReferences [[archived-task]]";
          }
          return "---\nexo__Asset_isArchived: true\n---\nContent";
        },
      );

      const executor = new ArchiveExecutor({
        vaultPath: "/test/vault",
        archiveVaultPath: "/test/archive",
        dryRun: false,
      });

      const report = await executor.execute();

      expect(report.blocked).toBe(1);
      expect(report.moved).toBe(0);
      expect(report.details[0].status).toBe("blocked");
      expect(report.details[0].blockedBy).toContain("projects/active-project.md");
    });

    it("should filter by class", async () => {
      mockFsAdapterInstance.getMarkdownFiles.mockResolvedValue([
        "tasks/task1.md",
        "meetings/meeting1.md",
      ]);

      mockFsAdapterInstance.getFileMetadata.mockImplementation(
        async (file) => {
          if (file === "tasks/task1.md") {
            return {
              exo__Asset_isArchived: true,
              exo__Instance_class: ["[[ems__Task]]"],
            };
          }
          return {
            exo__Asset_isArchived: true,
            exo__Instance_class: ["[[ems__Meeting]]"],
          };
        },
      );

      mockFsAdapterInstance.readFile.mockResolvedValue(
        "---\nexo__Asset_isArchived: true\n---\nContent",
      );

      mockFsExtra.readFile.mockResolvedValue(
        "---\nexo__Asset_isArchived: true\n---\nContent",
      );

      const executor = new ArchiveExecutor({
        vaultPath: "/test/vault",
        archiveVaultPath: "/test/archive",
        classes: ["ems__Task"],
        dryRun: false,
      });

      const report = await executor.execute();

      expect(report.moved).toBe(1);
      expect(report.details[0].filepath).toBe("tasks/task1.md");
    });

    it("should filter by year", async () => {
      mockFsAdapterInstance.getMarkdownFiles.mockResolvedValue([
        "tasks/task-2025.md",
        "tasks/task-2024.md",
      ]);

      mockFsAdapterInstance.getFileMetadata.mockImplementation(
        async (file) => {
          if (file === "tasks/task-2025.md") {
            return {
              exo__Asset_isArchived: true,
              exo__Instance_class: ["[[ems__Task]]"],
              ems__Effort_resolutionTimestamp: "2025-06-15T10:00:00",
            };
          }
          return {
            exo__Asset_isArchived: true,
            exo__Instance_class: ["[[ems__Task]]"],
            ems__Effort_resolutionTimestamp: "2024-03-10T10:00:00",
          };
        },
      );

      mockFsAdapterInstance.readFile.mockResolvedValue(
        "---\nexo__Asset_isArchived: true\n---\nContent",
      );

      mockFsExtra.readFile.mockResolvedValue(
        "---\nexo__Asset_isArchived: true\n---\nContent",
      );

      const executor = new ArchiveExecutor({
        vaultPath: "/test/vault",
        archiveVaultPath: "/test/archive",
        year: 2025,
        dryRun: false,
      });

      const report = await executor.execute();

      expect(report.moved).toBe(1);
      expect(report.details[0].filepath).toBe("tasks/task-2025.md");
    });

    it("should respect dry-run mode", async () => {
      mockFsAdapterInstance.getMarkdownFiles.mockResolvedValue([
        "tasks/archived-task.md",
      ]);

      mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
        exo__Asset_isArchived: true,
        exo__Instance_class: ["[[ems__Task]]"],
      });

      mockFsAdapterInstance.readFile.mockResolvedValue(
        "---\nexo__Asset_isArchived: true\n---\nContent",
      );

      const executor = new ArchiveExecutor({
        vaultPath: "/test/vault",
        archiveVaultPath: "/test/archive",
        dryRun: true,
      });

      const report = await executor.execute();

      expect(report.moved).toBe(1);
      // In dry-run mode, no filesystem operations should occur
      expect(mockFsExtra.writeFile).not.toHaveBeenCalled();
      expect(mockFsExtra.remove).not.toHaveBeenCalled();
    });

    it("should skip files that don't exist on disk", async () => {
      mockFsAdapterInstance.getMarkdownFiles.mockResolvedValue([
        "tasks/missing-task.md",
      ]);

      mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
        exo__Asset_isArchived: true,
        exo__Instance_class: ["[[ems__Task]]"],
      });

      mockFsAdapterInstance.readFile.mockResolvedValue(
        "---\nexo__Asset_isArchived: true\n---\nContent",
      );

      mockFsAdapterInstance.fileExists.mockResolvedValue(false);

      const executor = new ArchiveExecutor({
        vaultPath: "/test/vault",
        archiveVaultPath: "/test/archive",
        dryRun: false,
      });

      const report = await executor.execute();

      expect(report.skipped).toBe(1);
      expect(report.details[0].status).toBe("skipped");
      expect(report.details[0].reason).toBe("File not found on disk");
    });

    it("should not block on self-references", async () => {
      mockFsAdapterInstance.getMarkdownFiles.mockResolvedValue([
        "tasks/self-ref.md",
      ]);

      mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
        exo__Asset_isArchived: true,
        exo__Instance_class: ["[[ems__Task]]"],
      });

      // File references itself
      mockFsAdapterInstance.readFile.mockResolvedValue(
        "---\nexo__Asset_isArchived: true\n---\nSee also [[self-ref]]",
      );

      mockFsExtra.readFile.mockResolvedValue(
        "---\nexo__Asset_isArchived: true\n---\nSee also [[self-ref]]",
      );

      const executor = new ArchiveExecutor({
        vaultPath: "/test/vault",
        archiveVaultPath: "/test/archive",
        dryRun: false,
      });

      const report = await executor.execute();

      expect(report.moved).toBe(1);
      expect(report.blocked).toBe(0);
    });

    it("should not block when reference comes from another archived asset", async () => {
      mockFsAdapterInstance.getMarkdownFiles.mockResolvedValue([
        "tasks/archived-a.md",
        "tasks/archived-b.md",
      ]);

      mockFsAdapterInstance.getFileMetadata.mockImplementation(
        async () => {
          return {
            exo__Asset_isArchived: true,
            exo__Instance_class: ["[[ems__Task]]"],
          };
        },
      );

      mockFsAdapterInstance.readFile.mockImplementation(
        async (file) => {
          if (file === "tasks/archived-a.md") {
            return "---\nexo__Asset_isArchived: true\n---\nSee [[archived-b]]";
          }
          return "---\nexo__Asset_isArchived: true\n---\nSee [[archived-a]]";
        },
      );

      mockFsExtra.readFile.mockResolvedValue(
        "---\nexo__Asset_isArchived: true\n---\nContent",
      );

      const executor = new ArchiveExecutor({
        vaultPath: "/test/vault",
        archiveVaultPath: "/test/archive",
        dryRun: false,
      });

      const report = await executor.execute();

      expect(report.moved).toBe(2);
      expect(report.blocked).toBe(0);
    });

    it("should return empty report when no candidates found", async () => {
      mockFsAdapterInstance.getMarkdownFiles.mockResolvedValue([
        "tasks/active-task.md",
      ]);

      mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
        exo__Instance_class: ["[[ems__Task]]"],
        ems__Effort_status: '"[[ems__EffortStatusDoing]]"',
      });

      mockFsAdapterInstance.readFile.mockResolvedValue(
        "---\nems__Effort_status: Doing\n---\nContent",
      );

      const executor = new ArchiveExecutor({
        vaultPath: "/test/vault",
        archiveVaultPath: "/test/archive",
        dryRun: false,
      });

      const report = await executor.execute();

      expect(report.moved).toBe(0);
      expect(report.blocked).toBe(0);
      expect(report.skipped).toBe(0);
      expect(report.details).toHaveLength(0);
    });

    it("should support legacy archived field", async () => {
      mockFsAdapterInstance.getMarkdownFiles.mockResolvedValue([
        "tasks/legacy-archived.md",
      ]);

      mockFsAdapterInstance.getFileMetadata.mockResolvedValue({
        archived: true,
        exo__Instance_class: ["[[ems__Task]]"],
      });

      mockFsAdapterInstance.readFile.mockResolvedValue(
        "---\narchived: true\n---\nContent",
      );

      mockFsExtra.readFile.mockResolvedValue(
        "---\narchived: true\n---\nContent",
      );

      const executor = new ArchiveExecutor({
        vaultPath: "/test/vault",
        archiveVaultPath: "/test/archive",
        dryRun: false,
      });

      const report = await executor.execute();

      expect(report.moved).toBe(1);
    });
  });
});
