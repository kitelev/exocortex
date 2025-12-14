// Mock obsidian BEFORE any imports that use it
jest.mock("obsidian", () => ({
  Notice: jest.fn(),
  App: jest.fn(),
  TFile: jest.fn(),
  Modal: class MockModal {
    app: any;
    contentEl: HTMLElement;
    constructor(app: any) {
      this.app = app;
      this.contentEl = document.createElement("div");
    }
    open() {}
    close() {}
    onOpen() {}
    onClose() {}
  },
}));

// Mock PropertyEditorModal BEFORE import
jest.mock("../../src/presentation/modals/PropertyEditorModal", () => ({
  PropertyEditorModal: jest.fn().mockImplementation(() => ({
    open: jest.fn(),
    close: jest.fn(),
  })),
}));

import { EditPropertiesCommand } from "../../src/application/commands/EditPropertiesCommand";
import { App, TFile, Notice } from "obsidian";
import { ExocortexPluginInterface } from "../../src/types";
import { PropertyEditorModal } from "../../src/presentation/modals/PropertyEditorModal";
import type { CommandVisibilityContext } from "exocortex";

describe("EditPropertiesCommand", () => {
  let command: EditPropertiesCommand;
  let mockApp: App;
  let mockPlugin: ExocortexPluginInterface;
  let mockFile: TFile;
  let mockContext: CommandVisibilityContext | null;

  beforeEach(() => {
    jest.clearAllMocks();

    mockApp = {
      metadataCache: {
        getFileCache: jest.fn(),
      },
    } as unknown as App;

    mockPlugin = {
      settings: {},
      saveSettings: jest.fn(),
    } as unknown as ExocortexPluginInterface;

    mockFile = {
      path: "test/file.md",
      basename: "file",
      extension: "md",
    } as TFile;

    mockContext = null;

    command = new EditPropertiesCommand(mockApp, mockPlugin);
  });

  describe("properties", () => {
    it("should have correct id", () => {
      expect(command.id).toBe("edit-properties");
    });

    it("should have correct name", () => {
      expect(command.name).toBe("edit properties");
    });
  });

  describe("checkCallback - checking mode", () => {
    it("should return true when file has frontmatter", () => {
      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: { key: "value" },
      });

      const result = command.checkCallback(true, mockFile, mockContext);

      expect(result).toBe(true);
    });

    it("should return false when file has no cache", () => {
      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue(null);

      const result = command.checkCallback(true, mockFile, mockContext);

      expect(result).toBe(false);
    });

    it("should return false when file has no frontmatter", () => {
      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({});

      const result = command.checkCallback(true, mockFile, mockContext);

      expect(result).toBe(false);
    });

    it("should return false when frontmatter is undefined", () => {
      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: undefined,
      });

      const result = command.checkCallback(true, mockFile, mockContext);

      expect(result).toBe(false);
    });
  });

  describe("checkCallback - execution mode", () => {
    it("should open PropertyEditorModal when file has frontmatter", () => {
      const frontmatter = { exo__Asset_label: "Test", key: "value" };
      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter,
      });

      const mockModalInstance = { open: jest.fn() };
      (PropertyEditorModal as jest.Mock).mockImplementation(() => mockModalInstance);

      command.checkCallback(false, mockFile, mockContext);

      expect(PropertyEditorModal).toHaveBeenCalledWith(
        mockApp,
        mockPlugin,
        mockFile,
        frontmatter
      );
      expect(mockModalInstance.open).toHaveBeenCalled();
    });

    it("should show notice when file has no frontmatter", () => {
      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({});

      command.checkCallback(false, mockFile, mockContext);

      expect(Notice).toHaveBeenCalledWith(
        "This file has no frontmatter properties to edit"
      );
      expect(PropertyEditorModal).not.toHaveBeenCalled();
    });

    it("should show notice when cache returns null", () => {
      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue(null);

      command.checkCallback(false, mockFile, mockContext);

      expect(Notice).toHaveBeenCalledWith(
        "This file has no frontmatter properties to edit"
      );
    });

    it("should not return any value in execution mode", () => {
      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: { key: "value" },
      });

      const mockModalInstance = { open: jest.fn() };
      (PropertyEditorModal as jest.Mock).mockImplementation(() => mockModalInstance);

      const result = command.checkCallback(false, mockFile, mockContext);

      expect(result).toBeUndefined();
    });
  });

  describe("checkCallback - edge cases", () => {
    it("should handle empty frontmatter object", () => {
      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {},
      });

      const mockModalInstance = { open: jest.fn() };
      (PropertyEditorModal as jest.Mock).mockImplementation(() => mockModalInstance);

      // Empty frontmatter still has frontmatter defined
      const checkResult = command.checkCallback(true, mockFile, mockContext);
      expect(checkResult).toBe(true);

      // Execution should open modal
      command.checkCallback(false, mockFile, mockContext);
      expect(PropertyEditorModal).toHaveBeenCalled();
    });

    it("should handle frontmatter with nested objects", () => {
      const complexFrontmatter = {
        key: "value",
        nested: { deep: { value: 123 } },
        array: [1, 2, 3],
      };
      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: complexFrontmatter,
      });

      const mockModalInstance = { open: jest.fn() };
      (PropertyEditorModal as jest.Mock).mockImplementation(() => mockModalInstance);

      command.checkCallback(false, mockFile, mockContext);

      expect(PropertyEditorModal).toHaveBeenCalledWith(
        mockApp,
        mockPlugin,
        mockFile,
        complexFrontmatter
      );
    });

    it("should pass context parameter even when null", () => {
      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: { key: "value" },
      });

      // Context is not used in this command but should be accepted
      const result = command.checkCallback(true, mockFile, null);
      expect(result).toBe(true);
    });

    it("should pass non-null context parameter", () => {
      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: { key: "value" },
      });

      const nonNullContext: CommandVisibilityContext = {
        instanceClass: "ems__Task",
        status: "draft",
        isEffortActive: false,
      } as CommandVisibilityContext;

      const result = command.checkCallback(true, mockFile, nonNullContext);
      expect(result).toBe(true);
    });
  });
});
