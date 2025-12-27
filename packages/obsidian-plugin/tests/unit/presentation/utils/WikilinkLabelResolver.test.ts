/**
 * WikilinkLabelResolver Unit Tests
 */

import {
  WikilinkLabelResolver,
  resolveWikilinkLabel,
  getWikilinkDisplayText,
} from "@plugin/presentation/utils/WikilinkLabelResolver";
import { TFile } from "obsidian";

describe("WikilinkLabelResolver", () => {
  describe("parseWikilink", () => {
    it("parses simple wikilink without alias", () => {
      const result = WikilinkLabelResolver.parseWikilink("[[target]]");
      expect(result).toEqual({ target: "target", alias: undefined });
    });

    it("parses wikilink with alias", () => {
      const result = WikilinkLabelResolver.parseWikilink("[[target|Display Name]]");
      expect(result).toEqual({ target: "target", alias: "Display Name" });
    });

    it("trims whitespace from target and alias", () => {
      const result = WikilinkLabelResolver.parseWikilink("[[ target | alias ]]");
      expect(result).toEqual({ target: "target", alias: "alias" });
    });

    it("handles path with slashes", () => {
      const result = WikilinkLabelResolver.parseWikilink("[[path/to/file]]");
      expect(result).toEqual({ target: "path/to/file", alias: undefined });
    });

    it("returns null for non-wikilink", () => {
      expect(WikilinkLabelResolver.parseWikilink("plain text")).toBeNull();
      expect(WikilinkLabelResolver.parseWikilink("[[incomplete")).toBeNull();
      expect(WikilinkLabelResolver.parseWikilink("incomplete]]")).toBeNull();
    });
  });

  describe("isWikilink", () => {
    it("returns true for valid wikilinks", () => {
      expect(WikilinkLabelResolver.isWikilink("[[target]]")).toBe(true);
      expect(WikilinkLabelResolver.isWikilink("[[target|alias]]")).toBe(true);
      expect(WikilinkLabelResolver.isWikilink("  [[target]]  ")).toBe(true);
    });

    it("returns false for non-wikilinks", () => {
      expect(WikilinkLabelResolver.isWikilink("plain text")).toBe(false);
      expect(WikilinkLabelResolver.isWikilink("[[incomplete")).toBe(false);
      expect(WikilinkLabelResolver.isWikilink("")).toBe(false);
    });
  });

  describe("getAssetLabel", () => {
    const createMockApp = (files: Record<string, Record<string, unknown>>) => {
      const mockApp = {
        metadataCache: {
          getFirstLinkpathDest: jest.fn().mockImplementation((path: string) => {
            const fullPath = path.endsWith(".md") ? path : `${path}.md`;
            if (files[path] || files[fullPath]) {
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
        },
      };
      return mockApp as unknown as import("@plugin/types").ObsidianApp;
    };

    it("returns exo__Asset_label from file metadata", () => {
      const mockApp = createMockApp({
        "test-file": {
          exo__Asset_label: "My Project",
        },
      });

      const resolver = new WikilinkLabelResolver(mockApp);
      expect(resolver.getAssetLabel("test-file")).toBe("My Project");
    });

    it("returns null when file not found", () => {
      const mockApp = createMockApp({});
      const resolver = new WikilinkLabelResolver(mockApp);
      expect(resolver.getAssetLabel("nonexistent")).toBeNull();
    });

    it("returns null when label is empty", () => {
      const mockApp = createMockApp({
        "test-file": {
          exo__Asset_label: "",
        },
      });

      const resolver = new WikilinkLabelResolver(mockApp);
      expect(resolver.getAssetLabel("test-file")).toBeNull();
    });

    it("returns label from prototype when direct label not found", () => {
      const mockApp = createMockApp({
        "task-instance": {
          exo__Asset_prototype: "[[task-prototype]]",
        },
        "task-prototype": {
          exo__Asset_label: "Task Template",
        },
      });

      const resolver = new WikilinkLabelResolver(mockApp);
      expect(resolver.getAssetLabel("task-instance")).toBe("Task Template");
    });
  });

  describe("resolveWikilinkLabel", () => {
    const createMockApp = (labels: Record<string, string>) => {
      const mockApp = {
        metadataCache: {
          getFirstLinkpathDest: jest.fn().mockImplementation((path: string) => {
            if (labels[path] || labels[path.replace(".md", "")]) {
              const mockFile = new TFile();
              (mockFile as unknown as { path: string }).path = path;
              return mockFile;
            }
            return null;
          }),
          getFileCache: jest.fn().mockImplementation((file: TFile) => {
            const pathWithoutExt = file.path.replace(".md", "");
            const label = labels[file.path] || labels[pathWithoutExt];
            if (label) {
              return { frontmatter: { exo__Asset_label: label } };
            }
            return null;
          }),
        },
      };
      return mockApp as unknown as import("@plugin/types").ObsidianApp;
    };

    it("returns alias when present", () => {
      const mockApp = createMockApp({});
      const resolver = new WikilinkLabelResolver(mockApp);
      const result = resolver.resolveWikilinkLabel("[[target|My Alias]]");

      expect(result).toEqual({
        target: "target",
        displayText: "My Alias",
        hasAlias: true,
      });
    });

    it("resolves label when no alias", () => {
      const mockApp = createMockApp({
        "my-project": "Project Alpha",
      });
      const resolver = new WikilinkLabelResolver(mockApp);
      const result = resolver.resolveWikilinkLabel("[[my-project]]");

      expect(result).toEqual({
        target: "my-project",
        displayText: "Project Alpha",
        hasAlias: false,
      });
    });

    it("falls back to target when label not found", () => {
      const mockApp = createMockApp({});
      const resolver = new WikilinkLabelResolver(mockApp);
      const result = resolver.resolveWikilinkLabel("[[unknown-file]]");

      expect(result).toEqual({
        target: "unknown-file",
        displayText: "unknown-file",
        hasAlias: false,
      });
    });

    it("returns null for non-wikilink", () => {
      const mockApp = createMockApp({});
      const resolver = new WikilinkLabelResolver(mockApp);
      expect(resolver.resolveWikilinkLabel("plain text")).toBeNull();
    });
  });

  describe("processContent", () => {
    const createMockApp = (labels: Record<string, string>) => {
      const mockApp = {
        metadataCache: {
          getFirstLinkpathDest: jest.fn().mockImplementation((path: string) => {
            if (labels[path] || labels[path.replace(".md", "")]) {
              const mockFile = new TFile();
              (mockFile as unknown as { path: string }).path = path;
              return mockFile;
            }
            return null;
          }),
          getFileCache: jest.fn().mockImplementation((file: TFile) => {
            const pathWithoutExt = file.path.replace(".md", "");
            const label = labels[file.path] || labels[pathWithoutExt];
            if (label) {
              return { frontmatter: { exo__Asset_label: label } };
            }
            return null;
          }),
        },
      };
      return mockApp as unknown as import("@plugin/types").ObsidianApp;
    };

    it("replaces wikilinks without aliases with resolved labels", () => {
      const mockApp = createMockApp({
        "project-1": "Project Alpha",
        "project-2": "Project Beta",
      });
      const resolver = new WikilinkLabelResolver(mockApp);

      const content = "See [[project-1]] and [[project-2]] for details";
      const result = resolver.processContent(content);

      expect(result).toBe("See [[project-1|Project Alpha]] and [[project-2|Project Beta]] for details");
    });

    it("preserves wikilinks with existing aliases", () => {
      const mockApp = createMockApp({
        "project-1": "Resolved Label",
      });
      const resolver = new WikilinkLabelResolver(mockApp);

      const content = "See [[project-1|Custom Alias]] for details";
      const result = resolver.processContent(content);

      expect(result).toBe("See [[project-1|Custom Alias]] for details");
    });

    it("leaves wikilinks unchanged when label not found", () => {
      const mockApp = createMockApp({});
      const resolver = new WikilinkLabelResolver(mockApp);

      const content = "See [[unknown-file]] for details";
      const result = resolver.processContent(content);

      expect(result).toBe("See [[unknown-file]] for details");
    });

    it("handles mixed content with wikilinks and plain text", () => {
      const mockApp = createMockApp({
        "task-1": "Important Task",
      });
      const resolver = new WikilinkLabelResolver(mockApp);

      const content = "Review [[task-1]] and update [[unknown-file]]";
      const result = resolver.processContent(content);

      expect(result).toBe("Review [[task-1|Important Task]] and update [[unknown-file]]");
    });
  });

  describe("utility functions", () => {
    const createMockApp = (labels: Record<string, string>) => {
      const mockApp = {
        metadataCache: {
          getFirstLinkpathDest: jest.fn().mockImplementation((path: string) => {
            if (labels[path] || labels[path.replace(".md", "")]) {
              const mockFile = new TFile();
              (mockFile as unknown as { path: string }).path = path;
              return mockFile;
            }
            return null;
          }),
          getFileCache: jest.fn().mockImplementation((file: TFile) => {
            const pathWithoutExt = file.path.replace(".md", "");
            const label = labels[file.path] || labels[pathWithoutExt];
            if (label) {
              return { frontmatter: { exo__Asset_label: label } };
            }
            return null;
          }),
        },
      };
      return mockApp as unknown as import("@plugin/types").ObsidianApp;
    };

    describe("resolveWikilinkLabel function", () => {
      it("resolves wikilink label", () => {
        const mockApp = createMockApp({ "test": "Test Label" });
        const result = resolveWikilinkLabel(mockApp, "[[test]]");

        expect(result).toEqual({
          target: "test",
          displayText: "Test Label",
          hasAlias: false,
        });
      });
    });

    describe("getWikilinkDisplayText function", () => {
      it("returns resolved label", () => {
        const mockApp = createMockApp({ "test": "Test Label" });
        const result = getWikilinkDisplayText(mockApp, "[[test]]");
        expect(result).toBe("Test Label");
      });

      it("returns alias when present", () => {
        const mockApp = createMockApp({});
        const result = getWikilinkDisplayText(mockApp, "[[test|My Alias]]");
        expect(result).toBe("My Alias");
      });

      it("returns fallback when provided and label not found", () => {
        const mockApp = createMockApp({});
        const result = getWikilinkDisplayText(mockApp, "[[unknown]]", "Fallback");
        expect(result).toBe("unknown");
      });

      it("returns target for non-wikilink", () => {
        const mockApp = createMockApp({});
        const result = getWikilinkDisplayText(mockApp, "plain text", "Fallback");
        expect(result).toBe("Fallback");
      });
    });
  });
});
