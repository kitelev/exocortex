import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type { IVaultAdapter, IFile, IFolder, IFrontmatter, ILogger, INotificationService } from "exocortex";
import { SolutionMapping, Literal, IRI } from "exocortex";
import type { TableLayout, LayoutSort, LayoutColumn } from "../../../../src/domain/layout";
import { LayoutType } from "../../../../src/domain/layout";

// Create stable mock references
const mockSparqlInitialize = jest.fn();
const mockSparqlQuery = jest.fn();
const mockSparqlRefresh = jest.fn();
const mockSparqlUpdateFile = jest.fn();
const mockSparqlDispose = jest.fn();

const mockParserParseFromFile = jest.fn();
const mockParserParseFromWikiLink = jest.fn();
const mockParserClearCache = jest.fn();
const mockParserInvalidateCache = jest.fn();

const mockLoggerDebug = jest.fn();
const mockLoggerInfo = jest.fn();
const mockLoggerWarn = jest.fn();
const mockLoggerError = jest.fn();

// Mock modules - functions are referenced by stable variables
jest.mock("../../../../src/application/services/SPARQLQueryService", () => {
  return {
    SPARQLQueryService: function() {
      return {
        initialize: mockSparqlInitialize,
        query: mockSparqlQuery,
        refresh: mockSparqlRefresh,
        updateFile: mockSparqlUpdateFile,
        dispose: mockSparqlDispose,
        getTripleStore: jest.fn(),
      };
    }
  };
});

jest.mock("../../../../src/infrastructure/layout/LayoutParser", () => {
  return {
    LayoutParser: function() {
      return {
        parseFromFile: mockParserParseFromFile,
        parseFromWikiLink: mockParserParseFromWikiLink,
        clearCache: mockParserClearCache,
        invalidateCache: mockParserInvalidateCache,
      };
    }
  };
});

jest.mock("@plugin/adapters/logging/LoggerFactory", () => {
  return {
    LoggerFactory: {
      create: () => ({
        debug: mockLoggerDebug,
        info: mockLoggerInfo,
        warn: mockLoggerWarn,
        error: mockLoggerError,
      })
    }
  };
});

// Import after mocks
import { LayoutService } from "../../../../src/application/layout";

// Mock Obsidian App
const mockApp = {
  vault: {
    getAbstractFileByPath: jest.fn(),
  },
} as unknown as import("obsidian").App;

// Mock file factory
function createMockFile(
  path: string,
  basename: string = path.split("/").pop() || path
): IFile {
  return {
    path,
    basename: basename.replace(".md", ""),
    name: basename,
    parent: { path: path.split("/").slice(0, -1).join("/"), name: "parent" } as IFolder,
  };
}

// Mock vault adapter factory
function createMockVaultAdapter(
  files: Map<string, IFrontmatter | null> = new Map()
): jest.Mocked<IVaultAdapter> {
  return {
    read: jest.fn<IVaultAdapter["read"]>(),
    exists: jest.fn<IVaultAdapter["exists"]>(),
    getAllFiles: jest.fn<IVaultAdapter["getAllFiles"]>(),
    getAbstractFileByPath: jest.fn<IVaultAdapter["getAbstractFileByPath"]>().mockImplementation((path: string) => {
      if (files.has(path)) {
        return createMockFile(path);
      }
      return null;
    }),
    create: jest.fn<IVaultAdapter["create"]>(),
    modify: jest.fn<IVaultAdapter["modify"]>(),
    delete: jest.fn<IVaultAdapter["delete"]>(),
    process: jest.fn<IVaultAdapter["process"]>(),
    rename: jest.fn<IVaultAdapter["rename"]>(),
    updateLinks: jest.fn<IVaultAdapter["updateLinks"]>(),
    createFolder: jest.fn<IVaultAdapter["createFolder"]>(),
    getDefaultNewFileParent: jest.fn<IVaultAdapter["getDefaultNewFileParent"]>(),
    getFrontmatter: jest.fn<IVaultAdapter["getFrontmatter"]>().mockImplementation((file: IFile) => {
      return files.get(file.path) || null;
    }),
    updateFrontmatter: jest.fn<IVaultAdapter["updateFrontmatter"]>(),
    getFirstLinkpathDest: jest.fn<IVaultAdapter["getFirstLinkpathDest"]>().mockImplementation(
      (linkpath: string) => {
        for (const [path] of files) {
          if (path === linkpath || path === linkpath + ".md") {
            return createMockFile(path);
          }
          const basename = path.split("/").pop()?.replace(".md", "");
          if (basename === linkpath || basename === linkpath.replace(".md", "")) {
            return createMockFile(path);
          }
        }
        return null;
      }
    ),
  } as jest.Mocked<IVaultAdapter>;
}

