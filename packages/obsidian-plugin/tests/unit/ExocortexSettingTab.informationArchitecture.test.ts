/**
 * RFC 0002 §3.6 — Settings information architecture + strip internal references.
 *
 * Pins the four DoD predicates of §3.6 (resolves P8 flat-list / leaked internal
 * IDs / buried PAT / unlabeled log matrix, plus P3 jargon):
 *
 *   1. The tab is sectioned into «Onboarding & sync» (top) / «Display» /
 *      «Advanced», in that order, with the GitHub PAT in the top section
 *      (no longer buried at the bottom).
 *   2. GREP GATE (M4): no user-facing string rendered by the tab contains
 *      `Vision Lock`, `Security #`, `(D<n>)`, or `Issue #<n>`.
 *   3. The log-channel matrix columns are labeled (Notice / Console / File),
 *      and each toggle carries an accessible name.
 *   4. The free-text path editors (Lazy bootstrap folders / Excluded folders)
 *      render after the «Advanced» heading, behind a "you can break indexing"
 *      caution.
 *
 * Strategy: a render-capture harness records every user-facing string the tab
 * emits (Setting names/descs/headings, button labels, placeholders) plus the
 * real-DOM text built via createDiv/createEl/appendText, so the grep gate runs
 * against the actual rendered surface — not the source file (comments citing
 * issue numbers for traceability are intentionally out of scope, per §7).
 */

import { ExocortexSettingTab } from "../../src/presentation/settings/ExocortexSettingTab";
import { Setting } from "obsidian";
import { createMockApp, createMockPlugin } from "./helpers/testHelpers";

// ─── Obsidian DOM helpers on HTMLElement (jsdom lacks them) ───
function installObsidianDomHelpers(): void {
  const proto = HTMLElement.prototype as any;
  const applyOptions = (el: HTMLElement, options?: any): void => {
    if (options?.text) el.textContent = options.text;
    if (options?.cls) el.className = options.cls;
    if (options?.href) (el as HTMLAnchorElement).href = options.href;
    if (options?.attr) {
      for (const [key, value] of Object.entries(options.attr)) {
        el.setAttribute(key, String(value));
      }
    }
  };
  if (!proto.createEl) {
    proto.createEl = function (tag: string, options?: any) {
      const el = document.createElement(tag);
      applyOptions(el, options);
      this.appendChild(el);
      return el;
    };
  }
  if (!proto.createDiv) {
    proto.createDiv = function (options?: any) {
      const el = document.createElement("div");
      applyOptions(el, options);
      this.appendChild(el);
      return el;
    };
  }
  if (!proto.createSpan) {
    proto.createSpan = function (options?: any) {
      const el = document.createElement("span");
      applyOptions(el, options);
      this.appendChild(el);
      return el;
    };
  }
  if (!proto.appendText) {
    proto.appendText = function (text: string) {
      this.appendChild(document.createTextNode(text));
    };
  }
  if (!proto.empty) {
    proto.empty = function () {
      while (this.firstChild) this.removeChild(this.firstChild);
    };
  }
  if (!proto.addClass) {
    proto.addClass = function (cls: string) {
      this.classList.add(cls);
    };
  }
  if (!proto.toggleClass) {
    proto.toggleClass = function (cls: string, on: boolean) {
      this.classList.toggle(cls, on);
    };
  }
  if (!proto.setText) {
    proto.setText = function (t: string) {
      this.textContent = t;
    };
  }
}
installObsidianDomHelpers();

// Shared capture state (jest hoists jest.mock above imports; the factory may
// only reference out-of-scope identifiers prefixed with `mock`).
interface MockSettingRecord {
  name?: string;
  heading: boolean;
}
const mockCapture: {
  settings: MockSettingRecord[];
  userFacing: string[];
  toggleEls: HTMLElement[];
  reset: () => void;
} = {
  settings: [],
  userFacing: [],
  toggleEls: [],
  reset() {
    this.settings = [];
    this.userFacing = [];
    this.toggleEls = [];
  },
};

