import { flushPromises } from "./helpers/testHelpers";
import { RenameToUidCommand } from "../../src/application/commands/RenameToUidCommand";
import { TFile, Notice } from "obsidian";
import { RenameToUidService, CommandVisibilityContext, LoggingService } from "exocortex";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Notice: jest.fn(),
}));
jest.mock("exocortex", () => ({
  ...jest.requireActual("exocortex"),
  canRenameToUid: jest.fn(),
  LoggingService: {
    error: jest.fn(),
  },
}));

describe("RenameToUidCommand", () => {
  let command: RenameToUidCommand;
  let mockRenameToUidService: jest.Mocked<RenameToUidService>;
  let mockFile: jest.Mocked<TFile>;
  let mockContext: CommandVisibilityContext;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock rename to UID service
    mockRenameToUidService = {
      renameToUid: jest.fn(),
    } as unknown as jest.Mocked<RenameToUidService>;

    // Create mock file
    mockFile = {
      path: "test-file.md",
      basename: "test-file",
    } as jest.Mocked<TFile>;

    // Create mock context with metadata
    mockContext = {
      instanceClass: "Asset",
      status: "Active",
      archived: false,
      isDraft: false,
      metadata: {
        exo__Asset_uid: "asset-12345",
      },
    };

    // Create command instance
    command = new RenameToUidCommand(mockRenameToUidService);
  });

  describe("id and name", () => {
    it("should have correct id and name", () => {
      expect(command.id).toBe("rename-to-uid");
      expect(command.name).toBe("Rename to uid");
    });
  });

  describe("checkCallback", () => {
    const mockCanRenameToUid = require("exocortex").canRenameToUid;

    it("should return false when context is null", () => {
      const result = command.checkCallback(true, mockFile, null);
      expect(result).toBe(false);
      expect(mockRenameToUidService.renameToUid).not.toHaveBeenCalled();
    });

    it("should return false when canRenameToUid returns false", () => {
      mockCanRenameToUid.mockReturnValue(false);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(false);
      expect(mockRenameToUidService.renameToUid).not.toHaveBeenCalled();
    });

    it("should pass basename to canRenameToUid", () => {
      mockCanRenameToUid.mockReturnValue(true);
      command.checkCallback(true, mockFile, mockContext);
      expect(mockCanRenameToUid).toHaveBeenCalledWith(mockContext, "test-file");
    });

    it("should return true when canRenameToUid returns true and checking is true", () => {
      mockCanRenameToUid.mockReturnValue(true);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(true);
      expect(mockRenameToUidService.renameToUid).not.toHaveBeenCalled();
    });

    it("should execute command when checking is false and canRenameToUid returns true", async () => {
      mockCanRenameToUid.mockReturnValue(true);
      mockRenameToUidService.renameToUid.mockResolvedValue();

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockRenameToUidService.renameToUid).toHaveBeenCalledWith(mockFile, mockContext.metadata);
      expect(Notice).toHaveBeenCalledWith('Renamed "test-file" to "asset-12345"');
    });

    it("should handle errors and show notice", async () => {
      mockCanRenameToUid.mockReturnValue(true);
      const error = new Error("Rename failed");
      mockRenameToUidService.renameToUid.mockRejectedValue(error);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockRenameToUidService.renameToUid).toHaveBeenCalledWith(mockFile, mockContext.metadata);
      expect(LoggingService.error).toHaveBeenCalledWith("Rename to UID error", error);
      expect(Notice).toHaveBeenCalledWith("Failed to rename: Rename failed");
    });

    it("should handle missing UID in metadata", async () => {
      mockCanRenameToUid.mockReturnValue(true);
      mockRenameToUidService.renameToUid.mockResolvedValue();

      const contextWithoutUid = {
        ...mockContext,
        metadata: {},
      };

      const result = command.checkCallback(false, mockFile, contextWithoutUid);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockRenameToUidService.renameToUid).toHaveBeenCalledWith(mockFile, contextWithoutUid.metadata);
      expect(Notice).toHaveBeenCalledWith('Renamed "test-file" to "undefined"');
    });

    it("should handle files with special characters in name", async () => {
      mockCanRenameToUid.mockReturnValue(true);
      mockRenameToUidService.renameToUid.mockResolvedValue();

      const specialFile = {
        path: "path/to/[IMPORTANT] File (2024).md",
        basename: "[IMPORTANT] File (2024)",
      } as TFile;

      const result = command.checkCallback(false, specialFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockRenameToUidService.renameToUid).toHaveBeenCalledWith(specialFile, mockContext.metadata);
      expect(Notice).toHaveBeenCalledWith('Renamed "[IMPORTANT] File (2024)" to "asset-12345"');
    });

    it("should handle file already named as UID", async () => {
      mockCanRenameToUid.mockReturnValue(true);
      mockRenameToUidService.renameToUid.mockResolvedValue();

      const uidFile = {
        path: "asset-12345.md",
        basename: "asset-12345",
      } as TFile;

      const result = command.checkCallback(false, uidFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockRenameToUidService.renameToUid).toHaveBeenCalledWith(uidFile, mockContext.metadata);
      expect(Notice).toHaveBeenCalledWith('Renamed "asset-12345" to "asset-12345"');
    });

    it("should handle permission denied error", async () => {
      mockCanRenameToUid.mockReturnValue(true);
      const permError = new Error("Permission denied: cannot rename file");
      mockRenameToUidService.renameToUid.mockRejectedValue(permError);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockRenameToUidService.renameToUid).toHaveBeenCalledWith(mockFile, mockContext.metadata);
      expect(LoggingService.error).toHaveBeenCalledWith("Rename to UID error", permError);
      expect(Notice).toHaveBeenCalledWith("Failed to rename: Permission denied: cannot rename file");
    });

    it("should handle context with complex metadata", async () => {
      mockCanRenameToUid.mockReturnValue(true);
      mockRenameToUidService.renameToUid.mockResolvedValue();

      const complexContext = {
        ...mockContext,
        metadata: {
          exo__Asset_uid: "complex-uid-98765",
          exo__Asset_label: "Complex Asset",
          exo__Asset_created: "2024-01-01",
          exo__Asset_tags: ["important", "archived"],
        },
      };

      const result = command.checkCallback(false, mockFile, complexContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockRenameToUidService.renameToUid).toHaveBeenCalledWith(mockFile, complexContext.metadata);
      expect(Notice).toHaveBeenCalledWith('Renamed "test-file" to "complex-uid-98765"');
    });
  });
});