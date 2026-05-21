import { TaskStatusService } from "../../../src/services/TaskStatusService";
import { EffortStatusWorkflow } from "../../../src/services/EffortStatusWorkflow";
import { StatusTimestampService } from "../../../src/services/StatusTimestampService";
import type { IVaultAdapter, IFile } from "../../../src/interfaces/IVaultAdapter";

describe("TaskStatusService", () => {
  let service: TaskStatusService;
  let mockVault: jest.Mocked<IVaultAdapter>;
  let workflow: EffortStatusWorkflow;
  let mockTimestampService: jest.Mocked<StatusTimestampService>;

  const createMockFile = (overrides?: Partial<IFile>): IFile => ({
    path: "tasks/test-task.md",
    basename: "test-task",
    name: "test-task.md",
    parent: { path: "tasks", name: "tasks" },
    ...overrides,
  });

  const makeFrontmatter = (props: Record<string, string>): string => {
    const lines = Object.entries(props).map(([k, v]) => `${k}: ${v}`);
    return `---\n${lines.join("\n")}\n---\n\nBody content`;
  };

  beforeEach(() => {
    mockVault = {
      getFrontmatter: jest.fn(),
      getAllFiles: jest.fn(),
      read: jest.fn(),
      create: jest.fn(),
      modify: jest.fn(),
      delete: jest.fn(),
      exists: jest.fn(),
      getAbstractFileByPath: jest.fn(),
      updateFrontmatter: jest.fn(),
      rename: jest.fn(),
      updateLinks: jest.fn(),
      createFolder: jest.fn(),
      getFirstLinkpathDest: jest.fn(),
      process: jest.fn(),
      getDefaultNewFileParent: jest.fn(),
    } as jest.Mocked<IVaultAdapter>;

    workflow = new EffortStatusWorkflow();
    mockTimestampService = {
      addEndAndResolutionTimestamps: jest.fn().mockResolvedValue(undefined),
      shiftPlannedEndTimestamp: jest.fn().mockResolvedValue(undefined),
      addReviewTimestamp: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<StatusTimestampService>;

    service = new TaskStatusService(
      mockVault,
      workflow,
      mockTimestampService,
    );
  });

  describe("syncEffortEndTimestamp", () => {
    it("should delegate to timestampService.addEndAndResolutionTimestamps", async () => {
      const file = createMockFile();

      await service.syncEffortEndTimestamp(file);

      expect(mockTimestampService.addEndAndResolutionTimestamps).toHaveBeenCalledWith(file, undefined);
    });

    it("should pass custom date to timestampService", async () => {
      const file = createMockFile();
      const date = new Date("2025-06-15T10:00:00");

      await service.syncEffortEndTimestamp(file, date);

      expect(mockTimestampService.addEndAndResolutionTimestamps).toHaveBeenCalledWith(file, date);
    });
  });

  describe("shiftPlannedEndTimestamp", () => {
    it("should delegate to timestampService.shiftPlannedEndTimestamp", async () => {
      const file = createMockFile();
      const deltaMs = 3600000; // 1 hour

      await service.shiftPlannedEndTimestamp(file, deltaMs);

      expect(mockTimestampService.shiftPlannedEndTimestamp).toHaveBeenCalledWith(file, deltaMs);
    });
  });

  describe("planForEvening", () => {
    it("should set plannedStartTimestamp to 19:00 today", async () => {
      const file = createMockFile();
      const content = makeFrontmatter({
        "ems__Effort_plannedStartTimestamp": "2025-01-01T00:00:00",
      });
      mockVault.read.mockResolvedValue(content);

      await service.planForEvening(file);

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).toContain("ems__Effort_plannedStartTimestamp");
      // The evening timestamp should contain 19:00
      expect(modifiedContent).toMatch(/19:00:00/);
    });
  });

  describe("rollbackStatus", () => {
    it("should throw when no current status exists", async () => {
      const file = createMockFile();
      mockVault.read.mockResolvedValue("No frontmatter");

      await expect(service.rollbackStatus(file)).rejects.toThrow(
        "No current status to rollback from",
      );
    });

    it("should throw when frontmatter exists but no status property", async () => {
      const file = createMockFile();
      const content = makeFrontmatter({ "some_property": "value" });
      mockVault.read.mockResolvedValue(content);

      await expect(service.rollbackStatus(file)).rejects.toThrow(
        "No current status to rollback from",
      );
    });

    it("should throw when cannot rollback from unknown status", async () => {
      const file = createMockFile();
      const content = makeFrontmatter({
        "ems__Effort_status": '"[[ems__UnknownStatus]]"',
      });
      mockVault.read.mockResolvedValue(content);

      await expect(service.rollbackStatus(file)).rejects.toThrow(
        "Cannot rollback from current status",
      );
    });

    it("should remove status property when rolling back from Draft", async () => {
      const file = createMockFile();
      const content = makeFrontmatter({
        "ems__Effort_status": '"[[ems__EffortStatusDraft]]"',
      });
      mockVault.read.mockResolvedValue(content);

      await service.rollbackStatus(file);

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      // Draft rollback returns null -> removes status property
      expect(modifiedContent).not.toContain("ems__Effort_status");
    });

    it("should rollback from Backlog to Draft", async () => {
      const file = createMockFile();
      const content = makeFrontmatter({
        "ems__Effort_status": '"[[ems__EffortStatusBacklog]]"',
      });
      mockVault.read.mockResolvedValue(content);

      await service.rollbackStatus(file);

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).toContain("ems__EffortStatusDraft");
    });

    it("should rollback from Doing to Backlog for non-project tasks", async () => {
      const file = createMockFile();
      const content = makeFrontmatter({
        "ems__Effort_status": '"[[ems__EffortStatusDoing]]"',
        "exo__Instance_class": '"[[ems__Task]]"',
      });
      mockVault.read.mockResolvedValue(content);

      await service.rollbackStatus(file);

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).toContain("ems__EffortStatusBacklog");
      // Should remove startTimestamp when rolling back from Doing
      expect(modifiedContent).not.toContain("ems__Effort_startTimestamp");
    });

    it("should rollback from Doing to ToDo for projects", async () => {
      const file = createMockFile();
      const content = `---
ems__Effort_status: "[[ems__EffortStatusDoing]]"
exo__Instance_class:
  - "[[ems__Project]]"
---

Body`;
      mockVault.read.mockResolvedValue(content);

      await service.rollbackStatus(file);

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).toContain("ems__EffortStatusToDo");
    });

    it("should rollback from Done to Doing and remove end/resolution timestamps", async () => {
      const file = createMockFile();
      const content = makeFrontmatter({
        "ems__Effort_status": '"[[ems__EffortStatusDone]]"',
        "ems__Effort_endTimestamp": "2025-06-15T10:00:00",
        "ems__Effort_resolutionTimestamp": "2025-06-15T10:00:00",
      });
      mockVault.read.mockResolvedValue(content);

      await service.rollbackStatus(file);

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).toContain("ems__EffortStatusDoing");
      expect(modifiedContent).not.toContain("ems__Effort_endTimestamp");
      expect(modifiedContent).not.toContain("ems__Effort_resolutionTimestamp");
    });

    it("should rollback from Analysis to Backlog", async () => {
      const file = createMockFile();
      const content = makeFrontmatter({
        "ems__Effort_status": '"[[ems__EffortStatusAnalysis]]"',
      });
      mockVault.read.mockResolvedValue(content);

      await service.rollbackStatus(file);

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).toContain("ems__EffortStatusBacklog");
    });

    it("should rollback from ToDo to Analysis", async () => {
      const file = createMockFile();
      const content = makeFrontmatter({
        "ems__Effort_status": '"[[ems__EffortStatusToDo]]"',
      });
      mockVault.read.mockResolvedValue(content);

      await service.rollbackStatus(file);

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).toContain("ems__EffortStatusAnalysis");
    });

    it("should handle instance class as array", async () => {
      const file = createMockFile();
      const content = `---
ems__Effort_status: "[[ems__EffortStatusDoing]]"
exo__Instance_class:
  - "[[ems__Project]]"
  - "[[exo__Prototype]]"
---

Body`;
      mockVault.read.mockResolvedValue(content);

      await service.rollbackStatus(file);

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).toContain("ems__EffortStatusToDo");
    });
  });
});
