import { LabelToAliasService } from "exocortex";
import { TFile, Vault } from "obsidian";

describe("LabelToAliasService", () => {
  let service: LabelToAliasService;
  let mockVault: jest.Mocked<Vault>;

  beforeEach(() => {
    mockVault = {
      read: jest.fn(),
      modify: jest.fn(),
    } as unknown as jest.Mocked<Vault>;

    service = new LabelToAliasService(mockVault);
  });

  describe("copyLabelToAliases", () => {
    it("should throw error when file has no frontmatter", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = "Task content";

      mockVault.read.mockResolvedValue(originalContent);

      await expect(service.copyLabelToAliases(mockFile)).rejects.toThrow(
        "No exo__Asset_label found in file",
      );
    });

    it("should create aliases array when property doesn't exist", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class: "[[ems__Task]]"
exo__Asset_label: "My Task Label"
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.copyLabelToAliases(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain("aliases:");
      expect(modifiedContent).toContain('  - "My Task Label"');
      expect(modifiedContent).toContain('exo__Instance_class: "[[ems__Task]]"');
      expect(modifiedContent).toContain("Task content");
    });

    it("should add label to existing aliases array", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class: "[[ems__Task]]"
exo__Asset_label: "My Task Label"
aliases:
  - "Existing Alias"
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.copyLabelToAliases(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain('  - "Existing Alias"');
      expect(modifiedContent).toContain('  - "My Task Label"');
    });

    it("should preserve other frontmatter properties", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class: "[[ems__Task]]"
exo__Asset_uid: task-123
exo__Asset_label: "Important Task"
ems__Effort_status: "[[ems__EffortStatusBacklog]]"
ems__Effort_day: "[[2025-10-20]]"
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.copyLabelToAliases(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain('exo__Instance_class: "[[ems__Task]]"');
      expect(modifiedContent).toContain("exo__Asset_uid: task-123");
      expect(modifiedContent).toContain('exo__Asset_label: "Important Task"');
      expect(modifiedContent).toContain(
        'ems__Effort_status: "[[ems__EffortStatusBacklog]]"',
      );
      expect(modifiedContent).toContain('ems__Effort_day: "[[2025-10-20]]"');
      expect(modifiedContent).toContain('  - "Important Task"');
    });

    it("should preserve markdown content after frontmatter", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class: "[[ems__Task]]"
exo__Asset_label: "My Task"
---
# Task Title

Task description with **bold** and *italic* text.

- List item 1
- List item 2

## Section

More content here.`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.copyLabelToAliases(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain("# Task Title");
      expect(modifiedContent).toContain(
        "Task description with **bold** and *italic* text.",
      );
      expect(modifiedContent).toContain("- List item 1");
      expect(modifiedContent).toContain("- List item 2");
      expect(modifiedContent).toContain("## Section");
      expect(modifiedContent).toContain("More content here.");
    });

    it("should work for Project assets", async () => {
      const mockFile = { path: "test-project.md" } as TFile;
      const originalContent = `---
exo__Instance_class: "[[ems__Project]]"
exo__Asset_label: "Project Alpha"
ems__Effort_status: "[[ems__EffortStatusToDo]]"
---
Project content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.copyLabelToAliases(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain('  - "Project Alpha"');
      expect(modifiedContent).toContain(
        'exo__Instance_class: "[[ems__Project]]"',
      );
    });

    it("should handle files with Windows line endings", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---\r\nexo__Instance_class: "[[ems__Task]]"\r\nexo__Asset_label: "My Task"\r\n---\r\nTask content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.copyLabelToAliases(mockFile);

      expect(mockVault.modify).toHaveBeenCalled();
    });

    it("should handle label with quotes in it", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class: "[[ems__Task]]"
exo__Asset_label: Task with "quotes"
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.copyLabelToAliases(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain('Task with "quotes"');
    });

    it("should throw error when no label exists", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class: "[[ems__Task]]"
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      await expect(service.copyLabelToAliases(mockFile)).rejects.toThrow(
        "No exo__Asset_label found in file",
      );
    });

    it("should handle label with special characters", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class: "[[ems__Task]]"
exo__Asset_label: "Task: Review & Update (2025)"
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.copyLabelToAliases(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain('  - "Task: Review & Update (2025)"');
    });

    it("should handle multiline property values", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class: "[[ems__Task]]"
exo__Asset_description: |
  This is a multiline
  description
exo__Asset_label: "My Task"
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.copyLabelToAliases(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain('  - "My Task"');
      expect(modifiedContent).toContain("This is a multiline");
      expect(modifiedContent).toContain("description");
    });
  });

  describe("edge cases", () => {
    it("should handle empty frontmatter", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      await expect(service.copyLabelToAliases(mockFile)).rejects.toThrow(
        "No exo__Asset_label found in file",
      );
    });

    it("should handle label without quotes", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class: "[[ems__Task]]"
exo__Asset_label: Simple Task Label
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.copyLabelToAliases(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain('  - "Simple Task Label"');
    });

    it("should trim whitespace from label", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class: "[[ems__Task]]"
exo__Asset_label: "  Padded Label  "
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.copyLabelToAliases(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain('  - "Padded Label"');
    });

    it("should handle label with single quotes", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class: "[[ems__Task]]"
exo__Asset_label: 'Task Label'
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.copyLabelToAliases(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain('  - "Task Label"');
    });
  });
});
