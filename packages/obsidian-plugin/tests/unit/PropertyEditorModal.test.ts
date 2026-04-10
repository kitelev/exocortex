import {
  PropertyEditorModal,
} from "../../src/presentation/modals/PropertyEditorModal";
import { App, TFile } from "obsidian";
import type { ExocortexPluginInterface } from "@plugin/types";
import { ReactRenderer } from "@plugin/presentation/utils/ReactRenderer";
import { extractInstanceClass } from "@plugin/domain/property-editor/extractInstanceClass";

jest.mock("../../src/presentation/utils/ReactRenderer");
jest.mock("../../src/presentation/components/ErrorBoundary");
jest.mock("../../src/presentation/components/property-editor/PropertyEditorForm");
jest.mock("../../src/domain/property-editor/extractInstanceClass");

jest.mock("obsidian", () => {
  const actual = jest.requireActual("obsidian");
  return {
    ...actual,
  };
});

describe("PropertyEditorModal", () => {
  let mockApp: App;
  let mockPlugin: ExocortexPluginInterface;
  let mockFile: TFile;
  let mockFrontmatter: Record<string, unknown>;
  let modal: PropertyEditorModal;
  let mockContentEl: any;
  let mockRender: jest.Mock;
  let mockUnmount: jest.Mock;
  let mockNotifier: any;

  beforeEach(() => {
    mockNotifier = {
      info: jest.fn(),
      success: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      confirm: jest.fn().mockResolvedValue(true),
    };
    mockRender = jest.fn();
    mockUnmount = jest.fn();
    (ReactRenderer as jest.Mock).mockImplementation(() => ({
      render: mockRender,
      unmount: mockUnmount,
    }));

    (extractInstanceClass as jest.Mock).mockReturnValue("ems__Task");

    mockApp = {
      vault: {
        read: jest.fn().mockResolvedValue("---\nkey: value\n---\ncontent"),
        modify: jest.fn().mockResolvedValue(undefined),
      },
    } as unknown as App;

    mockPlugin = {
      refreshLayout: jest.fn(),
    } as unknown as ExocortexPluginInterface;

    mockFile = {
      basename: "test-file",
      path: "test/test-file.md",
      name: "test-file.md",
      extension: "md",
      stat: { ctime: 0, mtime: 0, size: 0 },
      vault: {} as any,
      parent: null,
    } as TFile;

    mockFrontmatter = {
      exo__Instance_class: ["[[ems__Task]]"],
      exo__Asset_label: "Test Task",
    };

    mockContentEl = {
      addClass: jest.fn(),
      createEl: jest.fn().mockImplementation((tag: string, options?: any) => {
        const el = document.createElement(tag);
        if (options?.text) el.textContent = options.text;
        if (options?.cls) el.className = options.cls;
        return el;
      }),
      createDiv: jest.fn().mockImplementation(() => ({
        createEl: jest.fn(),
      })),
      empty: jest.fn(),
    };
  });

  describe("constructor", () => {
    it("should initialize with required parameters", () => {
      modal = new PropertyEditorModal(mockApp, mockPlugin, mockFile, mockFrontmatter, mockNotifier);
      expect(modal).toBeDefined();
    });

    it("should store plugin reference", () => {
      modal = new PropertyEditorModal(mockApp, mockPlugin, mockFile, mockFrontmatter, mockNotifier);
      expect((modal as any).plugin).toBe(mockPlugin);
    });

    it("should store file reference", () => {
      modal = new PropertyEditorModal(mockApp, mockPlugin, mockFile, mockFrontmatter, mockNotifier);
      expect((modal as any).file).toBe(mockFile);
    });

    it("should store frontmatter", () => {
      modal = new PropertyEditorModal(mockApp, mockPlugin, mockFile, mockFrontmatter, mockNotifier);
      expect((modal as any).frontmatter).toBe(mockFrontmatter);
    });

    it("should extract instance class from frontmatter", () => {
      modal = new PropertyEditorModal(mockApp, mockPlugin, mockFile, mockFrontmatter, mockNotifier);
      expect((modal as any).instanceClass).toBe("ems__Task");
    });

    it("should initialize ReactRenderer", () => {
      modal = new PropertyEditorModal(mockApp, mockPlugin, mockFile, mockFrontmatter, mockNotifier);
      expect(ReactRenderer).toHaveBeenCalled();
    });
  });

  describe("onOpen", () => {
    beforeEach(() => {
      modal = new PropertyEditorModal(mockApp, mockPlugin, mockFile, mockFrontmatter, mockNotifier);
      modal.contentEl = mockContentEl;
      modal.close = jest.fn();
    });

    it("should empty content element first", () => {
      modal.onOpen();
      expect(mockContentEl.empty).toHaveBeenCalled();
    });

    it("should add modal class", () => {
      modal.onOpen();
      expect(mockContentEl.addClass).toHaveBeenCalledWith("property-editor-modal");
    });

    it("should create title element", () => {
      modal.onOpen();
      expect(mockContentEl.createEl).toHaveBeenCalledWith("div", { cls: "modal-title" });
    });

    it("should create subtitle element", () => {
      modal.onOpen();
      expect(mockContentEl.createEl).toHaveBeenCalledWith("div", { cls: "property-editor-subtitle" });
    });

    it("should create container for React component", () => {
      modal.onOpen();
      expect(mockContentEl.createEl).toHaveBeenCalledWith("div", { cls: "property-editor-container" });
    });

    it("should call ReactRenderer.render", () => {
      modal.onOpen();
      expect(mockRender).toHaveBeenCalled();
    });
  });

  describe("handleSave", () => {
    beforeEach(() => {
      modal = new PropertyEditorModal(mockApp, mockPlugin, mockFile, mockFrontmatter, mockNotifier);
      modal.contentEl = mockContentEl;
      modal.close = jest.fn();
    });

    it("should read file content", async () => {
      await (modal as any).handleSave({ key1: "value1" });
      expect(mockApp.vault.read).toHaveBeenCalledWith(mockFile);
    });

    it("should modify file with updated content", async () => {
      await (modal as any).handleSave({ key1: "value1" });
      expect(mockApp.vault.modify).toHaveBeenCalled();
    });

    it("should show success notice", async () => {
      await (modal as any).handleSave({ key1: "value1" });
      expect(mockNotifier.success).toHaveBeenCalledWith("Properties saved successfully");
    });

    it("should close modal after save", async () => {
      await (modal as any).handleSave({ key1: "value1" });
      expect(modal.close).toHaveBeenCalled();
    });

    it("should refresh layout after save", async () => {
      await (modal as any).handleSave({ key1: "value1" });
      expect(mockPlugin.refreshLayout).toHaveBeenCalled();
    });

    it("should handle multiple properties", async () => {
      await (modal as any).handleSave({
        key1: "value1",
        key2: "value2",
        key3: "value3",
      });
      expect(mockApp.vault.modify).toHaveBeenCalled();
    });

    it("should show error notice on vault read failure", async () => {
      (mockApp.vault.read as jest.Mock).mockRejectedValue(new Error("Read failed"));

      await (modal as any).handleSave({ key1: "value1" });

      expect(mockNotifier.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to save properties"),
      );
    });

    it("should show error notice on vault modify failure", async () => {
      (mockApp.vault.modify as jest.Mock).mockRejectedValue(new Error("Write failed"));

      await (modal as any).handleSave({ key1: "value1" });

      expect(mockNotifier.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to save properties"),
      );
    });

    it("should handle non-Error thrown objects", async () => {
      (mockApp.vault.read as jest.Mock).mockRejectedValue("string error");

      await (modal as any).handleSave({ key1: "value1" });

      expect(mockNotifier.error).toHaveBeenCalledWith(
        expect.stringContaining("string error"),
      );
    });

    it("should not close modal on error", async () => {
      (mockApp.vault.read as jest.Mock).mockRejectedValue(new Error("Read failed"));

      await (modal as any).handleSave({ key1: "value1" });

      expect(modal.close).not.toHaveBeenCalled();
    });

    it("should handle empty frontmatter update", async () => {
      await (modal as any).handleSave({});
      expect(mockApp.vault.modify).toHaveBeenCalled();
    });

    it("should handle plugin without refreshLayout", async () => {
      const pluginNoRefresh = { ...mockPlugin, refreshLayout: undefined };
      modal = new PropertyEditorModal(mockApp, pluginNoRefresh as ExocortexPluginInterface, mockFile, mockFrontmatter, mockNotifier);
      modal.contentEl = mockContentEl;
      modal.close = jest.fn();

      await expect((modal as any).handleSave({ key1: "value1" })).resolves.not.toThrow();
    });
  });

  describe("handleCancel", () => {
    beforeEach(() => {
      modal = new PropertyEditorModal(mockApp, mockPlugin, mockFile, mockFrontmatter, mockNotifier);
      modal.close = jest.fn();
    });

    it("should close modal", () => {
      (modal as any).handleCancel();
      expect(modal.close).toHaveBeenCalled();
    });

    it("should not call vault operations", () => {
      (modal as any).handleCancel();
      expect(mockApp.vault.read).not.toHaveBeenCalled();
      expect(mockApp.vault.modify).not.toHaveBeenCalled();
    });
  });

  describe("onClose", () => {
    it("should unmount React component", () => {
      modal = new PropertyEditorModal(mockApp, mockPlugin, mockFile, mockFrontmatter, mockNotifier);
      modal.contentEl = mockContentEl;

      modal.onClose();

      expect(mockUnmount).toHaveBeenCalledWith(mockContentEl);
    });

    it("should empty content element", () => {
      modal = new PropertyEditorModal(mockApp, mockPlugin, mockFile, mockFrontmatter, mockNotifier);
      modal.contentEl = mockContentEl;

      modal.onClose();

      expect(mockContentEl.empty).toHaveBeenCalled();
    });
  });

  describe("edge cases", () => {
    it("should handle file with no basename", () => {
      const fileNoBn = { ...mockFile, basename: "" };
      modal = new PropertyEditorModal(mockApp, mockPlugin, fileNoBn as TFile, mockFrontmatter, mockNotifier);
      expect(modal).toBeDefined();
    });

    it("should handle empty frontmatter", () => {
      modal = new PropertyEditorModal(mockApp, mockPlugin, mockFile, {}, mockNotifier);
      expect(modal).toBeDefined();
    });

    it("should handle frontmatter with null values", () => {
      const fmWithNull = { key1: null, key2: undefined, key3: "" };
      modal = new PropertyEditorModal(mockApp, mockPlugin, mockFile, fmWithNull, mockNotifier);
      expect(modal).toBeDefined();
    });

    it("should handle frontmatter with complex nested values", () => {
      const complexFm = {
        key1: ["a", "b", "c"],
        key2: { nested: { deep: "value" } },
        key3: 42,
      };
      modal = new PropertyEditorModal(mockApp, mockPlugin, mockFile, complexFm, mockNotifier);
      expect(modal).toBeDefined();
    });

    it("should handle concurrent save operations gracefully", async () => {
      modal = new PropertyEditorModal(mockApp, mockPlugin, mockFile, mockFrontmatter, mockNotifier);
      modal.contentEl = mockContentEl;
      modal.close = jest.fn();

      const save1 = (modal as any).handleSave({ key1: "value1" });
      const save2 = (modal as any).handleSave({ key2: "value2" });

      await Promise.all([save1, save2]);

      expect(mockApp.vault.read).toHaveBeenCalledTimes(2);
    });
  });
});