jest.mock("obsidian", () => {
  class MockPluginSettingTab {
    containerEl: any;
    app: any;
    plugin: any;
    constructor(app: any, plugin: any) {
      this.app = app;
      this.plugin = plugin;
      this.containerEl = document.createElement("div");
    }
  }

  class MockSetting {
    private record: { name?: string; heading: boolean };
    controlEl: HTMLElement;
    constructor(_containerEl: HTMLElement) {
      this.record = { heading: false };
      mockCapture.settings.push(this.record);
      this.controlEl = document.createElement("div");
    }
    setName(name: string): this {
      this.record.name = name;
      mockCapture.userFacing.push(name);
      return this;
    }
    setDesc(desc: unknown): this {
      if (typeof desc === "string") mockCapture.userFacing.push(desc);
      return this;
    }
    setHeading(): this {
      this.record.heading = true;
      return this;
    }
    addToggle(cb: (toggle: any) => void): this {
      const toggleEl = document.createElement("input");
      mockCapture.toggleEls.push(toggleEl);
      const toggle: any = {
        setValue: jest.fn(() => toggle),
        onChange: jest.fn(() => toggle),
        toggleEl,
      };
      cb(toggle);
      return this;
    }
    addText(cb: (text: any) => void): this {
      const text: any = {
        setPlaceholder: jest.fn((p: string) => {
          mockCapture.userFacing.push(p);
          return text;
        }),
        setValue: jest.fn(() => text),
        onChange: jest.fn(() => text),
        inputEl: { type: "" } as Record<string, unknown>,
      };
      cb(text);
      return this;
    }
    addTextArea(cb: (text: any) => void): this {
      const textArea: any = {
        setPlaceholder: jest.fn((p: string) => {
          mockCapture.userFacing.push(p);
          return textArea;
        }),
        setValue: jest.fn(() => textArea),
        onChange: jest.fn(() => textArea),
        inputEl: { rows: 0, cols: 0 } as Record<string, unknown>,
      };
      cb(textArea);
      return this;
    }
    addButton(cb: (button: any) => void): this {
      const button: any = {
        setButtonText: jest.fn((t: string) => {
          mockCapture.userFacing.push(t);
          return button;
        }),
        setTooltip: jest.fn((t: string) => {
          mockCapture.userFacing.push(t);
          return button;
        }),
        onClick: jest.fn(() => button),
        setCta: jest.fn(() => button),
      };
      cb(button);
      return this;
    }
    addDropdown(cb: (d: any) => void): this {
      cb({
        addOption: jest.fn().mockReturnThis(),
        setValue: jest.fn().mockReturnThis(),
        onChange: jest.fn().mockReturnThis(),
      });
      return this;
    }
  }

  return {
    App: jest.fn(),
    PluginSettingTab: MockPluginSettingTab,
    Setting: MockSetting,
  };
});

// Profile-section dependencies (mirror ExocortexSettingTab.focusProfile.test).
const __secretsBacking = new Map<string, string>();
jest.mock("@plugin/infrastructure/adapters/LocalSecretsStore", () => ({
  LocalSecretsStore: class {
    async getSecret(key: string): Promise<string | null> {
      return __secretsBacking.get(key) ?? null;
    }
    async setSecret(key: string, value: string | null): Promise<void> {
      if (value === null || value === "") __secretsBacking.delete(key);
      else __secretsBacking.set(key, value);
    }
  },
}));
jest.mock("@plugin/infrastructure/adapters/GitHubRestClient", () => ({
  GitHubRestClient: class {
    static validateRepoURL(): void {}
    async checkRateLimit(): Promise<{ remaining: number; resetAt: Date }> {
      return { remaining: 4999, resetAt: new Date("2026-06-02T03:00:00Z") };
    }
    async listRepos(): Promise<string[]> {
      return ["kitelev/exoas-test"];
    }
  },
}));
jest.mock("@plugin/infrastructure/adapters/OperationsLogReader", () => {
  const real = jest.requireActual(
    "@plugin/infrastructure/adapters/OperationsLogReader",
  );
  class MockOperationsLogReader {
    async readLast(): Promise<unknown[]> {
      return [];
    }
    static formatEntry = real.OperationsLogReader.formatEntry;
  }
  return { OperationsLogReader: MockOperationsLogReader };
});
jest.mock("@plugin/infrastructure/adapters/SwitchCacheLayer", () => ({
  SwitchCacheLayer: class {
    getCacheStats(): {
      count: number;
      totalSize: number;
      oldestEntry: string | null;
    } {
      return { count: 0, totalSize: 0, oldestEntry: null };
    }
  },
}));

