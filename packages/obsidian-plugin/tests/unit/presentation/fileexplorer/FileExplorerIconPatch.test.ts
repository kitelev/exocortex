jest.mock("obsidian", () => {
  class FakeTFileCtor {
    path: string;
    basename: string;
    extension: string;
    constructor(path: string) {
      this.path = path;
      const name = path.split("/").pop() || path;
      this.basename = name.replace(/\.md$/, "");
      this.extension = "md";
    }
  }
  return {
    Plugin: class {},
    TFile: FakeTFileCtor,
    Notice: jest.fn(),
    setIcon: jest.fn((el: HTMLElement, name: string) => {
      el.setAttribute("data-lucide", name);
    }),
  };
});

import { FileExplorerIconPatch } from "../../../../src/presentation/fileexplorer/FileExplorerIconPatch";
import { ThemeResolver } from "../../../../src/application/services/ThemeResolver";
import { TFile as ObsidianTFile, setIcon as obsidianSetIcon } from "obsidian";

const FakeTFileCtor = ObsidianTFile as unknown as new (path: string) => {
  path: string;
  basename: string;
  extension: string;
};

describe("FileExplorerIconPatch", () => {
  const TASK_PATH = "03 Knowledge/task-uuid.md";
  const PROJECT_PATH = "03 Knowledge/project-uuid.md";
  const NON_EXOCORTEX_PATH = "03 Knowledge/Random.md";
  const NO_ICON_PATH = "03 Knowledge/no-icon.md";

  let patch: FileExplorerIconPatch;
  let mockPlugin: any;
  let mockApp: any;
  let navContainer: HTMLElement;
  let frontmatters: Record<string, any>;
  let filesByPath: Record<string, any>;
  let themeResolver: ThemeResolver;

  function createNavFileTitle(path: string): HTMLElement {
    const titleEl = document.createElement("div");
    titleEl.className = "nav-file-title";
    titleEl.setAttribute("data-path", path);

    const contentEl = document.createElement("div");
    contentEl.className = "nav-file-title-content";
    contentEl.textContent = (path.split("/").pop() || path).replace(
      /\.md$/,
      "",
    );
    titleEl.appendChild(contentEl);

    return titleEl;
  }

  beforeEach(() => {
    navContainer = document.createElement("div");
    navContainer.className = "nav-files-container";
    document.body.appendChild(navContainer);

    frontmatters = {
      [TASK_PATH]: {
        exo__Instance_class: ["[[ems__Task]]"],
        exo__Asset_label: "Task A",
      },
      [PROJECT_PATH]: {
        exo__Instance_class: ["[[ems__Project]]"],
        exo__Asset_label: "Project A",
      },
      [NON_EXOCORTEX_PATH]: { tags: ["misc"] },
      [NO_ICON_PATH]: {
        exo__Instance_class: ["[[ems__UnknownClass]]"],
      },
    };
    filesByPath = {
      [TASK_PATH]: new FakeTFileCtor(TASK_PATH),
      [PROJECT_PATH]: new FakeTFileCtor(PROJECT_PATH),
      [NON_EXOCORTEX_PATH]: new FakeTFileCtor(NON_EXOCORTEX_PATH),
      [NO_ICON_PATH]: new FakeTFileCtor(NO_ICON_PATH),
    };

    mockApp = {
      workspace: { on: jest.fn().mockReturnValue({ id: "evt" }) },
      metadataCache: {
        on: jest.fn().mockReturnValue({ id: "evt" }),
        getFileCache: jest.fn().mockImplementation((file: any) => {
          const fm = frontmatters[file.path];
          return fm ? { frontmatter: fm } : null;
        }),
      },
      vault: {
        getAbstractFileByPath: jest
          .fn()
          .mockImplementation((p: string) => filesByPath[p] ?? null),
      },
    };

    mockPlugin = { app: mockApp, registerEvent: jest.fn() };

    themeResolver = new ThemeResolver({
      layoutProvider: (cls: string) => {
        if (cls === "ems__Task") {
          return {
            accentColor: null,
            icon: "check-square",
            labelTypography: null,
          };
        }
        if (cls === "ems__Project") {
          return {
            accentColor: null,
            icon: "folder-kanban",
            labelTypography: null,
          };
        }
        return null;
      },
    });

    patch = new FileExplorerIconPatch(mockPlugin, themeResolver);
  });

  afterEach(() => {
    patch.cleanup();
    jest.clearAllMocks();
    if (navContainer.parentNode) {
      navContainer.parentNode.removeChild(navContainer);
    }
  });

  describe("enable", () => {
    it("registers metadataCache (changed + resolved) and layout-change handlers", () => {
      patch.enable();
      expect(mockApp.metadataCache.on).toHaveBeenCalledWith(
        "changed",
        expect.any(Function),
      );
      expect(mockApp.metadataCache.on).toHaveBeenCalledWith(
        "resolved",
        expect.any(Function),
      );
      expect(mockApp.workspace.on).toHaveBeenCalledWith(
        "layout-change",
        expect.any(Function),
      );
    });

    it("is idempotent (double enable does not double-register)", () => {
      patch.enable();
      const calls = mockPlugin.registerEvent.mock.calls.length;
      patch.enable();
      expect(mockPlugin.registerEvent).toHaveBeenCalledTimes(calls);
    });
  });

  describe("icon overlay", () => {
    it("renders icon for class-bearing file with resolved icon", () => {
      const titleEl = createNavFileTitle(TASK_PATH);
      navContainer.appendChild(titleEl);

      patch.enable();

      const overlay = titleEl.querySelector<HTMLSpanElement>(
        ".exo-file-explorer-icon",
      );
      expect(overlay).toBeTruthy();
      expect(obsidianSetIcon).toHaveBeenCalledWith(overlay, "check-square");
    });

    it("inserts icon BEFORE .nav-file-title-content", () => {
      const titleEl = createNavFileTitle(TASK_PATH);
      navContainer.appendChild(titleEl);

      patch.enable();

      const children = Array.from(titleEl.children);
      const iconIdx = children.findIndex((c) =>
        c.classList.contains("exo-file-explorer-icon"),
      );
      const contentIdx = children.findIndex((c) =>
        c.classList.contains("nav-file-title-content"),
      );
      expect(iconIdx).toBeGreaterThanOrEqual(0);
      expect(iconIdx).toBeLessThan(contentIdx);
    });

    it("renders icons for multiple class-bearing files independently", () => {
      const taskEl = createNavFileTitle(TASK_PATH);
      const projectEl = createNavFileTitle(PROJECT_PATH);
      navContainer.appendChild(taskEl);
      navContainer.appendChild(projectEl);

      patch.enable();

      const taskOverlay = taskEl.querySelector(".exo-file-explorer-icon");
      const projectOverlay = projectEl.querySelector(
        ".exo-file-explorer-icon",
      );
      expect(taskOverlay).toBeTruthy();
      expect(projectOverlay).toBeTruthy();
      expect(obsidianSetIcon).toHaveBeenCalledWith(taskOverlay, "check-square");
      expect(obsidianSetIcon).toHaveBeenCalledWith(
        projectOverlay,
        "folder-kanban",
      );
    });

    it("does not double-overlay on subsequent patchAll", () => {
      const titleEl = createNavFileTitle(TASK_PATH);
      navContainer.appendChild(titleEl);

      patch.enable();
      const changedCb = mockApp.metadataCache.on.mock.calls.find(
        (c: any[]) => c[0] === "changed",
      )?.[1];
      if (changedCb) changedCb();

      const overlays = titleEl.querySelectorAll(".exo-file-explorer-icon");
      expect(overlays.length).toBe(1);
    });
  });

  describe("non-class / no-icon edge cases", () => {
    it("does NOT inject overlay for file without exo__Instance_class", () => {
      const titleEl = createNavFileTitle(NON_EXOCORTEX_PATH);
      navContainer.appendChild(titleEl);

      patch.enable();

      expect(titleEl.querySelector(".exo-file-explorer-icon")).toBeNull();
    });

    it("does NOT inject overlay when ThemeResolver returns null icon", () => {
      const titleEl = createNavFileTitle(NO_ICON_PATH);
      navContainer.appendChild(titleEl);

      patch.enable();

      expect(titleEl.querySelector(".exo-file-explorer-icon")).toBeNull();
    });

    it("does nothing when metadataCache returns null", () => {
      const orphan = "03 Knowledge/orphan.md";
      filesByPath[orphan] = new FakeTFileCtor(orphan);
      const titleEl = createNavFileTitle(orphan);
      navContainer.appendChild(titleEl);

      patch.enable();

      expect(titleEl.querySelector(".exo-file-explorer-icon")).toBeNull();
    });

    it("does nothing when data-path is missing", () => {
      const titleEl = document.createElement("div");
      titleEl.className = "nav-file-title";
      const contentEl = document.createElement("div");
      contentEl.className = "nav-file-title-content";
      titleEl.appendChild(contentEl);
      navContainer.appendChild(titleEl);

      patch.enable();

      expect(titleEl.querySelector(".exo-file-explorer-icon")).toBeNull();
    });
  });

  describe("Iconize co-existence", () => {
    it("skips rows that already carry an Iconize-injected icon", () => {
      const titleEl = createNavFileTitle(TASK_PATH);
      const iconize = document.createElement("span");
      iconize.className = "obsidian-icon-folder-icon";
      titleEl.insertBefore(iconize, titleEl.firstChild);
      navContainer.appendChild(titleEl);

      patch.enable();

      expect(titleEl.querySelector(".exo-file-explorer-icon")).toBeNull();
    });
  });

  describe("disable / cleanup", () => {
    it("removes overlay on disable", () => {
      const titleEl = createNavFileTitle(TASK_PATH);
      navContainer.appendChild(titleEl);

      patch.enable();
      expect(titleEl.querySelector(".exo-file-explorer-icon")).toBeTruthy();

      patch.disable();

      expect(titleEl.querySelector(".exo-file-explorer-icon")).toBeNull();
      expect(titleEl.getAttribute("data-exo-fe-icon-patched")).toBeNull();
    });

    it("disconnects MutationObserver on cleanup — no overlay for rows added later", async () => {
      patch.enable();
      patch.cleanup();

      // Row appears AFTER cleanup; the observer must not re-patch it.
      const titleEl = createNavFileTitle(TASK_PATH);
      navContainer.appendChild(titleEl);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(titleEl.querySelector(".exo-file-explorer-icon")).toBeNull();
      expect(titleEl.getAttribute("data-exo-fe-icon-patched")).toBeNull();
    });

    it("cleanup is idempotent (double cleanup safe)", () => {
      const titleEl = createNavFileTitle(TASK_PATH);
      navContainer.appendChild(titleEl);

      patch.enable();
      patch.cleanup();
      // Second cleanup must not throw and must keep the row free of overlay.
      expect(() => patch.cleanup()).not.toThrow();
      expect(titleEl.querySelector(".exo-file-explorer-icon")).toBeNull();
    });
  });

  describe("MutationObserver", () => {
    it("patches a nav-file-title added after enable()", async () => {
      patch.enable();

      const titleEl = createNavFileTitle(TASK_PATH);
      navContainer.appendChild(titleEl);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(titleEl.querySelector(".exo-file-explorer-icon")).toBeTruthy();
    });
  });
});
