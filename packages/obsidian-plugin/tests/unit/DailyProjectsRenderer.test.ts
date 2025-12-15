import { DailyProjectsRenderer } from "../../src/presentation/renderers/DailyProjectsRenderer";
import { TFile } from "obsidian";
import { ExocortexSettings } from "../../src/domain/settings/ExocortexSettings";
import { ILogger } from "../../src/infrastructure/logging/ILogger";
import { MetadataExtractor, IVaultAdapter } from "exocortex";
import { ReactRenderer } from "../../src/presentation/utils/ReactRenderer";

describe("DailyProjectsRenderer", () => {
  let renderer: DailyProjectsRenderer;
  let mockApp: any;
  let mockSettings: ExocortexSettings;
  let mockPlugin: any;
  let mockLogger: jest.Mocked<ILogger>;
  let mockMetadataExtractor: jest.Mocked<MetadataExtractor>;
  let mockReactRenderer: jest.Mocked<ReactRenderer>;
  let mockRefresh: jest.Mock;
  let mockGetAssetLabel: jest.Mock;
  let mockGetEffortArea: jest.Mock;
  let mockVaultAdapter: jest.Mocked<IVaultAdapter>;

  const createMockElement = (): any => {
    const el: any = document.createElement("div");
    el.createDiv = (opts?: any) => {
      const div: any = document.createElement("div");
      if (opts?.cls) div.className = opts.cls;
      el.appendChild(div);
      div.createEl = (tag: string, opts?: any) => {
        const element = document.createElement(tag);
        if (opts?.cls) element.className = opts.cls;
        if (opts?.text) element.textContent = opts.text;
        div.appendChild(element);
        return element;
      };
      div.createDiv = el.createDiv;
      return div;
    };
    return el;
  };

  beforeEach(() => {
    mockApp = {
      vault: {
        getMarkdownFiles: jest.fn().mockReturnValue([]),
      },
      metadataCache: {
        getFileCache: jest.fn(),
        getFirstLinkpathDest: jest.fn(),
      },
      workspace: {
        getLeaf: jest.fn().mockReturnValue({
          openLinkText: jest.fn(),
        }),
        openLinkText: jest.fn(),
      },
    };

    mockSettings = {
      activeFocusArea: null,
      showEffortArea: true,
      showEffortVotes: true,
    } as ExocortexSettings;

    mockPlugin = {
      saveSettings: jest.fn(),
    };

    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    } as any;

    mockMetadataExtractor = {
      extractMetadata: jest.fn(),
      extractInstanceClass: jest.fn(),
      extractStatus: jest.fn(),
      extractIsArchived: jest.fn(),
    } as any;

    mockReactRenderer = {
      render: jest.fn(),
      unmount: jest.fn(),
    } as any;

    mockRefresh = jest.fn();
    mockGetAssetLabel = jest.fn();
    mockGetEffortArea = jest.fn();

    mockVaultAdapter = {
      getAllFiles: jest.fn().mockReturnValue([]),
      read: jest.fn(),
      create: jest.fn(),
      modify: jest.fn(),
      delete: jest.fn(),
      exists: jest.fn(),
      getAbstractFileByPath: jest.fn(),
      getFrontmatter: jest.fn(),
      updateFrontmatter: jest.fn(),
      rename: jest.fn(),
      createFolder: jest.fn(),
      getFirstLinkpathDest: jest.fn(),
      process: jest.fn(),
      getDefaultNewFileParent: jest.fn(),
      updateLinks: jest.fn(),
    } as any;

    renderer = new DailyProjectsRenderer(
      mockApp,
      mockSettings,
      mockPlugin,
      mockLogger,
      mockMetadataExtractor,
      mockReactRenderer,
      mockRefresh,
      mockGetAssetLabel,
      mockGetEffortArea,
      mockVaultAdapter,
    );
  });

  describe("render", () => {
    it("should not render for non-daily-note files", async () => {
      const mockFile = {
        path: "test.md",
        parent: { path: "Projects" },
        basename: "TestProject",
      } as TFile;
      const metadata = { exo__Instance_class: "[[ems__Project]]" };

      mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
      mockMetadataExtractor.extractInstanceClass.mockReturnValue(
        "[[ems__Project]]",
      );

      const mockEl = createMockElement();
      await renderer.render(mockEl, mockFile);

      expect(mockEl.children.length).toBe(0);
      expect(mockReactRenderer.render).not.toHaveBeenCalled();
    });

    it("should not render when pn__DailyNote_day is missing", async () => {
      const mockFile = {
        path: "test.md",
        parent: { path: "DailyNotes" },
        basename: "2025-10-20",
      } as TFile;
      const metadata = { exo__Instance_class: "[[pn__DailyNote]]" };

      mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
      mockMetadataExtractor.extractInstanceClass.mockReturnValue(
        "[[pn__DailyNote]]",
      );

      const mockEl = createMockElement();
      await renderer.render(mockEl, mockFile);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "No pn__DailyNote_day found for daily note",
      );
      expect(mockReactRenderer.render).not.toHaveBeenCalled();
    });

    it("should not render when no projects found for the day", async () => {
      const mockFile = {
        path: "test.md",
        parent: { path: "DailyNotes" },
        basename: "2025-10-20",
      } as TFile;
      const metadata = {
        exo__Instance_class: "[[pn__DailyNote]]",
        pn__DailyNote_day: "[[2025-10-20]]",
      };

      mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
      mockMetadataExtractor.extractInstanceClass.mockReturnValue(
        "[[pn__DailyNote]]",
      );
      mockVaultAdapter.getAllFiles.mockReturnValue([]);

      const mockEl = createMockElement();
      await renderer.render(mockEl, mockFile);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "No projects found for day: 2025-10-20",
      );
      expect(mockReactRenderer.render).not.toHaveBeenCalled();
    });

    it("should render projects section when projects exist", async () => {
      const mockFile = {
        path: "test.md",
        parent: { path: "DailyNotes" },
        basename: "2025-10-20",
      } as TFile;
      const metadata = {
        exo__Instance_class: "[[pn__DailyNote]]",
        pn__DailyNote_day: "[[2025-10-20]]",
      };

      const projectFile = {
        path: "project.md",
        basename: "test-project",
      } as TFile;

      const projectMetadata = {
        exo__Instance_class: "[[ems__Project]]",
        ems__Effort_day: "[[2025-10-20]]",
        ems__Effort_startTimestamp: "2025-10-20T09:00:00",
        ems__Effort_status: "[[ems__EffortStatusToDo]]",
      };

      mockMetadataExtractor.extractMetadata
        .mockReturnValueOnce(metadata)
        .mockReturnValueOnce(projectMetadata);

      mockMetadataExtractor.extractInstanceClass.mockReturnValueOnce(
        "[[pn__DailyNote]]",
      );

      mockVaultAdapter.getAllFiles.mockReturnValue([projectFile]);

      const mockEl = createMockElement();
      await renderer.render(mockEl, mockFile);

      expect(
        mockEl.querySelector(".exocortex-daily-projects-section"),
      ).toBeTruthy();
      expect(mockEl.querySelector("h3")).toBeTruthy();
      expect(mockEl.querySelector("h3")?.textContent).toBe("Projects");
      expect(mockReactRenderer.render).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("Rendered 1 projects"),
      );
    });

    it("should filter out tasks from daily projects", async () => {
      const mockFile = {
        path: "test.md",
        parent: { path: "DailyNotes" },
        basename: "2025-10-20",
      } as TFile;
      const metadata = {
        exo__Instance_class: "[[pn__DailyNote]]",
        pn__DailyNote_day: "[[2025-10-20]]",
      };

      const taskFile = {
        path: "task.md",
        basename: "test-task",
      } as TFile;

      const taskMetadata = {
        exo__Instance_class: "[[ems__Task]]",
        ems__Effort_day: "[[2025-10-20]]",
        ems__Effort_startTimestamp: "2025-10-20T09:00:00",
        ems__Effort_status: "[[ems__EffortStatusBacklog]]",
      };

      mockMetadataExtractor.extractMetadata
        .mockReturnValueOnce(metadata)
        .mockReturnValueOnce(taskMetadata);

      mockMetadataExtractor.extractInstanceClass.mockReturnValueOnce(
        "[[pn__DailyNote]]",
      );

      mockVaultAdapter.getAllFiles.mockReturnValue([taskFile]);

      const mockEl = createMockElement();
      await renderer.render(mockEl, mockFile);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "No projects found for day: 2025-10-20",
      );
      expect(mockReactRenderer.render).not.toHaveBeenCalled();
    });

    it("should handle pn__DailyNote_day without brackets", async () => {
      const mockFile = {
        path: "test.md",
        parent: { path: "DailyNotes" },
        basename: "2025-10-20",
      } as TFile;
      const metadata = {
        exo__Instance_class: "[[pn__DailyNote]]",
        pn__DailyNote_day: "2025-10-20",
      };

      const projectFile = {
        path: "project.md",
        basename: "test-project",
      } as TFile;

      const projectMetadata = {
        exo__Instance_class: "[[ems__Project]]",
        ems__Effort_day: "2025-10-20",
        ems__Effort_startTimestamp: "2025-10-20T09:00:00",
        ems__Effort_status: "[[ems__EffortStatusToDo]]",
      };

      mockMetadataExtractor.extractMetadata
        .mockReturnValueOnce(metadata)
        .mockReturnValueOnce(projectMetadata);

      mockMetadataExtractor.extractInstanceClass.mockReturnValueOnce(
        "[[pn__DailyNote]]",
      );

      mockVaultAdapter.getAllFiles.mockReturnValue([projectFile]);

      const mockEl = createMockElement();
      await renderer.render(mockEl, mockFile);

      expect(mockReactRenderer.render).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("Rendered 1 projects"),
      );
    });

    it("should return all projects without artificial limit", async () => {
      const mockFile = {
        path: "test.md",
        parent: { path: "DailyNotes" },
        basename: "2025-10-20",
      } as TFile;
      const metadata = {
        exo__Instance_class: "[[pn__DailyNote]]",
        pn__DailyNote_day: "[[2025-10-20]]",
      };

      const projectFiles = Array.from(
        { length: 60 },
        (_, i) =>
          ({
            path: `project-${i}.md`,
            basename: `project-${i}`,
          }) as TFile,
      );

      const projectMetadata = {
        exo__Instance_class: "[[ems__Project]]",
        ems__Effort_day: "[[2025-10-20]]",
        ems__Effort_startTimestamp: "2025-10-20T09:00:00",
        ems__Effort_status: "[[ems__EffortStatusToDo]]",
      };

      mockMetadataExtractor.extractMetadata.mockReturnValueOnce(metadata);

      projectFiles.forEach(() => {
        mockMetadataExtractor.extractMetadata.mockReturnValueOnce(
          projectMetadata,
        );
      });

      mockMetadataExtractor.extractInstanceClass.mockReturnValueOnce(
        "[[pn__DailyNote]]",
      );

      mockVaultAdapter.getAllFiles.mockReturnValue(projectFiles);

      const mockEl = createMockElement();
      await renderer.render(mockEl, mockFile);

      expect(mockReactRenderer.render).toHaveBeenCalled();
      const renderCall = mockReactRenderer.render.mock.calls[0];
      const projects = renderCall[1].props.projects;
      // No artificial limit - all 60 projects should be returned
      // UI component handles virtualization for large lists
      expect(projects.length).toBe(60);
    });

    it("should handle error gracefully", async () => {
      const mockFile = {
        path: "test.md",
        parent: { path: "DailyNotes" },
        basename: "2025-10-20",
      } as TFile;
      const metadata = {
        exo__Instance_class: "[[pn__DailyNote]]",
        pn__DailyNote_day: "[[2025-10-20]]",
      };

      mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
      mockMetadataExtractor.extractInstanceClass.mockReturnValue(
        "[[pn__DailyNote]]",
      );
      mockVaultAdapter.getAllFiles.mockImplementation(() => {
        throw new Error("Vault error");
      });

      const mockEl = createMockElement();
      await renderer.render(mockEl, mockFile);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "No projects found for day: 2025-10-20",
      );
      expect(mockReactRenderer.render).not.toHaveBeenCalled();
    });

    it("should format timestamps correctly", async () => {
      const mockFile = {
        path: "test.md",
        parent: { path: "DailyNotes" },
        basename: "2025-10-20",
      } as TFile;
      const metadata = {
        exo__Instance_class: "[[pn__DailyNote]]",
        pn__DailyNote_day: "[[2025-10-20]]",
      };

      const projectFile = {
        path: "project.md",
        basename: "test-project",
      } as TFile;

      const projectMetadata = {
        exo__Instance_class: "[[ems__Project]]",
        ems__Effort_day: "[[2025-10-20]]",
        ems__Effort_status: "[[ems__EffortStatusDoing]]",
        ems__Effort_startTimestamp: "2025-10-20T09:00:00.000Z",
        ems__Effort_endTimestamp: "2025-10-20T17:00:00.000Z",
      };

      mockMetadataExtractor.extractMetadata
        .mockReturnValueOnce(metadata)
        .mockReturnValueOnce(projectMetadata);

      mockMetadataExtractor.extractInstanceClass.mockReturnValueOnce(
        "[[pn__DailyNote]]",
      );

      mockVaultAdapter.getAllFiles.mockReturnValue([projectFile]);

      const mockEl = createMockElement();
      await renderer.render(mockEl, mockFile);

      expect(mockReactRenderer.render).toHaveBeenCalled();
      const renderCall = mockReactRenderer.render.mock.calls[0];
      const projects = renderCall[1].props.projects;
      expect(projects[0].startTime).toBeTruthy();
      expect(projects[0].endTime).toBeTruthy();
    });
  });
});
