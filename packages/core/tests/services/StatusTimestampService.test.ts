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

  describe("addReviewTimestamp", () => {
    it("should add lastReviewTimestamp to frontmatter", async () => {
      const originalContent = `---
title: My Task
ems__Effort_status: "[[ems__EffortStatusBacklog]]"
---

Task content.`;

      const expectedContent = `---
title: My Task
ems__Effort_status: "[[ems__EffortStatusBacklog]]"
ems__Effort_lastReviewTimestamp: ${mockTimestamp}
---

Task content.`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.addReviewTimestamp(mockFile);

      expect(mockVault.read).toHaveBeenCalledWith(mockFile);
      expect(mockVault.modify).toHaveBeenCalledWith(mockFile, expectedContent);
      expect(DateFormatter.toLocalTimestamp).toHaveBeenCalledWith(
        expect.any(Date),
      );
    });

    it("should update existing lastReviewTimestamp", async () => {
      const originalContent = `---
title: My Task
ems__Effort_lastReviewTimestamp: 2024-01-01T09:00:00
---

Task content.`;

      const expectedContent = `---
title: My Task
ems__Effort_lastReviewTimestamp: ${mockTimestamp}
---

Task content.`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.addReviewTimestamp(mockFile);

      expect(mockVault.modify).toHaveBeenCalledWith(mockFile, expectedContent);
    });

    it("should handle content without frontmatter", async () => {
      const originalContent = "Task content without frontmatter.";

      const expectedContent = `---
ems__Effort_lastReviewTimestamp: ${mockTimestamp}
---
Task content without frontmatter.`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.addReviewTimestamp(mockFile);

      expect(mockVault.modify).toHaveBeenCalledWith(mockFile, expectedContent);
    });

    it("should preserve other frontmatter properties", async () => {
      const originalContent = `---
exo__Asset_label: "My Project"
exo__Instance_class: "[[ems__Project]]"
ems__Effort_status: "[[ems__EffortStatusToDo]]"
---

Project description.`;

      const expectedContent = `---
exo__Asset_label: "My Project"
exo__Instance_class: "[[ems__Project]]"
ems__Effort_status: "[[ems__EffortStatusToDo]]"
ems__Effort_lastReviewTimestamp: ${mockTimestamp}
---

Project description.`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.addReviewTimestamp(mockFile);

      expect(mockVault.modify).toHaveBeenCalledWith(mockFile, expectedContent);
    });
  });

  describe("shiftPlannedEndTimestamp", () => {
    // Consolidated from the former StatusTimestampService.branch.test.ts.
    // shiftPlannedEndTimestamp was the only behavior unique to that file; its
    // add*/remove* tests duplicated (more weakly) the content-level assertions
    // already present above, so the .branch file was removed (zero coverage
    // loss). The positive/negative-delta tests below assert the shift itself,
    // not merely that modify was called.

    it("should shift planned end timestamp forward by a positive delta", async () => {
      mockVault.read.mockResolvedValue(
        '---\nems__Effort_plannedEndTimestamp: "2025-06-15T10:00:00"\n---\n',
      );

      await service.shiftPlannedEndTimestamp(mockFile, 3600000); // +1 hour

      // Verify the SHIFT math: the date handed to the formatter must equal
      // currentDate + delta (the formatter itself is mocked, so we assert its
      // input rather than the formatted output string).
      const expectedShifted = new Date(
        new Date("2025-06-15T10:00:00").getTime() + 3600000,
      );
      expect(DateFormatter.toLocalTimestamp).toHaveBeenCalledWith(
        expectedShifted,
      );
      expect(mockVault.modify).toHaveBeenCalledWith(
        mockFile,
        expect.stringContaining("ems__Effort_plannedEndTimestamp"),
      );
    });

    it("should shift planned end timestamp backward by a negative delta", async () => {
      mockVault.read.mockResolvedValue(
        '---\nems__Effort_plannedEndTimestamp: "2025-06-15T10:00:00"\n---\n',
      );

      await service.shiftPlannedEndTimestamp(mockFile, -3600000); // -1 hour

      const expectedShifted = new Date(
        new Date("2025-06-15T10:00:00").getTime() - 3600000,
      );
      expect(DateFormatter.toLocalTimestamp).toHaveBeenCalledWith(
        expectedShifted,
      );
      expect(mockVault.modify).toHaveBeenCalled();
    });

    it("should return early when frontmatter does not exist", async () => {
      mockVault.read.mockResolvedValue("No frontmatter here");

      await service.shiftPlannedEndTimestamp(mockFile, 3600000);

      expect(mockVault.modify).not.toHaveBeenCalled();
    });

    it("should return early when plannedEndTimestamp is not set", async () => {
      mockVault.read.mockResolvedValue("---\nexo__Asset_uid: abc\n---\n");

      await service.shiftPlannedEndTimestamp(mockFile, 3600000);

      expect(mockVault.modify).not.toHaveBeenCalled();
    });

    it("should return early when plannedEndTimestamp is an invalid date", async () => {
      mockVault.read.mockResolvedValue(
        '---\nems__Effort_plannedEndTimestamp: "not-a-date"\n---\n',
      );

      await service.shiftPlannedEndTimestamp(mockFile, 3600000);

      expect(mockVault.modify).not.toHaveBeenCalled();
    });

    it("should strip quotes before parsing the timestamp value", async () => {
      mockVault.read.mockResolvedValue(
        "---\nems__Effort_plannedEndTimestamp: '2025-06-15T10:00:00'\n---\n",
      );

      await service.shiftPlannedEndTimestamp(mockFile, 3600000);

      // If quotes were not stripped, new Date("'2025...'") would be invalid and
      // the method would return early — so a modify call proves quote-stripping.
      expect(mockVault.modify).toHaveBeenCalled();
    });
  });
});
