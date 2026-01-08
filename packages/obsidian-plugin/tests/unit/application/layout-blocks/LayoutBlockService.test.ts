import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type { ILogger } from "exocortex";
import { SolutionMapping, Literal, IRI } from "exocortex";
import {
  LayoutBlockService,
  type LayoutBlockServiceOptions,
} from "../../../../src/application/layout-blocks/LayoutBlockService";
import type {
  LayoutBlock,
  LayoutWithBlocks,
} from "../../../../src/domain/layout-blocks";
import { LAYOUT_URIS, LAYOUT_BLOCK_URIS } from "../../../../src/domain/layout-blocks";

// Mock SPARQLQueryService
const mockQuery = jest.fn<() => Promise<SolutionMapping[]>>();
const mockInitialize = jest.fn<() => Promise<void>>();
const mockDispose = jest.fn<() => Promise<void>>();

jest.mock("../../../../src/application/services/SPARQLQueryService", () => {
  return {
    SPARQLQueryService: function() {
      return {
        initialize: mockInitialize,
        query: mockQuery,
        dispose: mockDispose,
        getTripleStore: jest.fn(),
      };
    },
  };
});

// Mock logger
function createMockLogger(): jest.Mocked<ILogger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

// Mock Obsidian App
const mockApp = {
  vault: {
    getAbstractFileByPath: jest.fn(),
  },
} as unknown as import("obsidian").App;

