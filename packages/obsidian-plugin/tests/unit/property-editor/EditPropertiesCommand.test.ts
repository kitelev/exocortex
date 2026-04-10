import { EditPropertiesCommand } from "../../../src/application/commands/EditPropertiesCommand";
import type { TFile, App, MetadataCache, CachedMetadata } from "obsidian";

jest.mock("obsidian", () => ({
  Notice: jest.fn(),
}));

jest.mock(
  "../../../src/presentation/modals/PropertyEditorModal",
  () => ({
    PropertyEditorModal: jest.fn(),
  }),
);

describe("EditPropertiesCommand", () => {
  let mockApp: App;
  let mockPlugin: any;
  let command: EditPropertiesCommand;
  let mockNotifier: { info: jest.Mock; success: jest.Mock; error: jest.Mock; warn: jest.Mock; confirm: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();

    mockApp = {
      metadataCache: {
        getFileCache: jest.fn(),
      } as unknown as MetadataCache,
    } as unknown as App;

    mockPlugin = {
      refreshLayout: jest.fn(),
    };

    mockNotifier = { info: jest.fn(), success: jest.fn(), error: jest.fn(), warn: jest.fn(), confirm: jest.fn() };
    command = new EditPropertiesCommand(mockApp, mockPlugin, mockNotifier);
  });

  describe("command properties", () => {
    it("should have correct id", () => {
      expect(command.id).toBe("edit-properties");
    });

    it("should have correct name", () => {
      expect(command.name).toBe("edit properties");
    });
  });

  describe("checkCallback - checking mode", () => {
    it("should return true when file has frontmatter", () => {
      const mockFile = { basename: "test-file" } as TFile;
      const mockCache: CachedMetadata = {
        frontmatter: {
          exo__Asset_label: "Test",
          position: { start: { line: 0 }, end: { line: 5 } } as any,
        },
      };

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue(
        mockCache,
      );

      const result = command.checkCallback(true, mockFile, null);

      expect(result).toBe(true);
    });

    it("should return false when file has no frontmatter", () => {
      const mockFile = { basename: "test-file" } as TFile;
      const mockCache: CachedMetadata = {};

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue(
        mockCache,
      );

      const result = command.checkCallback(true, mockFile, null);

      expect(result).toBe(false);
    });

    it("should return false when cache is null", () => {
      const mockFile = { basename: "test-file" } as TFile;

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue(null);

      const result = command.checkCallback(true, mockFile, null);

      expect(result).toBe(false);
    });

    it("should return false when frontmatter is undefined", () => {
      const mockFile = { basename: "test-file" } as TFile;
      const mockCache: CachedMetadata = {
        frontmatter: undefined,
      };

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue(
        mockCache,
      );

      const result = command.checkCallback(true, mockFile, null);

      expect(result).toBe(false);
    });
  });

  describe("checkCallback - execution mode", () => {
    it("should show notice when file has no frontmatter", () => {
      const mockFile = { basename: "test-file" } as TFile;
      const mockCache: CachedMetadata = {};

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue(
        mockCache,
      );

      const { Notice } = require("obsidian");

      command.checkCallback(false, mockFile, null);

      expect(mockNotifier.info).toHaveBeenCalledWith(
        "This file has no frontmatter properties to edit",
      );
    });

    it("should show notice when cache is null", () => {
      const mockFile = { basename: "test-file" } as TFile;

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue(null);

      const { Notice } = require("obsidian");

      command.checkCallback(false, mockFile, null);

      expect(mockNotifier.info).toHaveBeenCalledWith(
        "This file has no frontmatter properties to edit",
      );
    });

    it("should instantiate modal when file has frontmatter", () => {
      const mockFile = { basename: "test-file" } as TFile;
      const mockCache: CachedMetadata = {
        frontmatter: {
          exo__Asset_label: "Test",
          "exo__Instance_class": "[[ems__Task]]",
          position: { start: { line: 0 }, end: { line: 5 } } as any,
        },
      };

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue(
        mockCache,
      );

      const {
        PropertyEditorModal,
      } = require("../../../src/presentation/modals/PropertyEditorModal");
      PropertyEditorModal.mockImplementation(() => ({ open: jest.fn() }));

      command.checkCallback(false, mockFile, null);

      expect(PropertyEditorModal).toHaveBeenCalledWith(
        mockApp,
        mockPlugin,
        mockFile,
        mockCache.frontmatter,
        mockNotifier,
      );
    });
  });

  describe("command visibility context", () => {
    it("should work with context parameter", () => {
      const mockFile = { basename: "test-file" } as TFile;
      const mockCache: CachedMetadata = {
        frontmatter: {
          exo__Asset_label: "Test",
          position: { start: { line: 0 }, end: { line: 5 } } as any,
        },
      };
      const mockContext = { isEffort: true, isProject: false } as any;

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue(
        mockCache,
      );

      const result = command.checkCallback(true, mockFile, mockContext);

      expect(result).toBe(true);
    });
  });
});
