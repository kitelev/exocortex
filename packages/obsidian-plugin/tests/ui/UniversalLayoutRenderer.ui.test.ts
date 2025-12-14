/**
 * @jest-environment jest-environment-obsidian
 * @obsidian-conformance strict
 * @obsidian-version 1.7.7
 *
 * UI Integration tests for UniversalLayoutRenderer
 * Tests actual DOM rendering using Obsidian API mocks
 */

import "reflect-metadata";
import { container } from "tsyringe";
import { App, TFile, MarkdownPostProcessorContext } from "obsidian";
import { UniversalLayoutRenderer } from "../../src/presentation/renderers/UniversalLayoutRenderer";
import { FileBuilder, ListBuilder } from "./helpers/FileBuilder";
import { DEFAULT_SETTINGS } from "../../src/domain/settings/ExocortexSettings";
import { waitForReact, waitForDomElement } from "../unit/helpers/testHelpers";
import {
  DI_TOKENS,
  IVaultAdapter,
  registerCoreServices,
  resetContainer,
} from "exocortex";

describe("UniversalLayoutRenderer UI Integration", () => {
  let renderer: UniversalLayoutRenderer;
  let mockApp: App;
  let mockPlugin: any;
  let domContainer: HTMLElement;
  let mockVault: any;
  let mockVaultAdapter: any;

  beforeEach(() => {
    resetContainer();

    // Create a real DOM container
    domContainer = document.createElement("div");
    // Add Obsidian-specific methods
    (domContainer as any).createDiv = jest.fn((options?: { text?: string; cls?: string }) => {
      const div = document.createElement("div");
      if (options?.text) div.textContent = options.text;
      if (options?.cls) div.className = options.cls;
      domContainer.appendChild(div);
      return div;
    });
    document.body.appendChild(domContainer);

    // Create mock plugin with saveSettings
    mockPlugin = {
      saveSettings: jest.fn().mockResolvedValue(undefined),
    };

    // Create mock app with essential methods
    mockApp = {
      workspace: {
        getActiveFile: jest.fn(),
        openLinkText: jest.fn(),
      },
      vault: {
        getAbstractFileByPath: jest.fn((path: string) => {
          // Return active file if path matches
          const activeFile = mockApp.workspace.getActiveFile();
          if (activeFile && activeFile.path === path) {
            return activeFile;
          }
          // Search in resolved links for other files
          for (const filePath in mockApp.metadataCache.resolvedLinks) {
            if (filePath === path) {
              return {
                path: filePath,
                basename: filePath.split("/").pop()?.replace(".md", ""),
                stat: { ctime: Date.now(), mtime: Date.now() },
              };
            }
          }
          return null;
        }),
        getMarkdownFiles: jest.fn().mockReturnValue([]),
      },
      metadataCache: {
        getFileCache: jest.fn(),
        getFirstLinkpathDest: jest.fn(),
        resolvedLinks: {},
        on: jest.fn(),
      },
      fileManager: {
        processFrontMatter: jest.fn().mockResolvedValue(undefined),
        renameFile: jest.fn().mockResolvedValue(undefined),
      },
    } as unknown as App;

    // Setup DI container with all required dependencies
    mockVault = {
      create: jest.fn().mockResolvedValue({ path: "test-task.md" }),
      read: jest.fn().mockResolvedValue(""),
      modify: jest.fn().mockResolvedValue(undefined),
      getAllFiles: jest.fn().mockReturnValue([]),
      getFrontmatter: jest.fn().mockReturnValue({}),
      exists: jest.fn().mockResolvedValue(true),
      updateFrontmatter: jest.fn().mockResolvedValue(undefined),
      getFirstLinkpathDest: jest.fn().mockReturnValue(null),
    };

    const mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
    };

    container.register(DI_TOKENS.IVaultAdapter, { useValue: mockVault });
    container.register(DI_TOKENS.ILogger, { useValue: mockLogger });
    registerCoreServices();

    mockVaultAdapter = {
      getAllFiles: jest.fn().mockReturnValue([]),
      read: jest.fn(),
      create: jest.fn(),
      modify: jest.fn(),
      delete: jest.fn(),
      exists: jest.fn(),
      getAbstractFileByPath: jest.fn((path: string) => {
        // Delegate to mockApp.vault.getAbstractFileByPath
        return mockApp.vault.getAbstractFileByPath(path);
      }),
      getFrontmatter: jest.fn((file: any) => {
        // Delegate to mockApp.metadataCache.getFileCache
        const cache = mockApp.metadataCache.getFileCache(file);
        return cache?.frontmatter || {};
      }),
      updateFrontmatter: jest.fn(),
      rename: jest.fn(),
      createFolder: jest.fn(),
      getFirstLinkpathDest: jest.fn((linkpath: string) => {
        return mockApp.metadataCache.getFirstLinkpathDest(linkpath, "");
      }),
      process: jest.fn(),
      getDefaultNewFileParent: jest.fn(),
      updateLinks: jest.fn(),
    };

    renderer = new UniversalLayoutRenderer(
      mockApp,
      { ...DEFAULT_SETTINGS, showPropertiesSection: true },
      mockPlugin,
      mockVaultAdapter,
    );
  });

  afterEach(() => {
    // Cleanup
    renderer.cleanup();
    document.body.removeChild(domContainer);
    resetContainer();
  });

  describe("DOM Rendering", () => {
    it("should render React component with proper DOM structure", async () => {
      // Setup test data
      const currentFile = new TFile("test.md");

      const relatedFile = new TFile("tasks/task1.md");
      (relatedFile as any).stat = { ctime: Date.now(), mtime: Date.now() };

      // Mock file cache with frontmatter
      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "ems__Task",
          status: "active",
        },
      });

      // Setup backlinks
      mockApp.metadataCache.resolvedLinks = {
        "tasks/task1.md": {
          "test.md": 1,
        },
      };

      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );
      (mockApp.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(
        relatedFile,
      );

      // Render
      const ctx = {} as MarkdownPostProcessorContext;
      await renderer.render("", domContainer, ctx);

      // Wait for React to render
      await waitForReact();

      // Verify DOM structure - should have both properties and relations sections
      expect(
        domContainer.querySelector(".exocortex-properties-section"),
      ).toBeTruthy();
      expect(
        domContainer.querySelector(".exocortex-assets-relations"),
      ).toBeTruthy();

      // Relations table is inside .exocortex-relations or .exocortex-relations-grouped
      const relationsContainer = domContainer.querySelector(
        ".exocortex-assets-relations",
      );
      expect(relationsContainer).toBeTruthy();
      const relationsTable = relationsContainer?.querySelector(
        ".exocortex-relations-table",
      );
      expect(relationsTable).toBeTruthy();

      // Verify properties table rendered
      const propertiesTable = domContainer.querySelector(
        ".exocortex-properties-table",
      );
      expect(propertiesTable).toBeTruthy();

      // Verify relations table headers
      const headers = relationsTable.querySelectorAll("th");
      expect(headers.length).toBeGreaterThan(0);

      const headerTexts = Array.from(headers).map((h) => h.textContent?.trim());
      expect(headerTexts.some((text) => text?.startsWith("Name"))).toBeTruthy();
      expect(headerTexts).toContain("exo__Instance_class");
    });

    it("should render clickable Instance Class links", async () => {
      const currentFile = new TFile("test.md");

      const relatedFile = new TFile("task1.md");
      (relatedFile as any).stat = { ctime: Date.now(), mtime: Date.now() };

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Task]]",
        },
      });

      mockApp.metadataCache.resolvedLinks = {
        "task1.md": { "test.md": 1 },
      };

      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );
      (mockApp.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(
        relatedFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      // Wait for React to render
      await waitForReact();

      // Find Instance Class links in RELATIONS table (not properties table)
      const relationsContainer = domContainer.querySelector(
        ".exocortex-assets-relations",
      );
      expect(relationsContainer).toBeTruthy();

      const relationsTable = relationsContainer?.querySelector(
        ".exocortex-relations-table",
      );
      expect(relationsTable).toBeTruthy();

      const instanceClassLinks = relationsTable?.querySelectorAll(
        ".instance-class a.internal-link",
      );
      expect(instanceClassLinks?.length).toBeGreaterThan(0);

      // Verify link text (wiki syntax removed)
      const linkText = instanceClassLinks?.[0]?.textContent?.trim();
      expect(linkText).toBe("ems__Task");
      expect(linkText).not.toContain("[[");
      expect(linkText).not.toContain("]]");
    });

    it("should handle grouped relations rendering", async () => {
      const currentFile = new TFile("test.md");

      // Create multiple files with different properties
      const file1 = new TFile("task1.md");
      (file1 as any).stat = { ctime: Date.now(), mtime: Date.now() };

      const file2 = new TFile("task2.md");
      (file2 as any).stat = { ctime: Date.now(), mtime: Date.now() };

      (mockApp.metadataCache.getFileCache as jest.Mock).mockImplementation(
        (file: any) => {
          if (file?.path === "task1.md") {
            return {
              frontmatter: {
                exo__Instance_class: "ems__Task",
                assignedTo: "[[test]]",
              },
            };
          } else if (file?.path === "task2.md") {
            return {
              frontmatter: {
                exo__Instance_class: "ems__Project",
                owner: "[[test]]",
              },
            };
          }
          return { frontmatter: {} };
        },
      );

      mockApp.metadataCache.resolvedLinks = {
        "task1.md": { "test.md": 1 },
        "task2.md": { "test.md": 1 },
      };

      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );
      (mockApp.vault.getAbstractFileByPath as jest.Mock).mockImplementation(
        (path: string) => {
          if (path === "test.md") return currentFile;
          if (path === "task1.md") return file1;
          if (path === "task2.md") return file2;
          return null;
        },
      );

      await renderer.render(
        "groupByProperty: true",
        domContainer,
        {} as MarkdownPostProcessorContext,
      );

      // Wait for React to render
      await waitForReact();

      // Verify grouped rendering
      const groups = domContainer.querySelectorAll(".relation-group");
      expect(groups.length).toBeGreaterThan(0);

      // Verify group headers
      const groupHeaders = domContainer.querySelectorAll(".group-header");
      const headerTexts = Array.from(groupHeaders).map((h) => h.textContent);
      expect(headerTexts).toContain("assignedTo");
      expect(headerTexts).toContain("owner");
    });

    it("should handle empty state gracefully", async () => {
      const currentFile = new TFile("test.md");

      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );
      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: null, // No frontmatter
      });
      mockApp.metadataCache.resolvedLinks = {}; // No backlinks

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      // With no frontmatter and no relations, nothing should be rendered
      // Properties table should NOT appear (no frontmatter)
      expect(
        domContainer.querySelector(".exocortex-properties-section"),
      ).toBeFalsy();
      // Relations table should NOT appear (no relations)
      expect(
        domContainer.querySelector(".exocortex-assets-relations"),
      ).toBeFalsy();
    });

    it("should filter archived notes from relations", async () => {
      const currentFile = new TFile("project.md");

      // Create three related files - two active, one archived
      const activeFile1 = new TFile("Active.md");
      (activeFile1 as any).stat = { ctime: Date.now(), mtime: Date.now() };

      const archivedFile = new TFile("Archived.md");
      (archivedFile as any).stat = { ctime: Date.now(), mtime: Date.now() };

      const activeFile2 = new TFile("Also Active.md");
      (activeFile2 as any).stat = { ctime: Date.now(), mtime: Date.now() };

      // Mock file cache - archived file has exo__Asset_isArchived: true
      (mockApp.metadataCache.getFileCache as jest.Mock).mockImplementation(
        (file: any) => {
          if (file?.path === "Active.md") {
            return { frontmatter: { exo__Asset_isArchived: false } };
          } else if (file?.path === "Archived.md") {
            return { frontmatter: { exo__Asset_isArchived: true } };
          } else if (file?.path === "Also Active.md") {
            return { frontmatter: { exo__Asset_isArchived: false } };
          }
          return { frontmatter: {} };
        },
      );

      // Setup backlinks - all three files link to current file
      mockApp.metadataCache.resolvedLinks = {
        "Active.md": { "project.md": 1 },
        "Archived.md": { "project.md": 1 },
        "Also Active.md": { "project.md": 1 },
      };

      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );
      (mockApp.vault.getAbstractFileByPath as jest.Mock).mockImplementation(
        (path: string) => {
          if (path === "project.md") return currentFile;
          if (path === "Active.md") return activeFile1;
          if (path === "Archived.md") return archivedFile;
          if (path === "Also Active.md") return activeFile2;
          return null;
        },
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      // Wait for React to render
      await waitForReact();

      // Verify relations table rendered
      const relationsContainer = domContainer.querySelector(
        ".exocortex-assets-relations",
      );
      expect(relationsContainer).toBeTruthy();

      const relationsTable = relationsContainer?.querySelector(
        ".exocortex-relations-table",
      );
      expect(relationsTable).toBeTruthy();

      // Verify only 2 rows (active files only)
      const rows = relationsTable?.querySelectorAll("tbody tr");
      expect(rows?.length).toBe(2);

      // Verify active files are present
      const rowTexts = Array.from(rows || []).map((row) => row.textContent);
      expect(rowTexts.some((text) => text?.includes("Active"))).toBeTruthy();
      expect(
        rowTexts.some((text) => text?.includes("Also Active")),
      ).toBeTruthy();

      // Verify archived file is NOT present
      expect(rowTexts.some((text) => text?.includes("Archived"))).toBeFalsy();
    });
  });

  describe("Create Task Button", () => {
    it("should render Create Task button for Area assets", async () => {
      const currentFile = new TFile("areas/project.md");

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Area]]",
          exo__Asset_isDefinedBy: "[[Ontology/EMS]]",
        },
      });

      mockApp.metadataCache.resolvedLinks = {}; // No relations
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      // Wait for React to render
      await waitForReact();

      // Verify button is present - find by text content
      const buttons = domContainer.querySelectorAll(".exocortex-action-button");
      const createTaskBtn = Array.from(buttons).find(
        (btn) => btn.textContent === "Create Task",
      );
      expect(createTaskBtn).toBeTruthy();
    });

    it("should render Create Task button for Project assets", async () => {
      const currentFile = new TFile("projects/redesign.md");

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Project]]",
          exo__Asset_isDefinedBy: "[[Ontology/EMS]]",
        },
      });

      mockApp.metadataCache.resolvedLinks = {}; // No relations
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      // Wait for React to render
      await waitForReact();

      // Verify button is present - find by text content
      const buttons = domContainer.querySelectorAll(".exocortex-action-button");
      const createTaskBtn = Array.from(buttons).find(
        (btn) => btn.textContent === "Create Task",
      );
      expect(createTaskBtn).toBeTruthy();
    });

    it("should NOT render Create Task button for non-Area/Project assets", async () => {
      const currentFile = new TFile("tasks/task1.md");

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Task]]",
        },
      });

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      // Verify button is NOT present
      const button = domContainer.querySelector(".exocortex-create-task-btn");
      expect(button).toBeFalsy();
    });

    it("should position Create Task button below properties table", async () => {
      const currentFile = new TFile("area.md");

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Area]]",
          exo__Asset_uid: "area-123",
        },
      });

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      // Verify order: properties section -> buttons section (containing action buttons) -> relations
      const children = Array.from(domContainer.children);
      const buttonsContainerIndex = children.findIndex((el) =>
        el.classList.contains("exocortex-buttons-section"),
      );
      const propertiesIndex = children.findIndex((el) =>
        el.classList.contains("exocortex-properties-section"),
      );

      expect(buttonsContainerIndex).toBeGreaterThanOrEqual(0);
      expect(propertiesIndex).toBeGreaterThanOrEqual(0);
      expect(propertiesIndex).toBeLessThan(buttonsContainerIndex);

      // Verify Create Task button is inside the action buttons container (inside buttons section)
      const buttonsSection = children[buttonsContainerIndex];
      const buttons = buttonsSection.querySelectorAll(
        ".exocortex-action-button",
      );
      const createTaskBtn = Array.from(buttons).find(
        (btn) => btn.textContent === "Create Task",
      );
      expect(createTaskBtn).toBeTruthy();
    });
  });

  describe("Mark Task Done Button", () => {
    it("should render Done button for Task with Doing status", async () => {
      const currentFile = new TFile("tasks/my-task.md");

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Task]]",
          ems__Effort_status: "[[ems__EffortStatusDoing]]",
          exo__Asset_isDefinedBy: "[[Ontology/EMS]]",
        },
      });

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      // Find Mark Done button by text content
      const buttons = domContainer.querySelectorAll(".exocortex-action-button");
      const doneBtn = Array.from(buttons).find(
        (btn) => btn.textContent === "Mark Done",
      );
      expect(doneBtn).toBeTruthy();
    });

    it("should NOT render Done button for Task with Backlog status", async () => {
      const currentFile = new TFile("tasks/backlog.md");

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Task]]",
          ems__Effort_status: "[[ems__EffortStatusBacklog]]",
        },
      });

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      const button = domContainer.querySelector(".exocortex-mark-done-btn");
      expect(button).toBeFalsy();
    });

    it("should NOT render Done button for Task with Done status", async () => {
      const currentFile = new TFile("tasks/completed.md");

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Task]]",
          ems__Effort_status: "[[ems__EffortStatusDone]]",
        },
      });

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      const button = domContainer.querySelector(".exocortex-mark-done-btn");
      expect(button).toBeFalsy();
    });

    it("should render Done button for Project with Doing status", async () => {
      const currentFile = new TFile("projects/project.md");

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Project]]",
          ems__Effort_status: "[[ems__EffortStatusDoing]]",
        },
      });

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      // Find Mark Done button by text content
      const buttons = domContainer.querySelectorAll(".exocortex-action-button");
      const doneBtn = Array.from(buttons).find(
        (btn) => btn.textContent === "Mark Done",
      );
      expect(doneBtn).toBeTruthy();
    });

    it("should NOT render Done button for Project with Backlog status", async () => {
      const currentFile = new TFile("projects/backlog.md");

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Project]]",
          ems__Effort_status: "[[ems__EffortStatusBacklog]]",
        },
      });

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      const button = domContainer.querySelector(".exocortex-mark-done-btn");
      expect(button).toBeFalsy();
    });

    it("should NOT render Done button for Project with Done status", async () => {
      const currentFile = new TFile("projects/completed.md");

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Project]]",
          ems__Effort_status: "[[ems__EffortStatusDone]]",
        },
      });

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      const button = domContainer.querySelector(".exocortex-mark-done-btn");
      expect(button).toBeFalsy();
    });

    it("should NOT render Done button for non-Task/Project assets (Area)", async () => {
      const currentFile = new TFile("areas/area.md");

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Area]]",
        },
      });

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      const button = domContainer.querySelector(".exocortex-mark-done-btn");
      expect(button).toBeFalsy();
    });
  });

  describe("Archive Task Button", () => {
    it("should render Archive button for Done Task not archived", async () => {
      const currentFile = new TFile("tasks/completed.md");

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Task]]",
          ems__Effort_status: "[[ems__EffortStatusDone]]",
          archived: false,
        },
      });

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      // Find Archive button by text content
      const buttons = domContainer.querySelectorAll(".exocortex-action-button");
      const archiveBtn = Array.from(buttons).find(
        (btn) => btn.textContent === "Archive",
      );
      expect(archiveBtn).toBeTruthy();
    });

    it("should NOT render Archive button for already archived Task", async () => {
      const currentFile = new TFile("tasks/archived.md");

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Task]]",
          ems__Effort_status: "[[ems__EffortStatusDone]]",
          archived: true,
        },
      });

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      const button = domContainer.querySelector(".exocortex-archive-task-btn");
      expect(button).toBeFalsy();
    });

    it("should render Archive button for Task with any status not archived", async () => {
      const currentFile = new TFile("tasks/active.md");

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Task]]",
          ems__Effort_status: "[[ems__EffortStatusActive]]",
          archived: false,
        },
      });

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      const buttons = domContainer.querySelectorAll(".exocortex-action-button");
      const archiveBtn = Array.from(buttons).find(
        (btn) => btn.textContent === "Archive",
      );
      expect(archiveBtn).toBeTruthy();
    });

    it("should render Archive button for Done Project not archived", async () => {
      const currentFile = new TFile("projects/completed.md");

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Project]]",
          ems__Effort_status: "[[ems__EffortStatusDone]]",
          archived: false,
        },
      });

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      // Find Archive button by text content
      const buttons = domContainer.querySelectorAll(".exocortex-action-button");
      const archiveBtn = Array.from(buttons).find(
        (btn) => btn.textContent === "Archive",
      );
      expect(archiveBtn).toBeTruthy();
    });

    it("should NOT render Archive button for already archived Project", async () => {
      const currentFile = new TFile("projects/archived.md");

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Project]]",
          ems__Effort_status: "[[ems__EffortStatusDone]]",
          archived: true,
        },
      });

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      const button = domContainer.querySelector(".exocortex-archive-task-btn");
      expect(button).toBeFalsy();
    });

    it("should render Archive button for Project with any status not archived", async () => {
      const currentFile = new TFile("projects/active.md");

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Project]]",
          ems__Effort_status: "[[ems__EffortStatusActive]]",
          archived: false,
        },
      });

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      const buttons = domContainer.querySelectorAll(".exocortex-action-button");
      const archiveBtn = Array.from(buttons).find(
        (btn) => btn.textContent === "Archive",
      );
      expect(archiveBtn).toBeTruthy();
    });

    it("should render Archive button for any asset type not archived (Area)", async () => {
      const currentFile = new TFile("areas/area.md");

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Area]]",
          archived: false,
        },
      });

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      const buttons = domContainer.querySelectorAll(".exocortex-action-button");
      const archiveBtn = Array.from(buttons).find(
        (btn) => btn.textContent === "Archive",
      );
      expect(archiveBtn).toBeTruthy();
    });
  });

  describe("Clean Empty Properties Button", () => {
    it("should render Clean button when asset has empty properties", async () => {
      const currentFile = new TFile("areas/empty-props.md");

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Area]]",
          exo__Asset_uid: "area-123",
          emptyProp: "",
          validProp: "value",
        },
      });

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      // Find Clean Properties button by text content
      const buttons = domContainer.querySelectorAll(".exocortex-action-button");
      const cleanBtn = Array.from(buttons).find(
        (btn) => btn.textContent === "Clean Properties",
      );
      expect(cleanBtn).toBeTruthy();
    });

    it("should NOT render Clean button when asset has no empty properties", async () => {
      const currentFile = new TFile("areas/no-empty.md");

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Area]]",
          exo__Asset_uid: "area-123",
          validProp1: "value1",
          validProp2: "value2",
        },
      });

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      const button = domContainer.querySelector(".exocortex-clean-properties-btn");
      expect(button).toBeFalsy();
    });

    it("should render Clean button for Task with empty properties", async () => {
      const currentFile = new TFile("tasks/empty-props.md");

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Task]]",
          ems__Effort_status: "[[ems__EffortStatusActive]]",
          emptyProp: null,
        },
      });

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      // Find Clean Properties button by text content
      const buttons = domContainer.querySelectorAll(".exocortex-action-button");
      const cleanBtn = Array.from(buttons).find(
        (btn) => btn.textContent === "Clean Properties",
      );
      expect(cleanBtn).toBeTruthy();
    });

    it("should render Clean button for Project with empty properties", async () => {
      const currentFile = new TFile("projects/empty-props.md");

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Project]]",
          ems__Effort_status: "[[ems__EffortStatusDone]]",
          emptyArray: [],
        },
      });

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      // Find Clean Properties button by text content
      const buttons = domContainer.querySelectorAll(".exocortex-action-button");
      const cleanBtn = Array.from(buttons).find(
        (btn) => btn.textContent === "Clean Properties",
      );
      expect(cleanBtn).toBeTruthy();
    });
  });

  describe("FileBuilder Integration", () => {
    it("should work with FileBuilder pattern for test data", () => {
      const [content, metadata] = new FileBuilder()
        .frontmatter({
          exo__Instance_class: "ems__Task",
          status: "active",
          priority: "high",
        })
        .heading(2, "Task Details")
        .text("This is a task description")
        .blank()
        .list(new ListBuilder().item("First item").item("Second item"))
        .blank()
        .link("Related Note", "alias")
        .done();

      // Verify content
      expect(content).toContain("---");
      expect(content).toContain("exo__Instance_class: ems__Task");
      expect(content).toContain("## Task Details");
      expect(content).toContain("- First item");
      expect(content).toContain("[[Related Note|alias]]");

      // Verify metadata
      expect(metadata.frontmatter.exo__Instance_class).toBe("ems__Task");
      expect(metadata.headings).toHaveLength(1);
      expect(metadata.headings[0].heading).toBe("Task Details");
      expect(metadata.links).toHaveLength(1);
      expect(metadata.links[0].link).toBe("Related Note");
    });
  });

  describe("Repair Folder Button", () => {
    it("should render Repair Folder button when asset is in wrong folder", async () => {
      const currentFile = new TFile("wrong/folder/asset.md");
      (currentFile as any).parent = { path: "wrong/folder" };

      const referencedFile = new TFile("correct/folder/reference.md");
      (referencedFile as any).parent = { path: "correct/folder" };

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Asset_isDefinedBy: "[[Reference]]",
        },
      });

      // Mock both the app's metadataCache and the DI vault's getFirstLinkpathDest
      (mockApp.metadataCache.getFirstLinkpathDest as jest.Mock) = jest
        .fn()
        .mockReturnValue(referencedFile);
      mockVault.getFirstLinkpathDest.mockReturnValue(referencedFile);

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      // Find Repair Folder button by text content
      const buttons = domContainer.querySelectorAll(".exocortex-action-button");
      const repairBtn = Array.from(buttons).find(
        (btn) => btn.textContent === "Repair Folder",
      );
      expect(repairBtn).toBeTruthy();
    });

    it("should NOT render Repair Folder button when asset is in correct folder", async () => {
      const currentFile = new TFile("correct/folder/asset.md");
      (currentFile as any).parent = { path: "correct/folder" };

      const referencedFile = new TFile("correct/folder/reference.md");
      (referencedFile as any).parent = { path: "correct/folder" };

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Asset_isDefinedBy: "[[Reference]]",
        },
      });

      (mockApp.metadataCache.getFirstLinkpathDest as jest.Mock) = jest
        .fn()
        .mockReturnValue(referencedFile);

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      const button = domContainer.querySelector(".exocortex-repair-folder-btn");
      expect(button).toBeFalsy();
    });

    it("should NOT render Repair Folder button when exo__Asset_isDefinedBy is missing", async () => {
      const currentFile = new TFile("folder/asset.md");
      (currentFile as any).parent = { path: "folder" };

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Task]]",
        },
      });

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      const button = domContainer.querySelector(".exocortex-repair-folder-btn");
      expect(button).toBeFalsy();
    });

    it("should NOT render Repair Folder button when referenced file not found", async () => {
      const currentFile = new TFile("folder/asset.md");
      (currentFile as any).parent = { path: "folder" };

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Asset_isDefinedBy: "[[NonExistent]]",
        },
      });

      (mockApp.metadataCache.getFirstLinkpathDest as jest.Mock) = jest
        .fn()
        .mockReturnValue(null);

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      const button = domContainer.querySelector(".exocortex-repair-folder-btn");
      expect(button).toBeFalsy();
    });

    it("should position Repair Folder button after Clean button and after properties", async () => {
      const currentFile = new TFile("wrong/asset.md");
      (currentFile as any).parent = { path: "wrong" };

      const referencedFile = new TFile("correct/ref.md");
      (referencedFile as any).parent = { path: "correct" };

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Asset_isDefinedBy: "[[Ref]]",
          exo__Instance_class: "[[ems__Task]]",
          emptyProp: "", // Add empty property to trigger Clean Properties button
        },
      });

      // Mock both the app's metadataCache and the DI vault's getFirstLinkpathDest
      (mockApp.metadataCache.getFirstLinkpathDest as jest.Mock) = jest
        .fn()
        .mockReturnValue(referencedFile);
      mockVault.getFirstLinkpathDest.mockReturnValue(referencedFile);

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      // Verify properties section is before buttons section
      const children = Array.from(domContainer.children);
      const buttonsContainerIndex = children.findIndex((el) =>
        el.classList.contains("exocortex-buttons-section"),
      );
      const propertiesIndex = children.findIndex((el) =>
        el.classList.contains("exocortex-properties-section"),
      );

      expect(buttonsContainerIndex).toBeGreaterThanOrEqual(0);
      expect(propertiesIndex).toBeGreaterThanOrEqual(0);
      expect(propertiesIndex).toBeLessThan(buttonsContainerIndex);

      // Verify both buttons exist inside the buttons section (via action buttons container)
      const buttonsSection = children[buttonsContainerIndex];
      const buttons = buttonsSection.querySelectorAll(
        ".exocortex-action-button",
      );

      const cleanBtn = Array.from(buttons).find(
        (btn) => btn.textContent === "Clean Properties",
      );
      const repairBtn = Array.from(buttons).find(
        (btn) => btn.textContent === "Repair Folder",
      );

      expect(cleanBtn).toBeTruthy();
      expect(repairBtn).toBeTruthy();
    });

    it("should render buttons in horizontal layout container", async () => {
      const currentFile = new TFile("test-asset.md");
      (currentFile as any).parent = { path: "wrong-folder" };

      const targetFile = new TFile("correct-folder/target.md");
      (targetFile as any).parent = { path: "correct-folder" };

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Area]]",
          exo__Asset_uid: "test-123",
          exo__Asset_isDefinedBy: "[[some-class]]",
          emptyProp: "",
        },
      });

      mockApp.metadataCache.resolvedLinks = {
        "some-class.md": { "correct-folder": 1 },
      };

      (mockApp.metadataCache.getFirstLinkpathDest as jest.Mock) = jest
        .fn()
        .mockReturnValue(targetFile);
      (mockApp.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(
        targetFile,
      );
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      // Get action buttons container
      const buttonsContainer = domContainer.querySelector(
        ".exocortex-buttons-section",
      ) as HTMLElement;
      expect(buttonsContainer).toBeTruthy();

      // Verify container has correct CSS class
      expect(
        buttonsContainer.classList.contains(
          "exocortex-buttons-section",
        ),
      ).toBe(true);

      // Verify all expected buttons are present (rendered via React)
      // Note: Buttons are rendered as React components, so direct text comparison may vary
      const buttons = buttonsContainer.querySelectorAll("button");
      expect(buttons.length).toBeGreaterThan(0);
    });
  });

  describe("Start Effort Button", () => {
    it("should render Start Effort button for Task with Backlog status", async () => {
      const currentFile = new TFile("tasks/backlog-task.md");

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Task]]",
          ems__Effort_status: "[[ems__EffortStatusBacklog]]",
        },
      });

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      // Find Start Effort button by text content
      const buttons = domContainer.querySelectorAll(".exocortex-action-button");
      const startBtn = Array.from(buttons).find(
        (btn) => btn.textContent === "Start Effort",
      );
      expect(startBtn).toBeTruthy();
    });

    it("should NOT render Start Effort button for Task with Draft status", async () => {
      const currentFile = new TFile("tasks/draft-task.md");

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Task]]",
          ems__Effort_status: "[[ems__EffortStatusDraft]]",
        },
      });

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      const button = domContainer.querySelector(".exocortex-start-effort-btn");
      expect(button).toBeFalsy();
    });

    it("should NOT render Start Effort button for Task with Doing status", async () => {
      const currentFile = new TFile("tasks/doing-task.md");

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Task]]",
          ems__Effort_status: "[[ems__EffortStatusDoing]]",
        },
      });

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      const button = domContainer.querySelector(".exocortex-start-effort-btn");
      expect(button).toBeFalsy();
    });

    it("should NOT render Start Effort button for Task with Done status", async () => {
      const currentFile = new TFile("tasks/done-task.md");

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Task]]",
          ems__Effort_status: "[[ems__EffortStatusDone]]",
        },
      });

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      const button = domContainer.querySelector(".exocortex-start-effort-btn");
      expect(button).toBeFalsy();
    });

    it("should NOT render Start Effort button for Project with Backlog status", async () => {
      const currentFile = new TFile("projects/backlog-project.md");

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Project]]",
          ems__Effort_status: "[[ems__EffortStatusBacklog]]",
        },
      });

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      // Find Start Effort button by text content
      const buttons = domContainer.querySelectorAll(".exocortex-action-button");
      const startBtn = Array.from(buttons).find(
        (btn) => btn.textContent === "Start Effort",
      );
      expect(startBtn).toBeFalsy();
    });

    it("should render Start Effort button for Project with ToDo status", async () => {
      const currentFile = new TFile("projects/todo-project.md");

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Project]]",
          ems__Effort_status: "[[ems__EffortStatusToDo]]",
        },
      });

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      // Find Start Effort button by text content
      const buttons = domContainer.querySelectorAll(".exocortex-action-button");
      const startBtn = Array.from(buttons).find(
        (btn) => btn.textContent === "Start Effort",
      );
      expect(startBtn).toBeTruthy();
    });

    it("should NOT render Start Effort button for Project with Doing status", async () => {
      const currentFile = new TFile("projects/doing-project.md");

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Project]]",
          ems__Effort_status: "[[ems__EffortStatusDoing]]",
        },
      });

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      const button = domContainer.querySelector(".exocortex-start-effort-btn");
      expect(button).toBeFalsy();
    });

    it("should NOT render Start Effort button for Project with Done status", async () => {
      const currentFile = new TFile("projects/done-project.md");

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Project]]",
          ems__Effort_status: "[[ems__EffortStatusDone]]",
        },
      });

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      const button = domContainer.querySelector(".exocortex-start-effort-btn");
      expect(button).toBeFalsy();
    });

    it("should NOT render Start Effort button for non-Task/Project assets (Area)", async () => {
      const currentFile = new TFile("areas/area.md");

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Area]]",
        },
      });

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      const button = domContainer.querySelector(".exocortex-start-effort-btn");
      expect(button).toBeFalsy();
    });
  });

  describe("React Component Cleanup", () => {
    it("should properly cleanup React roots on unmount", async () => {
      const currentFile = new TFile("test.md");

      const relatedFile = new TFile("task.md");
      (relatedFile as any).stat = { ctime: Date.now(), mtime: Date.now() };

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: { exo__Instance_class: "ems__Task" },
      });

      mockApp.metadataCache.resolvedLinks = { "task.md": { "test.md": 1 } };
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );
      (mockApp.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(
        relatedFile,
      );

      // Render
      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);
      expect(domContainer.children.length).toBeGreaterThan(0);

      // Cleanup
      renderer.cleanup();

      // Verify container is not empty but React internals are cleaned
      // (container still has DOM elements but React roots are unmounted)
      expect(
        domContainer.querySelector(".exocortex-assets-relations"),
      ).toBeTruthy();
    });
  });

  describe("Prototype Label Fallback", () => {
    it("should display prototype label when asset has exo__Asset_prototype", async () => {
      const currentFile = new TFile("current.md");

      const taskFile = new TFile("tasks/Task-123.md");
      (taskFile as any).stat = { ctime: Date.now(), mtime: Date.now() };

      const prototypeFile = new TFile("prototypes/TaskPrototype.md");

      // Mock workspace and vault
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      // Mock cache for current file
      (mockApp.metadataCache.getFileCache as jest.Mock).mockImplementation(
        (file: TFile) => {
          if (file.path === "current.md") {
            return { frontmatter: { exo__Instance_class: "ems__Area" } };
          }
          if (file.path === "tasks/Task-123.md") {
            return {
              frontmatter: {
                exo__Instance_class: "ems__Task",
                exo__Asset_prototype: "[[TaskPrototype]]",
                // No exo__Asset_label on task itself
              },
            };
          }
          if (file.path === "prototypes/TaskPrototype.md") {
            return {
              frontmatter: {
                exo__Asset_label: "Marketing Campaign Template",
              },
            };
          }
          return null;
        },
      );

      // Mock vault file lookup
      (mockApp.vault.getAbstractFileByPath as jest.Mock).mockImplementation(
        (path: string) => {
          if (path === "current.md") return currentFile;
          if (path === "tasks/Task-123.md") return taskFile;
          if (path === "TaskPrototype.md") return prototypeFile;
          if (path === "prototypes/TaskPrototype.md") return prototypeFile;
          return null;
        },
      );

      // Mock metadataCache.getFirstLinkpathDest (used by new label resolution logic)
      (
        mockApp.metadataCache.getFirstLinkpathDest as jest.Mock
      ).mockImplementation((path: string) => {
        if (path === "tasks/Task-123.md" || path === "tasks/Task-123")
          return taskFile;
        if (path === "TaskPrototype" || path === "TaskPrototype.md")
          return prototypeFile;
        return null;
      });

      // Mock backlinks
      mockApp.metadataCache.resolvedLinks = {
        "tasks/Task-123.md": { "current.md": 1 },
      };

      // Render
      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);
      await waitForReact();

      // Check that prototype label is displayed (not filename)
      const assetLinks = domContainer.querySelectorAll("a.internal-link");
      let foundPrototypeLabel = false;
      assetLinks.forEach((link) => {
        if (link.textContent === "Marketing Campaign Template") {
          foundPrototypeLabel = true;
        }
      });

      expect(foundPrototypeLabel).toBe(true);
    });
  });

  describe("Multiple Relations via Different Properties", () => {
    it("should render multiple relations when same asset links via different properties", async () => {
      // BUG: Asset A links to Asset B via property1 and property2
      // Asset B should show BOTH relations, but currently shows only one
      const currentFile = new TFile("assets/AssetB.md");

      const assetAFile = new TFile("assets/AssetA.md");
      (assetAFile as any).stat = { ctime: Date.now(), mtime: Date.now() };

      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      // AssetA has TWO properties linking to AssetB
      (mockApp.metadataCache.getFileCache as jest.Mock).mockImplementation(
        (file: TFile) => {
          if (file.path === "assets/AssetB.md") {
            return { frontmatter: { exo__Instance_class: "ems__Task" } };
          }
          if (file.path === "assets/AssetA.md") {
            return {
              frontmatter: {
                exo__Instance_class: "ems__Task",
                property1: "[[AssetB]]",
                property2: "[[AssetB]]",
              },
            };
          }
          return null;
        },
      );

      // Mock backlinks - AssetA links to AssetB
      mockApp.metadataCache.resolvedLinks = {
        "assets/AssetA.md": { "assets/AssetB.md": 2 },
      };

      (mockApp.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(
        assetAFile,
      );

      // Render with groupByProperty to see both relations
      await renderer.render(
        "groupByProperty: true",
        domContainer,
        {} as MarkdownPostProcessorContext,
      );

      await waitForReact();

      // Should show 2 groups (property1 and property2)
      const groups = domContainer.querySelectorAll(".relation-group");
      expect(groups.length).toBe(2);

      // Should have headers for both properties
      const groupHeaders = domContainer.querySelectorAll(".group-header");
      const headerTexts = Array.from(groupHeaders).map((h) => h.textContent);
      expect(headerTexts).toContain("property1");
      expect(headerTexts).toContain("property2");

      // Each group should have 1 row with AssetA
      const property1Group = Array.from(groups).find(
        (g) => g.querySelector(".group-header")?.textContent === "property1",
      );
      const property2Group = Array.from(groups).find(
        (g) => g.querySelector(".group-header")?.textContent === "property2",
      );

      expect(property1Group).toBeTruthy();
      expect(property2Group).toBeTruthy();

      const property1Rows = property1Group?.querySelectorAll("tbody tr");
      const property2Rows = property2Group?.querySelectorAll("tbody tr");

      expect(property1Rows?.length).toBe(1);
      expect(property2Rows?.length).toBe(1);

      // Both should show AssetA
      expect(property1Rows?.[0]?.textContent).toContain("AssetA");
      expect(property2Rows?.[0]?.textContent).toContain("AssetA");
    });
  });

  describe("Daily Tasks Table for pn__DailyNote", () => {
    it("should render Tasks table for pn__DailyNote with tasks", async () => {
      const currentFile = new TFile("daily-notes/2025-10-16 Note.md");

      const taskFile = new TFile("tasks/task1.md");
      (taskFile as any).stat = { ctime: Date.now(), mtime: Date.now() };

      // Setup mocks in same order as passing test
      (mockApp.metadataCache.getFileCache as jest.Mock).mockImplementation(
        (file: TFile) => {
          if (file.path === "daily-notes/2025-10-16 Note.md") {
            return {
              frontmatter: {
                exo__Instance_class: "[[pn__DailyNote]]",
                pn__DailyNote_day: "[[2025-10-16]]",
                some_property: "value",
              },
            };
          }
          if (file.path === "tasks/task1.md") {
            return {
              frontmatter: {
                exo__Instance_class: "ems__Task",
                exo__Asset_label: "Task 1",
                ems__Effort_status: "[[ems__EffortStatusDoing]]",
                ems__Effort_day: "[[2025-10-16]]",
                ems__Effort_startTimestamp: "2025-10-16T09:00:00",
                some_reference: "[[2025-10-16 Note]]",
              },
            };
          }
          return { frontmatter: {} };
        },
      );

      // Mock Dataview API
      const mockDataviewApi = {
        pages: jest.fn().mockReturnValue({
          values: [
            {
              file: { path: "tasks/task1.md" },
              ems__Effort_day: "[[2025-10-16]]",
                ems__Effort_startTimestamp: "2025-10-16T09:00:00",
            },
          ],
        }),
      };

      (mockApp as any).plugins = {
        plugins: {
          dataview: { api: mockDataviewApi },
        },
      };

      mockApp.metadataCache.resolvedLinks = {
        "tasks/task1.md": { "daily-notes/2025-10-16 Note.md": 1 },
      };

      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );
      (mockApp.vault.getAbstractFileByPath as jest.Mock).mockImplementation(
        (path: string) => {
          if (path === "daily-notes/2025-10-16 Note.md") return currentFile;
          if (path === "tasks/task1.md") return taskFile;
          return null;
        },
      );
      (mockVaultAdapter.getAllFiles as jest.Mock).mockReturnValue([taskFile]);

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      // Verify Tasks table is present
      const tasksSection = domContainer.querySelector(
        ".exocortex-daily-tasks-section",
      );

      // Verify Tasks section header is present
      const tasksHeader = tasksSection?.querySelector(".exocortex-section-header");
      const headerH3 = tasksHeader?.querySelector("h3");
      expect(headerH3?.textContent).toBe("Tasks");
      expect(tasksSection).toBeTruthy();

      const tasksTable = tasksSection?.querySelector(".exocortex-tasks-table");
      expect(tasksTable).toBeTruthy();
    });

    it("should NOT render Tasks table for non-DailyNote assets", async () => {
      const currentFile = new TFile("notes/regular.md");

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[ems__Task]]",
        },
      });

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      // Verify Tasks table is NOT present
      const tasksSection = domContainer.querySelector(
        ".exocortex-daily-tasks-section",
      );
      expect(tasksSection).toBeFalsy();
    });

    it("should NOT render Tasks table when pn__DailyNote_day is missing", async () => {
      const currentFile = new TFile("daily-notes/note.md");

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[pn__DailyNote]]",
          // Missing pn__DailyNote_day
        },
      });

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      // Verify Tasks table is NOT present
      const tasksSection = domContainer.querySelector(
        ".exocortex-daily-tasks-section",
      );
      expect(tasksSection).toBeFalsy();
    });

    it("should NOT render Tasks table when Dataview is not available", async () => {
      const currentFile = new TFile("daily-notes/2025-10-16 Note.md");

      (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          exo__Instance_class: "[[pn__DailyNote]]",
          pn__DailyNote_day: "[[2025-10-16]]",
        },
      });

      // No Dataview API
      (mockApp as any).plugins = {};

      mockApp.metadataCache.resolvedLinks = {};
      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      // Verify Tasks table is NOT present (graceful fallback)
      const tasksSection = domContainer.querySelector(
        ".exocortex-daily-tasks-section",
      );
      expect(tasksSection).toBeFalsy();
    });

    it("should render Tasks table even when vault has tasks matching the day", async () => {
      // REGRESSION TEST: Previously failed when Dataview API returned empty results.
      // This test ensures tasks are always found via vault file enumeration.
      const currentFile = new TFile("daily-notes/2025-10-16 Note.md");

      const taskFile1 = new TFile("tasks/task1.md");
      (taskFile1 as any).stat = { ctime: Date.now(), mtime: Date.now() };

      const taskFile2 = new TFile("tasks/task2.md");
      (taskFile2 as any).stat = { ctime: Date.now(), mtime: Date.now() };

      const otherDayTaskFile = new TFile("tasks/other.md");
      (otherDayTaskFile as any).stat = { ctime: Date.now(), mtime: Date.now() };

      // Setup mocks with realistic data
      (mockApp.metadataCache.getFileCache as jest.Mock).mockImplementation(
        (file: TFile) => {
          if (file.path === "daily-notes/2025-10-16 Note.md") {
            return {
              frontmatter: {
                exo__Instance_class: "[[pn__DailyNote]]",
                pn__DailyNote_day: "[[2025-10-16]]",
              },
            };
          }
          if (file.path === "tasks/task1.md") {
            return {
              frontmatter: {
                exo__Instance_class: "ems__Task",
                exo__Asset_label: "Morning standup",
                ems__Effort_status: "[[ems__EffortStatusDoing]]",
                ems__Effort_day: "[[2025-10-16]]",
                ems__Effort_startTimestamp: "2025-10-16T09:00:00",
                ems__Effort_startTimestamp: "2025-10-16T09:00:00",
              },
            };
          }
          if (file.path === "tasks/task2.md") {
            return {
              frontmatter: {
                exo__Instance_class: "ems__Task",
                exo__Asset_label: "Code review",
                ems__Effort_status: "[[ems__EffortStatusDone]]",
                ems__Effort_day: "[[2025-10-16]]",
                ems__Effort_startTimestamp: "2025-10-16T09:00:00",
                ems__Effort_endTimestamp: "2025-10-16T15:00:00",
              },
            };
          }
          if (file.path === "tasks/other.md") {
            return {
              frontmatter: {
                exo__Instance_class: "ems__Task",
                exo__Asset_label: "Different day task",
                ems__Effort_day: "[[2025-10-17]]", // Different day!
                ems__Effort_startTimestamp: "2025-10-17T09:00:00",
              },
            };
          }
          return { frontmatter: {} };
        },
      );

      // Mock Dataview plugin availability (but implementation doesn't matter for this test)
      (mockApp as any).plugins = {
        plugins: {
          dataview: { api: {} },
        },
      };

      mockApp.metadataCache.resolvedLinks = {};

      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );
      (mockApp.vault.getAbstractFileByPath as jest.Mock).mockImplementation(
        (path: string) => {
          if (path === "daily-notes/2025-10-16 Note.md") return currentFile;
          if (path === "tasks/task1.md") return taskFile1;
          if (path === "tasks/task2.md") return taskFile2;
          if (path === "tasks/other.md") return otherDayTaskFile;
          return null;
        },
      );

      // CRITICAL: Vault returns all task files, renderer should filter by day
      (mockVaultAdapter.getAllFiles as jest.Mock).mockReturnValue([
        taskFile1,
        taskFile2,
        otherDayTaskFile, // This should be filtered out!
      ]);

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      // Verify Tasks section rendered
      const tasksSection = domContainer.querySelector(
        ".exocortex-daily-tasks-section",
      );

      const tasksHeader = tasksSection?.querySelector(".exocortex-section-header");
      const headerH3 = tasksHeader?.querySelector("h3");
      expect(headerH3?.textContent).toBe("Tasks");
      expect(tasksSection).toBeTruthy();

      const tasksTable = tasksSection?.querySelector(".exocortex-tasks-table");
      expect(tasksTable).toBeTruthy();

      // Verify ONLY tasks for 2025-10-16 are shown (not the 2025-10-17 task)
      const taskRows = tasksTable?.querySelectorAll("tbody tr");
      expect(taskRows?.length).toBe(2);

      // Verify task content is rendered correctly
      const rowTexts = Array.from(taskRows || []).map((row) => row.textContent);
      expect(
        rowTexts.some((text) => text?.includes("Morning standup")),
      ).toBeTruthy();
      expect(
        rowTexts.some((text) => text?.includes("Code review")),
      ).toBeTruthy();
      expect(
        rowTexts.some((text) => text?.includes("Different day task")),
      ).toBeFalsy();
    });

    it("should position Tasks table between Properties and Relations", async () => {
      const currentFile = new TFile("daily-notes/2025-10-16 Note.md");

      const relatedTask = new TFile("tasks/task1.md");
      (relatedTask as any).stat = { ctime: Date.now(), mtime: Date.now() };

      (mockApp.metadataCache.getFileCache as jest.Mock).mockImplementation(
        (file: TFile) => {
          if (file.path === "daily-notes/2025-10-16 Note.md") {
            return {
              frontmatter: {
                exo__Instance_class: "[[pn__DailyNote]]",
                pn__DailyNote_day: "[[2025-10-16]]",
                some_property: "value",
              },
            };
          }
          if (file.path === "tasks/task1.md") {
            return {
              frontmatter: {
                exo__Instance_class: "ems__Task",
                ems__Effort_day: "[[2025-10-16]]",
                ems__Effort_startTimestamp: "2025-10-16T09:00:00",
                some_reference: "[[2025-10-16 Note]]",
              },
            };
          }
          return { frontmatter: {} };
        },
      );

      // Mock Dataview API
      const mockDataviewApi = {
        pages: jest.fn().mockReturnValue({
          values: [
            {
              file: { path: "tasks/task1.md" },
              ems__Effort_day: "[[2025-10-16]]",
                ems__Effort_startTimestamp: "2025-10-16T09:00:00",
            },
          ],
        }),
      };

      (mockApp as any).plugins = {
        plugins: {
          dataview: { api: mockDataviewApi },
        },
      };

      mockApp.metadataCache.resolvedLinks = {
        "tasks/task1.md": { "daily-notes/2025-10-16 Note.md": 1 },
      };

      (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(
        currentFile,
      );
      (mockApp.vault.getAbstractFileByPath as jest.Mock).mockImplementation(
        (path: string) => {
          if (path === "daily-notes/2025-10-16 Note.md") return currentFile;
          if (path === "tasks/task1.md") return relatedTask;
          return null;
        },
      );
      (mockVaultAdapter.getAllFiles as jest.Mock).mockReturnValue([
        relatedTask,
      ]);

      await renderer.render("", domContainer, {} as MarkdownPostProcessorContext);

      await waitForReact();

      // Verify order: Properties -> Tasks -> Relations
      const children = Array.from(domContainer.children);
      const propertiesIndex = children.findIndex((el) =>
        el.classList.contains("exocortex-properties-section"),
      );
      const tasksIndex = children.findIndex((el) =>
        el.classList.contains("exocortex-daily-tasks-section"),
      );
      const relationsIndex = children.findIndex((el) =>
        el.classList.contains("exocortex-assets-relations"),
      );

      expect(propertiesIndex).toBeGreaterThanOrEqual(0);
      expect(tasksIndex).toBeGreaterThanOrEqual(0);
      expect(relationsIndex).toBeGreaterThanOrEqual(0);

      // Tasks should be BETWEEN Properties and Relations
      expect(tasksIndex).toBeGreaterThan(propertiesIndex);
      expect(tasksIndex).toBeLessThan(relationsIndex);
    });
  });
});
