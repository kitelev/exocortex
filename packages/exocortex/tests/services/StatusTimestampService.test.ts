import { StatusTimestampService } from "../../src/services/StatusTimestampService";
import { IVaultAdapter, IFile } from "../../src/interfaces/IVaultAdapter";
import { DateFormatter } from "../../src/utilities/DateFormatter";

jest.mock("../../src/utilities/DateFormatter");

describe("StatusTimestampService", () => {
  let service: StatusTimestampService;
  let mockVault: jest.Mocked<IVaultAdapter>;
  let mockFile: IFile;

  const mockTimestamp = "2025-01-15T10:30:00+10:00";

  beforeEach(() => {
    mockVault = {
      read: jest.fn(),
      modify: jest.fn(),
    } as any;

    mockFile = {
      path: "/path/to/task.md",
      name: "task.md",
    } as IFile;

    (DateFormatter.toLocalTimestamp as jest.Mock).mockReturnValue(
      mockTimestamp,
    );

    service = new StatusTimestampService(mockVault);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("addStartTimestamp", () => {
    it("should add start timestamp to frontmatter", async () => {
      const originalContent = `---
title: My Task
---

Task content here.`;

      const expectedContent = `---
title: My Task
ems__Effort_startTimestamp: ${mockTimestamp}
---

Task content here.`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.addStartTimestamp(mockFile);

      expect(mockVault.read).toHaveBeenCalledWith(mockFile);
      expect(mockVault.modify).toHaveBeenCalledWith(mockFile, expectedContent);
      expect(DateFormatter.toLocalTimestamp).toHaveBeenCalledWith(
        expect.any(Date),
      );
    });

    it("should handle content without frontmatter", async () => {
      const originalContent = "Task content without frontmatter.";

      const expectedContent = `---
ems__Effort_startTimestamp: ${mockTimestamp}
---
Task content without frontmatter.`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.addStartTimestamp(mockFile);

      expect(mockVault.modify).toHaveBeenCalledWith(mockFile, expectedContent);
    });
  });

  describe("addEndTimestamp", () => {
    it("should add end timestamp with current date", async () => {
      const originalContent = `---
title: My Task
ems__Effort_startTimestamp: 2025-01-15T09:00:00+10:00
---

Task content.`;

      const expectedContent = `---
title: My Task
ems__Effort_startTimestamp: 2025-01-15T09:00:00+10:00
ems__Effort_endTimestamp: ${mockTimestamp}
---

Task content.`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.addEndTimestamp(mockFile);

      expect(mockVault.modify).toHaveBeenCalledWith(mockFile, expectedContent);
      expect(DateFormatter.toLocalTimestamp).toHaveBeenCalledWith(
        expect.any(Date),
      );
    });

    it("should add end timestamp with provided date", async () => {
      const providedDate = new Date("2025-01-20T15:45:00");
      const originalContent = `---
title: My Task
---

Content.`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.addEndTimestamp(mockFile, providedDate);

      expect(DateFormatter.toLocalTimestamp).toHaveBeenCalledWith(providedDate);
    });
  });

  describe("addResolutionTimestamp", () => {
    it("should add resolution timestamp to frontmatter", async () => {
      const originalContent = `---
title: My Task
ems__Effort_startTimestamp: 2025-01-15T09:00:00+10:00
ems__Effort_endTimestamp: 2025-01-15T10:00:00+10:00
---

Task content.`;

      const expectedContent = `---
title: My Task
ems__Effort_startTimestamp: 2025-01-15T09:00:00+10:00
ems__Effort_endTimestamp: 2025-01-15T10:00:00+10:00
ems__Effort_resolutionTimestamp: ${mockTimestamp}
---

Task content.`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.addResolutionTimestamp(mockFile);

      expect(mockVault.modify).toHaveBeenCalledWith(mockFile, expectedContent);
    });

    it("should add resolution timestamp to empty frontmatter", async () => {
      const originalContent = "No frontmatter.";

      const expectedContent = `---
ems__Effort_resolutionTimestamp: ${mockTimestamp}
---
No frontmatter.`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.addResolutionTimestamp(mockFile);

      expect(mockVault.modify).toHaveBeenCalledWith(mockFile, expectedContent);
    });
  });

  describe("addEndAndResolutionTimestamps", () => {
    it("should add both end and resolution timestamps", async () => {
      const originalContent = `---
title: My Task
ems__Effort_startTimestamp: 2025-01-15T09:00:00+10:00
---

Task content.`;

      const expectedContent = `---
title: My Task
ems__Effort_startTimestamp: 2025-01-15T09:00:00+10:00
ems__Effort_endTimestamp: ${mockTimestamp}
ems__Effort_resolutionTimestamp: ${mockTimestamp}
---

Task content.`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.addEndAndResolutionTimestamps(mockFile);

      expect(mockVault.modify).toHaveBeenCalledWith(mockFile, expectedContent);
      expect(DateFormatter.toLocalTimestamp).toHaveBeenCalledTimes(1);
    });

    it("should use provided date for both timestamps", async () => {
      const providedDate = new Date("2025-01-20T15:45:00");
      const originalContent = `---
title: My Task
---

Content.`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.addEndAndResolutionTimestamps(mockFile, providedDate);

      expect(DateFormatter.toLocalTimestamp).toHaveBeenCalledWith(providedDate);
      expect(DateFormatter.toLocalTimestamp).toHaveBeenCalledTimes(1);
    });

    it("should handle empty frontmatter", async () => {
      const originalContent = "Task without frontmatter.";

      const expectedContent = `---
ems__Effort_endTimestamp: ${mockTimestamp}
ems__Effort_resolutionTimestamp: ${mockTimestamp}
---
Task without frontmatter.`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.addEndAndResolutionTimestamps(mockFile);

      expect(mockVault.modify).toHaveBeenCalledWith(mockFile, expectedContent);
    });
  });

  describe("removeStartTimestamp", () => {
    it("should remove start timestamp from frontmatter", async () => {
      const originalContent = `---
title: My Task
ems__Effort_startTimestamp: 2025-01-15T09:00:00+10:00
ems__Effort_endTimestamp: 2025-01-15T10:00:00+10:00
---

Task content.`;

      const expectedContent = `---
title: My Task
ems__Effort_endTimestamp: 2025-01-15T10:00:00+10:00
---

Task content.`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.removeStartTimestamp(mockFile);

      expect(mockVault.modify).toHaveBeenCalledWith(mockFile, expectedContent);
    });

    it("should handle missing start timestamp gracefully", async () => {
      const originalContent = `---
title: My Task
ems__Effort_endTimestamp: 2025-01-15T10:00:00+10:00
---

Task content.`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.removeStartTimestamp(mockFile);

      expect(mockVault.modify).toHaveBeenCalled();
    });
  });

  describe("removeEndTimestamp", () => {
    it("should remove end timestamp from frontmatter", async () => {
      const originalContent = `---
title: My Task
ems__Effort_startTimestamp: 2025-01-15T09:00:00+10:00
ems__Effort_endTimestamp: 2025-01-15T10:00:00+10:00
ems__Effort_resolutionTimestamp: 2025-01-15T10:30:00+10:00
---

Task content.`;

      const expectedContent = `---
title: My Task
ems__Effort_startTimestamp: 2025-01-15T09:00:00+10:00
ems__Effort_resolutionTimestamp: 2025-01-15T10:30:00+10:00
---

Task content.`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.removeEndTimestamp(mockFile);

      expect(mockVault.modify).toHaveBeenCalledWith(mockFile, expectedContent);
    });
  });

  describe("removeResolutionTimestamp", () => {
    it("should remove resolution timestamp from frontmatter", async () => {
      const originalContent = `---
title: My Task
ems__Effort_startTimestamp: 2025-01-15T09:00:00+10:00
ems__Effort_endTimestamp: 2025-01-15T10:00:00+10:00
ems__Effort_resolutionTimestamp: 2025-01-15T10:30:00+10:00
---

Task content.`;

      const expectedContent = `---
title: My Task
ems__Effort_startTimestamp: 2025-01-15T09:00:00+10:00
ems__Effort_endTimestamp: 2025-01-15T10:00:00+10:00
---

Task content.`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.removeResolutionTimestamp(mockFile);

      expect(mockVault.modify).toHaveBeenCalledWith(mockFile, expectedContent);
    });

    it("should handle content without resolution timestamp", async () => {
      const originalContent = `---
title: My Task
ems__Effort_startTimestamp: 2025-01-15T09:00:00+10:00
---

Task content.`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.removeResolutionTimestamp(mockFile);

      expect(mockVault.modify).toHaveBeenCalled();
    });
  });

  describe("removeEndAndResolutionTimestamps", () => {
    it("should remove both end and resolution timestamps", async () => {
      const originalContent = `---
title: My Task
ems__Effort_startTimestamp: 2025-01-15T09:00:00+10:00
ems__Effort_endTimestamp: 2025-01-15T10:00:00+10:00
ems__Effort_resolutionTimestamp: 2025-01-15T10:30:00+10:00
---

Task content.`;

      const expectedContent = `---
title: My Task
ems__Effort_startTimestamp: 2025-01-15T09:00:00+10:00
---

Task content.`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.removeEndAndResolutionTimestamps(mockFile);

      expect(mockVault.modify).toHaveBeenCalledWith(mockFile, expectedContent);
    });

    it("should handle partial timestamp presence", async () => {
      const originalContent = `---
title: My Task
ems__Effort_endTimestamp: 2025-01-15T10:00:00+10:00
---

Task content.`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.removeEndAndResolutionTimestamps(mockFile);

      expect(mockVault.modify).toHaveBeenCalled();
    });

    it("should handle empty frontmatter", async () => {
      const originalContent = "Task without frontmatter.";

      mockVault.read.mockResolvedValue(originalContent);

      await service.removeEndAndResolutionTimestamps(mockFile);

      expect(mockVault.modify).toHaveBeenCalled();
    });
  });
});
