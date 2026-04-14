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
  };
});

import { FileExplorerLabelPatch } from "../../../../src/presentation/fileexplorer/FileExplorerLabelPatch";
import { TFile as ObsidianTFile } from "obsidian";

const FakeTFileCtor = ObsidianTFile as unknown as new (path: string) => {
  path: string;
  basename: string;
  extension: string;
};

describe("FileExplorerLabelPatch", () => {
  let patch: FileExplorerLabelPatch;
  let mockPlugin: any;
  let mockApp: any;
  let navContainer: HTMLElement;

  const FILE_TASK_UUID =
    "37a88fda-74f3-4b26-bc93-8ebdac701c70";
  const FILE_TASK_PATH = `03 Knowledge/${FILE_TASK_UUID}.md`;
  const FILE_PROJECT_UUID = "ab1b5cc2-0000-0000-0000-000000000000";
  const FILE_PROJECT_PATH = `03 Knowledge/${FILE_PROJECT_UUID}.md`;
  const FILE_NON_EXOCORTEX_PATH = "03 Knowledge/Random note.md";

  const FRONTMATTERS: Record<string, any> = {
    [FILE_TASK_PATH]: {
      exo__Instance_class: ["[[1b20a8f0-d745-4e93-91db-4531b3df120e|ems__Task]]"],
      exo__Asset_label: "Купить молоко",
    },
    [FILE_PROJECT_PATH]: {
      exo__Instance_class: ["[[7db5eeff-718a-49b0-8d2b-39b084a356e3|ems__Project]]"],
      exo__Asset_label: "Сайт перестройки",
    },
    [FILE_NON_EXOCORTEX_PATH]: {
      // No exo__Instance_class — should NOT be patched
      tags: ["misc"],
    },
  };

  const FILES_BY_PATH: Record<string, FakeTFileCtor> = {
    [FILE_TASK_PATH]: new FakeTFileCtor(FILE_TASK_PATH),
    [FILE_PROJECT_PATH]: new FakeTFileCtor(FILE_PROJECT_PATH),
    [FILE_NON_EXOCORTEX_PATH]: new FakeTFileCtor(FILE_NON_EXOCORTEX_PATH),
  };

  function createNavFileTitle(path: string, visibleText?: string): HTMLElement {
    const basename = (path.split("/").pop() || path).replace(/\.md$/, "");
    const titleEl = document.createElement("div");
    titleEl.className = "nav-file-title";
    titleEl.setAttribute("data-path", path);

    const contentEl = document.createElement("div");
    contentEl.className = "nav-file-title-content";
    contentEl.textContent = visibleText ?? basename;
    titleEl.appendChild(contentEl);

    return titleEl;
  }

  beforeEach(() => {
    navContainer = document.createElement("div");
    navContainer.className = "nav-files-container";
    document.body.appendChild(navContainer);

    mockApp = {
      workspace: {
        on: jest.fn().mockReturnValue({ id: "test" }),
      },
      metadataCache: {
        on: jest.fn().mockReturnValue({ id: "test" }),
        getFileCache: jest.fn().mockImplementation((file: FakeTFileCtor) => {
          const fm = FRONTMATTERS[file.path];
          return fm ? { frontmatter: fm } : null;
        }),
      },
      vault: {
        getAbstractFileByPath: jest.fn().mockImplementation((path: string) => {
          return FILES_BY_PATH[path] ?? null;
        }),
      },
    };

    mockPlugin = {
      app: mockApp,
      registerEvent: jest.fn(),
    };

    patch = new FileExplorerLabelPatch(mockPlugin);
  });

  afterEach(() => {
    patch.cleanup();
    jest.clearAllMocks();
    if (navContainer.parentNode) {
      navContainer.parentNode.removeChild(navContainer);
    }
  });

  describe("enable", () => {
    it("registers layout-change, metadataCache changed + resolved events", () => {
      patch.enable();

      expect(mockApp.workspace.on).toHaveBeenCalledWith(
        "layout-change",
        expect.any(Function)
      );
      expect(mockApp.metadataCache.on).toHaveBeenCalledWith(
        "changed",
        expect.any(Function)
      );
      expect(mockApp.metadataCache.on).toHaveBeenCalledWith(
        "resolved",
        expect.any(Function)
      );
    });

    it("is idempotent (double-enable registers events only once)", () => {
      patch.enable();
      const callCount = mockPlugin.registerEvent.mock.calls.length;
      patch.enable();
      expect(mockPlugin.registerEvent).toHaveBeenCalledTimes(callCount);
    });
  });

  describe("Scenario A: Exocortex assets get readable label overlay", () => {
    it("injects overlay span with exo__Asset_label for UUID filename", () => {
      const titleEl = createNavFileTitle(FILE_TASK_PATH);
      navContainer.appendChild(titleEl);

      patch.enable();

      const overlay = titleEl.querySelector<HTMLSpanElement>(
        ".exo-file-explorer-label"
      );
      expect(overlay).toBeTruthy();
      expect(overlay?.textContent).toBe("Купить молоко");
    });

    it("hides original text by adding .exo-file-explorer-label-hidden class", () => {
      const titleEl = createNavFileTitle(FILE_TASK_PATH);
      navContainer.appendChild(titleEl);

      patch.enable();

      const contentEl = titleEl.querySelector<HTMLElement>(
        ".nav-file-title-content"
      )!;
      expect(
        contentEl.classList.contains("exo-file-explorer-label-hidden")
      ).toBe(true);
    });

    it("marks patched nodes to avoid double-overlay", () => {
      const titleEl = createNavFileTitle(FILE_TASK_PATH);
      navContainer.appendChild(titleEl);

      patch.enable();
      // Trigger a second full scan via metadataCache changed
      const changedCb = mockApp.metadataCache.on.mock.calls.find(
        (c: any[]) => c[0] === "changed"
      )?.[1];
      if (changedCb) changedCb();

      const overlays = titleEl.querySelectorAll(".exo-file-explorer-label");
      expect(overlays.length).toBe(1);
    });

    it("patches multiple Exocortex assets independently", () => {
      const taskEl = createNavFileTitle(FILE_TASK_PATH);
      const projectEl = createNavFileTitle(FILE_PROJECT_PATH);
      navContainer.appendChild(taskEl);
      navContainer.appendChild(projectEl);

      patch.enable();

      expect(
        taskEl.querySelector<HTMLSpanElement>(".exo-file-explorer-label")
          ?.textContent
      ).toBe("Купить молоко");
      expect(
        projectEl.querySelector<HTMLSpanElement>(".exo-file-explorer-label")
          ?.textContent
      ).toBe("Сайт перестройки");
    });
  });

  describe("Scenario B: non-Exocortex files left untouched", () => {
    it("does NOT inject overlay for file without exo__Instance_class", () => {
      const titleEl = createNavFileTitle(FILE_NON_EXOCORTEX_PATH);
      navContainer.appendChild(titleEl);

      patch.enable();

      const overlay = titleEl.querySelector(".exo-file-explorer-label");
      expect(overlay).toBeNull();
      const contentEl = titleEl.querySelector<HTMLElement>(
        ".nav-file-title-content"
      )!;
      expect(
        contentEl.classList.contains("exo-file-explorer-label-hidden")
      ).toBe(false);
    });

    it("does NOT inject overlay when label equals visible text", () => {
      // Simulate file whose basename already matches label — no improvement possible
      const path = "03 Knowledge/Already Readable.md";
      FILES_BY_PATH[path] = new FakeTFileCtor(path);
      FRONTMATTERS[path] = {
        exo__Instance_class: ["[[ems__Task]]"],
        exo__Asset_label: "Already Readable",
      };
      const titleEl = createNavFileTitle(path);
      navContainer.appendChild(titleEl);

      patch.enable();

      expect(titleEl.querySelector(".exo-file-explorer-label")).toBeNull();
      delete FILES_BY_PATH[path];
      delete FRONTMATTERS[path];
    });
  });

  describe("Scenario C: no-frontmatter / no-label edge cases", () => {
    it("does nothing when metadataCache returns null", () => {
      const orphanPath = "03 Knowledge/orphan-uuid.md";
      FILES_BY_PATH[orphanPath] = new FakeTFileCtor(orphanPath);
      const titleEl = createNavFileTitle(orphanPath);
      navContainer.appendChild(titleEl);

      patch.enable();

      expect(titleEl.querySelector(".exo-file-explorer-label")).toBeNull();
      delete FILES_BY_PATH[orphanPath];
    });

    it("does nothing when data-path attribute is missing", () => {
      const titleEl = document.createElement("div");
      titleEl.className = "nav-file-title";
      const contentEl = document.createElement("div");
      contentEl.className = "nav-file-title-content";
      contentEl.textContent = "noop";
      titleEl.appendChild(contentEl);
      navContainer.appendChild(titleEl);

      patch.enable();

      expect(titleEl.querySelector(".exo-file-explorer-label")).toBeNull();
    });
  });

  describe("disable / cleanup", () => {
    it("removes overlay span on disable and restores hidden class", () => {
      const titleEl = createNavFileTitle(FILE_TASK_PATH);
      navContainer.appendChild(titleEl);

      patch.enable();
      const contentEl = titleEl.querySelector<HTMLElement>(
        ".nav-file-title-content"
      )!;
      expect(
        contentEl.classList.contains("exo-file-explorer-label-hidden")
      ).toBe(true);
      expect(titleEl.querySelector(".exo-file-explorer-label")).toBeTruthy();

      patch.disable();

      expect(titleEl.querySelector(".exo-file-explorer-label")).toBeNull();
      expect(
        contentEl.classList.contains("exo-file-explorer-label-hidden")
      ).toBe(false);
      expect((contentEl.textContent || "").trim()).toBe(FILE_TASK_UUID);
    });
  });

  describe("dynamic DOM (MutationObserver)", () => {
    it("patches a nav-file-title added after enable()", async () => {
      patch.enable();

      const titleEl = createNavFileTitle(FILE_TASK_PATH);
      navContainer.appendChild(titleEl);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const overlay = titleEl.querySelector<HTMLSpanElement>(
        ".exo-file-explorer-label"
      );
      expect(overlay?.textContent).toBe("Купить молоко");
    });
  });

  describe("Finding 4 regression: empty metadataCache at enable() + resolved later", () => {
    it("recovers when metadataCache is empty at enable() and fires resolved later", () => {
      let metadataResolved = false;
      mockApp.metadataCache.getFileCache = jest
        .fn()
        .mockImplementation((file: FakeTFileCtor) => {
          if (!metadataResolved) return null;
          const fm = FRONTMATTERS[file.path];
          return fm ? { frontmatter: fm } : null;
        });

      const titleEl = createNavFileTitle(FILE_TASK_PATH);
      navContainer.appendChild(titleEl);

      patch.enable();

      expect(titleEl.querySelector(".exo-file-explorer-label")).toBeNull();

      metadataResolved = true;
      const resolvedCb = mockApp.metadataCache.on.mock.calls.find(
        (c: any[]) => c[0] === "resolved"
      )?.[1];
      expect(typeof resolvedCb).toBe("function");
      resolvedCb();

      const overlay = titleEl.querySelector<HTMLSpanElement>(
        ".exo-file-explorer-label"
      );
      expect(overlay?.textContent).toBe("Купить молоко");
    });
  });

  describe("stylesheet: overlay + hidden class rules present", () => {
    it("styles.css contains .exo-file-explorer-label-hidden font-size:0 rule", () => {
      const fs = require("fs");
      const path = require("path");
      const stylesPath = path.resolve(
        __dirname,
        "../../../../styles.css"
      );
      const css = fs.readFileSync(stylesPath, "utf8");

      const hiddenMatch = css.match(
        /\.nav-file-title-content\.exo-file-explorer-label-hidden\s*\{([^}]*)\}/
      );
      expect(hiddenMatch).toBeTruthy();
      expect(hiddenMatch![1]).toMatch(/font-size:\s*0/);

      const overlayMatch = css.match(
        /\.nav-file-title-content \.exo-file-explorer-label\s*\{([^}]*)\}/
      );
      expect(overlayMatch).toBeTruthy();
    });
  });
});
