import React from "react";
import { PropertiesRenderer } from "../../src/presentation/renderers/layout/PropertiesRenderer";
import { Keymap } from "obsidian";
import {
  createMockApp,
  createMockTFile,
  createMockElement,
  createMockReactRenderer,
  createMockMetadataExtractor,
  createMockMetadataService,
  createMockMetadata,
} from "./helpers/testHelpers";

jest.mock("obsidian", () => ({
  Keymap: {
    isModEvent: jest.fn(),
  },
}));

jest.mock("../../src/presentation/components/AssetPropertiesTable", () => ({
  AssetPropertiesTable: jest.fn(() => null),
}));

describe("PropertiesRenderer", () => {
  let renderer: PropertiesRenderer;
  let mockApp: any;
  let mockReactRenderer: any;
  let mockMetadataExtractor: any;
  let mockMetadataService: any;
  let mockElement: any;
  let mockFile: any;
  let mockLeaf: any;

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
    mockMetadataService = createMockMetadataService();

    renderer = new PropertiesRenderer(
      mockApp,
      mockReactRenderer,
      mockMetadataExtractor,
      mockMetadataService
    );

    mockElement = createMockElement();
    mockFile = createMockTFile("test/file.md");

    jest.clearAllMocks();
    jest.spyOn(React, "createElement");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("render", () => {
    it("should not render anything when metadata is empty", async () => {
      mockMetadataExtractor.extractMetadata.mockReturnValue({});

      await renderer.render(mockElement, mockFile);

      expect(mockMetadataExtractor.extractMetadata).toHaveBeenCalledWith(mockFile);
      expect(mockElement.createDiv).not.toHaveBeenCalled();
      expect(mockReactRenderer.render).not.toHaveBeenCalled();
    });

    it("should render properties table when metadata exists", async () => {
      const metadata = createMockMetadata({
        exo__Asset_label: "Test Asset",
        exo__Instance_class: "ems__Task",
        custom_property: "value",
      });
      mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);

      await renderer.render(mockElement, mockFile);

      expect(mockElement.createDiv).toHaveBeenCalledWith({
        cls: "exocortex-properties-section",
      });
      expect(mockReactRenderer.render).toHaveBeenCalledTimes(1);
      expect(React.createElement).toHaveBeenCalledWith(
        expect.anything(), // AssetPropertiesTable component
        expect.objectContaining({
          metadata,
          onLinkClick: expect.any(Function),
          getAssetLabel: expect.any(Function),
          onRemoveRedundantAlias: expect.any(Function),
        })
      );
    });

    describe("link click handler", () => {
      let onLinkClick: (path: string, event: React.MouseEvent) => Promise<void>;

      beforeEach(async () => {
        const metadata = createMockMetadata();
        mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);

        await renderer.render(mockElement, mockFile);

        // Extract the onLinkClick callback from the React.createElement call
        const createElementCall = (React.createElement as jest.Mock).mock.calls[0];
        onLinkClick = createElementCall[1].onLinkClick;
      });

      it("should open link in current pane when no modifier is pressed", async () => {
        (Keymap.isModEvent as jest.Mock).mockReturnValue(false);

        const mockEvent = { nativeEvent: {} } as React.MouseEvent;
        await onLinkClick("path/to/file.md", mockEvent);

        expect(Keymap.isModEvent).toHaveBeenCalledWith({});
        expect(mockApp.workspace.openLinkText).toHaveBeenCalledWith(
          "path/to/file.md",
          "",
          false
        );
        expect(mockApp.workspace.getLeaf).not.toHaveBeenCalled();
      });

      it("should open link in new tab when modifier is pressed", async () => {
        (Keymap.isModEvent as jest.Mock).mockReturnValue(true);

        const mockEvent = { nativeEvent: {} } as React.MouseEvent;
        await onLinkClick("path/to/file.md", mockEvent);

        expect(Keymap.isModEvent).toHaveBeenCalledWith({});
        expect(mockApp.workspace.openLinkText).toHaveBeenCalledWith("path/to/file.md", "", "tab");
      });

      it("should handle different event types correctly", async () => {
        (Keymap.isModEvent as jest.Mock).mockReturnValue(false);

        const nativeEvent = new MouseEvent("click");
        const syntheticEvent = { nativeEvent } as React.MouseEvent;

        await onLinkClick("synthetic/event.md", syntheticEvent);

        expect(Keymap.isModEvent).toHaveBeenCalledWith(nativeEvent);
        expect(mockApp.workspace.openLinkText).toHaveBeenCalledWith(
          "synthetic/event.md",
          "",
          false
        );
      });

      it("should propagate errors from openLinkText", async () => {
        (Keymap.isModEvent as jest.Mock).mockReturnValue(false);
        const error = new Error("Failed to open link");
        mockApp.workspace.openLinkText.mockRejectedValue(error);

        const mockEvent = { nativeEvent: {} } as React.MouseEvent;

        await expect(
          onLinkClick("error/file.md", mockEvent)
        ).rejects.toThrow("Failed to open link");
      });
    });

    describe("getAssetLabel callback", () => {
      it("should delegate to metadataService", async () => {
        const metadata = createMockMetadata();
        mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
        mockMetadataService.getAssetLabel.mockReturnValue("Asset Label");

        await renderer.render(mockElement, mockFile);

        const createElementCall = (React.createElement as jest.Mock).mock.calls[0];
        const getAssetLabel = createElementCall[1].getAssetLabel;

        const result = getAssetLabel("some/path.md");

        expect(mockMetadataService.getAssetLabel).toHaveBeenCalledWith("some/path.md");
        expect(result).toBe("Asset Label");
      });
    });

    describe("onRemoveRedundantAlias callback", () => {
      let onRemoveRedundantAlias: (file: any, key: string, target: string, alias: string) => Promise<void>;

      beforeEach(async () => {
        const metadata = createMockMetadata({
          parent: "[[some-uuid|My Label]]",
        });
        mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);

        await renderer.render(mockElement, mockFile);

        const createElementCall = (React.createElement as jest.Mock).mock.calls[0];
        onRemoveRedundantAlias = createElementCall[1].onRemoveRedundantAlias;
      });

      it("should update single wikilink property to remove alias", async () => {
        mockApp.fileManager.processFrontMatter.mockImplementation(
          (_file: any, callback: (fm: any) => void) => {
            const fm: Record<string, unknown> = {};
            callback(fm);
            expect(fm.parent).toBe("[[some-uuid]]");
          },
        );

        await onRemoveRedundantAlias(mockFile, "parent", "some-uuid", "My Label");
      });

      it("should update array property to remove alias from matching element", async () => {
        const metadata = createMockMetadata({
          tags: ["[[uuid1|Label One]]", "[[uuid2|Keep This]]"],
        });
        mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);

        await renderer.render(mockElement, mockFile);

        const createElementCall = (React.createElement as jest.Mock).mock.calls[1];
        const callback = createElementCall[1].onRemoveRedundantAlias;

        mockApp.fileManager.processFrontMatter.mockImplementation(
          (_file: any, cb: (fm: any) => void) => {
            const fm: Record<string, unknown> = {};
            cb(fm);
            expect(fm.tags).toEqual(["[[uuid1]]", "[[uuid2|Keep This]]"]);
          },
        );

        await callback(mockFile, "tags", "uuid1", "Label One");
      });
    });

    it("should handle metadata with single property", async () => {
      const metadata = { single_property: "value" };
      mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);

      await renderer.render(mockElement, mockFile);

      expect(mockReactRenderer.render).toHaveBeenCalled();
      const createElementCall = (React.createElement as jest.Mock).mock.calls[0];
      expect(createElementCall[1].metadata).toEqual(metadata);
    });

    it("should handle metadata with many properties", async () => {
      const metadata = {
        prop1: "value1",
        prop2: "value2",
        prop3: "value3",
        prop4: ["array", "of", "values"],
        prop5: { nested: "object" },
        prop6: 12345,
        prop7: true,
        prop8: null,
      };
      mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);

      await renderer.render(mockElement, mockFile);

      expect(mockReactRenderer.render).toHaveBeenCalled();
      const createElementCall = (React.createElement as jest.Mock).mock.calls[0];
      expect(createElementCall[1].metadata).toEqual(metadata);
    });

    it("should pass correct container element to React renderer", async () => {
      const metadata = createMockMetadata();
      mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);

      const mockContainer = document.createElement("div");
      mockContainer.className = "exocortex-properties-section";

      const mockContentContainer = document.createElement("div");
      mockContentContainer.className = "exocortex-section-content";

      // Mock createDiv to return the content container
      const createDivMock = jest.fn().mockReturnValue(mockContentContainer);
      (mockContainer as any).createDiv = createDivMock;

      mockElement.createDiv.mockReturnValue(mockContainer);

      await renderer.render(mockElement, mockFile);

      expect(mockReactRenderer.render).toHaveBeenCalledWith(
        mockContentContainer,
        expect.anything()
      );
    });

    it("should handle files without extension properly", async () => {
      const metadata = createMockMetadata();
      mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);

      const fileWithoutExt = createMockTFile("path/to/file");
      await renderer.render(mockElement, fileWithoutExt);

      expect(mockMetadataExtractor.extractMetadata).toHaveBeenCalledWith(
        fileWithoutExt
      );
      expect(mockReactRenderer.render).toHaveBeenCalled();
    });

    describe("hideAliases option", () => {
      it("should include aliases when hideAliases is false", async () => {
        const metadata = {
          exo__Asset_label: "Test Task",
          aliases: ["Task A", "Task B"],
          status: "active",
        };
        mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);

        await renderer.render(mockElement, mockFile, { hideAliases: false });

        expect(mockReactRenderer.render).toHaveBeenCalled();
        const createElementCall = (React.createElement as jest.Mock).mock.calls[0];
        expect(createElementCall[1].metadata).toEqual(metadata);
        expect(createElementCall[1].metadata.aliases).toEqual(["Task A", "Task B"]);
      });

      it("should include aliases when hideAliases option is not provided", async () => {
        const metadata = {
          exo__Asset_label: "Test Task",
          aliases: ["Task A", "Task B"],
          status: "active",
        };
        mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);

        await renderer.render(mockElement, mockFile);

        expect(mockReactRenderer.render).toHaveBeenCalled();
        const createElementCall = (React.createElement as jest.Mock).mock.calls[0];
        expect(createElementCall[1].metadata).toEqual(metadata);
        expect(createElementCall[1].metadata.aliases).toEqual(["Task A", "Task B"]);
      });

      it("should exclude aliases when hideAliases is true", async () => {
        const metadata = {
          exo__Asset_label: "Test Task",
          aliases: ["Task A", "Task B"],
          status: "active",
        };
        mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);

        await renderer.render(mockElement, mockFile, { hideAliases: true });

        expect(mockReactRenderer.render).toHaveBeenCalled();
        const createElementCall = (React.createElement as jest.Mock).mock.calls[0];
        const renderedMetadata = createElementCall[1].metadata;

        // Should contain other properties but NOT aliases
        expect(renderedMetadata.exo__Asset_label).toBe("Test Task");
        expect(renderedMetadata.status).toBe("active");
        expect(renderedMetadata.aliases).toBeUndefined();
      });

      it("should handle missing aliases property when hideAliases is true", async () => {
        const metadata = {
          exo__Asset_label: "Test Task",
          status: "active",
        };
        mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);

        await renderer.render(mockElement, mockFile, { hideAliases: true });

        expect(mockReactRenderer.render).toHaveBeenCalled();
        const createElementCall = (React.createElement as jest.Mock).mock.calls[0];
        expect(createElementCall[1].metadata).toEqual(metadata);
      });

      it("should not filter other properties when hideAliases is true", async () => {
        const metadata = {
          exo__Asset_label: "Test Task",
          aliases: ["Task A"],
          status: "active",
          priority: "high",
          tags: ["tag1", "tag2"],
        };
        mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);

        await renderer.render(mockElement, mockFile, { hideAliases: true });

        const createElementCall = (React.createElement as jest.Mock).mock.calls[0];
        const renderedMetadata = createElementCall[1].metadata;

        // All properties except aliases should be present
        expect(renderedMetadata.exo__Asset_label).toBe("Test Task");
        expect(renderedMetadata.status).toBe("active");
        expect(renderedMetadata.priority).toBe("high");
        expect(renderedMetadata.tags).toEqual(["tag1", "tag2"]);
        expect(renderedMetadata.aliases).toBeUndefined();
      });
    });
  });
});