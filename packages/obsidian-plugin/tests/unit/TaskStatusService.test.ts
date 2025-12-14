import "reflect-metadata";
import { container } from "tsyringe";
import { TaskStatusService, DI_TOKENS, registerCoreServices, resetContainer } from "exocortex";
import { TFile, Vault } from "obsidian";

describe("TaskStatusService", () => {
  let service: TaskStatusService;
  let mockVault: any;

  beforeEach(() => {
    resetContainer();

    mockVault = {
      read: jest.fn(),
      modify: jest.fn(),
      getAllFiles: jest.fn().mockReturnValue([]),
      getFrontmatter: jest.fn().mockReturnValue({}),
      exists: jest.fn().mockResolvedValue(true),
      updateFrontmatter: jest.fn().mockResolvedValue(undefined),
    };

    const mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
    };

    container.register(DI_TOKENS.IVaultAdapter, { useValue: mockVault });
    container.register(DI_TOKENS.ILogger, { useValue: mockLogger });
    registerCoreServices();

    service = container.resolve(TaskStatusService);
  });

  afterEach(() => {
    resetContainer();
  });

  describe("markTaskAsDone", () => {
    it("should add status and timestamp to file without frontmatter", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = "Task content";

      mockVault.read.mockResolvedValue(originalContent);

      await service.markTaskAsDone(mockFile);

      expect(mockVault.modify).toHaveBeenCalledWith(
        mockFile,
        expect.stringContaining(
          'ems__Effort_status: "[[ems__EffortStatusDone]]"',
        ),
      );
      expect(mockVault.modify).toHaveBeenCalledWith(
        mockFile,
        expect.stringContaining("ems__Effort_endTimestamp:"),
      );
      expect(mockVault.modify).toHaveBeenCalledWith(
        mockFile,
        expect.stringContaining("Task content"),
      );
    });

    it("should update existing status in frontmatter", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class:
  - "[[ems__Task]]"
ems__Effort_status: "[[ems__EffortStatusActive]]"
exo__Asset_uid: test-uuid
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.markTaskAsDone(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];

      expect(modifiedContent).toContain(
        'ems__Effort_status: "[[ems__EffortStatusDone]]"',
      );
      expect(modifiedContent).not.toContain("ems__EffortStatusActive");
      expect(modifiedContent).toContain("ems__Effort_endTimestamp:");
    });

    it("should add timestamp when status already exists", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class:
  - "[[ems__Task]]"
ems__Effort_status: "[[ems__EffortStatusActive]]"
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.markTaskAsDone(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];

      expect(modifiedContent).toContain("ems__Effort_endTimestamp:");
      expect(modifiedContent).toMatch(
        /ems__Effort_endTimestamp: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );
    });

    it("should update existing timestamp", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class:
  - "[[ems__Task]]"
ems__Effort_status: "[[ems__EffortStatusActive]]"
ems__Effort_endTimestamp: 2025-01-01T10:00:00
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.markTaskAsDone(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];

      expect(modifiedContent).toContain("ems__Effort_endTimestamp:");
      expect(modifiedContent).not.toContain("2025-01-01T10:00:00");
      expect(modifiedContent).toMatch(
        /ems__Effort_endTimestamp: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );
    });

    it("should preserve other frontmatter properties", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class:
  - "[[ems__Task]]"
exo__Asset_uid: test-uuid-123
exo__Asset_isDefinedBy: "[[Ontology/EMS]]"
ems__Effort_area: "[[Development]]"
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.markTaskAsDone(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];

      expect(modifiedContent).toContain("exo__Asset_uid: test-uuid-123");
      expect(modifiedContent).toContain(
        'exo__Asset_isDefinedBy: "[[Ontology/EMS]]"',
      );
      expect(modifiedContent).toContain('ems__Effort_area: "[[Development]]"');
    });

    it("should generate timestamp in ISO 8601 format without milliseconds", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
ems__Effort_status: "[[ems__EffortStatusActive]]"
---
Content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.markTaskAsDone(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];

      const timestampMatch = modifiedContent.match(
        /ems__Effort_endTimestamp: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/,
      );
      expect(timestampMatch).toBeTruthy();

      const timestamp = timestampMatch![1];
      expect(timestamp).not.toContain(".");
      expect(timestamp.split("T")[0]).toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(timestamp.split("T")[1]).toMatch(/\d{2}:\d{2}:\d{2}/);
    });
  });

  describe("archiveTask", () => {
    it("should add archived property to file without frontmatter", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = "Task content";

      mockVault.read.mockResolvedValue(originalContent);

      await service.archiveTask(mockFile);

      expect(mockVault.modify).toHaveBeenCalledWith(
        mockFile,
        expect.stringContaining("archived: true"),
      );
      expect(mockVault.modify).toHaveBeenCalledWith(
        mockFile,
        expect.stringContaining("Task content"),
      );
    });

    it("should update existing archived property", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class:
  - "[[ems__Task]]"
archived: false
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.archiveTask(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];

      expect(modifiedContent).toContain("archived: true");
      expect(modifiedContent).not.toContain("archived: false");
    });

    it("should preserve other frontmatter properties when archiving", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class:
  - "[[ems__Task]]"
ems__Effort_status: "[[ems__EffortStatusDone]]"
ems__Effort_endTimestamp: 2025-10-12T14:30:00
exo__Asset_uid: task-123
---
Content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.archiveTask(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];

      expect(modifiedContent).toContain(
        'ems__Effort_status: "[[ems__EffortStatusDone]]"',
      );
      expect(modifiedContent).toContain(
        "ems__Effort_endTimestamp: 2025-10-12T14:30:00",
      );
      expect(modifiedContent).toContain("exo__Asset_uid: task-123");
      expect(modifiedContent).toContain("archived: true");
    });

    it("should remove aliases property when archiving", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class:
  - "[[ems__Task]]"
aliases:
  - Task Alias 1
  - Task Alias 2
ems__Effort_status: "[[ems__EffortStatusDone]]"
---
Content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.archiveTask(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];

      expect(modifiedContent).toContain("archived: true");
      expect(modifiedContent).not.toContain("aliases");
      expect(modifiedContent).not.toContain("Task Alias 1");
      expect(modifiedContent).not.toContain("Task Alias 2");
    });

    it("should handle archiving when aliases property does not exist", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class:
  - "[[ems__Task]]"
ems__Effort_status: "[[ems__EffortStatusDone]]"
---
Content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.archiveTask(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];

      expect(modifiedContent).toContain("archived: true");
      expect(modifiedContent).toContain(
        'ems__Effort_status: "[[ems__EffortStatusDone]]"',
      );
    });
  });

  describe("trashEffort", () => {
    it("should add Trashed status and resolutionTimestamp to file without frontmatter", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = "Task content";

      mockVault.read.mockResolvedValue(originalContent);

      await service.trashEffort(mockFile);

      expect(mockVault.modify).toHaveBeenCalledWith(
        mockFile,
        expect.stringContaining(
          'ems__Effort_status: "[[ems__EffortStatusTrashed]]"',
        ),
      );
      expect(mockVault.modify).toHaveBeenCalledWith(
        mockFile,
        expect.stringContaining("ems__Effort_resolutionTimestamp:"),
      );
      expect(mockVault.modify).toHaveBeenCalledWith(
        mockFile,
        expect.stringContaining("Task content"),
      );
    });

    it("should update existing status to Trashed in frontmatter", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class:
  - "[[ems__Task]]"
ems__Effort_status: "[[ems__EffortStatusDoing]]"
exo__Asset_uid: test-uuid
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.trashEffort(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];

      expect(modifiedContent).toContain(
        'ems__Effort_status: "[[ems__EffortStatusTrashed]]"',
      );
      expect(modifiedContent).toContain("ems__Effort_resolutionTimestamp:");
      expect(modifiedContent).not.toContain("ems__EffortStatusDoing");
    });

    it("should add resolutionTimestamp and preserve existing endTimestamp in frontmatter", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
ems__Effort_status: "[[ems__EffortStatusDoing]]"
ems__Effort_startTimestamp: 2025-10-12T10:00:00
ems__Effort_endTimestamp: 2025-10-12T10:30:00
---`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.trashEffort(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];

      expect(modifiedContent).toContain(
        'ems__Effort_status: "[[ems__EffortStatusTrashed]]"',
      );
      expect(modifiedContent).toContain("ems__Effort_resolutionTimestamp:");
      const oldEndTimestamp = "ems__Effort_endTimestamp: 2025-10-12T10:30:00";
      expect(modifiedContent).toContain(oldEndTimestamp);
    });

    it("should append trash reason section when reason is provided", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
ems__Effort_status: "[[ems__EffortStatusDoing]]"
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.trashEffort(mockFile, "No longer needed - project cancelled");

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];

      expect(modifiedContent).toContain(
        'ems__Effort_status: "[[ems__EffortStatusTrashed]]"',
      );
      expect(modifiedContent).toContain("## Trash Reason");
      expect(modifiedContent).toContain("No longer needed - project cancelled");
    });

    it("should not append trash reason section when reason is null", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
ems__Effort_status: "[[ems__EffortStatusDoing]]"
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.trashEffort(mockFile, null);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];

      expect(modifiedContent).toContain(
        'ems__Effort_status: "[[ems__EffortStatusTrashed]]"',
      );
      expect(modifiedContent).not.toContain("## Trash Reason");
    });

    it("should not append trash reason section when reason is undefined", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
ems__Effort_status: "[[ems__EffortStatusDoing]]"
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.trashEffort(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];

      expect(modifiedContent).toContain(
        'ems__Effort_status: "[[ems__EffortStatusTrashed]]"',
      );
      expect(modifiedContent).not.toContain("## Trash Reason");
    });

    it("should preserve multiline trash reason", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
ems__Effort_status: "[[ems__EffortStatusDoing]]"
---
Task content`;

      const multilineReason = "First line\nSecond line\nThird line";
      mockVault.read.mockResolvedValue(originalContent);

      await service.trashEffort(mockFile, multilineReason);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];

      expect(modifiedContent).toContain("## Trash Reason");
      expect(modifiedContent).toContain("First line\nSecond line\nThird line");
    });
  });

  describe("syncEffortEndTimestamp", () => {
    it("should add both timestamps to file without frontmatter", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = "Task content";

      mockVault.read.mockResolvedValue(originalContent);

      await service.syncEffortEndTimestamp(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];

      expect(modifiedContent).toContain("ems__Effort_endTimestamp:");
      expect(modifiedContent).toContain("ems__Effort_resolutionTimestamp:");
      expect(modifiedContent).toContain("Task content");
    });

    it("should update existing endTimestamp and resolutionTimestamp", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class:
  - "[[ems__Task]]"
ems__Effort_endTimestamp: 2025-01-01T10:00:00
ems__Effort_resolutionTimestamp: 2025-01-01T10:00:00
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.syncEffortEndTimestamp(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];

      expect(modifiedContent).toContain("ems__Effort_endTimestamp:");
      expect(modifiedContent).toContain("ems__Effort_resolutionTimestamp:");
      expect(modifiedContent).not.toContain("2025-01-01T10:00:00");
      expect(modifiedContent).toMatch(
        /ems__Effort_endTimestamp: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );
      expect(modifiedContent).toMatch(
        /ems__Effort_resolutionTimestamp: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );
    });

    it("should add timestamps when only one exists", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class:
  - "[[ems__Task]]"
ems__Effort_endTimestamp: 2025-01-01T10:00:00
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.syncEffortEndTimestamp(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];

      expect(modifiedContent).toContain("ems__Effort_endTimestamp:");
      expect(modifiedContent).toContain("ems__Effort_resolutionTimestamp:");
    });

    it("should use custom date when provided", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
ems__Effort_status: "[[ems__EffortStatusDone]]"
---
Content`;

      // Create custom date and verify timestamp is recorded in local time format (without Z)
      const customDate = new Date(2025, 4, 15, 14, 30, 45); // May 15, 2025, 14:30:45 local time
      mockVault.read.mockResolvedValue(originalContent);

      await service.syncEffortEndTimestamp(mockFile, customDate);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];

      expect(modifiedContent).toContain(
        "ems__Effort_endTimestamp: 2025-05-15T14:30:45",
      );
      expect(modifiedContent).toContain(
        "ems__Effort_resolutionTimestamp: 2025-05-15T14:30:45",
      );
      // Ensure no Z suffix (local time, not UTC)
      expect(modifiedContent).not.toContain("14:30:45Z");
    });

    it("should preserve other frontmatter properties", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class:
  - "[[ems__Task]]"
exo__Asset_uid: test-uuid-456
ems__Effort_status: "[[ems__EffortStatusDone]]"
ems__Effort_area: "[[Development]]"
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.syncEffortEndTimestamp(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];

      expect(modifiedContent).toContain("exo__Asset_uid: test-uuid-456");
      expect(modifiedContent).toContain(
        'ems__Effort_status: "[[ems__EffortStatusDone]]"',
      );
      expect(modifiedContent).toContain('ems__Effort_area: "[[Development]]"');
    });

    it("should set both timestamps to same value", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
ems__Effort_status: "[[ems__EffortStatusDone]]"
---
Content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.syncEffortEndTimestamp(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];

      const endTimestampMatch = modifiedContent.match(
        /ems__Effort_endTimestamp: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/,
      );
      const resolutionTimestampMatch = modifiedContent.match(
        /ems__Effort_resolutionTimestamp: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/,
      );

      expect(endTimestampMatch).toBeTruthy();
      expect(resolutionTimestampMatch).toBeTruthy();
      expect(endTimestampMatch![1]).toBe(resolutionTimestampMatch![1]);
    });

    it("should generate timestamps in ISO 8601 format without milliseconds", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
ems__Effort_status: "[[ems__EffortStatusDone]]"
---
Content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.syncEffortEndTimestamp(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];

      const timestampMatch = modifiedContent.match(
        /ems__Effort_endTimestamp: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/,
      );
      expect(timestampMatch).toBeTruthy();

      const timestamp = timestampMatch![1];
      expect(timestamp).not.toContain(".");
      expect(timestamp.split("T")[0]).toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(timestamp.split("T")[1]).toMatch(/\d{2}:\d{2}:\d{2}/);
    });
  });

  describe("rollbackStatus", () => {
    it("should rollback Task from Doing to Backlog", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class:
  - "[[ems__Task]]"
ems__Effort_status: "[[ems__EffortStatusDoing]]"
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.rollbackStatus(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];

      expect(modifiedContent).toContain(
        'ems__Effort_status: "[[ems__EffortStatusBacklog]]"',
      );
      expect(modifiedContent).not.toContain("ems__EffortStatusDoing");
    });

    it("should rollback Project from Doing to ToDo", async () => {
      const mockFile = { path: "test-project.md" } as TFile;
      const originalContent = `---
exo__Instance_class:
  - "[[ems__Project]]"
ems__Effort_status: "[[ems__EffortStatusDoing]]"
---
Project content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.rollbackStatus(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];

      expect(modifiedContent).toContain(
        'ems__Effort_status: "[[ems__EffortStatusToDo]]"',
      );
      expect(modifiedContent).not.toContain("ems__EffortStatusDoing");
    });

    it("should rollback from Backlog to Draft", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class:
  - "[[ems__Task]]"
ems__Effort_status: "[[ems__EffortStatusBacklog]]"
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.rollbackStatus(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];

      expect(modifiedContent).toContain(
        'ems__Effort_status: "[[ems__EffortStatusDraft]]"',
      );
      expect(modifiedContent).not.toContain("ems__EffortStatusBacklog");
    });

    it("should remove status property when rolling back from Draft", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class:
  - "[[ems__Task]]"
ems__Effort_status: "[[ems__EffortStatusDraft]]"
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.rollbackStatus(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];

      expect(modifiedContent).not.toContain("ems__Effort_status");
    });

    it("should throw error when trying to rollback from Trashed", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class:
  - "[[ems__Task]]"
ems__Effort_status: "[[ems__EffortStatusTrashed]]"
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      await expect(service.rollbackStatus(mockFile)).rejects.toThrow(
        "Cannot rollback from current status",
      );
    });

    it("should throw error when no status exists", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class:
  - "[[ems__Task]]"
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      await expect(service.rollbackStatus(mockFile)).rejects.toThrow(
        "No current status to rollback from",
      );
    });

    it("should remove endTimestamp and resolutionTimestamp when rolling back from Done", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class:
  - "[[ems__Task]]"
ems__Effort_status: "[[ems__EffortStatusDone]]"
ems__Effort_endTimestamp: 2025-10-23T12:00:00
ems__Effort_resolutionTimestamp: 2025-10-23T12:00:00
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.rollbackStatus(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];

      expect(modifiedContent).toContain(
        'ems__Effort_status: "[[ems__EffortStatusDoing]]"',
      );
      expect(modifiedContent).not.toContain("ems__Effort_endTimestamp");
      expect(modifiedContent).not.toContain("ems__Effort_resolutionTimestamp");
    });

    it("should remove startTimestamp when rolling back from Doing", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class:
  - "[[ems__Task]]"
ems__Effort_status: "[[ems__EffortStatusDoing]]"
ems__Effort_startTimestamp: 2025-10-23T12:00:00
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.rollbackStatus(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];

      expect(modifiedContent).toContain(
        'ems__Effort_status: "[[ems__EffortStatusBacklog]]"',
      );
      expect(modifiedContent).not.toContain("ems__Effort_startTimestamp");
    });

    it("should rollback Project from Analysis to Backlog", async () => {
      const mockFile = { path: "test-project.md" } as TFile;
      const originalContent = `---
exo__Instance_class:
  - "[[ems__Project]]"
ems__Effort_status: "[[ems__EffortStatusAnalysis]]"
---
Project content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.rollbackStatus(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];

      expect(modifiedContent).toContain(
        'ems__Effort_status: "[[ems__EffortStatusBacklog]]"',
      );
      expect(modifiedContent).not.toContain("ems__EffortStatusAnalysis");
    });

    it("should rollback Project from ToDo to Analysis", async () => {
      const mockFile = { path: "test-project.md" } as TFile;
      const originalContent = `---
exo__Instance_class:
  - "[[ems__Project]]"
ems__Effort_status: "[[ems__EffortStatusToDo]]"
---
Project content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.rollbackStatus(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];

      expect(modifiedContent).toContain(
        'ems__Effort_status: "[[ems__EffortStatusAnalysis]]"',
      );
      expect(modifiedContent).not.toContain("ems__EffortStatusToDo");
    });
  });

  describe("setDraftStatus", () => {
    it("should update task status to Draft", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---\nems__Effort_status: "[[ems__EffortStatusBacklog]]"\n---\n\nContent`;
      mockVault.read.mockResolvedValue(originalContent);

      await service.setDraftStatus(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain(
        'ems__Effort_status: "[[ems__EffortStatusDraft]]"',
      );
    });
  });

  describe("moveToBacklog", () => {
    it("should update task status to Backlog", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---\nems__Effort_status: "[[ems__EffortStatusDraft]]"\n---\n\nContent`;
      mockVault.read.mockResolvedValue(originalContent);

      await service.moveToBacklog(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain(
        'ems__Effort_status: "[[ems__EffortStatusBacklog]]"',
      );
    });
  });

  describe("moveToAnalysis", () => {
    it("should update project status to Analysis", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---\nems__Effort_status: "[[ems__EffortStatusBacklog]]"\n---\n\nContent`;
      mockVault.read.mockResolvedValue(originalContent);

      await service.moveToAnalysis(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain(
        'ems__Effort_status: "[[ems__EffortStatusAnalysis]]"',
      );
    });
  });

  describe("moveToToDo", () => {
    it("should update project status to ToDo", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---\nems__Effort_status: "[[ems__EffortStatusAnalysis]]"\n---\n\nContent`;
      mockVault.read.mockResolvedValue(originalContent);

      await service.moveToToDo(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain(
        'ems__Effort_status: "[[ems__EffortStatusToDo]]"',
      );
    });
  });

  describe("startEffort", () => {
    it("should set status to Doing and add startTimestamp", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---\nems__Effort_status: "[[ems__EffortStatusBacklog]]"\n---\n\nContent`;
      mockVault.read.mockResolvedValue(originalContent);

      await service.startEffort(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain(
        'ems__Effort_status: "[[ems__EffortStatusDoing]]"',
      );
      expect(modifiedContent).toContain("ems__Effort_startTimestamp:");
      expect(modifiedContent).toMatch(
        /ems__Effort_startTimestamp: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );
    });

    it("should update both properties when starting from Draft", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---\nems__Effort_status: "[[ems__EffortStatusDraft]]"\n---\n\nContent`;
      mockVault.read.mockResolvedValue(originalContent);

      await service.startEffort(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain(
        'ems__Effort_status: "[[ems__EffortStatusDoing]]"',
      );
      expect(modifiedContent).toContain("ems__Effort_startTimestamp:");
    });
  });

  describe("planOnToday", () => {
    it("should set ems__Effort_plannedStartTimestamp to today at 00:00:00 local time", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---\nems__Effort_status: "[[ems__EffortStatusBacklog]]"\n---\n\nContent`;
      mockVault.read.mockResolvedValue(originalContent);

      await service.planOnToday(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain("ems__Effort_plannedStartTimestamp:");
      expect(modifiedContent).toMatch(
        /ems__Effort_plannedStartTimestamp: \d{4}-\d{2}-\d{2}T00:00:00$/m,
      );
    });

    it("should update existing ems__Effort_plannedStartTimestamp", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---\nems__Effort_plannedStartTimestamp: 2025-01-01T10:00:00\n---\n\nContent`;
      mockVault.read.mockResolvedValue(originalContent);

      await service.planOnToday(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain("ems__Effort_plannedStartTimestamp:");
      expect(modifiedContent).toMatch(
        /ems__Effort_plannedStartTimestamp: \d{4}-\d{2}-\d{2}T00:00:00$/m,
      );
      expect(modifiedContent).not.toContain("2025-01-01T10:00:00");
    });
  });

  describe("planForEvening", () => {
    it("should set plannedStartTimestamp to 19:00 local time", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---\nems__Effort_status: "[[ems__EffortStatusBacklog]]"\n---\n\nContent`;
      mockVault.read.mockResolvedValue(originalContent);

      await service.planForEvening(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain("ems__Effort_plannedStartTimestamp:");
      expect(modifiedContent).toMatch(
        /ems__Effort_plannedStartTimestamp: \d{4}-\d{2}-\d{2}T19:00:00$/m,
      );
    });

    it("should preserve other frontmatter properties", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---\nexo__Asset_uid: test-uid\nems__Effort_status: "[[ems__EffortStatusBacklog]]"\n---\n\nContent`;
      mockVault.read.mockResolvedValue(originalContent);

      await service.planForEvening(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain("exo__Asset_uid: test-uid");
      expect(modifiedContent).toContain(
        'ems__Effort_status: "[[ems__EffortStatusBacklog]]"',
      );
      expect(modifiedContent).toContain("ems__Effort_plannedStartTimestamp:");
    });
  });

  describe("shiftDayBackward", () => {
    it("should shift day backward by 1 day", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---\nems__Effort_plannedStartTimestamp: 2025-10-20T00:00:00\n---\n\nContent`;
      mockVault.read.mockResolvedValue(originalContent);

      await service.shiftDayBackward(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain('ems__Effort_plannedStartTimestamp: 2025-10-19T00:00:00');
      expect(modifiedContent).not.toContain("2025-10-20");
    });

    it("should throw error when ems__Effort_plannedStartTimestamp is missing", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---\nems__Effort_status: "[[ems__EffortStatusBacklog]]"\n---\n\nContent`;
      mockVault.read.mockResolvedValue(originalContent);

      await expect(service.shiftDayBackward(mockFile)).rejects.toThrow(
        "ems__Effort_plannedStartTimestamp property not found",
      );
    });

    it("should throw error when date format is invalid", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---\nems__Effort_plannedStartTimestamp: invalid-date\n---\n\nContent`;
      mockVault.read.mockResolvedValue(originalContent);

      await expect(service.shiftDayBackward(mockFile)).rejects.toThrow(
        "Invalid date format in ems__Effort_plannedStartTimestamp",
      );
    });

    it("should handle month transition backward", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---\nems__Effort_plannedStartTimestamp: 2025-11-01T00:00:00\n---\n\nContent`;
      mockVault.read.mockResolvedValue(originalContent);

      await service.shiftDayBackward(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain('ems__Effort_plannedStartTimestamp: 2025-10-31T00:00:00');
    });
  });

  describe("shiftDayForward", () => {
    it("should shift day forward by 1 day", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---\nems__Effort_plannedStartTimestamp: 2025-10-20T00:00:00\n---\n\nContent`;
      mockVault.read.mockResolvedValue(originalContent);

      await service.shiftDayForward(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain('ems__Effort_plannedStartTimestamp: 2025-10-21T00:00:00');
      expect(modifiedContent).not.toContain("2025-10-20");
    });

    it("should throw error when ems__Effort_plannedStartTimestamp is missing", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---\nems__Effort_status: "[[ems__EffortStatusBacklog]]"\n---\n\nContent`;
      mockVault.read.mockResolvedValue(originalContent);

      await expect(service.shiftDayForward(mockFile)).rejects.toThrow(
        "ems__Effort_plannedStartTimestamp property not found",
      );
    });

    it("should throw error when date format is invalid", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---\nems__Effort_plannedStartTimestamp: not-a-date\n---\n\nContent`;
      mockVault.read.mockResolvedValue(originalContent);

      await expect(service.shiftDayForward(mockFile)).rejects.toThrow(
        "Invalid date format in ems__Effort_plannedStartTimestamp",
      );
    });

    it("should handle month transition forward", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---\nems__Effort_plannedStartTimestamp: 2025-10-31T00:00:00\n---\n\nContent`;
      mockVault.read.mockResolvedValue(originalContent);

      await service.shiftDayForward(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain('ems__Effort_plannedStartTimestamp: 2025-11-01T00:00:00');
    });

    it("should preserve other frontmatter properties", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---\nexo__Asset_uid: test-uid\nems__Effort_plannedStartTimestamp: 2025-10-20T00:00:00\nems__Effort_status: "[[ems__EffortStatusBacklog]]"\n---\n\nContent`;
      mockVault.read.mockResolvedValue(originalContent);

      await service.shiftDayForward(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain("exo__Asset_uid: test-uid");
      expect(modifiedContent).toContain(
        'ems__Effort_status: "[[ems__EffortStatusBacklog]]"',
      );
      expect(modifiedContent).toContain('ems__Effort_plannedStartTimestamp: 2025-10-21T00:00:00');
    });
  });
});