// Mock logger factory
function createMockLogger(): jest.Mocked<ILogger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

// Mock notifier factory
function createMockNotifier(): jest.Mocked<INotificationService> {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    success: jest.fn(),
    confirm: jest.fn<() => Promise<boolean>>().mockResolvedValue(false),
  };
}

// Default layout for mocks
const defaultLayout: TableLayout = {
  uid: "layout-001",
  label: "Test Table",
  type: LayoutType.Table,
  targetClass: "[[ems__Task]]",
  columns: [],
};

describe("LayoutService", () => {
  let service: LayoutService;
  let mockVaultAdapter: jest.Mocked<IVaultAdapter>;
  let mockLogger: jest.Mocked<ILogger>;
  let mockNotifier: jest.Mocked<INotificationService>;

  beforeEach(() => {
    // Clear call history
    mockSparqlInitialize.mockClear();
    mockSparqlQuery.mockClear();
    mockSparqlRefresh.mockClear();
    mockSparqlUpdateFile.mockClear();
    mockSparqlDispose.mockClear();
    mockParserParseFromFile.mockClear();
    mockParserParseFromWikiLink.mockClear();
    mockParserClearCache.mockClear();
    mockParserInvalidateCache.mockClear();
    mockLoggerDebug.mockClear();
    mockLoggerInfo.mockClear();
    mockLoggerWarn.mockClear();
    mockLoggerError.mockClear();

    // Reset mock implementations to defaults
    mockSparqlInitialize.mockResolvedValue(undefined);
    mockSparqlQuery.mockResolvedValue([]);
    mockSparqlRefresh.mockResolvedValue(undefined);
    mockSparqlUpdateFile.mockResolvedValue(undefined);
    mockSparqlDispose.mockResolvedValue(undefined);

    mockParserParseFromFile.mockResolvedValue({
      success: true,
      layout: defaultLayout,
    });
    mockParserParseFromWikiLink.mockResolvedValue(defaultLayout);

    mockVaultAdapter = createMockVaultAdapter();
    mockLogger = createMockLogger();
    mockNotifier = createMockNotifier();
    service = new LayoutService(mockApp, mockVaultAdapter, mockLogger, mockNotifier);
  });

  describe("constructor", () => {
    it("should create a LayoutService instance", () => {
      expect(service).toBeInstanceOf(LayoutService);
    });

    it("should create with default logger when not provided", () => {
      const serviceWithoutLogger = new LayoutService(mockApp, mockVaultAdapter);
      expect(serviceWithoutLogger).toBeInstanceOf(LayoutService);
    });
  });

  describe("initialize", () => {
    it("should initialize the service", async () => {
      await service.initialize();
      expect(mockSparqlInitialize).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith("LayoutService initialized");
    });

    it("should be idempotent", async () => {
      await service.initialize();
      await service.initialize();
      // Should only initialize SPARQL service once
      expect(mockSparqlInitialize).toHaveBeenCalledTimes(1);
    });
  });

  describe("renderLayout", () => {
    const layoutFile = createMockFile("layouts/TaskTable.md");

    it("should successfully render a layout", async () => {
      const result = await service.renderLayout(layoutFile);

      expect(result.success).toBe(true);
      expect(result.layout).toBeDefined();
      expect(result.rows).toBeDefined();
      expect(result.query).toBeDefined();
    });

    it("should return cached result on subsequent calls", async () => {
      const result1 = await service.renderLayout(layoutFile);
      const result2 = await service.renderLayout(layoutFile);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      // Parser should only be called once due to caching
      expect(mockParserParseFromFile).toHaveBeenCalledTimes(1);
    });

    it("should bypass cache when useCache is false", async () => {
      await service.renderLayout(layoutFile);
      await service.renderLayout(layoutFile, { useCache: false });

      // Parser should be called twice since cache was bypassed
      expect(mockParserParseFromFile).toHaveBeenCalledTimes(2);
    });

    it("should return error for invalid layout", async () => {
      mockParserParseFromFile.mockResolvedValue({
        success: false,
        error: "Invalid layout file",
      });

      const result = await service.renderLayout(layoutFile);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Invalid layout file");
    });

    it("should transform SPARQL results to table rows", async () => {
      // Setup layout with columns
      const layoutWithColumns: TableLayout = {
        ...defaultLayout,
        columns: [
          { uid: "col-001", label: "Label", property: "[[exo__Asset_label]]" },
          { uid: "col-002", label: "Status", property: "[[ems__Effort_status]]" },
        ],
      };
      mockParserParseFromFile.mockResolvedValue({
        success: true,
        layout: layoutWithColumns,
      });

      // Setup SPARQL results
      const mapping = new SolutionMapping();
      mapping.set("asset", new IRI("obsidian://vault/03%20Knowledge/task-001.md"));
      mapping.set("col0", new Literal("Task 1"));
      mapping.set("col1", new Literal("Done"));
      mockSparqlQuery.mockResolvedValue([mapping]);

      const result = await service.renderLayout(layoutFile);

      expect(result.success).toBe(true);
      expect(result.rows).toHaveLength(1);
      expect(result.rows![0].path).toBe("03 Knowledge/task-001.md");
      expect(result.rows![0].values["col-001"]).toBe("Task 1");
      expect(result.rows![0].values["col-002"]).toBe("Done");
    });

    it("should handle missing asset binding in SPARQL results", async () => {
      // Result without asset binding should be skipped
      const mapping = new SolutionMapping();
      mapping.set("col0", new Literal("Value"));
      mockSparqlQuery.mockResolvedValue([mapping]);

      const result = await service.renderLayout(layoutFile);

      expect(result.success).toBe(true);
      expect(result.rows).toHaveLength(0);
    });

    it("should convert number renderer values to numbers", async () => {
      const layoutWithNumber: TableLayout = {
        ...defaultLayout,
        columns: [
          { uid: "col-001", label: "Count", property: "[[count]]", renderer: "number" },
        ],
      };
      mockParserParseFromFile.mockResolvedValue({
        success: true,
        layout: layoutWithNumber,
      });

      const mapping = new SolutionMapping();
      mapping.set("asset", new IRI("obsidian://vault/test.md"));
      mapping.set("col0", new Literal("42"));
      mockSparqlQuery.mockResolvedValue([mapping]);

      const result = await service.renderLayout(layoutFile);

      expect(result.success).toBe(true);
      expect(result.rows![0].values["col-001"]).toBe(42);
    });

    it("should convert boolean renderer values to booleans", async () => {
      const layoutWithBoolean: TableLayout = {
        ...defaultLayout,
        columns: [
          { uid: "col-001", label: "Active", property: "[[active]]", renderer: "boolean" },
        ],
      };
      mockParserParseFromFile.mockResolvedValue({
        success: true,
        layout: layoutWithBoolean,
      });

      const mapping = new SolutionMapping();
      mapping.set("asset", new IRI("obsidian://vault/test.md"));
      mapping.set("col0", new Literal("true"));
      mockSparqlQuery.mockResolvedValue([mapping]);

      const result = await service.renderLayout(layoutFile);

      expect(result.success).toBe(true);
      expect(result.rows![0].values["col-001"]).toBe(true);
    });

    it("should convert datetime renderer values to Date objects", async () => {
      const layoutWithDatetime: TableLayout = {
        ...defaultLayout,
        columns: [
          { uid: "col-001", label: "Created", property: "[[created]]", renderer: "datetime" },
        ],
      };
      mockParserParseFromFile.mockResolvedValue({
        success: true,
        layout: layoutWithDatetime,
      });

      const mapping = new SolutionMapping();
      mapping.set("asset", new IRI("obsidian://vault/test.md"));
      mapping.set("col0", new Literal("2024-01-15T10:30:00.000Z"));
      mockSparqlQuery.mockResolvedValue([mapping]);

      const result = await service.renderLayout(layoutFile);

      expect(result.success).toBe(true);
      expect(result.rows![0].values["col-001"]).toBeInstanceOf(Date);
    });
  });

  describe("renderLayoutFromWikiLink", () => {
    it("should render layout from wikilink", async () => {
      const result = await service.renderLayoutFromWikiLink("[[TaskTable]]");

      expect(result.success).toBe(true);
      expect(result.layout).toBeDefined();
    });

    it("should return error for unresolved wikilink", async () => {
      mockParserParseFromWikiLink.mockResolvedValue(null);

      const result = await service.renderLayoutFromWikiLink("[[NonExistent]]");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to resolve layout from wikilink");
    });
  });

  describe("handleCellEdit", () => {
    it("should update frontmatter for valid file", async () => {
      const files = new Map<string, IFrontmatter | null>([
        ["tasks/task-001.md", { exo__Asset_uid: "001", exo__Asset_label: "Old Label" }],
      ]);
      mockVaultAdapter = createMockVaultAdapter(files);
      service = new LayoutService(mockApp, mockVaultAdapter, mockLogger, mockNotifier);

      const result = await service.handleCellEdit("tasks/task-001.md", "exo__Asset_label", "New Label");

      expect(result.success).toBe(true);
      expect(mockVaultAdapter.updateFrontmatter).toHaveBeenCalled();
    });

    it("should return error for non-existent file", async () => {
      mockVaultAdapter.getAbstractFileByPath.mockReturnValue(null);

      const result = await service.handleCellEdit("nonexistent.md", "property", "value");

      expect(result.success).toBe(false);
      expect(result.error).toContain("File not found");
    });

    it("should format boolean values correctly", async () => {
      const files = new Map<string, IFrontmatter | null>([
        ["tasks/task-001.md", { exo__Asset_uid: "001" }],
      ]);
      mockVaultAdapter = createMockVaultAdapter(files);
      service = new LayoutService(mockApp, mockVaultAdapter, mockLogger, mockNotifier);

      await service.handleCellEdit("tasks/task-001.md", "active", true);

      expect(mockVaultAdapter.updateFrontmatter).toHaveBeenCalled();
    });

    it("should format Date values as ISO strings", async () => {
      const files = new Map<string, IFrontmatter | null>([
        ["tasks/task-001.md", { exo__Asset_uid: "001" }],
      ]);
      mockVaultAdapter = createMockVaultAdapter(files);
      service = new LayoutService(mockApp, mockVaultAdapter, mockLogger, mockNotifier);

      const testDate = new Date("2024-01-15T10:30:00.000Z");
      await service.handleCellEdit("tasks/task-001.md", "created", testDate);

      expect(mockVaultAdapter.updateFrontmatter).toHaveBeenCalled();
    });
  });

  describe("handleSortChange", () => {
    it("should re-render with new sort", async () => {
      const sort: LayoutSort = {
        property: "[[exo__Asset_label]]",
        direction: "asc",
      };

      const result = await service.handleSortChange(defaultLayout, sort);

      expect(result.success).toBe(true);
      expect(result.layout?.defaultSort).toEqual(sort);
    });

    it("should handle query builder failure", async () => {
      // Mock query builder to return failure by returning a layout without query
      const { LayoutQueryBuilder } = await import("../../../../src/application/layout/LayoutQueryBuilder");
      const originalBuild = LayoutQueryBuilder.prototype.build;
      LayoutQueryBuilder.prototype.build = jest.fn().mockReturnValue({
        success: false,
        error: "Query build failed",
      });

      const sort: LayoutSort = {
        property: "[[exo__Asset_label]]",
        direction: "desc",
      };

      const result = await service.handleSortChange(defaultLayout, sort);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Query build failed");

      // Restore original
      LayoutQueryBuilder.prototype.build = originalBuild;
    });
  });

  describe("refreshLayout", () => {
    const layoutFile = createMockFile("layouts/TaskTable.md");

    it("should invalidate cache and re-render", async () => {
      // First render to populate cache
      await service.renderLayout(layoutFile);
      // Refresh
      await service.refreshLayout(layoutFile);

      expect(mockParserInvalidateCache).toHaveBeenCalledWith(layoutFile.path);
      expect(mockSparqlRefresh).toHaveBeenCalled();
      // Parser should be called twice (initial + refresh)
      expect(mockParserParseFromFile).toHaveBeenCalledTimes(2);
    });
  });

  describe("clearCache", () => {
    it("should clear parser cache and layout cache", () => {
      service.clearCache();

      expect(mockParserClearCache).toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith("Layout caches cleared");
    });
  });

  describe("dispose", () => {
    it("should dispose SPARQL service and clear caches", async () => {
      await service.dispose();

      expect(mockSparqlDispose).toHaveBeenCalled();
      expect(mockParserClearCache).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith("LayoutService disposed");
    });
  });

  describe("URI handling", () => {
    it("should handle obsidian:// URIs", async () => {
      const layoutWithColumns: TableLayout = {
        ...defaultLayout,
        columns: [
          { uid: "col-001", label: "Label", property: "[[exo__Asset_label]]" },
        ],
      };
      mockParserParseFromFile.mockResolvedValue({
        success: true,
        layout: layoutWithColumns,
      });

      const mapping = new SolutionMapping();
      mapping.set("asset", new IRI("obsidian://vault/03%20Knowledge%2Fkitelev%2Ftask.md"));
      mapping.set("col0", new Literal("Test"));
      mockSparqlQuery.mockResolvedValue([mapping]);

      const layoutFile = createMockFile("layouts/UriTest.md");
      const result = await service.renderLayout(layoutFile);

      expect(result.success).toBe(true);
      expect(result.rows![0].path).toBe("03 Knowledge/kitelev/task.md");
    });

    it("should handle file:// URIs", async () => {
      const layoutWithColumns: TableLayout = {
        ...defaultLayout,
        columns: [
          { uid: "col-001", label: "Label", property: "[[exo__Asset_label]]" },
        ],
      };
      mockParserParseFromFile.mockResolvedValue({
        success: true,
        layout: layoutWithColumns,
      });

      const mapping = new SolutionMapping();
      mapping.set("asset", new IRI("file:///path/to/file.md"));
      mapping.set("col0", new Literal("Test"));
      mockSparqlQuery.mockResolvedValue([mapping]);

      const layoutFile = createMockFile("layouts/UriTest2.md");
      const result = await service.renderLayout(layoutFile);

      expect(result.success).toBe(true);
      expect(result.rows![0].path).toBe("/path/to/file.md");
    });

    it("should extract UUID from path", async () => {
      const layoutWithColumns: TableLayout = {
        ...defaultLayout,
        columns: [
          { uid: "col-001", label: "Label", property: "[[exo__Asset_label]]" },
        ],
      };
      mockParserParseFromFile.mockResolvedValue({
        success: true,
        layout: layoutWithColumns,
      });

      const mapping = new SolutionMapping();
      mapping.set("asset", new IRI("obsidian://vault/03%20Knowledge/12345678-1234-1234-1234-123456789abc.md"));
      mapping.set("col0", new Literal("Test"));
      mockSparqlQuery.mockResolvedValue([mapping]);

      const layoutFile = createMockFile("layouts/UriTest3.md");
      const result = await service.renderLayout(layoutFile);

      expect(result.success).toBe(true);
      expect(result.rows![0].id).toBe("12345678-1234-1234-1234-123456789abc");
    });
  });

  describe("error handling", () => {
    it("should handle parser exceptions", async () => {
      mockParserParseFromFile.mockRejectedValue(new Error("Parse error"));

      const layoutFile = createMockFile("layouts/ErrorTest.md");
      const result = await service.renderLayout(layoutFile);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Parse error");
    });

    it("should handle SPARQL query exceptions", async () => {
      mockSparqlQuery.mockRejectedValue(new Error("Query timeout"));

      const layoutFile = createMockFile("layouts/ErrorTest2.md");
      const result = await service.renderLayout(layoutFile);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Query timeout");
    });
  });
});
