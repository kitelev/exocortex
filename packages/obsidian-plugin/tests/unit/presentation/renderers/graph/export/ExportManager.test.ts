/**
 * ExportManager Unit Tests
 *
 * Tests for graph export functionality supporting PNG, JPEG, WebP, and SVG formats.
 *
 * @module presentation/renderers/graph/export
 */

import {
  ExportManager,
  createExportManager,
  DEFAULT_EXPORT_OPTIONS,
  DEFAULT_EXPORT_MANAGER_CONFIG,
  EXPORT_MIME_TYPES,
  EXPORT_FILE_EXTENSIONS,
  type ExportNode,
  type ExportEdge,
  type ExportEvent,
} from "@plugin/presentation/renderers/graph/export";

// Mock canvas and 2D context - create fresh per test
function createMockContext() {
  return {
    scale: jest.fn(),
    fillRect: jest.fn(),
    fillStyle: "",
    translate: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    stroke: jest.fn(),
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "round" as CanvasLineCap,
    globalAlpha: 1,
    arc: jest.fn(),
    fill: jest.fn(),
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    font: "",
    textAlign: "center" as CanvasTextAlign,
    textBaseline: "top" as CanvasTextBaseline,
    fillText: jest.fn(),
  };
}

function createMockCanvas(mockContext: ReturnType<typeof createMockContext>) {
  return {
    width: 800,
    height: 600,
    getContext: jest.fn().mockReturnValue(mockContext),
    toDataURL: jest.fn().mockReturnValue("data:image/png;base64,mockdata"),
    toBlob: jest.fn((callback: (blob: Blob | null) => void) => {
      callback(new Blob(["test"], { type: "image/png" }));
    }),
  };
}

// Store original blob data for text() method in JSDOM
// SVG blobs store the actual SVG string content
const blobDataMap = new WeakMap<Blob, string>();
const OriginalBlob = globalThis.Blob;

// Override Blob to track string content for text() support
globalThis.Blob = class extends OriginalBlob {
  constructor(blobParts?: BlobPart[], options?: BlobPropertyBag) {
    super(blobParts, options);
    // If first part is a string, store it for text() retrieval
    if (blobParts && blobParts.length > 0 && typeof blobParts[0] === "string") {
      blobDataMap.set(this, blobParts[0]);
    }
  }

  text(): Promise<string> {
    const stored = blobDataMap.get(this);
    if (stored !== undefined) {
      return Promise.resolve(stored);
    }
    // Fallback for non-string blobs
    return Promise.resolve("");
  }
} as typeof Blob;

// Test data
const testNodes: ExportNode[] = [
  { id: "node1", label: "Node 1", x: 100, y: 100, radius: 10, color: 0x6366f1 },
  { id: "node2", label: "Node 2", x: 200, y: 150, radius: 8, color: "#22c55e" },
  { id: "node3", label: "Node 3", x: 150, y: 250 },
];

const testEdges: ExportEdge[] = [
  { id: "edge1", sourceId: "node1", targetId: "node2", color: 0x64748b },
  { id: "edge2", sourceId: "node2", targetId: "node3", width: 2 },
];