const INTERNAL_ID_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "Vision Lock", re: /Vision Lock/ },
  { label: "Security #", re: /Security #/ },
  { label: "(D<n>)", re: /\(D[0-9]+\)/ },
  { label: "Issue #<n>", re: /Issue #[0-9]+/ },
];

describe("ExocortexSettingTab — RFC 0002 §3.6 information architecture", () => {
  let settingTab: ExocortexSettingTab;
  let mockPlugin: any;

  /** All user-facing text rendered by the tab (Setting strings + DOM text). */
  function renderedText(): string {
    return (
      mockCapture.userFacing.join("\n") +
      "\n" +
      (settingTab.containerEl.textContent ?? "")
    );
  }
  function headingNames(): string[] {
    return mockCapture.settings
      .filter((s) => s.heading)
      .map((s) => s.name ?? "");
  }
  function settingIndex(name: string): number {
    return mockCapture.settings.findIndex((s) => s.name === name);
  }

  beforeEach(() => {
    mockCapture.reset();
    __secretsBacking.clear();
    const mockApp = createMockApp();
    mockPlugin = createMockPlugin({
      app: mockApp,
      settings: {
        layoutVisible: true,
        showArchivedAssets: false,
        autoAdjustPlannedEndTimestamp: true,
        showLabelsInTabTitles: true,
        showLabelsInProperties: true,
        enablePropertiesLabelPatch: true,
        enableExoLayoutRenderer: true,
        showIconsInFileExplorer: false,
        autoReadingModeForExocortexAssets: true,
        showLabelsInBody: true,
        showLabelsInGraphView: true,
        showLabelsInLivePreview: true,
        enableSparqlAutoExecute: false,
        settingsHomoiconizationEnabled: false,
        enableShaclValidation: false,
        lazyBootstrapFolders: ["assetspaces/exo/"],
        excludedFolders: ["09 Templates/"],
        exosyncQuarantineRepoUrl: "",
        exosyncStepNotices: false,
        verboseSyncLogging: false,
        displayNameSettings: {
          defaultTemplate: "{{exo__Asset_label}}",
          classTemplates: {},
        },
        logChannels: {
          debug: { notice: false, console: true, file: false },
          info: { notice: false, console: true, file: false },
          warn: { notice: true, console: true, file: true },
          error: { notice: true, console: true, file: true },
        },
      },
      saveSettings: jest.fn().mockResolvedValue(undefined),
      refreshLayout: jest.fn(),
      toggleTabTitleLabels: jest.fn(),
      togglePropertiesLabels: jest.fn(),
      togglePropertiesLabelPatch: jest.fn(),
      toggleFileExplorerIcons: jest.fn(),
      toggleBodyLabels: jest.fn(),
      toggleGraphViewLabels: jest.fn(),
      applyDisplayNameTemplate: jest.fn(),
      configureLogChannels: jest.fn(),
      listProfileChoices: jest.fn().mockResolvedValue([]),
      localDataStore: { getActiveProfileUid: jest.fn().mockReturnValue(null) },
      notifier: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });

    settingTab = new ExocortexSettingTab(mockApp, mockPlugin);
    settingTab.containerEl = document.createElement("div");
    settingTab.display();
  });

  it("renders the three top-level sections in order: Onboarding & sync → Display → Advanced", () => {
    const headings = headingNames();
    const onboarding = headings.indexOf("Onboarding & sync");
    const display = headings.indexOf("Display");
    const advanced = headings.indexOf("Advanced");

    expect(onboarding).toBeGreaterThanOrEqual(0);
    expect(display).toBeGreaterThan(onboarding);
    expect(advanced).toBeGreaterThan(display);
  });

  it("renders «Onboarding & sync» as the very first heading (no longer last)", () => {
    expect(headingNames()[0]).toBe("Onboarding & sync");
  });

  it("places the GitHub PAT field in the top section, before «Display» (PAT not buried)", () => {
    const patIdx = settingIndex("Personal Access Token");
    const displayIdx = settingIndex("Display");
    expect(patIdx).toBeGreaterThanOrEqual(0);
    expect(displayIdx).toBeGreaterThan(patIdx);
  });

  describe("grep gate (M4) — no internal IDs in user-facing strings", () => {
    for (const { label, re } of INTERNAL_ID_PATTERNS) {
      it(`no rendered string contains ${label}`, () => {
        const text = renderedText();
        const offending = text
          .split("\n")
          .filter((line) => re.test(line));
        expect(offending).toEqual([]);
      });
    }
  });

  it("retains the user-facing copy after stripping the internal IDs", () => {
    const text = renderedText();
    // The SPARQL desc kept its content, lost "Issue #2992".
    expect(text).toContain("without side effects");
    // The PAT desc kept the privacy explanation, lost "Vision Lock #1, Security #1".
    expect(text).toContain("Obsidian Sync never replicates it over the network");
  });

  describe("log-channel matrix columns labeled", () => {
    it("renders Notice / Console / File column header labels", () => {
      const text = settingTab.containerEl.textContent ?? "";
      expect(text).toContain("Notice");
      expect(text).toContain("Console");
      expect(text).toContain("File");
    });

    it("gives every matrix toggle an accessible name (4 levels × 3 channels)", () => {
      const labeled = mockCapture.toggleEls.filter((el) =>
        (el.getAttribute("aria-label") ?? "").includes("route to"),
      );
      // 4 log levels × 3 channels.
      expect(labeled.length).toBe(12);
      const labels = labeled.map((el) => el.getAttribute("aria-label"));
      expect(labels).toContain("Debug: route to Notice channel");
      expect(labels).toContain("Error: route to File channel");
    });
  });

  describe("free-text path editors gated behind Advanced + caution", () => {
    it("renders both path editors after the «Advanced» heading", () => {
      const advancedIdx = settingIndex("Advanced");
      const lazyIdx = settingIndex("Lazy bootstrap folders");
      const excludedIdx = settingIndex("Excluded folders");
      expect(advancedIdx).toBeGreaterThanOrEqual(0);
      expect(lazyIdx).toBeGreaterThan(advancedIdx);
      expect(excludedIdx).toBeGreaterThan(advancedIdx);
    });

    it("shows a caution warning the user a wrong path can break indexing", () => {
      const text = renderedText();
      expect(text).toContain("Caution");
      expect(text).toContain("break indexing");
    });
  });
});
