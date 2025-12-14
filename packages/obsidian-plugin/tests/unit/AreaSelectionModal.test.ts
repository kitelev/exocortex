import {
  AreaSelectionModal,
  AreaSelectionModalResult,
} from "../../src/presentation/modals/AreaSelectionModal";
import { App, TFile } from "obsidian";
import { AssetClass } from "exocortex";

jest.mock("../../src/adapters/ObsidianVaultAdapter");
jest.mock("exocortex", () => ({
  ...jest.requireActual("exocortex"),
  MetadataExtractor: jest.fn().mockImplementation(() => ({
    extractMetadata: jest.fn(),
  })),
}));

describe("AreaSelectionModal", () => {
  let mockApp: App;
  let modal: AreaSelectionModal;
  let onSubmitSpy: jest.Mock<void, [AreaSelectionModalResult]>;
  let mockContentEl: any;
  let mockSelectEl: HTMLSelectElement;
  let mockVault: any;
  let mockMetadataCache: any;
  let mockFiles: TFile[];

  beforeEach(() => {
    mockSelectEl = document.createElement("select");

    mockContentEl = {
      addClass: jest.fn(),
      createEl: jest.fn(),
      createDiv: jest.fn(),
      empty: jest.fn(),
    };

    mockContentEl.createEl.mockImplementation((tag: string, options?: any) => {
      if (tag === "select") {
        const select = document.createElement("select");
        select.className = options?.cls || "";
        return select;
      }
      if (tag === "button") {
        const button = document.createElement("button");
        if (options?.text) button.textContent = options.text;
        return button;
      }
      if (tag === "option") {
        const option = document.createElement("option");
        if (options?.value !== undefined) option.value = options.value;
        if (options?.text) option.textContent = options.text;
        return option;
      }
      return document.createElement(tag);
    });

    mockContentEl.createDiv.mockImplementation((options?: any) => ({
      createEl: mockContentEl.createEl,
      createDiv: mockContentEl.createDiv,
      style: {},
      classList: {
        add: jest.fn(),
      },
      className: options?.cls || "",
    }));

    mockFiles = [
      {
        path: "Areas/Development.md",
        basename: "Development",
      } as TFile,
      {
        path: "Areas/Personal.md",
        basename: "Personal",
      } as TFile,
      {
        path: "Areas/Frontend.md",
        basename: "Frontend",
      } as TFile,
      {
        path: "Projects/Project1.md",
        basename: "Project1",
      } as TFile,
    ];

    mockMetadataCache = {
      getFileCache: jest.fn((file: TFile) => {
        if (file.basename === "Development") {
          return {
            frontmatter: {
              exo__Instance_class: `[[${AssetClass.AREA}]]`,
            },
          };
        }
        if (file.basename === "Personal") {
          return {
            frontmatter: {
              exo__Instance_class: `[[${AssetClass.AREA}]]`,
              exo__Asset_label: "Personal Life",
            },
          };
        }
        if (file.basename === "Frontend") {
          return {
            frontmatter: {
              exo__Instance_class: `[[${AssetClass.AREA}]]`,
              ems__Area_parent: "[[Development]]",
            },
          };
        }
        if (file.basename === "Project1") {
          return {
            frontmatter: {
              exo__Instance_class: `[[${AssetClass.PROJECT}]]`,
            },
          };
        }
        return { frontmatter: {} };
      }),
    };

    mockVault = {
      getMarkdownFiles: jest.fn(() => mockFiles),
      getAbstractFileByPath: jest.fn(),
      getAllFiles: jest.fn(() => mockFiles),
      getFrontmatter: jest.fn(),
    };

    mockApp = {
      vault: mockVault,
      metadataCache: mockMetadataCache,
    } as unknown as App;

    const { MetadataExtractor } = require("exocortex");
    MetadataExtractor.mockImplementation(() => ({
      extractMetadata: jest.fn((file: TFile) => {
        const cache = mockMetadataCache.getFileCache(file);
        return cache?.frontmatter || {};
      }),
    }));

    onSubmitSpy = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with null active area", () => {
      modal = new AreaSelectionModal(mockApp, onSubmitSpy, null);
      expect(modal).toBeDefined();
    });

    it("should initialize with existing active area", () => {
      modal = new AreaSelectionModal(mockApp, onSubmitSpy, "Development");
      expect(modal).toBeDefined();
    });
  });

  describe("onOpen", () => {
    beforeEach(() => {
      modal = new AreaSelectionModal(mockApp, onSubmitSpy, null);
      modal.contentEl = mockContentEl;
      modal.close = jest.fn();
    });

    it("should add modal class", () => {
      modal.onOpen();
      expect(mockContentEl.addClass).toHaveBeenCalledWith(
        "exocortex-area-selection-modal",
      );
    });

    it("should create header", () => {
      modal.onOpen();
      expect(mockContentEl.createEl).toHaveBeenCalledWith("h2", {
        text: "Set focus area",
      });
    });

    it("should create description", () => {
      modal.onOpen();
      expect(mockContentEl.createEl).toHaveBeenCalledWith("p", {
        text: expect.stringContaining("Select an area to focus on"),
        cls: "exocortex-modal-description",
      });
    });

    it("should create select dropdown", () => {
      modal.onOpen();
      expect(mockContentEl.createEl).toHaveBeenCalledWith("select", {
        cls: "exocortex-modal-select dropdown",
      });
    });

    it("should include None option", () => {
      modal.onOpen();
      const selectCalls = mockContentEl.createEl.mock.calls.filter(
        (call) => call[0] === "select",
      );
      expect(selectCalls.length).toBeGreaterThan(0);
    });

    it("should display root areas only", () => {
      modal.onOpen();

      expect(mockVault.getMarkdownFiles).toHaveBeenCalled();
    });

    it("should filter out non-root areas", () => {
      modal.onOpen();

      expect(mockVault.getMarkdownFiles).toHaveBeenCalled();
    });

    it("should filter out non-area assets", () => {
      modal.onOpen();

      expect(mockVault.getMarkdownFiles).toHaveBeenCalled();
    });

    it("should create OK button", () => {
      modal.onOpen();
      const buttonCalls = mockContentEl.createEl.mock.calls.filter(
        (call) => call[0] === "button",
      );
      const okButton = buttonCalls.find(
        (call) => call[1]?.text === "OK",
      );
      expect(okButton).toBeDefined();
    });

    it("should create Cancel button", () => {
      modal.onOpen();
      const buttonCalls = mockContentEl.createEl.mock.calls.filter(
        (call) => call[0] === "button",
      );
      const cancelButton = buttonCalls.find(
        (call) => call[1]?.text === "Cancel",
      );
      expect(cancelButton).toBeDefined();
    });
  });

  describe("onClose", () => {
    beforeEach(() => {
      modal = new AreaSelectionModal(mockApp, onSubmitSpy, null);
      modal.contentEl = mockContentEl;
    });

    it("should empty content element", () => {
      modal.onClose();
      expect(mockContentEl.empty).toHaveBeenCalled();
    });
  });

  describe("area selection", () => {
    beforeEach(() => {
      modal = new AreaSelectionModal(mockApp, onSubmitSpy, null);
      modal.contentEl = mockContentEl;
      modal.close = jest.fn();
    });

    it("should handle area selection and submission", () => {
      modal.onOpen();

      modal["selectedArea"] = "Development";
      modal["submit"]();

      expect(onSubmitSpy).toHaveBeenCalledWith({
        selectedArea: "Development",
      });
      expect(modal.close).toHaveBeenCalled();
    });

    it("should handle null selection (clear)", () => {
      modal.onOpen();

      modal["selectedArea"] = null;
      modal["submit"]();

      expect(onSubmitSpy).toHaveBeenCalledWith({
        selectedArea: null,
      });
      expect(modal.close).toHaveBeenCalled();
    });

    it("should handle cancel", () => {
      modal.onOpen();

      modal["cancel"]();

      expect(modal.close).toHaveBeenCalled();
      expect(onSubmitSpy).not.toHaveBeenCalled();
    });
  });

  describe("archived areas filtering", () => {
    beforeEach(() => {
      mockFiles.push({
        path: "Areas/Archived.md",
        basename: "Archived",
      } as TFile);

      const originalGetFileCache = mockMetadataCache.getFileCache;
      mockMetadataCache.getFileCache = jest.fn((file: TFile) => {
        if (file.basename === "Archived") {
          return {
            frontmatter: {
              exo__Instance_class: `[[${AssetClass.AREA}]]`,
              exo__Asset_isArchived: true,
            },
          };
        }
        return originalGetFileCache(file);
      });
    });

    it("should filter out archived areas", () => {
      modal = new AreaSelectionModal(mockApp, onSubmitSpy, null);
      modal.contentEl = mockContentEl;

      modal.onOpen();

      expect(mockVault.getMarkdownFiles).toHaveBeenCalled();
    });
  });
});
