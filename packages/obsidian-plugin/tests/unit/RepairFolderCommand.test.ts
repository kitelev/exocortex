import { flushPromises } from "./helpers/testHelpers";
import { RepairFolderCommand } from "../../src/application/commands/RepairFolderCommand";
import { App, TFile, Notice } from "obsidian";
import { FolderRepairService, LoggingService } from "exocortex";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Notice: jest.fn(),
}));
jest.mock("exocortex", () => ({
  ...jest.requireActual("exocortex"),
  LoggingService: {
    error: jest.fn(),
  },
}));

describe("RepairFolderCommand", () => {
  let command: RepairFolderCommand;
  let mockNotifier: any;
  let mockApp: jest.Mocked<App>;
  let mockFolderRepairService: jest.Mocked<FolderRepairService>;
  let mockFile: jest.Mocked<TFile>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockApp = {
      metadataCache: {
        getFileCache: jest.fn(),
      },
    } as unknown as jest.Mocked<App>;

    mockFolderRepairService = {
      getExpectedFolder: jest.fn(),
      getExpectedFolderSync: jest.fn(),
      repairFolder: jest.fn(),
    } as unknown as jest.Mocked<FolderRepairService>;

    mockFile = {
      path: "current/folder/test-file.md",
      basename: "test-file",
      parent: {
        path: "current/folder",
      },
    } as jest.Mocked<TFile>;

    mockNotifier = { info: jest.fn(), success: jest.fn(), error: jest.fn(), warn: jest.fn(), confirm: jest.fn() };
    command = new RepairFolderCommand(mockApp, mockFolderRepairService, mockNotifier);
  });

  describe("id and name", () => {
    it("should have correct id and name", () => {
      expect(command.id).toBe("repair-folder");
      expect(command.name).toBe("Repair folder");
    });
  });

  describe("checkCallback — visibility (gated on wrong folder)", () => {
    it("should return false when metadata has no exo__Asset_isDefinedBy", () => {
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
        frontmatter: { otherProp: "value" },
      });

      const result = command.checkCallback(true, mockFile);
      expect(result).toBe(false);
      expect(mockFolderRepairService.getExpectedFolderSync).not.toHaveBeenCalled();
    });

    it("should return false when cache is null", () => {
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue(null);

      const result = command.checkCallback(true, mockFile);
      expect(result).toBe(false);
      expect(mockFolderRepairService.getExpectedFolderSync).not.toHaveBeenCalled();
    });

    it("should return false when frontmatter is missing", () => {
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({});

      const result = command.checkCallback(true, mockFile);
      expect(result).toBe(false);
      expect(mockFolderRepairService.getExpectedFolderSync).not.toHaveBeenCalled();
    });

    it("should return false when expected folder cannot be determined (null)", () => {
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
        frontmatter: { exo__Asset_isDefinedBy: "Asset" },
      });
      mockFolderRepairService.getExpectedFolderSync.mockReturnValue(null);

      const result = command.checkCallback(true, mockFile);
      expect(result).toBe(false);
      expect(mockFolderRepairService.getExpectedFolderSync).toHaveBeenCalledWith(
        mockFile,
        { exo__Asset_isDefinedBy: "Asset" },
      );
    });

    it("should return false when asset is already in the correct folder", () => {
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
        frontmatter: { exo__Asset_isDefinedBy: "Asset" },
      });
      mockFolderRepairService.getExpectedFolderSync.mockReturnValue("current/folder");

      const result = command.checkCallback(true, mockFile);
      expect(result).toBe(false);
    });

    it("should return false when correct folder differs only by trailing slash", () => {
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
        frontmatter: { exo__Asset_isDefinedBy: "Asset" },
      });
      mockFolderRepairService.getExpectedFolderSync.mockReturnValue("current/folder/");

      const result = command.checkCallback(true, mockFile);
      expect(result).toBe(false);
    });

    it("should return true when asset is in the wrong folder", () => {
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
        frontmatter: { exo__Asset_isDefinedBy: "Asset" },
      });
      mockFolderRepairService.getExpectedFolderSync.mockReturnValue("expected/folder");

      const result = command.checkCallback(true, mockFile);
      expect(result).toBe(true);
      // checking=true must NOT trigger execution
      expect(mockFolderRepairService.getExpectedFolder).not.toHaveBeenCalled();
      expect(mockFolderRepairService.repairFolder).not.toHaveBeenCalled();
    });

    it("should return true for file at vault root when expected folder is non-empty", () => {
      const rootFile = {
        path: "test-file.md",
        basename: "test-file",
        parent: null,
      } as unknown as TFile;
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
        frontmatter: { exo__Asset_isDefinedBy: "Asset" },
      });
      mockFolderRepairService.getExpectedFolderSync.mockReturnValue("expected/folder");

      const result = command.checkCallback(true, rootFile);
      expect(result).toBe(true);
    });
  });

  describe("checkCallback — execution (checking=false on wrong folder)", () => {
    beforeEach(() => {
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
        frontmatter: { exo__Asset_isDefinedBy: "Asset" },
      });
      mockFolderRepairService.getExpectedFolderSync.mockReturnValue("expected/folder");
    });

    it("should execute repair when checking=false and folder is wrong", async () => {
      mockFolderRepairService.getExpectedFolder.mockResolvedValue("expected/folder");
      mockFolderRepairService.repairFolder.mockResolvedValue();

      const result = command.checkCallback(false, mockFile);
      expect(result).toBe(true);

      await flushPromises();

      expect(mockFolderRepairService.getExpectedFolder).toHaveBeenCalledWith(
        mockFile,
        { exo__Asset_isDefinedBy: "Asset" },
      );
      expect(mockFolderRepairService.repairFolder).toHaveBeenCalledWith(mockFile, "expected/folder");
      expect(mockNotifier.success).toHaveBeenCalledWith("Moved to expected/folder");
    });

    it("should handle complex metadata", async () => {
      const complexMetadata = {
        exo__Asset_isDefinedBy: "ComplexAsset",
        exo__Instance_class: ["Task", "Project"],
        exo__Asset_label: "Complex Task",
        tags: ["important", "urgent"],
      };
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
        frontmatter: complexMetadata,
      });
      mockFolderRepairService.getExpectedFolderSync.mockReturnValue("complex/expected/folder");
      mockFolderRepairService.getExpectedFolder.mockResolvedValue("complex/expected/folder");
      mockFolderRepairService.repairFolder.mockResolvedValue();

      const result = command.checkCallback(false, mockFile);
      expect(result).toBe(true);

      await flushPromises();

      expect(mockFolderRepairService.repairFolder).toHaveBeenCalledWith(mockFile, "complex/expected/folder");
      expect(mockNotifier.success).toHaveBeenCalledWith("Moved to complex/expected/folder");
    });

    it("should handle errors from repairFolder and show error notice", async () => {
      mockFolderRepairService.getExpectedFolder.mockResolvedValue("expected/folder");
      const error = new Error("Move failed");
      mockFolderRepairService.repairFolder.mockRejectedValue(error);

      const result = command.checkCallback(false, mockFile);
      expect(result).toBe(true);

      await flushPromises();

      expect(LoggingService.error).toHaveBeenCalledWith("Repair folder error", error);
      expect(mockNotifier.error).toHaveBeenCalledWith("Failed to repair folder: Move failed");
    });

    it("should handle permission denied error", async () => {
      mockFolderRepairService.getExpectedFolder.mockResolvedValue("expected/folder");
      const permError = new Error("Permission denied: cannot move file");
      mockFolderRepairService.repairFolder.mockRejectedValue(permError);

      const result = command.checkCallback(false, mockFile);
      expect(result).toBe(true);

      await flushPromises();

      expect(LoggingService.error).toHaveBeenCalledWith("Repair folder error", permError);
      expect(mockNotifier.error).toHaveBeenCalledWith("Failed to repair folder: Permission denied: cannot move file");
    });
  });
});
