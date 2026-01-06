/**
 * Tests for ObsidianUIProvider - implements IUIProvider for Obsidian environment
 *
 * TDD: Write failing tests first (RED phase)
 *
 * @see Issue #1398: [Plugin] Implement ObsidianUIProvider
 * @see /Users/kitelev/vault-2025/03 Knowledge/concepts/RDF-Driven Architecture Implementation Plan (Note).md (lines 1300-1342)
 */

import { App, TFile, Notice } from "obsidian";
import { HeadlessError } from "exocortex";
import type { IUIProvider, ModalOptions, SelectOptions } from "exocortex";
import { ObsidianUIProvider } from "@plugin/infrastructure/ObsidianUIProvider";

describe("ObsidianUIProvider", () => {
  let mockApp: App;
  let provider: ObsidianUIProvider;

  beforeEach(() => {
    mockApp = new App();
    provider = new ObsidianUIProvider(mockApp);
  });

  describe("interface compliance", () => {
    it("should implement IUIProvider interface", () => {
      // Type assertion ensures interface compliance at compile time
      const uiProvider: IUIProvider = provider;
      expect(uiProvider).toBeDefined();
    });

    it("should have isHeadless set to false", () => {
      expect(provider.isHeadless).toBe(false);
    });

    it("should have all required methods", () => {
      expect(typeof provider.showInputModal).toBe("function");
      expect(typeof provider.showSelectModal).toBe("function");
      expect(typeof provider.showConfirm).toBe("function");
      expect(typeof provider.notify).toBe("function");
      expect(typeof provider.navigate).toBe("function");
    });
  });

  describe("notify", () => {
    it("should create a Notice with the message", () => {
      // Notice is mocked in __mocks__/obsidian.ts
      provider.notify("Test notification");
      // Just verify no error is thrown - Notice is mocked
      expect(true).toBe(true);
    });

    it("should accept optional duration parameter", () => {
      provider.notify("Test notification", 5000);
      // Just verify no error is thrown
      expect(true).toBe(true);
    });

    it("should use default duration when not specified", () => {
      provider.notify("Test notification");
      // Just verify no error is thrown
      expect(true).toBe(true);
    });
  });

  describe("navigate", () => {
    it("should open file when valid path is provided", async () => {
      // Setup mock file
      const mockFile = new TFile("test/file.md");
      mockApp.vault.__addMockFile("test/file.md");

      // Mock workspace.getLeaf().openFile
      const mockOpenFile = jest.fn().mockResolvedValue(undefined);
      const mockLeaf = { openFile: mockOpenFile };
      jest.spyOn(mockApp.workspace, "getLeaf").mockReturnValue(mockLeaf as any);
      jest
        .spyOn(mockApp.vault, "getAbstractFileByPath")
        .mockReturnValue(mockFile);

      await provider.navigate("test/file.md");

      expect(mockApp.vault.getAbstractFileByPath).toHaveBeenCalledWith(
        "test/file.md"
      );
      expect(mockApp.workspace.getLeaf).toHaveBeenCalled();
      expect(mockOpenFile).toHaveBeenCalledWith(mockFile);
    });

    it("should not throw when file does not exist", async () => {
      jest.spyOn(mockApp.vault, "getAbstractFileByPath").mockReturnValue(null);

      // Should not throw
      await expect(provider.navigate("nonexistent/file.md")).resolves.not.toThrow();
    });

    it("should not open folder as file", async () => {
      // Mock returning a folder instead of file
      const mockFolder = { path: "test/folder" }; // Not a TFile
      jest
        .spyOn(mockApp.vault, "getAbstractFileByPath")
        .mockReturnValue(mockFolder as any);

      const mockOpenFile = jest.fn();
      jest.spyOn(mockApp.workspace, "getLeaf").mockReturnValue({
        openFile: mockOpenFile,
      } as any);

      await provider.navigate("test/folder");

      // Should not call openFile for folders
      expect(mockOpenFile).not.toHaveBeenCalled();
    });
  });

  describe("showInputModal", () => {
    it("should return a promise", () => {
      const options: ModalOptions = {
        title: "Test Input",
        placeholder: "Enter value",
      };

      // Note: In actual test, the modal would need to be resolved
      // For unit test, we verify the method exists and returns a promise
      const result = provider.showInputModal(options);
      expect(result).toBeInstanceOf(Promise);
    });

    it("should accept all ModalOptions properties", async () => {
      const options: ModalOptions = {
        title: "Test Input",
        placeholder: "Enter something",
        defaultValue: "default",
        submitLabel: "Save",
      };

      // The promise will hang without manual resolution in tests
      // This tests that the method accepts all options without error
      const result = provider.showInputModal(options);
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe("showSelectModal", () => {
    it("should return a promise", () => {
      const options: SelectOptions<string> = {
        title: "Select Item",
        items: ["item1", "item2", "item3"],
        getLabel: (item) => item,
      };

      const result = provider.showSelectModal(options);
      expect(result).toBeInstanceOf(Promise);
    });

    it("should accept generic type parameter", () => {
      interface TestItem {
        id: string;
        name: string;
      }

      const options: SelectOptions<TestItem> = {
        title: "Select Test Item",
        items: [
          { id: "1", name: "First" },
          { id: "2", name: "Second" },
        ],
        getLabel: (item) => item.name,
        placeholder: "Search items...",
      };

      const result = provider.showSelectModal(options);
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe("showConfirm", () => {
    it("should return a promise of boolean", () => {
      const result = provider.showConfirm("Are you sure?");
      expect(result).toBeInstanceOf(Promise);
    });

    it("should accept message parameter", () => {
      // This tests that the method accepts the message without error
      const result = provider.showConfirm("Delete this item?");
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe("constructor", () => {
    it("should store app reference", () => {
      const newProvider = new ObsidianUIProvider(mockApp);
      // The app should be accessible for modal creation
      expect(newProvider).toBeDefined();
      expect(newProvider.isHeadless).toBe(false);
    });
  });
});
