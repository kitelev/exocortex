import { TaskStatusService } from "../../../src/services/TaskStatusService";
import { EffortStatusWorkflow } from "../../../src/services/EffortStatusWorkflow";
import { StatusTimestampService } from "../../../src/services/StatusTimestampService";
import { DateFormatter } from "../../../src/utilities/DateFormatter";
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

  describe("setDraftStatus", () => {
    it("should set status to ems__EffortStatusDraft", async () => {
      const file = createMockFile();
      const content = makeFrontmatter({ "ems__Effort_status": '"[[ems__EffortStatusBacklog]]"' });
      mockVault.read.mockResolvedValue(content);

      await service.setDraftStatus(file);

      expect(mockVault.modify).toHaveBeenCalledWith(
        file,
        expect.stringContaining("ems__EffortStatusDraft"),
      );
    });
  });

  describe("moveToBacklog", () => {
    it("should set status to ems__EffortStatusBacklog", async () => {
      const file = createMockFile();
      const content = makeFrontmatter({ "ems__Effort_status": '"[[ems__EffortStatusDraft]]"' });
      mockVault.read.mockResolvedValue(content);

      await service.moveToBacklog(file);

      expect(mockVault.modify).toHaveBeenCalledWith(
        file,
        expect.stringContaining("ems__EffortStatusBacklog"),
      );
    });
  });

  describe("moveToAnalysis", () => {
    it("should set status to ems__EffortStatusAnalysis", async () => {
      const file = createMockFile();
      const content = makeFrontmatter({ "ems__Effort_status": '"[[ems__EffortStatusBacklog]]"' });
      mockVault.read.mockResolvedValue(content);

      await service.moveToAnalysis(file);

      expect(mockVault.modify).toHaveBeenCalledWith(
        file,
        expect.stringContaining("ems__EffortStatusAnalysis"),
      );
    });
  });

  describe("moveToToDo", () => {
    it("should set status to ems__EffortStatusToDo", async () => {
      const file = createMockFile();
      const content = makeFrontmatter({ "ems__Effort_status": '"[[ems__EffortStatusAnalysis]]"' });
      mockVault.read.mockResolvedValue(content);

      await service.moveToToDo(file);

      expect(mockVault.modify).toHaveBeenCalledWith(
        file,
        expect.stringContaining("ems__EffortStatusToDo"),
      );
    });
  });

  describe("startEffort", () => {
    it("should set status to Doing and add startTimestamp", async () => {
      const file = createMockFile();
      const content = makeFrontmatter({
        "ems__Effort_status": '"[[ems__EffortStatusBacklog]]"',
        "ems__Effort_startTimestamp": "",
      });
      mockVault.read.mockResolvedValue(content);

      await service.startEffort(file);

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).toContain("ems__EffortStatusDoing");
      expect(modifiedContent).toContain("ems__Effort_startTimestamp");
    });
  });

  describe("markTaskAsDone", () => {
    it("should set status to Done and add end and resolution timestamps", async () => {
      const file = createMockFile();
      const content = makeFrontmatter({
        "ems__Effort_status": '"[[ems__EffortStatusDoing]]"',
        "ems__Effort_endTimestamp": "",
        "ems__Effort_resolutionTimestamp": "",
      });
      mockVault.read.mockResolvedValue(content);

      await service.markTaskAsDone(file);

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).toContain("ems__EffortStatusDone");
      expect(modifiedContent).toContain("ems__Effort_endTimestamp");
      expect(modifiedContent).toContain("ems__Effort_resolutionTimestamp");
    });
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

  describe("trashEffort", () => {
    it("should set status to Trashed and add resolution timestamp", async () => {
      const file = createMockFile();
      const content = makeFrontmatter({
        "ems__Effort_status": '"[[ems__EffortStatusDoing]]"',
        "ems__Effort_resolutionTimestamp": "",
      });
      mockVault.read.mockResolvedValue(content);

      await service.trashEffort(file);

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).toContain("ems__EffortStatusTrashed");
      expect(modifiedContent).toContain("ems__Effort_resolutionTimestamp");
    });

    it("should append trash reason when reason is provided", async () => {
      const file = createMockFile();
      const content = makeFrontmatter({
        "ems__Effort_status": '"[[ems__EffortStatusDoing]]"',
        "ems__Effort_resolutionTimestamp": "",
      });
      mockVault.read.mockResolvedValue(content);

      await service.trashEffort(file, "Duplicate task");

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).toContain("## Trash Reason");
      expect(modifiedContent).toContain("Duplicate task");
    });

    it("should not append trash reason when reason is null", async () => {
      const file = createMockFile();
      const content = makeFrontmatter({
        "ems__Effort_status": '"[[ems__EffortStatusDoing]]"',
        "ems__Effort_resolutionTimestamp": "",
      });
      mockVault.read.mockResolvedValue(content);

      await service.trashEffort(file, null);

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).not.toContain("## Trash Reason");
    });

    it("should not append trash reason when reason is undefined", async () => {
      const file = createMockFile();
      const content = makeFrontmatter({
        "ems__Effort_status": '"[[ems__EffortStatusDoing]]"',
        "ems__Effort_resolutionTimestamp": "",
      });
      mockVault.read.mockResolvedValue(content);

      await service.trashEffort(file, undefined);

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).not.toContain("## Trash Reason");
    });
  });

  describe("archiveTask", () => {
    it("should set archived to true and remove aliases", async () => {
      const file = createMockFile();
      const content = makeFrontmatter({
        archived: "false",
        aliases: "Some Alias",
      });
      mockVault.read.mockResolvedValue(content);

      await service.archiveTask(file);

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).toContain("archived: true");
    });
  });

  describe("planOnToday", () => {
    it("should set plannedStartTimestamp to today", async () => {
      const file = createMockFile();
      const content = makeFrontmatter({
        "ems__Effort_plannedStartTimestamp": "2025-01-01T00:00:00",
      });
      mockVault.read.mockResolvedValue(content);

      await service.planOnToday(file);

      expect(mockVault.modify).toHaveBeenCalledWith(
        file,
        expect.stringContaining("ems__Effort_plannedStartTimestamp"),
      );
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

  describe("shiftDayBackward", () => {
    it("should shift planned start timestamp by -1 day", async () => {
      const file = createMockFile();
      const content = makeFrontmatter({
        "ems__Effort_plannedStartTimestamp": "2025-06-15T10:00:00",
      });
      mockVault.read.mockResolvedValue(content);

      await service.shiftDayBackward(file);

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).toContain("2025-06-14");
    });
  });

  describe("shiftDayForward", () => {
    it("should shift planned start timestamp by +1 day", async () => {
      const file = createMockFile();
      const content = makeFrontmatter({
        "ems__Effort_plannedStartTimestamp": "2025-06-15T10:00:00",
      });
      mockVault.read.mockResolvedValue(content);

      await service.shiftDayForward(file);

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).toContain("2025-06-16");
    });

    it("should throw when plannedStartTimestamp is missing", async () => {
      const file = createMockFile();
      const content = makeFrontmatter({
        "ems__Effort_status": '"[[ems__EffortStatusDoing]]"',
      });
      mockVault.read.mockResolvedValue(content);

      await expect(service.shiftDayForward(file)).rejects.toThrow(
        "ems__Effort_plannedStartTimestamp property not found",
      );
    });

    it("should throw when plannedStartTimestamp has invalid date format", async () => {
      const file = createMockFile();
      const content = makeFrontmatter({
        "ems__Effort_plannedStartTimestamp": "not-a-date",
      });
      mockVault.read.mockResolvedValue(content);

      await expect(service.shiftDayForward(file)).rejects.toThrow(
        "Invalid date format in ems__Effort_plannedStartTimestamp",
      );
    });

    it("should throw when frontmatter does not exist", async () => {
      const file = createMockFile();
      mockVault.read.mockResolvedValue("No frontmatter here");

      await expect(service.shiftDayForward(file)).rejects.toThrow(
        "ems__Effort_plannedStartTimestamp property not found",
      );
    });
  });

  describe("markAsReviewed", () => {
    it("should delegate to timestampService.addReviewTimestamp", async () => {
      const file = createMockFile();

      await service.markAsReviewed(file);

      expect(mockTimestampService.addReviewTimestamp).toHaveBeenCalledWith(file);
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
