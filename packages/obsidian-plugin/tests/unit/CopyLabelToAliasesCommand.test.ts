import { flushPromises } from "./helpers/testHelpers";
import { CopyLabelToAliasesCommand } from "../../src/application/commands/CopyLabelToAliasesCommand";
import { TFile, Notice } from "obsidian";
import { LabelToAliasService, CommandVisibilityContext, LoggingService } from "exocortex";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Notice: jest.fn(),
}));
jest.mock("exocortex", () => ({
  ...jest.requireActual("exocortex"),
  canCopyLabelToAliases: jest.fn(),
  LoggingService: {
    error: jest.fn(),
  },
}));

describe("CopyLabelToAliasesCommand", () => {
  let command: CopyLabelToAliasesCommand;
  let mockLabelToAliasService: jest.Mocked<LabelToAliasService>;
  let mockFile: jest.Mocked<TFile>;
  let mockContext: CommandVisibilityContext;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock label to alias service
    mockLabelToAliasService = {
      copyLabelToAliases: jest.fn(),
    } as unknown as jest.Mocked<LabelToAliasService>;

    // Create mock file
    mockFile = {
      path: "test-file.md",
      basename: "test-file",
    } as jest.Mocked<TFile>;

    // Create mock context
    mockContext = {
      instanceClass: "Asset",
      status: "Active",
      archived: false,
      isDraft: false,
    };

    // Create command instance
    command = new CopyLabelToAliasesCommand(mockLabelToAliasService);
  });

  describe("id and name", () => {
    it("should have correct id and name", () => {
      expect(command.id).toBe("copy-label-to-aliases");
      expect(command.name).toBe("Copy label to aliases");
    });
  });

  describe("checkCallback", () => {
    const mockCanCopyLabelToAliases = require("exocortex").canCopyLabelToAliases;

    it("should return false when context is null", () => {
      const result = command.checkCallback(true, mockFile, null);
      expect(result).toBe(false);
      expect(mockLabelToAliasService.copyLabelToAliases).not.toHaveBeenCalled();
    });

    it("should return false when canCopyLabelToAliases returns false", () => {
      mockCanCopyLabelToAliases.mockReturnValue(false);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(false);
      expect(mockLabelToAliasService.copyLabelToAliases).not.toHaveBeenCalled();
    });

    it("should return true when canCopyLabelToAliases returns true and checking is true", () => {
      mockCanCopyLabelToAliases.mockReturnValue(true);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(true);
      expect(mockLabelToAliasService.copyLabelToAliases).not.toHaveBeenCalled();
    });

    it("should execute command when checking is false and canCopyLabelToAliases returns true", async () => {
      mockCanCopyLabelToAliases.mockReturnValue(true);
      mockLabelToAliasService.copyLabelToAliases.mockResolvedValue();

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockLabelToAliasService.copyLabelToAliases).toHaveBeenCalledWith(mockFile);
      expect(Notice).toHaveBeenCalledWith("Label copied to aliases");
    });

    it("should handle errors and show notice", async () => {
      mockCanCopyLabelToAliases.mockReturnValue(true);
      const error = new Error("Failed to copy");
      mockLabelToAliasService.copyLabelToAliases.mockRejectedValue(error);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockLabelToAliasService.copyLabelToAliases).toHaveBeenCalledWith(mockFile);
      expect(LoggingService.error).toHaveBeenCalledWith("Copy label to aliases error", error);
      expect(Notice).toHaveBeenCalledWith("Failed to copy label: Failed to copy");
    });

    it("should handle files with special characters", async () => {
      mockCanCopyLabelToAliases.mockReturnValue(true);
      mockLabelToAliasService.copyLabelToAliases.mockResolvedValue();

      const specialFile = {
        path: "path/to/[IMPORTANT] File (2024).md",
        basename: "[IMPORTANT] File (2024)",
      } as TFile;

      const result = command.checkCallback(false, specialFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockLabelToAliasService.copyLabelToAliases).toHaveBeenCalledWith(specialFile);
      expect(Notice).toHaveBeenCalledWith("Label copied to aliases");
    });

    it("should handle file system errors", async () => {
      mockCanCopyLabelToAliases.mockReturnValue(true);
      const fsError = new Error("File locked");
      mockLabelToAliasService.copyLabelToAliases.mockRejectedValue(fsError);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockLabelToAliasService.copyLabelToAliases).toHaveBeenCalledWith(mockFile);
      expect(LoggingService.error).toHaveBeenCalledWith("Copy label to aliases error", fsError);
      expect(Notice).toHaveBeenCalledWith("Failed to copy label: File locked");
    });

    it("should handle permission denied error", async () => {
      mockCanCopyLabelToAliases.mockReturnValue(true);
      const permError = new Error("Permission denied: cannot write to file");
      mockLabelToAliasService.copyLabelToAliases.mockRejectedValue(permError);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockLabelToAliasService.copyLabelToAliases).toHaveBeenCalledWith(mockFile);
      expect(LoggingService.error).toHaveBeenCalledWith("Copy label to aliases error", permError);
      expect(Notice).toHaveBeenCalledWith("Failed to copy label: Permission denied: cannot write to file");
    });

    it("should handle multiple concurrent copy operations", async () => {
      mockCanCopyLabelToAliases.mockReturnValue(true);
      mockLabelToAliasService.copyLabelToAliases.mockResolvedValue();

      const files = [
        { path: "file1.md", basename: "file1" } as TFile,
        { path: "file2.md", basename: "file2" } as TFile,
        { path: "file3.md", basename: "file3" } as TFile,
      ];

      // Execute copy operations concurrently
      files.forEach(file => command.checkCallback(false, file, mockContext));

      // Wait for all async executions
      await flushPromises();

      expect(mockLabelToAliasService.copyLabelToAliases).toHaveBeenCalledTimes(3);
      files.forEach((file, index) => {
        expect(mockLabelToAliasService.copyLabelToAliases).toHaveBeenNthCalledWith(index + 1, file);
      });
      expect(Notice).toHaveBeenCalledTimes(3);
      expect(Notice).toHaveBeenCalledWith("Label copied to aliases");
    });
  });
});