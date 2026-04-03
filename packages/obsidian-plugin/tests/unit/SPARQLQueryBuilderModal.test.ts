import {
  SPARQLQueryBuilderModal,
} from "../../src/presentation/modals/SPARQLQueryBuilderModal";
import { App, Modal, Notice, TFile, Plugin } from "obsidian";

jest.mock("obsidian", () => {
  const actual = jest.requireActual("obsidian");
  return {
    ...actual,
    Notice: jest.fn(),
  };
});

import { ReactRenderer } from "@plugin/presentation/utils/ReactRenderer";
import { SPARQLQueryService } from "@plugin/application/services/SPARQLQueryService";

jest.mock("../../src/presentation/utils/ReactRenderer");
jest.mock("../../src/presentation/components/ErrorBoundary");
jest.mock("../../src/presentation/components/sparql/QueryBuilder");
jest.mock("../../src/application/services/SPARQLQueryService");

describe("SPARQLQueryBuilderModal", () => {
  let mockApp: App;
  let mockPlugin: Plugin;
  let modal: SPARQLQueryBuilderModal;
  let mockContentEl: any;
  let mockRender: jest.Mock;
  let mockUnmount: jest.Mock;
  let mockInitialize: jest.Mock;
  let mockQuery: jest.Mock;

  beforeEach(() => {
    mockRender = jest.fn();
    mockUnmount = jest.fn();
    (ReactRenderer as jest.Mock).mockImplementation(() => ({
      render: mockRender,
      unmount: mockUnmount,
    }));

    mockInitialize = jest.fn().mockResolvedValue(undefined);
    mockQuery = jest.fn().mockResolvedValue([]);
    (SPARQLQueryService as jest.Mock).mockImplementation(() => ({
      initialize: mockInitialize,
      query: mockQuery,
    }));

    mockApp = {
      vault: {
        getAbstractFileByPath: jest.fn(),
      },
      workspace: {
        getLeaf: jest.fn().mockReturnValue({
          openFile: jest.fn(),
        }),
      },
    } as unknown as App;

    mockPlugin = {
      app: mockApp,
    } as unknown as Plugin;

    mockContentEl = {
      addClass: jest.fn(),
      createEl: jest.fn().mockImplementation((tag: string, options?: any) => {
        const el = document.createElement(tag);
        if (options?.text) el.textContent = options.text;
        if (options?.cls) el.className = options.cls;
        (el as any).createEl = jest.fn().mockImplementation((childTag: string, childOpts?: any) => {
          const childEl = document.createElement(childTag);
          if (childOpts?.text) childEl.textContent = childOpts.text;
          if (childOpts?.cls) childEl.className = childOpts.cls;
          return childEl;
        });
        return el;
      }),
      createDiv: jest.fn().mockImplementation((options?: any) => {
        const el = document.createElement("div");
        if (options?.cls) el.className = options.cls;
        (el as any).createEl = mockContentEl.createEl;
        return el;
      }),
      empty: jest.fn(),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with app and plugin", () => {
      modal = new SPARQLQueryBuilderModal(mockApp, mockPlugin);
      expect(modal).toBeDefined();
    });

    it("should initialize ReactRenderer", () => {
      modal = new SPARQLQueryBuilderModal(mockApp, mockPlugin);
      expect((modal as any).reactRenderer).toBeDefined();
    });

    it("should initialize SPARQLQueryService", () => {
      modal = new SPARQLQueryBuilderModal(mockApp, mockPlugin);
      expect((modal as any).queryService).toBeDefined();
    });

    it("should initialize ApplicationErrorHandler", () => {
      modal = new SPARQLQueryBuilderModal(mockApp, mockPlugin);
      expect((modal as any).errorHandler).toBeDefined();
    });

    it("should start with isInitialized as false", () => {
      modal = new SPARQLQueryBuilderModal(mockApp, mockPlugin);
      expect((modal as any).isInitialized).toBe(false);
    });
  });

  describe("onOpen", () => {
    beforeEach(() => {
      modal = new SPARQLQueryBuilderModal(mockApp, mockPlugin);
      modal.contentEl = mockContentEl;
      modal.close = jest.fn();
    });

    it("should empty content element", async () => {
      await modal.onOpen();
      expect(mockContentEl.empty).toHaveBeenCalled();
    });

    it("should add modal class", async () => {
      await modal.onOpen();
      expect(mockContentEl.addClass).toHaveBeenCalledWith("sparql-query-builder-modal");
    });

    it("should create title element", async () => {
      await modal.onOpen();
      expect(mockContentEl.createEl).toHaveBeenCalledWith("div", { cls: "modal-title" });
    });

    it("should create container element", async () => {
      await modal.onOpen();
      expect(mockContentEl.createEl).toHaveBeenCalledWith("div", { cls: "sparql-query-builder-container" });
    });

    it("should initialize query service", async () => {
      await modal.onOpen();
      expect(mockInitialize).toHaveBeenCalled();
    });

    it("should render React component after initialization", async () => {
      await modal.onOpen();
      expect(mockRender).toHaveBeenCalled();
    });

    it("should handle initialization failure", async () => {
      mockInitialize.mockRejectedValue(new Error("Init failed"));

      await modal.onOpen();

      // Should not throw, but should show error in container
      expect(mockRender).not.toHaveBeenCalled();
    });

    it("should skip initialization on second open if already initialized", async () => {
      await modal.onOpen();
      expect(mockInitialize).toHaveBeenCalledTimes(1);

      mockInitialize.mockClear();
      mockRender.mockClear();

      await modal.onOpen();
      expect(mockInitialize).not.toHaveBeenCalled();
    });
  });

  describe("onClose", () => {
    it("should unmount React component", () => {
      modal = new SPARQLQueryBuilderModal(mockApp, mockPlugin);
      modal.contentEl = mockContentEl;

      modal.onClose();

      expect(mockUnmount).toHaveBeenCalledWith(mockContentEl);
    });

    it("should empty content element", () => {
      modal = new SPARQLQueryBuilderModal(mockApp, mockPlugin);
      modal.contentEl = mockContentEl;

      modal.onClose();

      expect(mockContentEl.empty).toHaveBeenCalled();
    });
  });

  describe("ensureQueryServiceInitialized", () => {
    beforeEach(() => {
      modal = new SPARQLQueryBuilderModal(mockApp, mockPlugin);
    });

    it("should initialize query service on first call", async () => {
      await (modal as any).ensureQueryServiceInitialized();
      expect(mockInitialize).toHaveBeenCalledTimes(1);
    });

    it("should set isInitialized to true after success", async () => {
      await (modal as any).ensureQueryServiceInitialized();
      expect((modal as any).isInitialized).toBe(true);
    });

    it("should not re-initialize on subsequent calls", async () => {
      await (modal as any).ensureQueryServiceInitialized();
      await (modal as any).ensureQueryServiceInitialized();
      expect(mockInitialize).toHaveBeenCalledTimes(1);
    });

    it("should propagate initialization errors", async () => {
      mockInitialize.mockRejectedValue(new Error("Init error"));

      await expect((modal as any).ensureQueryServiceInitialized()).rejects.toThrow("Init error");
      expect((modal as any).isInitialized).toBe(false);
    });
  });

  describe("executeQuery", () => {
    beforeEach(() => {
      modal = new SPARQLQueryBuilderModal(mockApp, mockPlugin);
    });

    it("should execute query via query service", async () => {
      const mockResults = [{ s: "subject", p: "predicate", o: "object" }];
      mockQuery.mockResolvedValue(mockResults);

      const result = await (modal as any).executeQuery("SELECT ?s WHERE { ?s ?p ?o }");

      expect(mockQuery).toHaveBeenCalledWith("SELECT ?s WHERE { ?s ?p ?o }");
      expect(result).toEqual(mockResults);
    });

    it("should handle empty query results", async () => {
      mockQuery.mockResolvedValue([]);

      const result = await (modal as any).executeQuery("SELECT ?s WHERE { ?s ?p ?o }");

      expect(result).toEqual([]);
    });

    it("should propagate query errors", async () => {
      mockQuery.mockRejectedValue(new Error("Query failed"));

      await expect((modal as any).executeQuery("INVALID QUERY")).rejects.toThrow("Query failed");
    });

    it("should handle empty query string", async () => {
      mockQuery.mockResolvedValue([]);

      const result = await (modal as any).executeQuery("");

      expect(mockQuery).toHaveBeenCalledWith("");
      expect(result).toEqual([]);
    });
  });

  describe("handleAssetClick", () => {
    beforeEach(() => {
      modal = new SPARQLQueryBuilderModal(mockApp, mockPlugin);
      modal.close = jest.fn();
    });

    it("should show notice when file not found", () => {
      (mockApp.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(null);

      (modal as any).handleAssetClick("nonexistent.md");

      expect(Notice).toHaveBeenCalledWith("file not found: nonexistent.md");
    });

    it("should show notice when path is not a file", () => {
      const mockFolder = { path: "folder" };
      // TFile has extension property, TFolder does not behave as TFile
      (mockApp.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(mockFolder);

      (modal as any).handleAssetClick("folder");

      expect(Notice).toHaveBeenCalledWith("path is not a file: folder");
    });

    it("should open file in current leaf by default", () => {
      const mockTFile = new TFile();
      (mockApp.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(mockTFile);

      const mockLeaf = { openFile: jest.fn() };
      (mockApp.workspace.getLeaf as jest.Mock).mockReturnValue(mockLeaf);

      (modal as any).handleAssetClick("test.md");

      expect(mockApp.workspace.getLeaf).toHaveBeenCalledWith();
      expect(mockLeaf.openFile).toHaveBeenCalledWith(mockTFile);
      expect(modal.close).toHaveBeenCalled();
    });

    it("should open file in new tab when ctrl key is held", () => {
      const mockTFile = new TFile();
      (mockApp.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(mockTFile);

      const mockLeaf = { openFile: jest.fn() };
      (mockApp.workspace.getLeaf as jest.Mock).mockReturnValue(mockLeaf);

      const mockEvent = { ctrlKey: true, metaKey: false } as React.MouseEvent;
      (modal as any).handleAssetClick("test.md", mockEvent);

      expect(mockApp.workspace.getLeaf).toHaveBeenCalledWith("tab");
      expect(mockLeaf.openFile).toHaveBeenCalledWith(mockTFile);
    });

    it("should open file in new tab when meta key is held", () => {
      const mockTFile = new TFile();
      (mockApp.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(mockTFile);

      const mockLeaf = { openFile: jest.fn() };
      (mockApp.workspace.getLeaf as jest.Mock).mockReturnValue(mockLeaf);

      const mockEvent = { ctrlKey: false, metaKey: true } as React.MouseEvent;
      (modal as any).handleAssetClick("test.md", mockEvent);

      expect(mockApp.workspace.getLeaf).toHaveBeenCalledWith("tab");
    });

    it("should not close modal when opening in new tab", () => {
      const mockTFile = new TFile();
      (mockApp.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(mockTFile);

      const mockLeaf = { openFile: jest.fn() };
      (mockApp.workspace.getLeaf as jest.Mock).mockReturnValue(mockLeaf);

      const mockEvent = { ctrlKey: true, metaKey: false } as React.MouseEvent;
      (modal as any).handleAssetClick("test.md", mockEvent);

      expect(modal.close).not.toHaveBeenCalled();
    });

    it("should handle undefined event parameter", () => {
      const mockTFile = new TFile();
      (mockApp.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(mockTFile);

      const mockLeaf = { openFile: jest.fn() };
      (mockApp.workspace.getLeaf as jest.Mock).mockReturnValue(mockLeaf);

      (modal as any).handleAssetClick("test.md", undefined);

      expect(mockApp.workspace.getLeaf).toHaveBeenCalledWith();
      expect(modal.close).toHaveBeenCalled();
    });
  });

  describe("handleCopyQuery", () => {
    beforeEach(() => {
      modal = new SPARQLQueryBuilderModal(mockApp, mockPlugin);
    });

    it("should show notice when query is copied", () => {
      (modal as any).handleCopyQuery("SELECT ?s WHERE { ?s ?p ?o }");

      expect(Notice).toHaveBeenCalledWith("Query copied to clipboard", 2000);
    });

    it("should show notice for empty query", () => {
      (modal as any).handleCopyQuery("");

      expect(Notice).toHaveBeenCalledWith("Query copied to clipboard", 2000);
    });
  });

  describe("edge cases", () => {
    it("should handle query service initialization timeout", async () => {
      mockInitialize.mockImplementation(
        () => new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 10))
      );

      modal = new SPARQLQueryBuilderModal(mockApp, mockPlugin);
      modal.contentEl = mockContentEl;
      modal.close = jest.fn();

      await modal.onOpen();

      expect((modal as any).isInitialized).toBe(false);
    });

    it("should handle rapid open/close cycles", () => {
      modal = new SPARQLQueryBuilderModal(mockApp, mockPlugin);
      modal.contentEl = mockContentEl;
      modal.close = jest.fn();

      modal.onClose();
      expect(mockUnmount).toHaveBeenCalled();
      expect(mockContentEl.empty).toHaveBeenCalled();
    });

    it("should handle asset click with empty path", () => {
      modal = new SPARQLQueryBuilderModal(mockApp, mockPlugin);
      modal.close = jest.fn();
      (mockApp.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(null);

      (modal as any).handleAssetClick("");

      expect(Notice).toHaveBeenCalledWith("file not found: ");
    });

    it("should handle query with special characters", async () => {
      modal = new SPARQLQueryBuilderModal(mockApp, mockPlugin);
      mockQuery.mockResolvedValue([]);

      const queryWithSpecialChars = 'SELECT ?s WHERE { ?s rdfs:label "test & <value>" }';
      const result = await (modal as any).executeQuery(queryWithSpecialChars);

      expect(mockQuery).toHaveBeenCalledWith(queryWithSpecialChars);
      expect(result).toEqual([]);
    });

    it("should handle large query results", async () => {
      modal = new SPARQLQueryBuilderModal(mockApp, mockPlugin);
      const largeResults = Array.from({ length: 10000 }, (_, i) => ({
        s: `subject_${i}`,
        p: `predicate_${i}`,
        o: `object_${i}`,
      }));
      mockQuery.mockResolvedValue(largeResults);

      const result = await (modal as any).executeQuery("SELECT ?s ?p ?o WHERE { ?s ?p ?o }");

      expect(result).toHaveLength(10000);
    });
  });
});
