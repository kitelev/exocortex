import "reflect-metadata";
import { container } from "tsyringe";
import { TaskStatusService, DI_TOKENS, registerCoreServices, resetContainer } from "exocortex";
import { TFile } from "obsidian";

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
});
