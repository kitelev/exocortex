import { EffortVotingService } from "exocortex";
import { TFile, Vault } from "obsidian";

describe("EffortVotingService", () => {
  let service: EffortVotingService;
  let mockVault: jest.Mocked<Vault>;

  beforeEach(() => {
    mockVault = {
      read: jest.fn(),
      modify: jest.fn(),
    } as unknown as jest.Mocked<Vault>;

    service = new EffortVotingService(mockVault);
  });

  describe("incrementEffortVotes", () => {
    it("should create ems__Effort_votes property with value 1 when file has no frontmatter", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = "Task content";

      mockVault.read.mockResolvedValue(originalContent);

      const voteCount = await service.incrementEffortVotes(mockFile);

      expect(voteCount).toBe(1);
      expect(mockVault.modify).toHaveBeenCalledWith(
        mockFile,
        expect.stringContaining("ems__Effort_votes: 1"),
      );
      expect(mockVault.modify).toHaveBeenCalledWith(
        mockFile,
        expect.stringContaining("Task content"),
      );
    });

    it("should create ems__Effort_votes property with value 1 when property doesn't exist", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class: "[[ems__Task]]"
ems__Effort_status: "[[ems__EffortStatusBacklog]]"
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      const voteCount = await service.incrementEffortVotes(mockFile);

      expect(voteCount).toBe(1);
      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain("ems__Effort_votes: 1");
      expect(modifiedContent).toContain('exo__Instance_class: "[[ems__Task]]"');
      expect(modifiedContent).toContain("Task content");
    });

    it("should increment existing ems__Effort_votes from 0 to 1", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class: "[[ems__Task]]"
ems__Effort_votes: 0
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      const voteCount = await service.incrementEffortVotes(mockFile);

      expect(voteCount).toBe(1);
      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain("ems__Effort_votes: 1");
      expect(modifiedContent).not.toContain("ems__Effort_votes: 0");
    });

    it("should increment existing ems__Effort_votes from 1 to 2", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class: "[[ems__Task]]"
ems__Effort_votes: 1
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      const voteCount = await service.incrementEffortVotes(mockFile);

      expect(voteCount).toBe(2);
      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain("ems__Effort_votes: 2");
      expect(modifiedContent).not.toContain("ems__Effort_votes: 1");
    });

    it("should increment existing ems__Effort_votes from 5 to 6", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class: "[[ems__Task]]"
ems__Effort_votes: 5
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      const voteCount = await service.incrementEffortVotes(mockFile);

      expect(voteCount).toBe(6);
      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain("ems__Effort_votes: 6");
    });

    it("should handle large vote counts", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class: "[[ems__Task]]"
ems__Effort_votes: 999
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      const voteCount = await service.incrementEffortVotes(mockFile);

      expect(voteCount).toBe(1000);
      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain("ems__Effort_votes: 1000");
    });

    it("should preserve other frontmatter properties when adding votes", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class: "[[ems__Task]]"
exo__Asset_uid: task-123
ems__Effort_status: "[[ems__EffortStatusBacklog]]"
ems__Effort_day: "[[2025-10-20]]"
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.incrementEffortVotes(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain('exo__Instance_class: "[[ems__Task]]"');
      expect(modifiedContent).toContain("exo__Asset_uid: task-123");
      expect(modifiedContent).toContain(
        'ems__Effort_status: "[[ems__EffortStatusBacklog]]"',
      );
      expect(modifiedContent).toContain('ems__Effort_day: "[[2025-10-20]]"');
      expect(modifiedContent).toContain("ems__Effort_votes: 1");
    });

    it("should preserve other frontmatter properties when incrementing votes", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class: "[[ems__Task]]"
exo__Asset_uid: task-123
ems__Effort_status: "[[ems__EffortStatusBacklog]]"
ems__Effort_votes: 3
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.incrementEffortVotes(mockFile);

      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain('exo__Instance_class: "[[ems__Task]]"');
      expect(modifiedContent).toContain("exo__Asset_uid: task-123");
      expect(modifiedContent).toContain(
        'ems__Effort_status: "[[ems__EffortStatusBacklog]]"',
      );
      expect(modifiedContent).toContain("ems__Effort_votes: 4");
    });

    it("should preserve markdown content after frontmatter", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class: "[[ems__Task]]"
ems__Effort_votes: 2
---
# Task Title

Task description with **bold** and *italic* text.

- List item 1
- List item 2

## Section

More content here.`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.incrementEffortVotes(mockFile);

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
ems__Effort_status: "[[ems__EffortStatusToDo]]"
---
Project content`;

      mockVault.read.mockResolvedValue(originalContent);

      const voteCount = await service.incrementEffortVotes(mockFile);

      expect(voteCount).toBe(1);
      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain("ems__Effort_votes: 1");
      expect(modifiedContent).toContain(
        'exo__Instance_class: "[[ems__Project]]"',
      );
    });

    it("should handle files with Windows line endings", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---\r\nexo__Instance_class: "[[ems__Task]]"\r\nems__Effort_votes: 1\r\n---\r\nTask content`;

      mockVault.read.mockResolvedValue(originalContent);

      const voteCount = await service.incrementEffortVotes(mockFile);

      expect(voteCount).toBe(2);
      expect(mockVault.modify).toHaveBeenCalled();
    });

    it("should handle multiline property values", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class: "[[ems__Task]]"
exo__Asset_description: |
  This is a multiline
  description
ems__Effort_votes: 1
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      const voteCount = await service.incrementEffortVotes(mockFile);

      expect(voteCount).toBe(2);
      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain("ems__Effort_votes: 2");
      expect(modifiedContent).toContain("This is a multiline");
      expect(modifiedContent).toContain("description");
    });
  });

  describe("extractVoteCount", () => {
    it("should return 0 when file has no frontmatter", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = "Task content";

      mockVault.read.mockResolvedValue(originalContent);

      const voteCount = await service.incrementEffortVotes(mockFile);

      // First vote should be 1 (0 + 1)
      expect(voteCount).toBe(1);
    });

    it("should return 0 when ems__Effort_votes property doesn't exist", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class: "[[ems__Task]]"
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      const voteCount = await service.incrementEffortVotes(mockFile);

      // First vote should be 1 (0 + 1)
      expect(voteCount).toBe(1);
    });
  });

  describe("edge cases", () => {
    it("should handle empty file", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = "";

      mockVault.read.mockResolvedValue(originalContent);

      const voteCount = await service.incrementEffortVotes(mockFile);

      expect(voteCount).toBe(1);
      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain("---");
      expect(modifiedContent).toContain("ems__Effort_votes: 1");
    });

    it("should handle frontmatter with only dashes", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      const voteCount = await service.incrementEffortVotes(mockFile);

      expect(voteCount).toBe(1);
      const modifiedContent = (mockVault.modify as jest.Mock).mock.calls[0][1];
      expect(modifiedContent).toContain("ems__Effort_votes: 1");
    });

    it("should handle votes property with spaces around colon", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class: "[[ems__Task]]"
ems__Effort_votes:    5
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      const voteCount = await service.incrementEffortVotes(mockFile);

      expect(voteCount).toBe(6);
    });

    it("should treat invalid vote count as 0", async () => {
      const mockFile = { path: "test-task.md" } as TFile;
      const originalContent = `---
exo__Instance_class: "[[ems__Task]]"
ems__Effort_votes: invalid
---
Task content`;

      mockVault.read.mockResolvedValue(originalContent);

      const voteCount = await service.incrementEffortVotes(mockFile);

      // Should treat NaN as 0, so 0 + 1 = 1
      expect(voteCount).toBe(1);
    });
  });
});
