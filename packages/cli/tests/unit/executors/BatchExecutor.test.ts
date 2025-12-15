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
  toTimestampAtStartOfDay: jest.fn((dateStr: string) => {
    return `${dateStr}T00:00:00Z`;
  }),
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

describe("BatchExecutor", () => {
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
    mockFsAdapterInstance.fileExists.mockResolvedValue(true);

    mockTransactionManager.begin.mockResolvedValue(undefined);
    mockTransactionManager.commit.mockResolvedValue(undefined);
    mockTransactionManager.rollback.mockResolvedValue(undefined);

    executor = new BatchExecutor("/test/vault");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("executeBatch()", () => {
    it("should execute empty batch successfully", async () => {
      const result = await executor.executeBatch([]);

      expect(result.success).toBe(true);
      expect(result.total).toBe(0);
      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.results).toHaveLength(0);
    });

    it("should execute single operation successfully", async () => {
      const result = await executor.executeBatch([
        { command: "start", filepath: "task.md" },
      ]);

      expect(result.success).toBe(true);
      expect(result.total).toBe(1);
      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.results[0].success).toBe(true);
      expect(result.results[0].command).toBe("start");
      expect(result.results[0].filepath).toBe("task.md");
    });

    it("should execute multiple operations successfully", async () => {
      const result = await executor.executeBatch([
        { command: "start", filepath: "task1.md" },
        { command: "complete", filepath: "task2.md" },
        { command: "trash", filepath: "task3.md" },
      ]);

      expect(result.success).toBe(true);
      expect(result.total).toBe(3);
      expect(result.succeeded).toBe(3);
      expect(result.failed).toBe(0);
    });

    it("should continue execution on failure in non-atomic mode", async () => {
      // Each operation reads file twice: once for verification, once for execution
      // So for 3 operations: op1 verify, op1 exec, op2 verify (fails), op3 verify, op3 exec
      mockFsAdapterInstance.readFile
        .mockResolvedValueOnce("---\nexo__Asset_label: Test\n---\n# Content") // op1 verify
        .mockResolvedValueOnce("---\nexo__Asset_label: Test\n---\n# Content") // op1 exec
        .mockRejectedValueOnce(new Error("File not found")) // op2 verify (fails)
        .mockResolvedValueOnce("---\nexo__Asset_label: Test\n---\n# Content") // op3 verify
        .mockResolvedValueOnce("---\nexo__Asset_label: Test\n---\n# Content"); // op3 exec

      const result = await executor.executeBatch([
        { command: "start", filepath: "task1.md" },
        { command: "start", filepath: "task2.md" },
        { command: "start", filepath: "task3.md" },
      ]);

      expect(result.success).toBe(false);
      expect(result.total).toBe(3);
      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.results[0].success).toBe(true);
      expect(result.results[1].success).toBe(false);
      expect(result.results[2].success).toBe(true);
    });

    it("should rollback on failure in atomic mode", async () => {
      // In atomic mode: op1 verify, op1 exec, op2 verify (fails) -> rollback
      mockFsAdapterInstance.readFile
        .mockResolvedValueOnce("---\nexo__Asset_label: Test\n---\n# Content") // op1 verify
        .mockResolvedValueOnce("---\nexo__Asset_label: Test\n---\n# Content") // op1 exec
        .mockRejectedValueOnce(new Error("File not found")); // op2 verify (fails)

      const result = await executor.executeBatch(
        [
          { command: "start", filepath: "task1.md" },
          { command: "start", filepath: "task2.md" },
          { command: "start", filepath: "task3.md" },
        ],
        true, // atomic mode
      );

      expect(result.success).toBe(false);
      expect(result.total).toBe(3);
      expect(result.succeeded).toBe(0); // All rolled back
      expect(result.failed).toBe(3);
      expect(result.rolledBack).toBe(true);
      expect(mockTransactionManager.rollback).toHaveBeenCalled();
    });

    it("should backup files before execution in atomic mode", async () => {
      await executor.executeBatch(
        [
          { command: "start", filepath: "task1.md" },
          { command: "start", filepath: "task2.md" },
        ],
        true, // atomic mode
      );

      // Should backup each unique file
      expect(mockTransactionManager.begin).toHaveBeenCalledTimes(2);
    });

    it("should commit transaction on success in atomic mode", async () => {
      await executor.executeBatch(
        [{ command: "start", filepath: "task.md" }],
        true, // atomic mode
      );

      expect(mockTransactionManager.commit).toHaveBeenCalled();
    });

    it("should handle unknown commands gracefully", async () => {
      const result = await executor.executeBatch([
        { command: "unknown-command", filepath: "task.md" },
      ]);

      expect(result.success).toBe(false);
      expect(result.failed).toBe(1);
      expect(result.results[0].error).toContain("Unknown command");
    });

    it("should include duration in result", async () => {
      const result = await executor.executeBatch([
        { command: "start", filepath: "task.md" },
      ]);

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("should include atomic flag in result", async () => {
      const nonAtomicResult = await executor.executeBatch([
        { command: "start", filepath: "task.md" },
      ]);
      expect(nonAtomicResult.atomic).toBe(false);

      const atomicResult = await executor.executeBatch(
        [{ command: "start", filepath: "task.md" }],
        true,
      );
      expect(atomicResult.atomic).toBe(true);
    });
  });

  describe("executeBatch() - dry run mode", () => {
    beforeEach(() => {
      executor = new BatchExecutor("/test/vault", true); // dry run mode
    });

    it("should not modify files in dry run mode", async () => {
      const result = await executor.executeBatch([
        { command: "start", filepath: "task.md" },
      ]);

      expect(result.success).toBe(true);
      expect(mockFsAdapterInstance.updateFile).not.toHaveBeenCalled();
    });

    it("should report dry run in action message", async () => {
      const result = await executor.executeBatch([
        { command: "start", filepath: "task.md" },
      ]);

      expect(result.results[0].action).toContain("dry-run");
    });
  });

  describe("parseInput()", () => {
    it("should parse valid JSON array", () => {
      const input =
        '[{"command":"start","filepath":"task1.md"},{"command":"complete","filepath":"task2.md"}]';
      const operations = BatchExecutor.parseInput(input);

      expect(operations).toHaveLength(2);
      expect(operations[0].command).toBe("start");
      expect(operations[0].filepath).toBe("task1.md");
      expect(operations[1].command).toBe("complete");
      expect(operations[1].filepath).toBe("task2.md");
    });

    it("should parse operations with options", () => {
      const input =
        '[{"command":"update-label","filepath":"task.md","options":{"label":"New Label"}}]';
      const operations = BatchExecutor.parseInput(input);

      expect(operations).toHaveLength(1);
      expect(operations[0].options).toEqual({ label: "New Label" });
    });

    it("should throw error for non-array input", () => {
      expect(() => BatchExecutor.parseInput('{"command":"start"}')).toThrow(
        "Batch input must be a JSON array",
      );
    });

    it("should throw error for missing command", () => {
      expect(() => BatchExecutor.parseInput('[{"filepath":"task.md"}]')).toThrow(
        'Each operation must have a "command"',
      );
    });

    it("should throw error for missing filepath", () => {
      expect(() => BatchExecutor.parseInput('[{"command":"start"}]')).toThrow(
        'Each operation must have a "filepath"',
      );
    });

    it("should throw error for invalid JSON", () => {
      expect(() => BatchExecutor.parseInput("not valid json")).toThrow(
        "Failed to parse batch input",
      );
    });
  });

  describe("Command Execution", () => {
    describe("start command", () => {
      it("should update status to Doing", async () => {
        const result = await executor.executeBatch([
          { command: "start", filepath: "task.md" },
        ]);

        expect(result.results[0].success).toBe(true);
        expect(result.results[0].action).toBe("Started task");
        expect(mockFrontmatterService.updateProperty).toHaveBeenCalledWith(
          expect.any(String),
          "ems__Effort_status",
          '"[[ems__EffortStatusDoing]]"',
        );
      });

      it("should add start timestamp", async () => {
        await executor.executeBatch([{ command: "start", filepath: "task.md" }]);

        expect(mockFrontmatterService.updateProperty).toHaveBeenCalledWith(
          expect.any(String),
          "ems__Effort_startTimestamp",
          expect.any(String),
        );
      });
    });

    describe("complete command", () => {
      it("should update status to Done", async () => {
        const result = await executor.executeBatch([
          { command: "complete", filepath: "task.md" },
        ]);

        expect(result.results[0].success).toBe(true);
        expect(result.results[0].action).toBe("Completed task");
        expect(mockFrontmatterService.updateProperty).toHaveBeenCalledWith(
          expect.any(String),
          "ems__Effort_status",
          '"[[ems__EffortStatusDone]]"',
        );
      });

      it("should add end and resolution timestamps", async () => {
        await executor.executeBatch([
          { command: "complete", filepath: "task.md" },
        ]);

        expect(mockFrontmatterService.updateProperty).toHaveBeenCalledWith(
          expect.any(String),
          "ems__Effort_endTimestamp",
          expect.any(String),
        );
        expect(mockFrontmatterService.updateProperty).toHaveBeenCalledWith(
          expect.any(String),
          "ems__Effort_resolutionTimestamp",
          expect.any(String),
        );
      });
    });

    describe("trash command", () => {
      it("should update status to Trashed", async () => {
        const result = await executor.executeBatch([
          { command: "trash", filepath: "task.md" },
        ]);

        expect(result.results[0].success).toBe(true);
        expect(result.results[0].action).toBe("Trashed task");
        expect(mockFrontmatterService.updateProperty).toHaveBeenCalledWith(
          expect.any(String),
          "ems__Effort_status",
          '"[[ems__EffortStatusTrashed]]"',
        );
      });
    });

    describe("archive command", () => {
      it("should set archived flag and remove aliases", async () => {
        const result = await executor.executeBatch([
          { command: "archive", filepath: "task.md" },
        ]);

        expect(result.results[0].success).toBe(true);
        expect(result.results[0].action).toBe("Archived task");
        expect(mockFrontmatterService.updateProperty).toHaveBeenCalledWith(
          expect.any(String),
          "archived",
          "true",
        );
        expect(mockFrontmatterService.removeProperty).toHaveBeenCalledWith(
          expect.any(String),
          "aliases",
        );
      });
    });

    describe("move-to-backlog command", () => {
      it("should update status to Backlog", async () => {
        const result = await executor.executeBatch([
          { command: "move-to-backlog", filepath: "task.md" },
        ]);

        expect(result.results[0].success).toBe(true);
        expect(result.results[0].action).toBe("Moved to backlog");
        expect(mockFrontmatterService.updateProperty).toHaveBeenCalledWith(
          expect.any(String),
          "ems__Effort_status",
          '"[[ems__EffortStatusBacklog]]"',
        );
      });
    });

    describe("move-to-analysis command", () => {
      it("should update status to Analysis", async () => {
        const result = await executor.executeBatch([
          { command: "move-to-analysis", filepath: "task.md" },
        ]);

        expect(result.results[0].success).toBe(true);
        expect(result.results[0].action).toBe("Moved to analysis");
        expect(mockFrontmatterService.updateProperty).toHaveBeenCalledWith(
          expect.any(String),
          "ems__Effort_status",
          '"[[ems__EffortStatusAnalysis]]"',
        );
      });
    });

    describe("move-to-todo command", () => {
      it("should update status to ToDo", async () => {
        const result = await executor.executeBatch([
          { command: "move-to-todo", filepath: "task.md" },
        ]);

        expect(result.results[0].success).toBe(true);
        expect(result.results[0].action).toBe("Moved to todo");
        expect(mockFrontmatterService.updateProperty).toHaveBeenCalledWith(
          expect.any(String),
          "ems__Effort_status",
          '"[[ems__EffortStatusToDo]]"',
        );
      });
    });

    describe("update-label command", () => {
      it("should update label property", async () => {
        const result = await executor.executeBatch([
          {
            command: "update-label",
            filepath: "task.md",
            options: { label: "New Label" },
          },
        ]);

        expect(result.results[0].success).toBe(true);
        expect(result.results[0].action).toBe('Updated label to "New Label"');
        expect(mockFrontmatterService.updateProperty).toHaveBeenCalledWith(
          expect.any(String),
          "exo__Asset_label",
          '"New Label"',
        );
      });

      it("should fail if label is missing", async () => {
        const result = await executor.executeBatch([
          { command: "update-label", filepath: "task.md" },
        ]);

        expect(result.results[0].success).toBe(false);
        expect(result.results[0].error).toContain("Missing required option");
      });

      it("should fail if label is empty", async () => {
        const result = await executor.executeBatch([
          { command: "update-label", filepath: "task.md", options: { label: "" } },
        ]);

        expect(result.results[0].success).toBe(false);
        expect(result.results[0].error).toContain("Missing required option");
      });
    });

    describe("schedule command", () => {
      it("should set scheduled timestamp", async () => {
        const result = await executor.executeBatch([
          {
            command: "schedule",
            filepath: "task.md",
            options: { date: "2025-12-15" },
          },
        ]);

        expect(result.results[0].success).toBe(true);
        expect(result.results[0].action).toBe("Scheduled for 2025-12-15");
        expect(mockFrontmatterService.updateProperty).toHaveBeenCalledWith(
          expect.any(String),
          "ems__Effort_scheduledTimestamp",
          "2025-12-15T00:00:00Z",
        );
      });

      it("should fail if date is missing", async () => {
        const result = await executor.executeBatch([
          { command: "schedule", filepath: "task.md" },
        ]);

        expect(result.results[0].success).toBe(false);
        expect(result.results[0].error).toContain("Missing required option");
      });

      it("should fail for invalid date format", async () => {
        const result = await executor.executeBatch([
          {
            command: "schedule",
            filepath: "task.md",
            options: { date: "12/15/2025" },
          },
        ]);

        expect(result.results[0].success).toBe(false);
        expect(result.results[0].error).toContain("Invalid date format");
      });
    });

    describe("set-deadline command", () => {
      it("should set deadline timestamp", async () => {
        const result = await executor.executeBatch([
          {
            command: "set-deadline",
            filepath: "task.md",
            options: { date: "2025-12-31" },
          },
        ]);

        expect(result.results[0].success).toBe(true);
        expect(result.results[0].action).toBe("Set deadline to 2025-12-31");
        expect(mockFrontmatterService.updateProperty).toHaveBeenCalledWith(
          expect.any(String),
          "ems__Effort_deadlineTimestamp",
          "2025-12-31T00:00:00Z",
        );
      });

      it("should fail if date is missing", async () => {
        const result = await executor.executeBatch([
          { command: "set-deadline", filepath: "task.md" },
        ]);

        expect(result.results[0].success).toBe(false);
        expect(result.results[0].error).toContain("Missing required option");
      });

      it("should fail for invalid date format", async () => {
        const result = await executor.executeBatch([
          {
            command: "set-deadline",
            filepath: "task.md",
            options: { date: "invalid" },
          },
        ]);

        expect(result.results[0].success).toBe(false);
        expect(result.results[0].error).toContain("Invalid date format");
      });
    });
  });

  describe("Path Resolution and Validation", () => {
    it("should resolve filepath relative to vault root", async () => {
      await executor.executeBatch([{ command: "start", filepath: "task.md" }]);

      expect(mockPathResolverInstance.resolve).toHaveBeenCalledWith("task.md");
    });

    it("should validate resolved path", async () => {
      await executor.executeBatch([{ command: "start", filepath: "task.md" }]);

      expect(mockPathResolverInstance.validate).toHaveBeenCalledWith(
        "/test/vault/task.md",
      );
    });

    it("should handle path validation errors", async () => {
      mockPathResolverInstance.validate.mockImplementation(() => {
        throw new Error("Path traversal detected");
      });

      const result = await executor.executeBatch([
        { command: "start", filepath: "../outside/task.md" },
      ]);

      expect(result.results[0].success).toBe(false);
      expect(result.results[0].error).toContain("Path traversal");
    });
  });
});
