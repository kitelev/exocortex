import { DailyNavigationRenderer } from "../../../../src/presentation/renderers/helpers/DailyNavigationRenderer";
import { DailyNoteHelpers } from "../../../../src/presentation/renderers/helpers/DailyNoteHelpers";
import { DateFormatter, IVaultAdapter, MetadataExtractor } from "exocortex";
import { ILogger } from "../../../../src/adapters/logging/ILogger";

// Mock DailyNoteHelpers
jest.mock("../../../../src/presentation/renderers/helpers/DailyNoteHelpers");

describe("DailyNavigationRenderer", () => {
  let renderer: DailyNavigationRenderer;
  let mockApp: any;
  let mockVaultAdapter: jest.Mocked<IVaultAdapter>;
  let mockMetadataExtractor: jest.Mocked<MetadataExtractor>;
  let mockLogger: jest.Mocked<ILogger>;
  let mockFile: any;
  let containerEl: HTMLElement;

  beforeEach(() => {
    jest.clearAllMocks();

    mockApp = {
      workspace: {
        openLinkText: jest.fn(),
      },
    };

    mockVaultAdapter = {
      getAllFiles: jest.fn().mockReturnValue([]),
      read: jest.fn(),
      create: jest.fn(),
      modify: jest.fn(),
      delete: jest.fn(),
      exists: jest.fn(),
      getAbstractFileByPath: jest.fn(),
      getFrontmatter: jest.fn().mockReturnValue({}),
      updateFrontmatter: jest.fn(),
      rename: jest.fn(),
      createFolder: jest.fn(),
      getFirstLinkpathDest: jest.fn(),
      process: jest.fn(),
      getDefaultNewFileParent: jest.fn(),
      updateLinks: jest.fn(),
    } as unknown as jest.Mocked<IVaultAdapter>;

    mockMetadataExtractor = {
      extractMetadata: jest.fn(),
    } as unknown as jest.Mocked<MetadataExtractor>;

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    mockFile = {
      path: "daily/2025-01-15.md",
      basename: "2025-01-15",
    };

    containerEl = document.createElement("div");
    containerEl.createDiv = createDivMock;
    containerEl.createSpan = createSpanMock;

    renderer = new DailyNavigationRenderer(
      mockApp,
      mockVaultAdapter,
      mockMetadataExtractor,
      mockLogger
    );
  });

  describe("render", () => {
    it("should not render anything when file is not a daily note", () => {
      (DailyNoteHelpers.extractDailyNoteInfo as jest.Mock).mockReturnValue({
        isDailyNote: false,
        day: null,
      });

      renderer.render(containerEl, mockFile);

      expect(containerEl.querySelector(".exocortex-daily-navigation")).toBeNull();
    });

    it("should not render when daily note has no day value", () => {
      (DailyNoteHelpers.extractDailyNoteInfo as jest.Mock).mockReturnValue({
        isDailyNote: true,
        day: null,
      });

      renderer.render(containerEl, mockFile);

      expect(containerEl.querySelector(".exocortex-daily-navigation")).toBeNull();
    });

    it("should log debug message for invalid date format", () => {
      (DailyNoteHelpers.extractDailyNoteInfo as jest.Mock).mockReturnValue({
        isDailyNote: true,
        day: "invalid-date",
      });

      renderer.render(containerEl, mockFile);

      expect(mockLogger.debug).toHaveBeenCalledWith("Invalid date format: invalid-date");
    });

    it("should render navigation container for valid daily note", () => {
      (DailyNoteHelpers.extractDailyNoteInfo as jest.Mock).mockReturnValue({
        isDailyNote: true,
        day: "2025-01-15",
      });
      (DailyNoteHelpers.findDailyNoteByDate as jest.Mock).mockReturnValue(null);

      renderer.render(containerEl, mockFile);

      const navContainer = containerEl.querySelector(".exocortex-daily-navigation");
      expect(navContainer).toBeTruthy();
    });

    it("should render previous day navigation link", () => {
      (DailyNoteHelpers.extractDailyNoteInfo as jest.Mock).mockReturnValue({
        isDailyNote: true,
        day: "2025-01-15",
      });

      const prevDailyNote = { path: "daily/2025-01-14.md", basename: "2025-01-14" };
      (DailyNoteHelpers.findDailyNoteByDate as jest.Mock).mockImplementation(
        (_vault, _extractor, dateStr) => {
          if (dateStr === "2025-01-14") return prevDailyNote;
          return null;
        }
      );

      renderer.render(containerEl, mockFile);

      const prevSpan = containerEl.querySelector(".exocortex-nav-prev");
      expect(prevSpan).toBeTruthy();

      const link = prevSpan?.querySelector("a.internal-link");
      expect(link).toBeTruthy();
      expect(link?.textContent).toBe("← 2025-01-14");
      expect(link?.getAttribute("data-href")).toBe("daily/2025-01-14.md");
    });

    it("should render next day navigation link", () => {
      (DailyNoteHelpers.extractDailyNoteInfo as jest.Mock).mockReturnValue({
        isDailyNote: true,
        day: "2025-01-15",
      });

      const nextDailyNote = { path: "daily/2025-01-16.md", basename: "2025-01-16" };
      (DailyNoteHelpers.findDailyNoteByDate as jest.Mock).mockImplementation(
        (_vault, _extractor, dateStr) => {
          if (dateStr === "2025-01-16") return nextDailyNote;
          return null;
        }
      );

      renderer.render(containerEl, mockFile);

      const nextSpan = containerEl.querySelector(".exocortex-nav-next");
      expect(nextSpan).toBeTruthy();

      const link = nextSpan?.querySelector("a.internal-link");
      expect(link).toBeTruthy();
      expect(link?.textContent).toBe("2025-01-16 →");
      expect(link?.getAttribute("data-href")).toBe("daily/2025-01-16.md");
    });

    it("should render disabled state when previous day note doesn't exist", () => {
      (DailyNoteHelpers.extractDailyNoteInfo as jest.Mock).mockReturnValue({
        isDailyNote: true,
        day: "2025-01-15",
      });
      (DailyNoteHelpers.findDailyNoteByDate as jest.Mock).mockReturnValue(null);

      renderer.render(containerEl, mockFile);

      const prevSpan = containerEl.querySelector(".exocortex-nav-prev");
      expect(prevSpan).toBeTruthy();

      const disabledSpan = prevSpan?.querySelector(".exocortex-nav-disabled");
      expect(disabledSpan).toBeTruthy();
      expect(disabledSpan?.textContent).toBe("← 2025-01-14");
    });

    it("should render disabled state when next day note doesn't exist", () => {
      (DailyNoteHelpers.extractDailyNoteInfo as jest.Mock).mockReturnValue({
        isDailyNote: true,
        day: "2025-01-15",
      });
      (DailyNoteHelpers.findDailyNoteByDate as jest.Mock).mockReturnValue(null);

      renderer.render(containerEl, mockFile);

      const nextSpan = containerEl.querySelector(".exocortex-nav-next");
      expect(nextSpan).toBeTruthy();

      const disabledSpan = nextSpan?.querySelector(".exocortex-nav-disabled");
      expect(disabledSpan).toBeTruthy();
      expect(disabledSpan?.textContent).toBe("2025-01-16 →");
    });

    it("should open previous day note on click", () => {
      (DailyNoteHelpers.extractDailyNoteInfo as jest.Mock).mockReturnValue({
        isDailyNote: true,
        day: "2025-01-15",
      });

      const prevDailyNote = { path: "daily/2025-01-14.md", basename: "2025-01-14" };
      (DailyNoteHelpers.findDailyNoteByDate as jest.Mock).mockImplementation(
        (_vault, _extractor, dateStr) => {
          if (dateStr === "2025-01-14") return prevDailyNote;
          return null;
        }
      );

      renderer.render(containerEl, mockFile);

      const link = containerEl.querySelector(".exocortex-nav-prev a.internal-link") as HTMLElement;
      expect(link).toBeTruthy();

      const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
      jest.spyOn(clickEvent, "preventDefault");
      link.dispatchEvent(clickEvent);

      expect(clickEvent.preventDefault).toHaveBeenCalled();
      expect(mockApp.workspace.openLinkText).toHaveBeenCalledWith(
        "daily/2025-01-14.md",
        "daily/2025-01-15.md",
        false
      );
    });

    it("should open next day note on click", () => {
      (DailyNoteHelpers.extractDailyNoteInfo as jest.Mock).mockReturnValue({
        isDailyNote: true,
        day: "2025-01-15",
      });

      const nextDailyNote = { path: "daily/2025-01-16.md", basename: "2025-01-16" };
      (DailyNoteHelpers.findDailyNoteByDate as jest.Mock).mockImplementation(
        (_vault, _extractor, dateStr) => {
          if (dateStr === "2025-01-16") return nextDailyNote;
          return null;
        }
      );

      renderer.render(containerEl, mockFile);

      const link = containerEl.querySelector(".exocortex-nav-next a.internal-link") as HTMLElement;
      expect(link).toBeTruthy();

      const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
      jest.spyOn(clickEvent, "preventDefault");
      link.dispatchEvent(clickEvent);

      expect(clickEvent.preventDefault).toHaveBeenCalled();
      expect(mockApp.workspace.openLinkText).toHaveBeenCalledWith(
        "daily/2025-01-16.md",
        "daily/2025-01-15.md",
        false
      );
    });

    it("should calculate correct dates across month boundary", () => {
      (DailyNoteHelpers.extractDailyNoteInfo as jest.Mock).mockReturnValue({
        isDailyNote: true,
        day: "2025-02-01",
      });
      (DailyNoteHelpers.findDailyNoteByDate as jest.Mock).mockReturnValue(null);

      renderer.render(containerEl, mockFile);

      // Previous day should be January 31st
      const prevSpan = containerEl.querySelector(".exocortex-nav-prev .exocortex-nav-disabled");
      expect(prevSpan?.textContent).toBe("← 2025-01-31");

      // Next day should be February 2nd
      const nextSpan = containerEl.querySelector(".exocortex-nav-next .exocortex-nav-disabled");
      expect(nextSpan?.textContent).toBe("2025-02-02 →");
    });

    it("should calculate correct dates across year boundary", () => {
      (DailyNoteHelpers.extractDailyNoteInfo as jest.Mock).mockReturnValue({
        isDailyNote: true,
        day: "2025-01-01",
      });
      (DailyNoteHelpers.findDailyNoteByDate as jest.Mock).mockReturnValue(null);

      renderer.render(containerEl, mockFile);

      // Previous day should be December 31st of previous year
      const prevSpan = containerEl.querySelector(".exocortex-nav-prev .exocortex-nav-disabled");
      expect(prevSpan?.textContent).toBe("← 2024-12-31");
    });

    it("should render both navigation links", () => {
      (DailyNoteHelpers.extractDailyNoteInfo as jest.Mock).mockReturnValue({
        isDailyNote: true,
        day: "2025-01-15",
      });

      const prevNote = { path: "daily/2025-01-14.md" };
      const nextNote = { path: "daily/2025-01-16.md" };

      (DailyNoteHelpers.findDailyNoteByDate as jest.Mock).mockImplementation(
        (_vault, _extractor, dateStr) => {
          if (dateStr === "2025-01-14") return prevNote;
          if (dateStr === "2025-01-16") return nextNote;
          return null;
        }
      );

      renderer.render(containerEl, mockFile);

      const navContainer = containerEl.querySelector(".exocortex-daily-navigation");
      const links = navContainer?.querySelectorAll("a.internal-link");
      expect(links?.length).toBe(2);
    });

    it("should call DailyNoteHelpers with correct parameters", () => {
      (DailyNoteHelpers.extractDailyNoteInfo as jest.Mock).mockReturnValue({
        isDailyNote: true,
        day: "2025-01-15",
      });
      (DailyNoteHelpers.findDailyNoteByDate as jest.Mock).mockReturnValue(null);

      renderer.render(containerEl, mockFile);

      expect(DailyNoteHelpers.extractDailyNoteInfo).toHaveBeenCalledWith(
        mockFile,
        mockMetadataExtractor,
        mockLogger
      );

      expect(DailyNoteHelpers.findDailyNoteByDate).toHaveBeenCalledWith(
        mockVaultAdapter,
        mockMetadataExtractor,
        "2025-01-14"
      );

      expect(DailyNoteHelpers.findDailyNoteByDate).toHaveBeenCalledWith(
        mockVaultAdapter,
        mockMetadataExtractor,
        "2025-01-16"
      );
    });
  });
});