describe("LayoutBlockService", () => {
  let service: LayoutBlockService;
  let mockLogger: jest.Mocked<ILogger>;

  beforeEach(() => {
    mockQuery.mockClear();
    mockInitialize.mockClear();
    mockDispose.mockClear();
    mockInitialize.mockResolvedValue(undefined);
    mockQuery.mockResolvedValue([]);
    mockDispose.mockResolvedValue(undefined);
    mockLogger = createMockLogger();
    service = new LayoutBlockService(mockApp, mockLogger);
  });

  describe("constructor", () => {
    it("should create a LayoutBlockService instance", () => {
      expect(service).toBeInstanceOf(LayoutBlockService);
    });

    it("should create with default logger when not provided", () => {
      const serviceWithoutLogger = new LayoutBlockService(mockApp);
      expect(serviceWithoutLogger).toBeInstanceOf(LayoutBlockService);
    });
  });

  describe("initialize", () => {
    it("should initialize the service", async () => {
      await service.initialize();
      expect(mockInitialize).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith("LayoutBlockService initialized");
    });

    it("should be idempotent", async () => {
      await service.initialize();
      await service.initialize();
      expect(mockInitialize).toHaveBeenCalledTimes(1);
    });
  });

  describe("loadLayout", () => {
    it("should load layout with its blocks from RDF", async () => {
      // Mock query to return layout with blocks
      const layoutLabel = new SolutionMapping();
      layoutLabel.set("label", new Literal("Default Asset Layout"));

      // Mock blocks query results
      const block1 = new SolutionMapping();
      block1.set("block", new IRI(LAYOUT_BLOCK_URIS.IDENTITY));
      block1.set("label", new Literal("Identity"));
      block1.set("query", new Literal("SELECT ?label WHERE { ?asset exo:Asset_label ?label }"));
      block1.set("renderer", new Literal("identity"));
      block1.set("order", new Literal("1"));
      block1.set("headless", new Literal("true"));

      const block2 = new SolutionMapping();
      block2.set("block", new IRI(LAYOUT_BLOCK_URIS.INBOUND_RELATIONS));
      block2.set("label", new Literal("Inbound Relations"));
      block2.set("query", new Literal("SELECT ?source ?predicate WHERE { ?source ?predicate ?asset }"));
      block2.set("renderer", new Literal("relations-table"));
      block2.set("order", new Literal("3"));
      block2.set("headless", new Literal("true"));

      mockQuery
        .mockResolvedValueOnce([layoutLabel]) // Layout label query
        .mockResolvedValueOnce([block1, block2]); // Blocks query

      const layout = await service.loadLayout(LAYOUT_URIS.DEFAULT_ASSET_LAYOUT);

      expect(layout).toBeDefined();
      expect(layout.layoutUri).toBe(LAYOUT_URIS.DEFAULT_ASSET_LAYOUT);
      expect(layout.blocks).toHaveLength(2);
      expect(layout.blocks[0].renderer).toBe("identity");
      expect(layout.blocks[1].renderer).toBe("relations-table");
    });

    it("should order blocks by their order property", async () => {
      const layoutLabel = new SolutionMapping();
      layoutLabel.set("label", new Literal("Test Layout"));

      const block1 = new SolutionMapping();
      block1.set("block", new IRI("https://exocortex.my/ontology/exo-ui#Block1"));
      block1.set("label", new Literal("Block 1"));
      block1.set("query", new Literal("SELECT * WHERE {}"));
      block1.set("renderer", new Literal("identity"));
      block1.set("order", new Literal("3"));
      block1.set("headless", new Literal("true"));

      const block2 = new SolutionMapping();
      block2.set("block", new IRI("https://exocortex.my/ontology/exo-ui#Block2"));
      block2.set("label", new Literal("Block 2"));
      block2.set("query", new Literal("SELECT * WHERE {}"));
      block2.set("renderer", new Literal("classification"));
      block2.set("order", new Literal("1"));
      block2.set("headless", new Literal("true"));

      mockQuery
        .mockResolvedValueOnce([layoutLabel])
        .mockResolvedValueOnce([block1, block2]);

      const layout = await service.loadLayout("https://exocortex.my/ontology/test#layout");

      expect(layout!.blocks[0].order).toBe(1);
      expect(layout!.blocks[1].order).toBe(3);
    });

    it("should return null for non-existent layout", async () => {
      mockQuery.mockResolvedValueOnce([]); // No layout found

      const layout = await service.loadLayout("https://exocortex.my/ontology/test#non-existent-layout");

      expect(layout).toBeNull();
    });

    it("should handle layout with no blocks", async () => {
      const layoutLabel = new SolutionMapping();
      layoutLabel.set("label", new Literal("Empty Layout"));

      mockQuery
        .mockResolvedValueOnce([layoutLabel])
        .mockResolvedValueOnce([]); // No blocks

      const layout = await service.loadLayout("https://exocortex.my/ontology/test#empty-layout");

      expect(layout).toBeDefined();
      expect(layout!.blocks).toHaveLength(0);
    });

    it("should default headless to true when not specified", async () => {
      const layoutLabel = new SolutionMapping();
      layoutLabel.set("label", new Literal("Test Layout"));

      const block = new SolutionMapping();
      block.set("block", new IRI("https://exocortex.my/ontology/exo-ui#BlockNoHeadless"));
      block.set("label", new Literal("Block Without Headless"));
      block.set("query", new Literal("SELECT * WHERE {}"));
      block.set("renderer", new Literal("test"));
      block.set("order", new Literal("1"));
      // No headless property

      mockQuery
        .mockResolvedValueOnce([layoutLabel])
        .mockResolvedValueOnce([block]);

      const layout = await service.loadLayout("https://exocortex.my/ontology/test#layout");

      expect(layout!.blocks[0].headless).toBe(true);
    });
  });

  describe("getBlock", () => {
    it("should load a single block by URI", async () => {
      const block = new SolutionMapping();
      block.set("label", new Literal("Identity Block"));
      block.set("query", new Literal("SELECT ?label WHERE { ?asset exo:Asset_label ?label }"));
      block.set("renderer", new Literal("identity"));
      block.set("order", new Literal("1"));
      block.set("headless", new Literal("true"));

      mockQuery.mockResolvedValueOnce([block]);

      const result = await service.getBlock(LAYOUT_BLOCK_URIS.IDENTITY);

      expect(result).toBeDefined();
      expect(result!.uri).toBe(LAYOUT_BLOCK_URIS.IDENTITY);
      expect(result!.renderer).toBe("identity");
    });

    it("should return null for non-existent block", async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await service.getBlock("https://exocortex.my/ontology/test#non-existent-block");

      expect(result).toBeNull();
    });
  });

  describe("executeBlockQuery", () => {
    it("should execute block query with asset URI substitution", async () => {
      // First call for auto-initialize (returns empty for label query)
      // Then the actual block query
      const block: LayoutBlock = {
        uri: LAYOUT_BLOCK_URIS.IDENTITY,
        label: "Identity",
        query: "SELECT ?label ?uid WHERE { ?asset exo:Asset_label ?label . ?asset exo:Asset_uid ?uid }",
        renderer: "identity",
        order: 1,
        headless: true,
      };

      const assetUri = "obsidian://vault/test-asset.md";

      // Mock query result
      const result = new SolutionMapping();
      result.set("label", new Literal("Test Asset"));
      result.set("uid", new Literal("12345678-1234-1234-1234-123456789abc"));
      mockQuery.mockResolvedValueOnce([result]);

      const queryResult = await service.executeBlockQuery(block, assetUri);

      // Verify query was called with substituted asset URI
      expect(mockQuery).toHaveBeenCalled();
      const lastCallIndex = mockQuery.mock.calls.length - 1;
      const calledQuery = mockQuery.mock.calls[lastCallIndex][0] as string;
      expect(calledQuery).toContain(`<${assetUri}>`);
      expect(calledQuery).not.toContain("?asset");

      // Verify results
      expect(queryResult.block).toBe(block);
      expect(queryResult.bindings).toHaveLength(1);
      expect(queryResult.bindings[0]["label"]).toBe("Test Asset");
    });

    it("should handle empty query results", async () => {
      const block: LayoutBlock = {
        uri: "https://exocortex.my/ontology/test#block",
        label: "Test",
        query: "SELECT ?x WHERE { ?asset ?p ?x }",
        renderer: "test",
        order: 1,
        headless: true,
      };

      mockQuery.mockResolvedValueOnce([]);

      const result = await service.executeBlockQuery(block, "https://exocortex.my/ontology/test#asset");

      expect(result.bindings).toHaveLength(0);
    });

    it("should handle IRI values in query results", async () => {
      const block: LayoutBlock = {
        uri: "https://exocortex.my/ontology/test#block",
        label: "Test",
        query: "SELECT ?class WHERE { ?asset rdf:type ?class }",
        renderer: "test",
        order: 1,
        headless: true,
      };

      const result = new SolutionMapping();
      result.set("class", new IRI("https://exocortex.my/ontology/exo#Task"));
      mockQuery.mockResolvedValueOnce([result]);

      const queryResult = await service.executeBlockQuery(block, "https://exocortex.my/ontology/test#asset");

      expect(queryResult.bindings[0]["class"]).toBe("https://exocortex.my/ontology/exo#Task");
    });
  });

  describe("getRelationsBlocks", () => {
    it("should return inbound and outbound relations blocks", async () => {
      // Mock inbound block
      const inboundBlock = new SolutionMapping();
      inboundBlock.set("label", new Literal("Inbound Relations"));
      inboundBlock.set("query", new Literal("SELECT ?source WHERE { ?source ?p ?asset }"));
      inboundBlock.set("renderer", new Literal("relations-table"));
      inboundBlock.set("order", new Literal("3"));
      inboundBlock.set("headless", new Literal("true"));

      // Mock outbound block
      const outboundBlock = new SolutionMapping();
      outboundBlock.set("label", new Literal("Outbound Relations"));
      outboundBlock.set("query", new Literal("SELECT ?target WHERE { ?asset ?p ?target }"));
      outboundBlock.set("renderer", new Literal("relations-table"));
      outboundBlock.set("order", new Literal("4"));
      outboundBlock.set("headless", new Literal("true"));

      mockQuery
        .mockResolvedValueOnce([inboundBlock])
        .mockResolvedValueOnce([outboundBlock]);

      const blocks = await service.getRelationsBlocks();

      expect(blocks.inbound).toBeDefined();
      expect(blocks.outbound).toBeDefined();
      expect(blocks.inbound!.label).toBe("Inbound Relations");
      expect(blocks.outbound!.label).toBe("Outbound Relations");
    });

    it("should return null for missing relation blocks", async () => {
      mockQuery.mockResolvedValue([]);

      const blocks = await service.getRelationsBlocks();

      expect(blocks.inbound).toBeNull();
      expect(blocks.outbound).toBeNull();
    });
  });

  describe("dispose", () => {
    it("should dispose of resources", async () => {
      await service.initialize();
      await service.dispose();

      expect(mockDispose).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith("LayoutBlockService disposed");
    });
  });

  describe("fallback behavior", () => {
    it("should provide default relations query when block has no query", async () => {
      const blockWithoutQuery: LayoutBlock = {
        uri: LAYOUT_BLOCK_URIS.INBOUND_RELATIONS,
        label: "Inbound Relations",
        query: "", // Empty query
        renderer: "relations-table",
        order: 3,
        headless: true,
      };

      const assetUri = "obsidian://vault/test.md";

      // Even with empty query, service should handle gracefully
      mockQuery.mockResolvedValueOnce([]);

      const result = await service.executeBlockQuery(blockWithoutQuery, assetUri);

      // Should not throw, should return empty results
      expect(result.bindings).toEqual([]);
    });
  });
});
