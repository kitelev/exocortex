import React from "react";
import { AreaTreeRenderer } from "../../src/presentation/renderers/layout/AreaTreeRenderer";
import { Keymap } from "obsidian";
import { AssetClass, AreaHierarchyBuilder } from "exocortex";
import {
  createMockApp,
  createMockTFile,
  createMockElement,
  createMockReactRenderer,
  createMockMetadataExtractor,
  createMockMetadataService,
  createMockMetadata,
  createMockAssetRelation,
} from "./helpers/testHelpers";

jest.mock("obsidian", () => ({
  Keymap: {
    isModEvent: jest.fn(),
  },
}));

jest.mock("exocortex", () => ({
  ...jest.requireActual("exocortex"),
  AssetClass: {
    AREA: "ems__Area",
    PROJECT: "ems__Project",
    TASK: "ems__Task",
  },
  AreaHierarchyBuilder: jest.fn(),
}));

jest.mock("../../src/presentation/components/AreaHierarchyTree", () => ({
  AreaHierarchyTree: jest.fn(() => null),
}));

describe("AreaTreeRenderer", () => {
  let renderer: AreaTreeRenderer;
  let mockApp: any;
  let mockReactRenderer: any;
  let mockMetadataExtractor: any;
  let mockVaultAdapter: any;
  let mockMetadataService: any;
  let mockLogger: any;
  let mockElement: any;
  let mockFile: any;
  let mockLeaf: any;
  let mockHierarchyBuilder: any;

  beforeEach(() => {
    mockLeaf = {
      openLinkText: jest.fn().mockResolvedValue(undefined),
    };

    mockApp = createMockApp({
      workspace: {
        getLeaf: jest.fn().mockReturnValue(mockLeaf),
        openLinkText: jest.fn().mockResolvedValue(undefined),
      },
    });

    mockReactRenderer = createMockReactRenderer();
    mockMetadataExtractor = createMockMetadataExtractor();
    mockVaultAdapter = {
      getFile: jest.fn(),
      getMetadata: jest.fn(),
    };
    mockMetadataService = createMockMetadataService({
      extractInstanceClass: jest.fn(),
    });
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };

    mockHierarchyBuilder = {
      buildHierarchy: jest.fn(),
    };
    (AreaHierarchyBuilder as jest.Mock).mockImplementation(() => mockHierarchyBuilder);

    renderer = new AreaTreeRenderer(
      mockApp,
      mockReactRenderer,
      mockMetadataExtractor,
      mockVaultAdapter,
      mockMetadataService,
      mockLogger
    );

    mockElement = createMockElement();
    mockFile = createMockTFile("areas/main-area.md");

    jest.clearAllMocks();
    jest.spyOn(React, "createElement");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("render", () => {
    it("should not render when asset is not an Area", async () => {
      const metadata = createMockMetadata({
        exo__Instance_class: "ems__Task",
      });
      mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
      mockMetadataService.extractInstanceClass.mockReturnValue(AssetClass.TASK);

      const relations = [createMockAssetRelation()];
      await renderer.render(mockElement, mockFile, relations);

      expect(mockMetadataExtractor.extractMetadata).toHaveBeenCalledWith(mockFile);
      expect(mockMetadataService.extractInstanceClass).toHaveBeenCalledWith(metadata);
      expect(AreaHierarchyBuilder).not.toHaveBeenCalled();
      expect(mockElement.createDiv).not.toHaveBeenCalled();
      expect(mockReactRenderer.render).not.toHaveBeenCalled();
    });

    it("should not render when hierarchy tree is null", async () => {
      const metadata = createMockMetadata({
        exo__Instance_class: "ems__Area",
      });
      mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
      mockMetadataService.extractInstanceClass.mockReturnValue(AssetClass.AREA);
      mockHierarchyBuilder.buildHierarchy.mockReturnValue(null);

      const relations = [createMockAssetRelation()];
      await renderer.render(mockElement, mockFile, relations);

      expect(AreaHierarchyBuilder).toHaveBeenCalledWith(mockVaultAdapter);
      expect(mockHierarchyBuilder.buildHierarchy).toHaveBeenCalledWith(
        mockFile.path,
        relations
      );
      expect(mockElement.createDiv).not.toHaveBeenCalled();
      expect(mockReactRenderer.render).not.toHaveBeenCalled();
    });

    it("should render area tree when asset is an Area with valid hierarchy", async () => {
      const metadata = createMockMetadata({
        exo__Instance_class: "ems__Area",
      });
      mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
      mockMetadataService.extractInstanceClass.mockReturnValue(AssetClass.AREA);

      const mockTree = {
        path: "areas/main-area.md",
        children: [
          { path: "areas/sub-area1.md", children: [] },
          { path: "areas/sub-area2.md", children: [] },
        ],
      };
      mockHierarchyBuilder.buildHierarchy.mockReturnValue(mockTree);

      const relations = [
        createMockAssetRelation({ path: "areas/sub-area1.md" }),
        createMockAssetRelation({ path: "areas/sub-area2.md" }),
      ];

      const mockSectionContainer = createMockElement();
      const mockContentContainer = createMockElement();
      const mockTreeContainer = createMockElement();
      mockElement.createDiv.mockReturnValue(mockSectionContainer); // section container
      mockSectionContainer.createDiv.mockReturnValue(mockContentContainer); // content container
      mockContentContainer.createDiv.mockReturnValue(mockTreeContainer); // tree container

      await renderer.render(mockElement, mockFile, relations);

      // Verify section structure creation
      expect(mockElement.createDiv).toHaveBeenCalledWith({
        cls: "exocortex-area-tree-section",
      });
      expect(mockSectionContainer.createEl).toHaveBeenCalledWith("h3", {
        text: "Area tree",
        cls: "exocortex-section-header",
      });
      // First createDiv call is for content container
      expect(mockSectionContainer.createDiv).toHaveBeenNthCalledWith(1, {
        cls: "exocortex-section-content",
        attr: {
          "data-collapsed": "false",
        },
      });
      // Second createDiv call is for tree container
      expect(mockContentContainer.createDiv).toHaveBeenCalledWith({
        cls: "exocortex-area-tree-container",
      });

      // Verify React component rendering
      expect(mockReactRenderer.render).toHaveBeenCalledWith(
        mockTreeContainer,
        expect.anything()
      );
      expect(React.createElement).toHaveBeenCalledWith(
        expect.anything(), // AreaHierarchyTree component
        expect.objectContaining({
          tree: mockTree,
          currentAreaPath: mockFile.path,
          onAreaClick: expect.any(Function),
          getAssetLabel: expect.any(Function),
        })
      );

      // Verify logging
      expect(mockLogger.info).toHaveBeenCalledWith(
        `Rendered Area Tree for ${mockFile.path}`
      );
    });

    describe("area click handler", () => {
      let onAreaClick: (path: string, event: React.MouseEvent) => Promise<void>;

      beforeEach(async () => {
        const metadata = createMockMetadata({
          exo__Instance_class: "ems__Area",
        });
        mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
        mockMetadataService.extractInstanceClass.mockReturnValue(AssetClass.AREA);

        const mockTree = {
          path: "areas/main.md",
          children: [],
        };
        mockHierarchyBuilder.buildHierarchy.mockReturnValue(mockTree);

        await renderer.render(mockElement, mockFile, []);

        // Extract the onAreaClick callback
        const createElementCall = (React.createElement as jest.Mock).mock.calls[0];
        onAreaClick = createElementCall[1].onAreaClick;
      });

      it("should open area in current pane when no modifier is pressed", async () => {
        (Keymap.isModEvent as jest.Mock).mockReturnValue(false);

        const mockEvent = { nativeEvent: {} } as React.MouseEvent;
        await onAreaClick("areas/sub-area.md", mockEvent);

        expect(Keymap.isModEvent).toHaveBeenCalledWith({});
        expect(mockApp.workspace.openLinkText).toHaveBeenCalledWith(
          "areas/sub-area.md",
          "",
          false
        );
        expect(mockApp.workspace.getLeaf).not.toHaveBeenCalled();
      });

      it("should open area in new tab when modifier is pressed", async () => {
        (Keymap.isModEvent as jest.Mock).mockReturnValue(true);

        const mockEvent = { nativeEvent: {} } as React.MouseEvent;
        await onAreaClick("areas/sub-area.md", mockEvent);

        expect(Keymap.isModEvent).toHaveBeenCalledWith({});
        expect(mockApp.workspace.openLinkText).toHaveBeenCalledWith("areas/sub-area.md", "", "tab");
      });

      it("should handle synthetic React events", async () => {
        (Keymap.isModEvent as jest.Mock).mockReturnValue(false);

        const nativeEvent = new MouseEvent("click", { ctrlKey: false });
        const syntheticEvent = { nativeEvent } as React.MouseEvent;

        await onAreaClick("areas/clicked.md", syntheticEvent);

        expect(Keymap.isModEvent).toHaveBeenCalledWith(nativeEvent);
        expect(mockApp.workspace.openLinkText).toHaveBeenCalledWith(
          "areas/clicked.md",
          "",
          false
        );
      });

      it("should propagate errors from openLinkText", async () => {
        (Keymap.isModEvent as jest.Mock).mockReturnValue(false);
        const error = new Error("Failed to open area");
        mockApp.workspace.openLinkText.mockRejectedValue(error);

        const mockEvent = { nativeEvent: {} } as React.MouseEvent;

        await expect(
          onAreaClick("areas/error.md", mockEvent)
        ).rejects.toThrow("Failed to open area");
      });
    });

    describe("getAssetLabel callback", () => {
      it("should delegate to metadataService", async () => {
        const metadata = createMockMetadata({
          exo__Instance_class: "ems__Area",
        });
        mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
        mockMetadataService.extractInstanceClass.mockReturnValue(AssetClass.AREA);
        mockMetadataService.getAssetLabel.mockReturnValue("Area Label");

        const mockTree = {
          path: "areas/main.md",
          children: [],
        };
        mockHierarchyBuilder.buildHierarchy.mockReturnValue(mockTree);

        await renderer.render(mockElement, mockFile, []);

        const createElementCall = (React.createElement as jest.Mock).mock.calls[0];
        const getAssetLabel = createElementCall[1].getAssetLabel;

        const result = getAssetLabel("areas/some-area.md");

        expect(mockMetadataService.getAssetLabel).toHaveBeenCalledWith(
          "areas/some-area.md"
        );
        expect(result).toBe("Area Label");
      });
    });

    it("should handle complex area hierarchies", async () => {
      const metadata = createMockMetadata({
        exo__Instance_class: "ems__Area",
      });
      mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
      mockMetadataService.extractInstanceClass.mockReturnValue(AssetClass.AREA);

      const complexTree = {
        path: "areas/root.md",
        children: [
          {
            path: "areas/level1-a.md",
            children: [
              { path: "areas/level2-a1.md", children: [] },
              { path: "areas/level2-a2.md", children: [] },
            ],
          },
          {
            path: "areas/level1-b.md",
            children: [
              {
                path: "areas/level2-b1.md",
                children: [{ path: "areas/level3-b1a.md", children: [] }],
              },
            ],
          },
        ],
      };
      mockHierarchyBuilder.buildHierarchy.mockReturnValue(complexTree);

      const relations = [
        createMockAssetRelation({ path: "areas/level1-a.md" }),
        createMockAssetRelation({ path: "areas/level1-b.md" }),
      ];

      await renderer.render(mockElement, mockFile, relations);

      expect(mockReactRenderer.render).toHaveBeenCalled();
      const createElementCall = (React.createElement as jest.Mock).mock.calls[0];
      expect(createElementCall[1].tree).toEqual(complexTree);
    });

    it("should handle empty relations array", async () => {
      const metadata = createMockMetadata({
        exo__Instance_class: "ems__Area",
      });
      mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
      mockMetadataService.extractInstanceClass.mockReturnValue(AssetClass.AREA);

      const singleNodeTree = {
        path: "areas/lonely.md",
        children: [],
      };
      mockHierarchyBuilder.buildHierarchy.mockReturnValue(singleNodeTree);

      await renderer.render(mockElement, mockFile, []);

      expect(mockHierarchyBuilder.buildHierarchy).toHaveBeenCalledWith(
        mockFile.path,
        []
      );
      expect(mockReactRenderer.render).toHaveBeenCalled();
    });

    it("should handle Project class and not render", async () => {
      const metadata = createMockMetadata({
        exo__Instance_class: "ems__Project",
      });
      mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
      mockMetadataService.extractInstanceClass.mockReturnValue(AssetClass.PROJECT);

      await renderer.render(mockElement, mockFile, []);

      expect(AreaHierarchyBuilder).not.toHaveBeenCalled();
      expect(mockReactRenderer.render).not.toHaveBeenCalled();
    });

    it("should handle undefined instance class", async () => {
      const metadata = createMockMetadata();
      delete metadata.exo__Instance_class;
      mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
      mockMetadataService.extractInstanceClass.mockReturnValue(undefined);

      await renderer.render(mockElement, mockFile, []);

      expect(AreaHierarchyBuilder).not.toHaveBeenCalled();
      expect(mockReactRenderer.render).not.toHaveBeenCalled();
    });
  });
});