// Helper functions to mock Obsidian's DOM API
function createDivMock(this: HTMLElement, options: { cls?: string }): HTMLElement {
  const div = document.createElement("div");
  if (options.cls) {
    div.className = options.cls;
  }
  div.createDiv = createDivMock.bind(div);
  div.createSpan = createSpanMock.bind(div);
  div.createEl = createElMock.bind(div);
  this.appendChild(div);
  return div;
}

function createSpanMock(this: HTMLElement, options: { cls?: string; text?: string }): HTMLElement {
  const span = document.createElement("span");
  if (options.cls) {
    span.className = options.cls;
  }
  if (options.text) {
    span.textContent = options.text;
  }
  span.createEl = createElMock.bind(span);
  span.createSpan = createSpanMock.bind(span);
  this.appendChild(span);
  return span;
}

function createElMock(
  this: HTMLElement,
  tag: string,
  options?: { text?: string; cls?: string; attr?: Record<string, string> }
): HTMLElement {
  const el = document.createElement(tag);
  if (options?.text) {
    el.textContent = options.text;
  }
  if (options?.cls) {
    el.className = options.cls;
  }
  if (options?.attr) {
    Object.entries(options.attr).forEach(([key, value]) => {
      el.setAttribute(key, value);
    });
  }
  el.createEl = createElMock.bind(el);
  el.createSpan = createSpanMock.bind(el);
  this.appendChild(el);
  return el;
}
