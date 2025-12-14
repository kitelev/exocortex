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
  let mockApp: jest.Mocked<App>;
  let mockFolderRepairService: jest.Mocked<FolderRepairService>;
  let mockFile: jest.Mocked<TFile>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock app
    mockApp = {
      metadataCache: {
        getFileCache: jest.fn(),
      },
    } as unknown as jest.Mocked<App>;

    // Create mock folder repair service
    mockFolderRepairService = {
      getExpectedFolder: jest.fn(),
      repairFolder: jest.fn(),
    } as unknown as jest.Mocked<FolderRepairService>;

    // Create mock file
    mockFile = {
      path: "current/folder/test-file.md",
      basename: "test-file",
      parent: {
        path: "current/folder",
      },
    } as jest.Mocked<TFile>;

    // Create command instance
    command = new RepairFolderCommand(mockApp, mockFolderRepairService);
  });

  describe("id and name", () => {
    it("should have correct id and name", () => {
      expect(command.id).toBe("repair-folder");
      expect(command.name).toBe("Repair folder");
    });
  });

  describe("checkCallback", () => {
    it("should return false when metadata has no exo__Asset_isDefinedBy", () => {
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
        frontmatter: { otherProp: "value" },
      });

      const result = command.checkCallback(true, mockFile);
      expect(result).toBe(false);
      expect(mockFolderRepairService.getExpectedFolder).not.toHaveBeenCalled();
    });

    it("should return false when cache is null", () => {
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue(null);

      const result = command.checkCallback(true, mockFile);
      expect(result).toBe(false);
      expect(mockFolderRepairService.getExpectedFolder).not.toHaveBeenCalled();
    });

    it("should return false when frontmatter is missing", () => {
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({});

      const result = command.checkCallback(true, mockFile);
      expect(result).toBe(false);
      expect(mockFolderRepairService.getExpectedFolder).not.toHaveBeenCalled();
    });

    it("should return true when metadata has exo__Asset_isDefinedBy and checking is true", () => {
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
        frontmatter: { exo__Asset_isDefinedBy: "Asset" },
      });

      const result = command.checkCallback(true, mockFile);
      expect(result).toBe(true);
      expect(mockFolderRepairService.getExpectedFolder).not.toHaveBeenCalled();
    });

    it("should execute command when checking is false and metadata has exo__Asset_isDefinedBy", async () => {
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
        frontmatter: { exo__Asset_isDefinedBy: "Asset" },
      });
      mockFolderRepairService.getExpectedFolder.mockResolvedValue("expected/folder");
      mockFolderRepairService.repairFolder.mockResolvedValue();

      const result = command.checkCallback(false, mockFile);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockFolderRepairService.getExpectedFolder).toHaveBeenCalledWith(
        mockFile,
        { exo__Asset_isDefinedBy: "Asset" }
      );
      expect(mockFolderRepairService.repairFolder).toHaveBeenCalledWith(mockFile, "expected/folder");
      expect(Notice).toHaveBeenCalledWith("Moved to expected/folder");
    });

    it("should show notice when no expected folder found", async () => {
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
        frontmatter: { exo__Asset_isDefinedBy: "Asset" },
      });
      mockFolderRepairService.getExpectedFolder.mockResolvedValue(null);

      const result = command.checkCallback(false, mockFile);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockFolderRepairService.getExpectedFolder).toHaveBeenCalled();
      expect(mockFolderRepairService.repairFolder).not.toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith("No expected folder found");
    });

    it("should show notice when asset is already in correct folder", async () => {
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
        frontmatter: { exo__Asset_isDefinedBy: "Asset" },
      });
      mockFolderRepairService.getExpectedFolder.mockResolvedValue("current/folder");

      const result = command.checkCallback(false, mockFile);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockFolderRepairService.getExpectedFolder).toHaveBeenCalled();
      expect(mockFolderRepairService.repairFolder).not.toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith("Asset is already in correct folder");
    });

    it("should handle file with no parent folder", async () => {
      const rootFile = {
        path: "test-file.md",
        basename: "test-file",
        parent: null,
      } as unknown as TFile;

      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
        frontmatter: { exo__Asset_isDefinedBy: "Asset" },
      });
      mockFolderRepairService.getExpectedFolder.mockResolvedValue("expected/folder");
      mockFolderRepairService.repairFolder.mockResolvedValue();

      const result = command.checkCallback(false, rootFile);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockFolderRepairService.repairFolder).toHaveBeenCalledWith(rootFile, "expected/folder");
      expect(Notice).toHaveBeenCalledWith("Moved to expected/folder");
    });

    it("should handle errors and show error notice", async () => {
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
        frontmatter: { exo__Asset_isDefinedBy: "Asset" },
      });
      const error = new Error("Failed to repair");
      mockFolderRepairService.getExpectedFolder.mockRejectedValue(error);

      const result = command.checkCallback(false, mockFile);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(LoggingService.error).toHaveBeenCalledWith("Repair folder error", error);
      expect(Notice).toHaveBeenCalledWith("Failed to repair folder: Failed to repair");
    });

    it("should handle repair folder service errors", async () => {
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
        frontmatter: { exo__Asset_isDefinedBy: "Asset" },
      });
      mockFolderRepairService.getExpectedFolder.mockResolvedValue("expected/folder");
      const error = new Error("Move failed");
      mockFolderRepairService.repairFolder.mockRejectedValue(error);

      const result = command.checkCallback(false, mockFile);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(LoggingService.error).toHaveBeenCalledWith("Repair folder error", error);
      expect(Notice).toHaveBeenCalledWith("Failed to repair folder: Move failed");
    });

    it("should handle empty expected folder path", async () => {
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
        frontmatter: { exo__Asset_isDefinedBy: "Asset" },
      });
      mockFolderRepairService.getExpectedFolder.mockResolvedValue("");

      const result = command.checkCallback(false, mockFile);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockFolderRepairService.getExpectedFolder).toHaveBeenCalled();
      expect(mockFolderRepairService.repairFolder).not.toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith("No expected folder found");
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
      mockFolderRepairService.getExpectedFolder.mockResolvedValue("complex/expected/folder");
      mockFolderRepairService.repairFolder.mockResolvedValue();

      const result = command.checkCallback(false, mockFile);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockFolderRepairService.getExpectedFolder).toHaveBeenCalledWith(
        mockFile,
        complexMetadata
      );
      expect(mockFolderRepairService.repairFolder).toHaveBeenCalledWith(mockFile, "complex/expected/folder");
      expect(Notice).toHaveBeenCalledWith("Moved to complex/expected/folder");
    });

    it("should handle permission denied error", async () => {
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
        frontmatter: { exo__Asset_isDefinedBy: "Asset" },
      });
      mockFolderRepairService.getExpectedFolder.mockResolvedValue("expected/folder");
      const permError = new Error("Permission denied: cannot move file");
      mockFolderRepairService.repairFolder.mockRejectedValue(permError);

      const result = command.checkCallback(false, mockFile);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(LoggingService.error).toHaveBeenCalledWith("Repair folder error", permError);
      expect(Notice).toHaveBeenCalledWith("Failed to repair folder: Permission denied: cannot move file");
    });
  });
});