import { AssetConversionService } from "exocortex";
import { IVaultAdapter, IFile } from "exocortex";
import { AssetClass } from "exocortex";

describe("AssetConversionService", () => {
  let service: AssetConversionService;
  let mockVaultAdapter: jest.Mocked<IVaultAdapter>;
  let mockFile: IFile;

  beforeEach(() => {
    mockVaultAdapter = {
      read: jest.fn(),
      modify: jest.fn(),
      create: jest.fn(),
      exists: jest.fn(),
      list: jest.fn(),
      listRecursive: jest.fn(),
      getFileByPath: jest.fn(),
      getModificationTime: jest.fn(),
    } as any;

    mockFile = {
      path: "test-task.md",
      basename: "test-task",
      parent: null,
    } as IFile;

    service = new AssetConversionService(mockVaultAdapter);
  });

  describe("convertTaskToProject", () => {
    it("should update Instance_class from Task to Project", async () => {
      const originalContent = `---
exo__Asset_uid: test-uid
exo__Asset_label: Test Task
exo__Instance_class:
  - "[[ems__Task]]"
ems__Effort_status: "[[ems__EffortStatusDraft]]"
---

Task content`;

      mockVaultAdapter.read.mockResolvedValue(originalContent);

      await service.convertTaskToProject(mockFile);

      expect(mockVaultAdapter.read).toHaveBeenCalledWith(mockFile);
      expect(mockVaultAdapter.modify).toHaveBeenCalledWith(
        mockFile,
        expect.stringContaining('exo__Instance_class: ["[[ems__Project]]"]'),
      );
      
      const modifiedContent = mockVaultAdapter.modify.mock.calls[0][1];
      expect(modifiedContent).toContain('exo__Asset_uid: test-uid');
      expect(modifiedContent).toContain('exo__Asset_label: Test Task');
      expect(modifiedContent).toContain('ems__Effort_status: "[[ems__EffortStatusDraft]]"');
      expect(modifiedContent).toContain('Task content');
    });

    it("should preserve all other metadata during conversion", async () => {
      const originalContent = `---
exo__Asset_uid: abc-123
exo__Asset_label: Important Task
exo__Asset_createdAt: "2024-01-15T10:30:00"
exo__Instance_class:
  - "[[ems__Task]]"
ems__Effort_status: "[[ems__EffortStatusDoing]]"
ems__Effort_day: "[[2024-01-15]]"
ems__Effort_votes: 5
aliases:
  - Task Alias
---

Content here`;

      mockVaultAdapter.read.mockResolvedValue(originalContent);

      await service.convertTaskToProject(mockFile);

      expect(mockVaultAdapter.modify).toHaveBeenCalled();
      const modifiedContent = mockVaultAdapter.modify.mock.calls[0][1];

      // Check that all original properties are preserved
      expect(modifiedContent).toContain('exo__Asset_uid: abc-123');
      expect(modifiedContent).toContain('exo__Asset_label: Important Task');
      expect(modifiedContent).toContain('exo__Asset_createdAt: "2024-01-15T10:30:00"');
      expect(modifiedContent).toContain('ems__Effort_status: "[[ems__EffortStatusDoing]]"');
      expect(modifiedContent).toContain('ems__Effort_day: "[[2024-01-15]]"');
      expect(modifiedContent).toContain('ems__Effort_votes: 5');
      expect(modifiedContent).toContain('Task Alias');
      expect(modifiedContent).toContain('Content here');

      // Check that class was changed
      expect(modifiedContent).toContain(`exo__Instance_class: ["[[${AssetClass.PROJECT}]]"]`);
      expect(modifiedContent).not.toContain(`"[[${AssetClass.TASK}]]"`);
    });

    it("should throw error if read fails", async () => {
      mockVaultAdapter.read.mockRejectedValue(new Error("Read failed"));

      await expect(service.convertTaskToProject(mockFile)).rejects.toThrow(
        "Failed to convert Task to Project",
      );
    });

    it("should throw error if modify fails", async () => {
      mockVaultAdapter.read.mockResolvedValue(`---
exo__Instance_class:
  - "[[ems__Task]]"
---`);
      mockVaultAdapter.modify.mockRejectedValue(new Error("Write failed"));

      await expect(service.convertTaskToProject(mockFile)).rejects.toThrow(
        "Failed to convert Task to Project",
      );
    });
  });

  describe("convertProjectToTask", () => {
    it("should update Instance_class from Project to Task", async () => {
      const originalContent = `---
exo__Asset_uid: test-uid
exo__Asset_label: Test Project
exo__Instance_class:
  - "[[ems__Project]]"
ems__Effort_status: "[[ems__EffortStatusDraft]]"
---

Project content`;

      mockVaultAdapter.read.mockResolvedValue(originalContent);

      await service.convertProjectToTask(mockFile);

      expect(mockVaultAdapter.read).toHaveBeenCalledWith(mockFile);
      expect(mockVaultAdapter.modify).toHaveBeenCalledWith(
        mockFile,
        expect.stringContaining('exo__Instance_class: ["[[ems__Task]]"]'),
      );
      
      const modifiedContent = mockVaultAdapter.modify.mock.calls[0][1];
      expect(modifiedContent).toContain('exo__Asset_uid: test-uid');
      expect(modifiedContent).toContain('exo__Asset_label: Test Project');
      expect(modifiedContent).toContain('ems__Effort_status: "[[ems__EffortStatusDraft]]"');
      expect(modifiedContent).toContain('Project content');
    });

    it("should preserve all other metadata during conversion", async () => {
      const originalContent = `---
exo__Asset_uid: xyz-789
exo__Asset_label: Big Project
exo__Asset_createdAt: "2024-02-20T14:45:00"
exo__Instance_class:
  - "[[ems__Project]]"
ems__Effort_status: "[[ems__EffortStatusToDo]]"
ems__Effort_area: "[[Area Name]]"
---

Project details`;

      mockVaultAdapter.read.mockResolvedValue(originalContent);

      await service.convertProjectToTask(mockFile);

      expect(mockVaultAdapter.modify).toHaveBeenCalled();
      const modifiedContent = mockVaultAdapter.modify.mock.calls[0][1];

      // Check that all original properties are preserved
      expect(modifiedContent).toContain('exo__Asset_uid: xyz-789');
      expect(modifiedContent).toContain('exo__Asset_label: Big Project');
      expect(modifiedContent).toContain('ems__Effort_area: "[[Area Name]]"');
      expect(modifiedContent).toContain('Project details');

      // Check that class was changed
      expect(modifiedContent).toContain(`exo__Instance_class: ["[[${AssetClass.TASK}]]"]`);
      expect(modifiedContent).not.toContain(`"[[${AssetClass.PROJECT}]]"`);
    });

    it("should throw error if read fails", async () => {
      mockVaultAdapter.read.mockRejectedValue(new Error("Read failed"));

      await expect(service.convertProjectToTask(mockFile)).rejects.toThrow(
        "Failed to convert Project to Task",
      );
    });

    it("should throw error if modify fails", async () => {
      mockVaultAdapter.read.mockResolvedValue(`---
exo__Instance_class:
  - "[[ems__Project]]"
---`);
      mockVaultAdapter.modify.mockRejectedValue(new Error("Write failed"));

      await expect(service.convertProjectToTask(mockFile)).rejects.toThrow(
        "Failed to convert Project to Task",
      );
    });
  });
});