describe("ExportManager", () => {
  let exportManager: ExportManager;
  let mockContext: ReturnType<typeof createMockContext>;
  let mockCanvas: ReturnType<typeof createMockCanvas>;
  let originalCreateElement: typeof document.createElement;
  let createElementSpy: jest.SpyInstance;

  beforeEach(() => {
    mockContext = createMockContext();
    mockCanvas = createMockCanvas(mockContext);
    originalCreateElement = document.createElement.bind(document);

    createElementSpy = jest.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      if (tagName === "canvas") {
        return mockCanvas as unknown as HTMLCanvasElement;
      }
      return originalCreateElement(tagName);
    });

    exportManager = new ExportManager();
  });

  afterEach(() => {
    createElementSpy.mockRestore();
  });

  describe("constructor", () => {
    it("should create instance with default config", () => {
      const manager = new ExportManager();
      expect(manager).toBeInstanceOf(ExportManager);
    });

    it("should create instance with custom config", () => {
      const manager = new ExportManager({
        maxDimension: 8192,
        timeout: 60000,
        showProgress: false,
        defaultOptions: {
          format: "jpeg",
          quality: 0.8,
        },
      });
      expect(manager).toBeInstanceOf(ExportManager);
    });
  });

  describe("export", () => {
    it("should export to PNG format by default", async () => {
      const result = await exportManager.export(testNodes, testEdges);

      expect(result.format).toBe("png");
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.dataUrl).toContain("data:image/png");
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
      expect(result.fileSize).toBeGreaterThan(0);
    });

    it("should export to JPEG format", async () => {
      const result = await exportManager.export(testNodes, testEdges, {
        format: "jpeg",
        quality: 0.8,
      });

      expect(result.format).toBe("jpeg");
    });

    it("should export to WebP format", async () => {
      const result = await exportManager.export(testNodes, testEdges, {
        format: "webp",
        quality: 0.9,
      });

      expect(result.format).toBe("webp");
    });

    it("should export to SVG format", async () => {
      const result = await exportManager.export(testNodes, testEdges, {
        format: "svg",
      });

      expect(result.format).toBe("svg");
      expect(result.blob.type).toBe("image/svg+xml");
      const svgText = await result.blob.text();
      expect(svgText).toContain("<svg");
      expect(svgText).toContain("</svg>");
    });

    it("should apply custom scale factor", async () => {
      const result = await exportManager.export(testNodes, testEdges, {
        scale: 2,
      });

      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
    });

    it("should apply custom padding", async () => {
      const result = await exportManager.export(testNodes, testEdges, {
        padding: 100,
      });

      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
    });

    it("should use custom background color", async () => {
      await exportManager.export(testNodes, testEdges, {
        backgroundColor: "#1a1a2e",
      });

      expect(mockContext.fillRect).toHaveBeenCalled();
    });

    it("should export with transparent background", async () => {
      const result = await exportManager.export(testNodes, testEdges, {
        backgroundColor: null,
      });

      expect(result.format).toBe("png");
    });

    it("should respect includeLabels option", async () => {
      await exportManager.export(testNodes, testEdges, {
        includeLabels: false,
      });

      // Labels should not be drawn when disabled
      expect(mockContext.fillText).not.toHaveBeenCalled();
    });

    it("should respect includeEdges option", async () => {
      await exportManager.export(testNodes, testEdges, {
        includeEdges: false,
      });

      // Edges should not be drawn when disabled
      const strokeCalls = mockContext.stroke.mock.calls.length;
      // Only node drawing should have occurred, not edge drawing
      expect(strokeCalls).toBe(0);
    });

    it("should use custom bounds when provided", async () => {
      const result = await exportManager.export(testNodes, testEdges, {
        customBounds: { x: 0, y: 0, width: 500, height: 400 },
      });

      expect(result.width).toBe(500);
      expect(result.height).toBe(400);
    });

    it("should throw error for invalid dimensions", async () => {
      const largeNodes: ExportNode[] = [
        { id: "n1", label: "Test", x: 0, y: 0 },
        { id: "n2", label: "Test", x: 20000, y: 20000 },
      ];

      await expect(
        exportManager.export(largeNodes, [], { scale: 1 })
      ).rejects.toThrow("exceed maximum allowed");
    });

    it("should handle empty nodes array", async () => {
      const result = await exportManager.export([], []);

      expect(result.format).toBe("png");
      expect(result.width).toBe(100);
      expect(result.height).toBe(100);
    });

    it("should handle edges with missing nodes", async () => {
      const edges: ExportEdge[] = [
        { id: "e1", sourceId: "missing1", targetId: "missing2" },
      ];

      // Should not throw
      const result = await exportManager.export(testNodes, edges);
      expect(result.format).toBe("png");
    });
  });

  describe("SVG export", () => {
    it("should include metadata in SVG when provided", async () => {
      const result = await exportManager.export(testNodes, testEdges, {
        format: "svg",
        metadata: {
          title: "Test Graph",
          author: "Test User",
        },
      });

      const svgText = await result.blob.text();
      expect(svgText).toContain("<metadata>");
      expect(svgText).toContain("<title>Test Graph</title>");
      expect(svgText).toContain("<author>Test User</author>");
    });

    it("should escape XML special characters in SVG", async () => {
      const nodesWithSpecialChars: ExportNode[] = [
        { id: "n1", label: "Node <>&'\"", x: 100, y: 100 },
      ];

      const result = await exportManager.export(nodesWithSpecialChars, [], {
        format: "svg",
      });

      const svgText = await result.blob.text();
      expect(svgText).toContain("&lt;");
      expect(svgText).toContain("&gt;");
      expect(svgText).toContain("&amp;");
    });

    it("should include viewBox for proper scaling", async () => {
      const result = await exportManager.export(testNodes, testEdges, {
        format: "svg",
        scale: 2,
      });

      const svgText = await result.blob.text();
      expect(svgText).toContain("viewBox=");
    });

    it("should include shadow filter in defs", async () => {
      const result = await exportManager.export(testNodes, testEdges, {
        format: "svg",
      });

      const svgText = await result.blob.text();
      expect(svgText).toContain("<defs>");
      expect(svgText).toContain("<filter id=\"shadow\"");
    });
  });

  describe("cancel", () => {
    it("should not emit cancel event when no export is running", () => {
      const events: ExportEvent[] = [];
      exportManager.addEventListener((event) => events.push(event));

      // When no export is running, cancel should do nothing
      exportManager.cancel();

      // No cancel event should be emitted since there's no active export
      expect(events.some((e) => e.type === "cancel")).toBe(false);
    });

    it("should provide cancel method that doesn't throw", () => {
      // Cancel should be safe to call at any time
      expect(() => exportManager.cancel()).not.toThrow();
    });
  });

  describe("download", () => {
    let appendChildSpy: jest.SpyInstance;
    let removeChildSpy: jest.SpyInstance;
    let clickSpy: jest.Mock;

    beforeEach(() => {
      appendChildSpy = jest.spyOn(document.body, "appendChild").mockImplementation(() => null as unknown as Node);
      removeChildSpy = jest.spyOn(document.body, "removeChild").mockImplementation(() => null as unknown as Node);
      clickSpy = jest.fn();

      createElementSpy.mockImplementation((tagName: string) => {
        if (tagName === "a") {
          return {
            href: "",
            download: "",
            style: { display: "" },
            classList: { add: jest.fn() },
            click: clickSpy,
          } as unknown as HTMLAnchorElement;
        }
        if (tagName === "canvas") {
          return mockCanvas as unknown as HTMLCanvasElement;
        }
        return originalCreateElement(tagName);
      });
    });

    afterEach(() => {
      appendChildSpy.mockRestore();
      removeChildSpy.mockRestore();
    });

    it("should create download link with correct filename", async () => {
      const result = await exportManager.export(testNodes, testEdges, {
        format: "png",
      });

      exportManager.download(result, "my-graph");

      expect(clickSpy).toHaveBeenCalled();
    });

    it("should use default filename when not provided", async () => {
      const result = await exportManager.export(testNodes, testEdges);

      exportManager.download(result);

      expect(clickSpy).toHaveBeenCalled();
    });
  });

  describe("copyToClipboard", () => {
    const mockClipboard = {
      write: jest.fn().mockResolvedValue(undefined),
      writeText: jest.fn().mockResolvedValue(undefined),
    };

    beforeEach(() => {
      Object.assign(navigator, { clipboard: mockClipboard });
      mockClipboard.write.mockClear();
      mockClipboard.writeText.mockClear();

      // Mock ClipboardItem if not available
      if (typeof globalThis.ClipboardItem === "undefined") {
        (globalThis as unknown as { ClipboardItem: unknown }).ClipboardItem = class {
          constructor(public items: Record<string, Blob>) {}
        };
      }
    });

    it("should copy raster image to clipboard", async () => {
      const result = await exportManager.export(testNodes, testEdges, {
        format: "png",
      });

      await exportManager.copyToClipboard(result);

      expect(mockClipboard.write).toHaveBeenCalled();
    });

    it("should copy SVG as text to clipboard", async () => {
      // Create a fresh ExportManager to avoid state from previous tests
      const freshManager = new ExportManager();
      const result = await freshManager.export(testNodes, testEdges, {
        format: "svg",
      });

      // Verify blob has text method (SVG export creates real Blob)
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.format).toBe("svg");

      await freshManager.copyToClipboard(result);

      expect(mockClipboard.writeText).toHaveBeenCalled();
    });
  });

  describe("event listeners", () => {
    it("should emit start event on export begin", async () => {
      const events: ExportEvent[] = [];
      exportManager.addEventListener((event) => events.push(event));

      await exportManager.export(testNodes, testEdges);

      expect(events.some((e) => e.type === "start")).toBe(true);
    });

    it("should emit progress events during export", async () => {
      const events: ExportEvent[] = [];
      exportManager.addEventListener((event) => events.push(event));

      await exportManager.export(testNodes, testEdges);

      const progressEvents = events.filter((e) => e.type === "progress");
      expect(progressEvents.length).toBeGreaterThan(0);
      expect(progressEvents.every((e) => typeof e.progress === "number")).toBe(true);
    });

    it("should emit complete event on success", async () => {
      const events: ExportEvent[] = [];
      exportManager.addEventListener((event) => events.push(event));

      await exportManager.export(testNodes, testEdges);

      const completeEvent = events.find((e) => e.type === "complete");
      expect(completeEvent).toBeDefined();
      expect(completeEvent?.result).toBeDefined();
    });

    it("should emit error event on failure", async () => {
      const events: ExportEvent[] = [];
      exportManager.addEventListener((event) => events.push(event));

      // Force an error by using invalid dimensions
      const badNodes: ExportNode[] = [
        { id: "n1", label: "Test", x: 0, y: 0 },
        { id: "n2", label: "Test", x: 50000, y: 50000 },
      ];

      await expect(exportManager.export(badNodes, [])).rejects.toThrow();

      expect(events.some((e) => e.type === "error")).toBe(true);
    });

    it("should allow removing event listeners", async () => {
      const events: ExportEvent[] = [];
      const listener = (event: ExportEvent) => events.push(event);

      exportManager.addEventListener(listener);
      exportManager.removeEventListener(listener);

      await exportManager.export(testNodes, testEdges);

      expect(events.length).toBe(0);
    });
  });

  describe("statistics", () => {
    it("should track export statistics", async () => {
      await exportManager.export(testNodes, testEdges);

      const stats = exportManager.getStats();

      expect(stats.totalExports).toBe(1);
      expect(stats.successfulExports).toBe(1);
      expect(stats.failedExports).toBe(0);
      // Duration may be 0 if export is very fast (mocked)
      expect(stats.averageDuration).toBeGreaterThanOrEqual(0);
      expect(stats.lastExportTime).toBeDefined();
    });

    it("should track failed exports", async () => {
      const badNodes: ExportNode[] = [
        { id: "n1", label: "Test", x: 0, y: 0 },
        { id: "n2", label: "Test", x: 50000, y: 50000 },
      ];

      try {
        await exportManager.export(badNodes, []);
      } catch {
        // Expected error
      }

      const stats = exportManager.getStats();

      expect(stats.totalExports).toBe(1);
      expect(stats.failedExports).toBe(1);
    });

    it("should reset statistics", async () => {
      await exportManager.export(testNodes, testEdges);
      exportManager.resetStats();

      const stats = exportManager.getStats();

      expect(stats.totalExports).toBe(0);
      expect(stats.successfulExports).toBe(0);
      expect(stats.failedExports).toBe(0);
      expect(stats.averageDuration).toBe(0);
    });
  });
});

