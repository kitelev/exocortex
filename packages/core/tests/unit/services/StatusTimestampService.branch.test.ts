import "reflect-metadata";
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { StatusTimestampService } from "../../../src/services/StatusTimestampService";
import type { IVaultAdapter, IFile } from "../../../src/interfaces/IVaultAdapter";

describe("StatusTimestampService - branch coverage", () => {
  let service: StatusTimestampService;
  let mockVault: jest.Mocked<IVaultAdapter>;
  let mockFile: IFile;

  beforeEach(() => {
    mockVault = {
      read: jest.fn<(file: IFile) => Promise<string>>(),
      modify: jest.fn<(file: IFile, content: string) => Promise<void>>(),
    } as unknown as jest.Mocked<IVaultAdapter>;

    mockFile = { path: "test.md" } as IFile;

    service = new (StatusTimestampService as any)(mockVault);
  });

  describe("shiftPlannedEndTimestamp", () => {
    it("should shift planned end timestamp by positive delta", async () => {
      mockVault.read.mockResolvedValue(
        '---\nems__Effort_plannedEndTimestamp: "2025-06-15T10:00:00"\n---\n',
      );

      await service.shiftPlannedEndTimestamp(mockFile, 3600000); // +1 hour

      expect(mockVault.modify).toHaveBeenCalled();
      const content = mockVault.modify.mock.calls[0][1];
      expect(content).toContain("ems__Effort_plannedEndTimestamp");
    });

    it("should shift planned end timestamp by negative delta", async () => {
      mockVault.read.mockResolvedValue(
        '---\nems__Effort_plannedEndTimestamp: "2025-06-15T10:00:00"\n---\n',
      );

      await service.shiftPlannedEndTimestamp(mockFile, -3600000); // -1 hour

      expect(mockVault.modify).toHaveBeenCalled();
    });

    it("should return early when frontmatter does not exist", async () => {
      mockVault.read.mockResolvedValue("No frontmatter here");

      await service.shiftPlannedEndTimestamp(mockFile, 3600000);

      expect(mockVault.modify).not.toHaveBeenCalled();
    });

    it("should return early when plannedEndTimestamp is not set", async () => {
      mockVault.read.mockResolvedValue(
        "---\nexo__Asset_uid: abc\n---\n",
      );

      await service.shiftPlannedEndTimestamp(mockFile, 3600000);

      expect(mockVault.modify).not.toHaveBeenCalled();
    });

    it("should return early when plannedEndTimestamp is invalid date", async () => {
      mockVault.read.mockResolvedValue(
        '---\nems__Effort_plannedEndTimestamp: "not-a-date"\n---\n',
      );

      await service.shiftPlannedEndTimestamp(mockFile, 3600000);

      expect(mockVault.modify).not.toHaveBeenCalled();
    });

    it("should handle quoted timestamp values", async () => {
      mockVault.read.mockResolvedValue(
        "---\nems__Effort_plannedEndTimestamp: '2025-06-15T10:00:00'\n---\n",
      );

      await service.shiftPlannedEndTimestamp(mockFile, 3600000);

      expect(mockVault.modify).toHaveBeenCalled();
    });
  });

  describe("addEndTimestamp", () => {
    it("should use current date when no date provided", async () => {
      mockVault.read.mockResolvedValue("---\nexo__Asset_uid: abc\n---\n");

      await service.addEndTimestamp(mockFile);

      expect(mockVault.modify).toHaveBeenCalled();
      const content = mockVault.modify.mock.calls[0][1];
      expect(content).toContain("ems__Effort_endTimestamp");
    });

    it("should use provided date", async () => {
      mockVault.read.mockResolvedValue("---\nexo__Asset_uid: abc\n---\n");
      const specificDate = new Date("2025-03-15T12:00:00");

      await service.addEndTimestamp(mockFile, specificDate);

      expect(mockVault.modify).toHaveBeenCalled();
      const content = mockVault.modify.mock.calls[0][1];
      expect(content).toContain("ems__Effort_endTimestamp");
    });
  });

  describe("addEndAndResolutionTimestamps", () => {
    it("should use current date when no date provided", async () => {
      mockVault.read.mockResolvedValue("---\nexo__Asset_uid: abc\n---\n");

      await service.addEndAndResolutionTimestamps(mockFile);

      expect(mockVault.modify).toHaveBeenCalled();
      const content = mockVault.modify.mock.calls[0][1];
      expect(content).toContain("ems__Effort_endTimestamp");
      expect(content).toContain("ems__Effort_resolutionTimestamp");
    });

    it("should use provided date", async () => {
      mockVault.read.mockResolvedValue("---\nexo__Asset_uid: abc\n---\n");
      const specificDate = new Date("2025-03-15T12:00:00");

      await service.addEndAndResolutionTimestamps(mockFile, specificDate);

      expect(mockVault.modify).toHaveBeenCalled();
    });
  });

  describe("addStartTimestamp", () => {
    it("should add start timestamp", async () => {
      mockVault.read.mockResolvedValue("---\nexo__Asset_uid: abc\n---\n");

      await service.addStartTimestamp(mockFile);

      expect(mockVault.modify).toHaveBeenCalled();
      const content = mockVault.modify.mock.calls[0][1];
      expect(content).toContain("ems__Effort_startTimestamp");
    });
  });

  describe("addResolutionTimestamp", () => {
    it("should add resolution timestamp", async () => {
      mockVault.read.mockResolvedValue("---\nexo__Asset_uid: abc\n---\n");

      await service.addResolutionTimestamp(mockFile);

      expect(mockVault.modify).toHaveBeenCalled();
      const content = mockVault.modify.mock.calls[0][1];
      expect(content).toContain("ems__Effort_resolutionTimestamp");
    });
  });

  describe("addReviewTimestamp", () => {
    it("should add review timestamp", async () => {
      mockVault.read.mockResolvedValue("---\nexo__Asset_uid: abc\n---\n");

      await service.addReviewTimestamp(mockFile);

      expect(mockVault.modify).toHaveBeenCalled();
      const content = mockVault.modify.mock.calls[0][1];
      expect(content).toContain("ems__Effort_lastReviewTimestamp");
    });
  });

  describe("remove timestamps", () => {
    it("should remove start timestamp", async () => {
      mockVault.read.mockResolvedValue(
        "---\nems__Effort_startTimestamp: 2025-01-01T00:00:00\n---\n",
      );

      await service.removeStartTimestamp(mockFile);

      expect(mockVault.modify).toHaveBeenCalled();
    });

    it("should remove end timestamp", async () => {
      mockVault.read.mockResolvedValue(
        "---\nems__Effort_endTimestamp: 2025-01-01T00:00:00\n---\n",
      );

      await service.removeEndTimestamp(mockFile);

      expect(mockVault.modify).toHaveBeenCalled();
    });

    it("should remove resolution timestamp", async () => {
      mockVault.read.mockResolvedValue(
        "---\nems__Effort_resolutionTimestamp: 2025-01-01T00:00:00\n---\n",
      );

      await service.removeResolutionTimestamp(mockFile);

      expect(mockVault.modify).toHaveBeenCalled();
    });

    it("should remove both end and resolution timestamps", async () => {
      mockVault.read.mockResolvedValue(
        "---\nems__Effort_endTimestamp: 2025-01-01T00:00:00\nems__Effort_resolutionTimestamp: 2025-01-01T00:00:00\n---\n",
      );

      await service.removeEndAndResolutionTimestamps(mockFile);

      expect(mockVault.modify).toHaveBeenCalled();
    });
  });
});
