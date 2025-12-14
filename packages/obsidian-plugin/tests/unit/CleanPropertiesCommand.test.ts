import { flushPromises } from "./helpers/testHelpers";
import { CleanPropertiesCommand } from "../../src/application/commands/CleanPropertiesCommand";
import { TFile, Notice } from "obsidian";
import { PropertyCleanupService, CommandVisibilityContext, LoggingService } from "exocortex";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Notice: jest.fn(),
}));
jest.mock("exocortex", () => ({
  ...jest.requireActual("exocortex"),
  canCleanProperties: jest.fn(),
  LoggingService: {
    error: jest.fn(),
  },
}));

describe("CleanPropertiesCommand", () => {
  let command: CleanPropertiesCommand;
  let mockPropertyCleanupService: jest.Mocked<PropertyCleanupService>;
  let mockFile: jest.Mocked<TFile>;
  let mockContext: CommandVisibilityContext;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock property cleanup service
    mockPropertyCleanupService = {
      cleanEmptyProperties: jest.fn(),
    } as unknown as jest.Mocked<PropertyCleanupService>;

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
    command = new CleanPropertiesCommand(mockPropertyCleanupService);
  });

  describe("id and name", () => {
    it("should have correct id and name", () => {
      expect(command.id).toBe("clean-properties");
      expect(command.name).toBe("Clean empty properties");
    });
  });

  describe("checkCallback", () => {
    const mockCanCleanProperties = require("exocortex").canCleanProperties;

    it("should return false when context is null", () => {
      const result = command.checkCallback(true, mockFile, null);
      expect(result).toBe(false);
      expect(mockPropertyCleanupService.cleanEmptyProperties).not.toHaveBeenCalled();
    });

    it("should return false when canCleanProperties returns false", () => {
      mockCanCleanProperties.mockReturnValue(false);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(false);
      expect(mockPropertyCleanupService.cleanEmptyProperties).not.toHaveBeenCalled();
    });

    it("should return true when canCleanProperties returns true and checking is true", () => {
      mockCanCleanProperties.mockReturnValue(true);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(true);
      expect(mockPropertyCleanupService.cleanEmptyProperties).not.toHaveBeenCalled();
    });

    it("should execute command when checking is false and canCleanProperties returns true", async () => {
      mockCanCleanProperties.mockReturnValue(true);
      mockPropertyCleanupService.cleanEmptyProperties.mockResolvedValue();

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockPropertyCleanupService.cleanEmptyProperties).toHaveBeenCalledWith(mockFile);
      expect(Notice).toHaveBeenCalledWith("Cleaned empty properties: test-file");
    });

    it("should handle errors and show notice", async () => {
      mockCanCleanProperties.mockReturnValue(true);
      const error = new Error("Failed to clean");
      mockPropertyCleanupService.cleanEmptyProperties.mockRejectedValue(error);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockPropertyCleanupService.cleanEmptyProperties).toHaveBeenCalledWith(mockFile);
      expect(LoggingService.error).toHaveBeenCalledWith("Clean properties error", error);
      expect(Notice).toHaveBeenCalledWith("Failed to clean properties: Failed to clean");
    });

    it("should handle files with special characters", async () => {
      mockCanCleanProperties.mockReturnValue(true);
      mockPropertyCleanupService.cleanEmptyProperties.mockResolvedValue();

      const specialFile = {
        path: "path/to/[IMPORTANT] File (2024).md",
        basename: "[IMPORTANT] File (2024)",
      } as TFile;

      const result = command.checkCallback(false, specialFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockPropertyCleanupService.cleanEmptyProperties).toHaveBeenCalledWith(specialFile);
      expect(Notice).toHaveBeenCalledWith("Cleaned empty properties: [IMPORTANT] File (2024)");
    });

    it("should handle file system errors", async () => {
      mockCanCleanProperties.mockReturnValue(true);
      const fsError = new Error("File locked");
      mockPropertyCleanupService.cleanEmptyProperties.mockRejectedValue(fsError);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockPropertyCleanupService.cleanEmptyProperties).toHaveBeenCalledWith(mockFile);
      expect(LoggingService.error).toHaveBeenCalledWith("Clean properties error", fsError);
      expect(Notice).toHaveBeenCalledWith("Failed to clean properties: File locked");
    });

    it("should handle archived context", () => {
      mockCanCleanProperties.mockReturnValue(false);
      const archivedContext = { ...mockContext, archived: true };
      const result = command.checkCallback(true, mockFile, archivedContext);
      expect(result).toBe(false);
    });

    it("should handle multiple concurrent cleanups", async () => {
      mockCanCleanProperties.mockReturnValue(true);
      mockPropertyCleanupService.cleanEmptyProperties.mockResolvedValue();

      const files = [
        { path: "file1.md", basename: "file1" } as TFile,
        { path: "file2.md", basename: "file2" } as TFile,
        { path: "file3.md", basename: "file3" } as TFile,
      ];

      // Execute cleanups concurrently
      files.forEach(file => command.checkCallback(false, file, mockContext));

      // Wait for all async executions
      await flushPromises();

      expect(mockPropertyCleanupService.cleanEmptyProperties).toHaveBeenCalledTimes(3);
      files.forEach((file, index) => {
        expect(mockPropertyCleanupService.cleanEmptyProperties).toHaveBeenNthCalledWith(index + 1, file);
        expect(Notice).toHaveBeenCalledWith(`Cleaned empty properties: ${file.basename}`);
      });
    });
  });
});