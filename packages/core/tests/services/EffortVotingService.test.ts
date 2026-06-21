import { EffortVotingService } from "../../src/services/EffortVotingService";
import { IVaultAdapter, IFile } from "../../src/interfaces/IVaultAdapter";

describe("EffortVotingService", () => {
  let service: EffortVotingService;
  let mockVault: jest.Mocked<IVaultAdapter>;
  let mockFile: IFile;

  beforeEach(() => {
    mockVault = {
      read: jest.fn(),
      modify: jest.fn(),
    } as any;

    mockFile = {
      path: "/folder/task.md",
      name: "task.md",
      basename: "task",
    } as IFile;

    service = new EffortVotingService(mockVault);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("incrementEffortVotes", () => {
    it("should increment votes from 0 when property doesn't exist", async () => {
      const originalContent = `---
title: My Task
---

Task content.`;

      const expectedContent = `---
title: My Task
ems__Effort_votes: 1
---

Task content.`;

      mockVault.read.mockResolvedValue(originalContent);

      const result = await service.incrementEffortVotes(mockFile);

      expect(result).toBe(1);
      expect(mockVault.read).toHaveBeenCalledWith(mockFile);
      expect(mockVault.modify).toHaveBeenCalledWith(mockFile, expectedContent);
    });

    it("should increment existing vote count", async () => {
      const originalContent = `---
title: My Task
ems__Effort_votes: 5
---

Content.`;

      const expectedContent = `---
title: My Task
ems__Effort_votes: 6
---

Content.`;

      mockVault.read.mockResolvedValue(originalContent);

      const result = await service.incrementEffortVotes(mockFile);

      expect(result).toBe(6);
      expect(mockVault.modify).toHaveBeenCalledWith(mockFile, expectedContent);
    });

    it("should create frontmatter when missing", async () => {
      const originalContent = "Content without frontmatter.";

      const expectedContent = `---
ems__Effort_votes: 1
---
Content without frontmatter.`;

      mockVault.read.mockResolvedValue(originalContent);

      const result = await service.incrementEffortVotes(mockFile);

      expect(result).toBe(1);
      expect(mockVault.modify).toHaveBeenCalledWith(mockFile, expectedContent);
    });

    it("should handle vote count with multiple digits", async () => {
      const originalContent = `---
ems__Effort_votes: 42
---

Content.`;

      mockVault.read.mockResolvedValue(originalContent);

      const result = await service.incrementEffortVotes(mockFile);

      expect(result).toBe(43);
    });

    it("should handle vote count at beginning of frontmatter", async () => {
      const originalContent = `---
ems__Effort_votes: 10
title: Task
---

Content.`;

      mockVault.read.mockResolvedValue(originalContent);

      const result = await service.incrementEffortVotes(mockFile);

      expect(result).toBe(11);
      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).toContain("ems__Effort_votes: 11");
    });

    it("should handle vote count at end of frontmatter", async () => {
      const originalContent = `---
title: Task
ems__Effort_votes: 3
---
Content.`;

      mockVault.read.mockResolvedValue(originalContent);

      const result = await service.incrementEffortVotes(mockFile);

      expect(result).toBe(4);
    });
  });

  describe("extractVoteCount", () => {
    it("should return 0 when property doesn't exist", async () => {
      const content = `---
title: Task
---

Content.`;

      mockVault.read.mockResolvedValue(content);

      const result = await service.incrementEffortVotes(mockFile);

      expect(result).toBe(1);
    });

    it("should return 0 when frontmatter missing", async () => {
      const content = "No frontmatter content.";

      mockVault.read.mockResolvedValue(content);

      const result = await service.incrementEffortVotes(mockFile);

      expect(result).toBe(1);
    });

    it("should extract vote count correctly", async () => {
      const content = `---
title: Task
ems__Effort_votes: 25
other: property
---

Content.`;

      mockVault.read.mockResolvedValue(content);

      const result = await service.incrementEffortVotes(mockFile);

      expect(result).toBe(26);
    });

    it("should handle vote count of zero", async () => {
      const content = `---
ems__Effort_votes: 0
---

Content.`;

      mockVault.read.mockResolvedValue(content);

      const result = await service.incrementEffortVotes(mockFile);

      expect(result).toBe(1);
    });
  });

  describe("updateFrontmatterWithVotes", () => {
    it("should add votes property to existing frontmatter", async () => {
      const originalContent = `---
title: Task
exo__Asset_uid: task-123
---

Content.`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.incrementEffortVotes(mockFile);

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).toContain("ems__Effort_votes: 1");
      expect(modifiedContent).toContain("title: Task");
      expect(modifiedContent).toContain("exo__Asset_uid: task-123");
    });

    it("should update existing votes property", async () => {
      const originalContent = `---
title: Task
ems__Effort_votes: 10
status: active
---

Content.`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.incrementEffortVotes(mockFile);

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).toContain("ems__Effort_votes: 11");
      expect(modifiedContent).not.toContain("ems__Effort_votes: 10");
    });

    it("should handle vote property with spaces", async () => {
      const originalContent = `---
ems__Effort_votes:    5
---

Content.`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.incrementEffortVotes(mockFile);

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).toContain("ems__Effort_votes: 6");
    });
  });

  describe("line ending handling", () => {
    it("should preserve Unix line endings (\\n)", async () => {
      const originalContent = "---\ntitle: Task\nems__Effort_votes: 5\n---\n\nContent.";

      mockVault.read.mockResolvedValue(originalContent);

      await service.incrementEffortVotes(mockFile);

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).toContain("\n");
      expect(modifiedContent).not.toContain("\r\n");
    });

    it("should preserve Windows line endings (\\r\\n)", async () => {
      const originalContent = "---\r\ntitle: Task\r\nems__Effort_votes: 5\r\n---\r\n\r\nContent.";

      mockVault.read.mockResolvedValue(originalContent);

      await service.incrementEffortVotes(mockFile);

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).toContain("\r\n");
    });

    it("should use Unix line endings when creating new frontmatter", async () => {
      const originalContent = "Content without frontmatter.";

      mockVault.read.mockResolvedValue(originalContent);

      await service.incrementEffortVotes(mockFile);

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).toContain("---\nems__Effort_votes: 1\n---\n");
    });

    it("should use Windows line endings when creating new frontmatter from Windows file", async () => {
      const originalContent = "Content\r\nwith\r\nWindows\r\nline endings.";

      mockVault.read.mockResolvedValue(originalContent);

      await service.incrementEffortVotes(mockFile);

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).toContain("\r\n");
    });
  });

  describe("edge cases", () => {
    it("should handle empty frontmatter", async () => {
      const originalContent = `---
---

Content.`;

      mockVault.read.mockResolvedValue(originalContent);

      const result = await service.incrementEffortVotes(mockFile);

      expect(result).toBe(1);
    });

    it("should handle frontmatter with only votes property", async () => {
      const originalContent = `---
ems__Effort_votes: 99
---

Content.`;

      mockVault.read.mockResolvedValue(originalContent);

      const result = await service.incrementEffortVotes(mockFile);

      expect(result).toBe(100);
    });

    it("should handle very large vote counts", async () => {
      const originalContent = `---
ems__Effort_votes: 9999
---

Content.`;

      mockVault.read.mockResolvedValue(originalContent);

      const result = await service.incrementEffortVotes(mockFile);

      expect(result).toBe(10000);
    });
  });
});
