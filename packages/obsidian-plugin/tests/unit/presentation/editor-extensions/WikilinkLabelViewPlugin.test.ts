/**
 * WikilinkLabelViewPlugin Unit Tests
 *
 * Tests for the live preview extension that displays wikilinks by exo__Asset_label
 * instead of raw UUID.
 */

import { WikilinkLabelViewPlugin, WikilinkMatch, createWikilinkLabelExtension } from "@plugin/presentation/editor-extensions/WikilinkLabelViewPlugin";
import { TFile } from "obsidian";

describe("WikilinkLabelViewPlugin", () => {
  describe("findWikilinksWithoutAliases", () => {
    it("should find simple wikilink without alias", () => {
      const matches = WikilinkLabelViewPlugin.parseWikilinksFromText(
        "See [[abc123-def456]] for details",
        0
      );

      expect(matches).toHaveLength(1);
      expect(matches[0]).toEqual({
        from: 4,
        to: 21, // [[abc123-def456]] = 17 chars, starts at 4, ends at 4+17=21
        targetPath: "abc123-def456",
        hasAlias: false,
        blockId: undefined,
        headingRef: undefined,
      });
    });

    it("should find multiple wikilinks without aliases", () => {
      const matches = WikilinkLabelViewPlugin.parseWikilinksFromText(
        "[[link1]] and [[link2]]",
        0
      );

      expect(matches).toHaveLength(2);
      expect(matches[0].targetPath).toBe("link1");
      expect(matches[1].targetPath).toBe("link2");
    });

    it("should skip wikilinks with aliases (they already have display text)", () => {
      const matches = WikilinkLabelViewPlugin.parseWikilinksFromText(
        "See [[target|My Custom Alias]] for details",
        0
      );

      // Wikilinks with aliases should be skipped (already have display text)
      expect(matches).toHaveLength(0);
    });

    it("should handle mixed wikilinks (with and without aliases)", () => {
      const matches = WikilinkLabelViewPlugin.parseWikilinksFromText(
        "[[uuid-1]] and [[target|Alias]] and [[uuid-2]]",
        0
      );

      expect(matches).toHaveLength(2);
      expect(matches[0].targetPath).toBe("uuid-1");
      expect(matches[1].targetPath).toBe("uuid-2");
    });

    it("should apply offset correctly", () => {
      const matches = WikilinkLabelViewPlugin.parseWikilinksFromText(
        "[[link]]",
        100
      );

      expect(matches).toHaveLength(1);
      expect(matches[0].from).toBe(100);
      expect(matches[0].to).toBe(108);
    });

    it("should handle empty text", () => {
      const matches = WikilinkLabelViewPlugin.parseWikilinksFromText("", 0);
      expect(matches).toHaveLength(0);
    });

    it("should handle text without wikilinks", () => {
      const matches = WikilinkLabelViewPlugin.parseWikilinksFromText(
        "Plain text without links",
        0
      );
      expect(matches).toHaveLength(0);
    });

    it("should handle UUID-style targets", () => {
      const matches = WikilinkLabelViewPlugin.parseWikilinksFromText(
        "[[369c1b17-1296-4ec8-bdb9-c73fb74c0085]]",
        0
      );

      expect(matches).toHaveLength(1);
      expect(matches[0].targetPath).toBe("369c1b17-1296-4ec8-bdb9-c73fb74c0085");
    });

    it("should parse block reference wikilink", () => {
      const matches = WikilinkLabelViewPlugin.parseWikilinksFromText(
        "[[5764fb33-9cb1-43a4-a9be-43c534922798#^jgp9nz]]",
        0
      );

      expect(matches).toHaveLength(1);
      expect(matches[0].targetPath).toBe("5764fb33-9cb1-43a4-a9be-43c534922798");
      expect(matches[0].blockId).toBe("jgp9nz");
      expect(matches[0].headingRef).toBeUndefined();
      expect(matches[0].hasAlias).toBe(false);
    });

    it("should parse heading reference wikilink", () => {
      const matches = WikilinkLabelViewPlugin.parseWikilinksFromText(
        "[[some-file#My Heading]]",
        0
      );

      expect(matches).toHaveLength(1);
      expect(matches[0].targetPath).toBe("some-file");
      expect(matches[0].headingRef).toBe("My Heading");
      expect(matches[0].blockId).toBeUndefined();
      expect(matches[0].hasAlias).toBe(false);
    });

    it("should skip block reference wikilink with alias", () => {
      const matches = WikilinkLabelViewPlugin.parseWikilinksFromText(
        "[[file#^block|Custom Alias]]",
        0
      );

      // Wikilinks with aliases should be skipped
      expect(matches).toHaveLength(0);
    });

    it("should skip heading reference wikilink with alias", () => {
      const matches = WikilinkLabelViewPlugin.parseWikilinksFromText(
        "[[file#Heading|Custom Alias]]",
        0
      );

      // Wikilinks with aliases should be skipped
      expect(matches).toHaveLength(0);
    });

    it("should handle mixed wikilinks with block references", () => {
      const matches = WikilinkLabelViewPlugin.parseWikilinksFromText(
        "[[uuid1]] and [[uuid2#^block]] and [[uuid3#Heading]]",
        0
      );

      expect(matches).toHaveLength(3);
      expect(matches[0].targetPath).toBe("uuid1");
      expect(matches[0].blockId).toBeUndefined();
      expect(matches[0].headingRef).toBeUndefined();

      expect(matches[1].targetPath).toBe("uuid2");
      expect(matches[1].blockId).toBe("block");
      expect(matches[1].headingRef).toBeUndefined();

      expect(matches[2].targetPath).toBe("uuid3");
      expect(matches[2].blockId).toBeUndefined();
      expect(matches[2].headingRef).toBe("Heading");
    });
  });

  describe("shouldShowLabelForWikilink", () => {
    it("should return true for wikilink without alias", () => {
      const match: WikilinkMatch = {
        from: 0,
        to: 10,
        targetPath: "some-uuid",
        hasAlias: false,
      };

      expect(WikilinkLabelViewPlugin.shouldShowLabel(match)).toBe(true);
    });

    it("should return false for wikilink with alias", () => {
      const match: WikilinkMatch = {
        from: 0,
        to: 10,
        targetPath: "some-uuid",
        hasAlias: true,
      };

      expect(WikilinkLabelViewPlugin.shouldShowLabel(match)).toBe(false);
    });
  });

  describe("cursor awareness", () => {
    it("should not replace wikilink when cursor is inside", () => {
      const match: WikilinkMatch = {
        from: 4,
        to: 22,
        targetPath: "abc123",
        hasAlias: false,
      };
      const cursorPos = 10; // Inside the wikilink range

      expect(WikilinkLabelViewPlugin.isCursorInsideMatch(match, cursorPos)).toBe(true);
    });

    it("should allow replacement when cursor is outside", () => {
      const match: WikilinkMatch = {
        from: 4,
        to: 22,
        targetPath: "abc123",
        hasAlias: false,
      };
      const cursorPos = 30; // Outside the wikilink range

      expect(WikilinkLabelViewPlugin.isCursorInsideMatch(match, cursorPos)).toBe(false);
    });

    it("should treat cursor at start boundary as inside", () => {
      const match: WikilinkMatch = {
        from: 4,
        to: 22,
        targetPath: "abc123",
        hasAlias: false,
      };
      const cursorPos = 4;

      expect(WikilinkLabelViewPlugin.isCursorInsideMatch(match, cursorPos)).toBe(true);
    });

    it("should treat cursor at end boundary as inside", () => {
      const match: WikilinkMatch = {
        from: 4,
        to: 22,
        targetPath: "abc123",
        hasAlias: false,
      };
      const cursorPos = 22;

      expect(WikilinkLabelViewPlugin.isCursorInsideMatch(match, cursorPos)).toBe(true);
    });
  });

  describe("createWikilinkLabelExtension", () => {
    it("should create an extension with the correct structure", () => {
      const mockApp = {
        metadataCache: {
          getFirstLinkpathDest: jest.fn(),
          getFileCache: jest.fn(),
        },
      };
      const mockSettings = {
        showLabelsInLivePreview: true,
      };

      const extension = createWikilinkLabelExtension(
        mockApp as any,
        mockApp.metadataCache as any,
        mockSettings as any
      );

      expect(extension).toBeDefined();
    });
  });

  describe("label resolution", () => {
    const createMockMetadataCache = (files: Record<string, { exo__Asset_label?: string }>) => ({
      getFirstLinkpathDest: jest.fn().mockImplementation((path: string) => {
        const fullPath = path.endsWith(".md") ? path : `${path}.md`;
        if (files[path] || files[fullPath]) {
          // Create an actual TFile instance for instanceof checks
          const mockFile = new TFile();
          (mockFile as unknown as { path: string }).path = fullPath;
          return mockFile;
        }
        return null;
      }),
      getFileCache: jest.fn().mockImplementation((file: TFile) => {
        const filePath = file.path;
        const pathWithoutExt = filePath.replace(".md", "");
        const metadata = files[filePath] || files[pathWithoutExt];
        if (metadata) {
          return { frontmatter: metadata };
        }
        return null;
      }),
    });

    it("should resolve label for valid UUID target", () => {
      const mockCache = createMockMetadataCache({
        "369c1b17-1296-4ec8-bdb9-c73fb74c0085": {
          exo__Asset_label: "My Project",
        },
      });

      const label = WikilinkLabelViewPlugin.resolveLabel(
        mockCache as any,
        "369c1b17-1296-4ec8-bdb9-c73fb74c0085"
      );

      expect(label).toBe("My Project");
    });

    it("should return null when file not found", () => {
      const mockCache = createMockMetadataCache({});

      const label = WikilinkLabelViewPlugin.resolveLabel(
        mockCache as any,
        "nonexistent"
      );

      expect(label).toBeNull();
    });

    it("should return null when label is empty", () => {
      const mockCache = createMockMetadataCache({
        "some-file": { exo__Asset_label: "" },
      });

      const label = WikilinkLabelViewPlugin.resolveLabel(
        mockCache as any,
        "some-file"
      );

      expect(label).toBeNull();
    });
  });
});
