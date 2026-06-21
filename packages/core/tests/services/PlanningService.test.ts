import { PlanningService } from "../../src/services/PlanningService";
import { IVaultAdapter, IFile } from "../../src/interfaces/IVaultAdapter";
import { DateFormatter } from "../../src/utilities/DateFormatter";

jest.mock("../../src/utilities/DateFormatter");

describe("PlanningService", () => {
  let service: PlanningService;
  let mockVault: jest.Mocked<IVaultAdapter>;
  let mockFile: IFile;

  const mockTodayTimestamp = "2025-01-15T00:00:00";

  beforeEach(() => {
    mockVault = {
      getAbstractFileByPath: jest.fn(),
      read: jest.fn(),
      modify: jest.fn(),
    } as any;

    mockFile = {
      path: "/path/to/task.md",
      name: "task.md",
      basename: "task",
    } as IFile;

    (DateFormatter.getTodayStartTimestamp as jest.Mock).mockReturnValue(mockTodayTimestamp);

    service = new PlanningService(mockVault);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("planOnToday", () => {
    it("should plan task on today", async () => {
      const taskPath = "/path/to/task.md";
      const originalContent = `---
title: My Task
---

Task content.`;

      const expectedContent = `---
title: My Task
ems__Effort_plannedStartTimestamp: ${mockTodayTimestamp}
---

Task content.`;

      mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockVault.read.mockResolvedValue(originalContent);

      await service.planOnToday(taskPath);

      expect(mockVault.getAbstractFileByPath).toHaveBeenCalledWith(taskPath);
      expect(mockVault.read).toHaveBeenCalledWith(mockFile);
      expect(mockVault.modify).toHaveBeenCalledWith(mockFile, expectedContent);
      expect(DateFormatter.getTodayStartTimestamp).toHaveBeenCalled();
    });

    it("should throw error when file not found", async () => {
      const taskPath = "/nonexistent/task.md";
      mockVault.getAbstractFileByPath.mockReturnValue(null);

      await expect(service.planOnToday(taskPath)).rejects.toThrow(
        `File not found: ${taskPath}`,
      );

      expect(mockVault.getAbstractFileByPath).toHaveBeenCalledWith(taskPath);
      expect(mockVault.read).not.toHaveBeenCalled();
      expect(mockVault.modify).not.toHaveBeenCalled();
    });

    it("should throw error when path points to folder", async () => {
      const taskPath = "/path/to/folder";
      const mockFolder = {
        path: taskPath,
        name: "folder",
      };

      mockVault.getAbstractFileByPath.mockReturnValue(mockFolder as any);

      await expect(service.planOnToday(taskPath)).rejects.toThrow(
        `File not found: ${taskPath}`,
      );

      expect(mockVault.read).not.toHaveBeenCalled();
      expect(mockVault.modify).not.toHaveBeenCalled();
    });

    it("should update existing ems__Effort_plannedStartTimestamp property", async () => {
      const taskPath = "/path/to/task.md";
      const originalContent = `---
title: My Task
ems__Effort_plannedStartTimestamp: 2025-01-10T00:00:00
---

Task content.`;

      const expectedContent = `---
title: My Task
ems__Effort_plannedStartTimestamp: ${mockTodayTimestamp}
---

Task content.`;

      mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockVault.read.mockResolvedValue(originalContent);

      await service.planOnToday(taskPath);

      expect(mockVault.modify).toHaveBeenCalledWith(mockFile, expectedContent);
    });

    it("should handle empty frontmatter", async () => {
      const taskPath = "/path/to/task.md";
      const originalContent = "Task content without frontmatter.";

      const expectedContent = `---
ems__Effort_plannedStartTimestamp: ${mockTodayTimestamp}
---
Task content without frontmatter.`;

      mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockVault.read.mockResolvedValue(originalContent);

      await service.planOnToday(taskPath);

      expect(mockVault.modify).toHaveBeenCalledWith(mockFile, expectedContent);
    });

    it("should handle file with existing frontmatter properties", async () => {
      const taskPath = "/path/to/task.md";
      const originalContent = `---
title: My Task
exo__Asset_uid: task-123
exo__Asset_assetClass: ems__Task
ems__Effort_status: ToDo
---

Task content.`;

      mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockVault.read.mockResolvedValue(originalContent);

      await service.planOnToday(taskPath);

      expect(mockVault.modify).toHaveBeenCalled();
      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).toContain(`ems__Effort_plannedStartTimestamp: ${mockTodayTimestamp}`);
      expect(modifiedContent).toContain("title: My Task");
      expect(modifiedContent).toContain("exo__Asset_uid: task-123");
    });
  });
});
