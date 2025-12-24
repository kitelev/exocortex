/**
 * Tests for GraphTooltipDataProvider - Triple store integration for tooltip data
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import {
  GraphTooltipDataProvider,
  DEFAULT_GRAPH_TOOLTIP_PROVIDER_CONFIG,
  type TripleStore,
  type FileContentProvider,
  type GraphTooltipDataProviderConfig,
} from "../../../../../src/presentation/renderers/graph/GraphTooltipDataProvider";
import type { GraphNode, GraphEdge } from "../../../../../src/presentation/renderers/graph/types";

// Create mock graph nodes
function createMockNodes(): GraphNode[] {
  return [
    {
      id: "node-0",
      label: "Task 1",
      path: "/path/to/task-1.md",
      x: 0,
      y: 0,
      metadata: {
        "exo:Instance_class": "[[ems__Task]]",
        "ems:Effort_status": "Active",
        "ems:Effort_priority": "High",
      },
    },
    {
      id: "node-1",
      label: "Project A",
      path: "/path/to/project-a.md",
      x: 50,
      y: 30,
      group: "ems__Project",
    },
    {
      id: "node-2",
      label: "Person X",
      path: "/path/to/person-x.md",
      x: 100,
      y: 60,
    },
  ];
}

// Create mock graph edges
function createMockEdges(): GraphEdge[] {
  return [
    {
      id: "edge-0",
      source: "node-0",
      target: "node-1",
      label: "belongs_to",
      property: "ems:Effort_parent",
    },
    {
      id: "edge-1",
      source: "node-0",
      target: "node-2",
      label: "assigned_to",
      property: "ems:Task_assignee",
      weight: 1.5,
    },
  ];
}

// Create mock triple store
function createMockTripleStore(): TripleStore & {
  getBySubjectMock: jest.Mock;
  getByPredicateObjectMock: jest.Mock;
  countBySubjectPredicateMock: jest.Mock;
} {
  const getBySubjectMock = jest.fn().mockImplementation((subject: string) => {
    if (subject === "node-0") {
      return [
        { predicate: "exo:Instance_class", object: "[[ems__Task]]" },
        { predicate: "exo:Asset_label", object: "Task 1" },
        { predicate: "ems:Effort_status", object: "Active" },
      ];
    }
    return [];
  });

  const getByPredicateObjectMock = jest.fn().mockReturnValue([]);
  const countBySubjectPredicateMock = jest.fn().mockReturnValue(0);

  return {
    getBySubject: getBySubjectMock,
    getByPredicateObject: getByPredicateObjectMock,
    countBySubjectPredicate: countBySubjectPredicateMock,
    getBySubjectMock,
    getByPredicateObjectMock,
    countBySubjectPredicateMock,
  };
}

// Create mock file content provider
function createMockFileContentProvider(): FileContentProvider & { getContentMock: jest.Mock } {
  const getContentMock = jest.fn().mockImplementation(async (path: string) => {
    if (path.includes("task-1")) {
      return `---
exo__Instance_class: "[[ems__Task]]"
ems__Effort_status: Active
---

# Task 1

This is the content of Task 1.

## Details

Some **bold** and *italic* text.

- Item 1
- Item 2
`;
    }
    return null;
  });

  return {
    getContent: getContentMock,
    getContentMock,
  };
}

describe("GraphTooltipDataProvider", () => {
  let provider: GraphTooltipDataProvider;
  let mockNodes: GraphNode[];
  let mockEdges: GraphEdge[];

  beforeEach(() => {
    mockNodes = createMockNodes();
    mockEdges = createMockEdges();
    provider = new GraphTooltipDataProvider();
    provider.setNodes(mockNodes);
    provider.setEdges(mockEdges);
  });

  afterEach(() => {
    provider.destroy();
  });

  describe("initialization", () => {
    it("should use default config", () => {
      const config = provider.getConfig();
      expect(config.maxProperties).toBe(10);
      expect(config.maxPreviewLength).toBe(500);
    });

    it("should accept custom config", () => {
      provider.destroy();
      provider = new GraphTooltipDataProvider({
        config: {
          maxProperties: 5,
          maxPreviewLength: 200,
        },
      });

      const config = provider.getConfig();
      expect(config.maxProperties).toBe(5);
      expect(config.maxPreviewLength).toBe(200);
    });
  });

  describe("DEFAULT_GRAPH_TOOLTIP_PROVIDER_CONFIG", () => {
    it("should have expected default values", () => {
      expect(DEFAULT_GRAPH_TOOLTIP_PROVIDER_CONFIG.maxProperties).toBe(10);
      expect(DEFAULT_GRAPH_TOOLTIP_PROVIDER_CONFIG.maxPreviewLength).toBe(500);
      expect(DEFAULT_GRAPH_TOOLTIP_PROVIDER_CONFIG.excludedProperties).toContain("exo:Instance_class");
    });
  });

  describe("getTooltipData for nodes", () => {
    it("should return tooltip data for existing node", async () => {
      const data = await provider.getTooltipData("node-0", "node");

      expect(data.id).toBe("node-0");
      expect(data.title).toBe("Task 1");
      expect(data.path).toBe("/path/to/task-1.md");
    });

    it("should return default data for non-existent node", async () => {
      const data = await provider.getTooltipData("non-existent", "node");

      expect(data.id).toBe("non-existent");
      expect(data.title).toBe("non-existent");
      expect(data.type).toBe("unknown");
      expect(data.properties).toEqual([]);
    });

    it("should calculate relationship counts from edges", async () => {
      const data = await provider.getTooltipData("node-0", "node");

      // node-0 has 2 outgoing edges (to node-1 and node-2)
      expect(data.outgoingCount).toBe(2);
      expect(data.incomingCount).toBe(0);
    });

    it("should extract type from metadata", async () => {
      const data = await provider.getTooltipData("node-0", "node");
      expect(data.type).toBe("task");
    });

    it("should extract type from group", async () => {
      const data = await provider.getTooltipData("node-1", "node");
      expect(data.type).toBe("project");
    });

    it("should extract properties from metadata", async () => {
      const data = await provider.getTooltipData("node-0", "node");

      const statusProp = data.properties.find((p) => p.name === "Status");
      expect(statusProp).toBeDefined();
      expect(statusProp?.value).toBe("Active");
    });

    it("should exclude configured properties", async () => {
      const data = await provider.getTooltipData("node-0", "node");

      // Instance_class should be excluded
      const classProps = data.properties.filter((p) =>
        p.name.toLowerCase().includes("class")
      );
      expect(classProps.length).toBe(0);
    });
  });

  describe("getTooltipData for edges", () => {
    it("should return tooltip data for existing edge", async () => {
      const data = await provider.getTooltipData("edge-0", "edge");

      expect(data.id).toBe("edge-0");
      expect(data.title).toBe("belongs_to");
    });

    it("should return default data for non-existent edge", async () => {
      const data = await provider.getTooltipData("non-existent", "edge");

      expect(data.id).toBe("non-existent");
      expect(data.type).toBe("unknown");
    });

    it("should include source and target in properties", async () => {
      const data = await provider.getTooltipData("edge-0", "edge");

      const fromProp = data.properties.find((p) => p.name === "From");
      const toProp = data.properties.find((p) => p.name === "To");

      expect(fromProp).toBeDefined();
      expect(fromProp?.value).toBe("Task 1");
      expect(toProp).toBeDefined();
      expect(toProp?.value).toBe("Project A");
    });

    it("should include relation type in properties", async () => {
      const data = await provider.getTooltipData("edge-0", "edge");

      const relationProp = data.properties.find((p) => p.name === "Relation");
      expect(relationProp).toBeDefined();
      expect(relationProp?.value).toBe("Parent");
    });

    it("should include weight if present", async () => {
      const data = await provider.getTooltipData("edge-1", "edge");

      const weightProp = data.properties.find((p) => p.name === "Weight");
      expect(weightProp).toBeDefined();
      expect(weightProp?.value).toBe("1.5");
    });
  });

  describe("triple store integration", () => {
    it("should use triple store when available", async () => {
      const mockStore = createMockTripleStore();
      provider.setTripleStore(mockStore);

      await provider.getTooltipData("node-0", "node");

      expect(mockStore.getBySubjectMock).toHaveBeenCalledWith("node-0");
    });

    it("should extract type from triple store", async () => {
      const mockStore = createMockTripleStore();
      provider.setTripleStore(mockStore);

      // Use a node without metadata
      const data = await provider.getTooltipData("node-2", "node");

      // Should query triple store for Instance_class
      expect(mockStore.getBySubjectMock).toHaveBeenCalledWith("node-2");
    });

    it("should add properties from triple store", async () => {
      const mockStore = createMockTripleStore();
      provider.setTripleStore(mockStore);

      const data = await provider.getTooltipData("node-0", "node");

      // Should have properties from both metadata and triple store
      expect(data.properties.length).toBeGreaterThan(0);
    });
  });

  describe("file content provider integration", () => {
    it("should fetch preview from file content provider", async () => {
      const mockContentProvider = createMockFileContentProvider();
      provider.setFileContentProvider(mockContentProvider);

      const data = await provider.getTooltipData("node-0", "node");

      expect(mockContentProvider.getContentMock).toHaveBeenCalledWith("/path/to/task-1.md");
      expect(data.preview).toBeDefined();
    });

    it("should strip frontmatter from preview", async () => {
      const mockContentProvider = createMockFileContentProvider();
      provider.setFileContentProvider(mockContentProvider);

      const data = await provider.getTooltipData("node-0", "node");

      expect(data.preview).not.toContain("---");
      expect(data.preview).not.toContain("exo__Instance_class");
    });

    it("should strip markdown formatting from preview", async () => {
      const mockContentProvider = createMockFileContentProvider();
      provider.setFileContentProvider(mockContentProvider);

      const data = await provider.getTooltipData("node-0", "node");

      expect(data.preview).not.toContain("**");
      expect(data.preview).not.toContain("*");
      expect(data.preview).not.toContain("# ");
    });

    it("should truncate long previews", async () => {
      const mockContentProvider = {
        getContent: jest.fn().mockResolvedValue("A".repeat(1000)),
      };
      provider.setFileContentProvider(mockContentProvider);

      const data = await provider.getTooltipData("node-0", "node");

      expect(data.preview?.length).toBeLessThanOrEqual(510); // 500 + "..."
    });

    it("should handle missing file gracefully", async () => {
      const mockContentProvider = {
        getContent: jest.fn().mockResolvedValue(null),
      };
      provider.setFileContentProvider(mockContentProvider);

      const data = await provider.getTooltipData("node-0", "node");

      expect(data.preview).toBeUndefined();
    });

    it("should handle file read errors gracefully", async () => {
      const mockContentProvider = {
        getContent: jest.fn().mockRejectedValue(new Error("File not found")),
      };
      provider.setFileContentProvider(mockContentProvider);

      const data = await provider.getTooltipData("node-0", "node");

      expect(data.preview).toBeUndefined();
    });
  });

  describe("edge lookup", () => {
    it("should count incoming and outgoing edges correctly", async () => {
      // node-1 has 1 incoming edge from node-0
      const data1 = await provider.getTooltipData("node-1", "node");
      expect(data1.incomingCount).toBe(1);
      expect(data1.outgoingCount).toBe(0);

      // node-2 has 1 incoming edge from node-0
      const data2 = await provider.getTooltipData("node-2", "node");
      expect(data2.incomingCount).toBe(1);
      expect(data2.outgoingCount).toBe(0);
    });

    it("should rebuild edge lookup when edges change", async () => {
      // Add a new edge
      const newEdges = [
        ...mockEdges,
        {
          id: "edge-2",
          source: "node-1",
          target: "node-0",
          label: "related_to",
        },
      ];
      provider.setEdges(newEdges);

      const data = await provider.getTooltipData("node-0", "node");

      // Now node-0 should have 1 incoming edge
      expect(data.incomingCount).toBe(1);
      expect(data.outgoingCount).toBe(2);
    });
  });

  describe("property formatting", () => {
    it("should format wikilinks in property values", async () => {
      // Create node with wikilink property
      const nodeWithWikilink: GraphNode = {
        id: "node-with-wikilink",
        label: "Test Node",
        path: "/path/to/test.md",
        metadata: {
          "ems:Effort_parent": "[[03 Knowledge/project/My Project|My Project]]",
        },
      };
      provider.setNodes([...mockNodes, nodeWithWikilink]);

      const data = await provider.getTooltipData("node-with-wikilink", "node");

      const parentProp = data.properties.find((p) => p.name === "Parent");
      expect(parentProp?.value).toBe("My Project");
    });

    it("should format timestamps", async () => {
      const nodeWithTimestamp: GraphNode = {
        id: "node-with-timestamp",
        label: "Test Node",
        path: "/path/to/test.md",
        metadata: {
          "ems:Effort_startTimestamp": "2025-01-15T10:30:00Z",
        },
      };
      provider.setNodes([...mockNodes, nodeWithTimestamp]);

      const data = await provider.getTooltipData("node-with-timestamp", "node");

      const startProp = data.properties.find((p) => p.name === "Started");
      expect(startProp?.value).toContain("2025");
    });

    it("should format JS date strings", async () => {
      const nodeWithJsDate: GraphNode = {
        id: "node-with-jsdate",
        label: "Test Node",
        path: "/path/to/test.md",
        metadata: {
          "ems:Effort_startTimestamp": "Wed Jan 15 2025 10:30:00 GMT+0500",
        },
      };
      provider.setNodes([...mockNodes, nodeWithJsDate]);

      const data = await provider.getTooltipData("node-with-jsdate", "node");

      const startProp = data.properties.find((p) => p.name === "Started");
      expect(startProp?.value).toBeDefined();
    });
  });

  describe("config updates", () => {
    it("should update config via setConfig", () => {
      provider.setConfig({ maxProperties: 3 });
      expect(provider.getConfig().maxProperties).toBe(3);
    });

    it("should preserve existing config values when updating", () => {
      provider.setConfig({ maxProperties: 3 });
      provider.setConfig({ maxPreviewLength: 100 });

      const config = provider.getConfig();
      expect(config.maxProperties).toBe(3);
      expect(config.maxPreviewLength).toBe(100);
    });
  });

  describe("destroy", () => {
    it("should clear node and edge maps", () => {
      provider.destroy();

      // After destroy, getting data should return default
      return provider.getTooltipData("node-0", "node").then((data) => {
        expect(data.title).toBe("node-0"); // Uses ID as fallback
      });
    });
  });
});