describe("createExportManager", () => {
  it("should create ExportManager instance", () => {
    const manager = createExportManager();
    expect(manager).toBeInstanceOf(ExportManager);
  });

  it("should pass config to ExportManager", () => {
    const manager = createExportManager({
      maxDimension: 4096,
    });
    expect(manager).toBeInstanceOf(ExportManager);
  });
});

describe("Export constants", () => {
  describe("DEFAULT_EXPORT_OPTIONS", () => {
    it("should have correct default values", () => {
      expect(DEFAULT_EXPORT_OPTIONS.format).toBe("png");
      expect(DEFAULT_EXPORT_OPTIONS.quality).toBe(0.92);
      expect(DEFAULT_EXPORT_OPTIONS.padding).toBe(50);
      expect(DEFAULT_EXPORT_OPTIONS.includeLabels).toBe(true);
      expect(DEFAULT_EXPORT_OPTIONS.includeEdges).toBe(true);
    });
  });

  describe("DEFAULT_EXPORT_MANAGER_CONFIG", () => {
    it("should have correct default values", () => {
      expect(DEFAULT_EXPORT_MANAGER_CONFIG.maxDimension).toBe(16384);
      expect(DEFAULT_EXPORT_MANAGER_CONFIG.timeout).toBe(30000);
      expect(DEFAULT_EXPORT_MANAGER_CONFIG.showProgress).toBe(true);
    });
  });

  describe("EXPORT_MIME_TYPES", () => {
    it("should have correct MIME types", () => {
      expect(EXPORT_MIME_TYPES.png).toBe("image/png");
      expect(EXPORT_MIME_TYPES.jpeg).toBe("image/jpeg");
      expect(EXPORT_MIME_TYPES.webp).toBe("image/webp");
      expect(EXPORT_MIME_TYPES.svg).toBe("image/svg+xml");
    });
  });

  describe("EXPORT_FILE_EXTENSIONS", () => {
    it("should have correct file extensions", () => {
      expect(EXPORT_FILE_EXTENSIONS.png).toBe(".png");
      expect(EXPORT_FILE_EXTENSIONS.jpeg).toBe(".jpg");
      expect(EXPORT_FILE_EXTENSIONS.webp).toBe(".webp");
      expect(EXPORT_FILE_EXTENSIONS.svg).toBe(".svg");
    });
  });
});
