import { flushPromises } from "./helpers/testHelpers";
import { CopyFleetingNoteLabelCommand } from "../../src/application/commands/CopyFleetingNoteLabelCommand";
import { TFile, Notice, App } from "obsidian";
import { CommandVisibilityContext, LoggingService } from "exocortex";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Notice: jest.fn(),
}));
jest.mock("exocortex", () => ({
  ...jest.requireActual("exocortex"),
  canCopyFleetingNoteLabel: jest.fn(),
  LoggingService: {
    error: jest.fn(),
  },
}));

describe("CopyFleetingNoteLabelCommand", () => {
  let command: CopyFleetingNoteLabelCommand;
  let mockNotifier: any;
  let mockApp: jest.Mocked<App>;
  let mockFile: jest.Mocked<TFile>;
  let mockContext: CommandVisibilityContext;
  let originalClipboard: typeof navigator.clipboard;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock app
    mockApp = {
      vault: {
        read: jest.fn(),
      },
      workspace: {
        getActiveFile: jest.fn(),
      },
    } as unknown as jest.Mocked<App>;

    // Create mock file
    mockFile = {
      path: "01 Inbox/test-uuid.md",
      basename: "test-uuid",
    } as jest.Mocked<TFile>;

    // Create mock context
    mockContext = {
      instanceClass: "[[ztlk__FleetingNote]]",
      currentStatus: null,
      metadata: {},
      isArchived: false,
      currentFolder: "01 Inbox",
      expectedFolder: null,
    };

    // Mock clipboard API
    originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
      configurable: true,
    });

    // Create command instance
    mockNotifier = { info: jest.fn(), success: jest.fn(), error: jest.fn(), warn: jest.fn(), confirm: jest.fn() };
    command = new CopyFleetingNoteLabelCommand(mockApp, mockNotifier);
  });

  afterEach(() => {
    // Restore original clipboard
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      configurable: true,
    });
  });

  describe("id and name", () => {
    it("should have correct id and name", () => {
      expect(command.id).toBe("copy-fleeting-note-label");
      expect(command.name).toBe("Copy Label");
    });
  });

  describe("checkCallback", () => {
    const mockCanCopyFleetingNoteLabel = require("exocortex").canCopyFleetingNoteLabel;

    it("should return false when context is null", () => {
      const result = command.checkCallback(true, mockFile, null);
      expect(result).toBe(false);
    });

    it("should return false when canCopyFleetingNoteLabel returns false", () => {
      mockCanCopyFleetingNoteLabel.mockReturnValue(false);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(false);
    });

    it("should return true when canCopyFleetingNoteLabel returns true and checking is true", () => {
      mockCanCopyFleetingNoteLabel.mockReturnValue(true);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(true);
      expect(mockApp.vault.read).not.toHaveBeenCalled();
    });

    it("should copy first line of body to clipboard when checking is false", async () => {
      mockCanCopyFleetingNoteLabel.mockReturnValue(true);
      mockApp.vault.read.mockResolvedValue("---\nexo__Instance_class: ztlk__FleetingNote\n---\n\nThis is the label to copy\nSecond line\nThird line");

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(mockApp.vault.read).toHaveBeenCalledWith(mockFile);
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("This is the label to copy");
      expect(mockNotifier.success).toHaveBeenCalledWith("Label copied to clipboard");
    });

    it("should trim whitespace from first line", async () => {
      mockCanCopyFleetingNoteLabel.mockReturnValue(true);
      mockApp.vault.read.mockResolvedValue("---\nexo__Instance_class: ztlk__FleetingNote\n---\n\n  Label with spaces  \nSecond line");

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Label with spaces");
      expect(mockNotifier.success).toHaveBeenCalledWith("Label copied to clipboard");
    });

    it("should skip empty lines after frontmatter to find first content line", async () => {
      mockCanCopyFleetingNoteLabel.mockReturnValue(true);
      mockApp.vault.read.mockResolvedValue("---\nexo__Instance_class: ztlk__FleetingNote\n---\n\n\n\nActual label\nMore content");

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Actual label");
      expect(mockNotifier.success).toHaveBeenCalledWith("Label copied to clipboard");
    });

    it("should show notice when label is empty", async () => {
      mockCanCopyFleetingNoteLabel.mockReturnValue(true);
      mockApp.vault.read.mockResolvedValue("---\nexo__Instance_class: ztlk__FleetingNote\n---\n\n");

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
      expect(mockNotifier.warn).toHaveBeenCalledWith("Label is empty");
    });

    it("should show notice when file has only whitespace after frontmatter", async () => {
      mockCanCopyFleetingNoteLabel.mockReturnValue(true);
      mockApp.vault.read.mockResolvedValue("---\nexo__Instance_class: ztlk__FleetingNote\n---\n\n   \n   \n");

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
      expect(mockNotifier.warn).toHaveBeenCalledWith("Label is empty");
    });

    it("should handle errors and show notice", async () => {
      mockCanCopyFleetingNoteLabel.mockReturnValue(true);
      const error = new Error("Failed to read file");
      mockApp.vault.read.mockRejectedValue(error);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for async execution
      await flushPromises();

      expect(LoggingService.error).toHaveBeenCalledWith("Copy fleeting note label error", error);
      expect(mockNotifier.error).toHaveBeenCalledWith("Failed to copy label: Failed to read file");
    });

    it("should handle clipboard write errors", async () => {
      mockCanCopyFleetingNoteLabel.mockReturnValue(true);
      mockApp.vault.read.mockResolvedValue("---\nexo__Instance_class: ztlk__FleetingNote\n---\n\nMy label");

      const clipboardError = new Error("Clipboard access denied");
      (navigator.clipboard.writeText as jest.Mock).mockRejectedValue(clipboardError);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      expect(LoggingService.error).toHaveBeenCalledWith("Copy fleeting note label error", clipboardError);
      expect(mockNotifier.error).toHaveBeenCalledWith("Failed to copy label: Clipboard access denied");
    });

    it("should handle file without frontmatter", async () => {
      mockCanCopyFleetingNoteLabel.mockReturnValue(true);
      mockApp.vault.read.mockResolvedValue("Just a plain file\nWith content");

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      // When no frontmatter, the first line is the label
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Just a plain file");
      expect(mockNotifier.success).toHaveBeenCalledWith("Label copied to clipboard");
    });

    it("should handle file with only frontmatter", async () => {
      mockCanCopyFleetingNoteLabel.mockReturnValue(true);
      mockApp.vault.read.mockResolvedValue("---\nexo__Instance_class: ztlk__FleetingNote\n---");

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
      expect(mockNotifier.warn).toHaveBeenCalledWith("Label is empty");
    });
  });
});
