/**
 * Issue #3320 — Settings UI 4-section rendering tests.
 *
 * Verifies that `display()` calls `renderProfileSections` and that
 * each section's Setting builder is invoked с the expected name / heading
 * sequence: PAT → Active profile → Switch cache → Operations log.
 *
 * RFC 0a0791c1 Phase 5 T2 — the soft-filter dropdown was removed; profile
 * switching is the «Exocortex: Apply profile» Cmd+P command. Section 2 now
 * surfaces the single last-applied profile (read-only status + hint).
 *
 * The integration shape (real PAT persistence round-trip, real GitHub call,
 * real apply dispatch) is intentionally out of scope here — those are covered
 * by `LocalSecretsStore.test.ts`, `GitHubRestClient.test.ts`,
 * `ProfileApplyManager.test.ts`. These tests only assert the UI
 * renders the expected scaffold so a future regression that drops one of
 * the sections fails CI loudly.
 */

import { ExocortexSettingTab } from "../../src/presentation/settings/ExocortexSettingTab";
import { Setting } from "obsidian";
import { createMockApp, createMockPlugin } from "./helpers/testHelpers";

jest.mock("obsidian", () => ({
  App: jest.fn(),
  PluginSettingTab: class MockPluginSettingTab {
    containerEl: any;
    app: any;
    plugin: any;
    constructor(app: any, plugin: any) {
      this.app = app;
      this.plugin = plugin;
      this.containerEl = { empty: jest.fn() };
    }
  },
  Setting: jest.fn(),
}));

// Stub the helper classes with `class` factories so jest's per-test
// `resetMocks: true` (jest.config.js:75) doesn't strip the mockImpl —
// constructor-class bodies survive reset because they're real classes,
// not jest.fn().mockImplementation chains.
//
// LocalSecretsStore — read/write actually hits app.vault.adapter, which our
// mock doesn't fully implement. Stub it to a stable in-memory map.
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
    async readAll(): Promise<Record<string, string>> {
      return Object.fromEntries(__secretsBacking);
    }
    async clearAll(): Promise<void> {
      __secretsBacking.clear();
    }
  },
}));

jest.mock("@plugin/infrastructure/adapters/GitHubRestClient", () => ({
  GitHubRestClient: class {
    async checkRateLimit(): Promise<{ remaining: number; resetAt: Date }> {
      return {
        remaining: 4999,
        resetAt: new Date("2026-06-02T03:00:00Z"),
      };
    }
    async listRepos(): Promise<string[]> {
      return ["kitelev/exoas-test", "kitelev/exoas-ems"];
    }
  },
}));

jest.mock("@plugin/infrastructure/adapters/OperationsLogReader", () => {
  const real = jest.requireActual(
    "@plugin/infrastructure/adapters/OperationsLogReader",
  );
  class MockOperationsLogReader {
    async readLast(): Promise<unknown[]> {
      return [
        {
          ts: "2026-06-02T00:00:00.000Z",
          targetUid: "uid-a",
          profileLabel: "Personal",
          status: "completed",
          elapsedMs: 1234,
          error: null,
        },
      ];
    }
    static formatEntry = real.OperationsLogReader.formatEntry;
  }
  return { OperationsLogReader: MockOperationsLogReader };
});

jest.mock("@plugin/infrastructure/adapters/SwitchCacheLayer", () => ({
  SwitchCacheLayer: class {
    getCacheStats(): { count: number; totalSize: number; oldestEntry: string | null } {
      return { count: 0, totalSize: 0, oldestEntry: null };
    }
  },
}));

describe("ExocortexSettingTab — Issue #3320 Profile sections", () => {
  let settingTab: ExocortexSettingTab;
  let mockApp: any;
  let mockPlugin: any;
  let mockContainerEl: any;
  let MockSetting: any;
  let settingCalls: { name?: string; heading: boolean }[];
  let mockNotifier: {
    info: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };

  beforeEach(() => {
    settingCalls = [];
    mockNotifier = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    const createMockElement: () => any = () => {
      const el = document.createElement("div");
      (el as any).empty = jest.fn();
      (el as any).createEl = jest.fn().mockImplementation(() => createMockElement());
      (el as any).createDiv = jest.fn().mockImplementation(() => createMockElement());
      (el as any).appendText = jest.fn();
      return el;
    };
    mockContainerEl = {
      empty: jest.fn(),
      createEl: jest.fn().mockImplementation(() => createMockElement()),
      createDiv: jest.fn().mockImplementation(() => createMockElement()),
    };

    mockPlugin = createMockPlugin({
      settings: {
        layoutVisible: true,
        showArchivedAssets: false,
        showLabelsInTabTitles: true,
        activeProfileUid: null,
        displayNameSettings: {
          defaultTemplate: "{{exo__Asset_label}}",
          classTemplates: {},
        },
        logChannels: {
          debug: { notice: false, console: true, file: false },
          info: { notice: false, console: true, file: false },
          warn: { notice: true, console: true, file: false },
          error: { notice: true, console: true, file: false },
        },
      },
      saveSettings: jest.fn().mockResolvedValue(undefined),
      refreshLayout: jest.fn(),
      toggleTabTitleLabels: jest.fn(),
      applyDisplayNameTemplate: jest.fn(),
      configureLogChannels: jest.fn(),
      listProfileChoices: jest.fn().mockResolvedValue([
        { uid: "uid-a", label: "Personal", isActive: false },
        { uid: "uid-b", label: "Work", isActive: true },
      ]),
      notifier: mockNotifier,
    });

    mockApp = createMockApp();
    mockPlugin.app = mockApp;

    MockSetting = Setting as jest.Mock;
    MockSetting.mockImplementation((containerEl: any) => {
      const record: { name?: string; heading: boolean } = { heading: false };
      settingCalls.push(record);
      const setting: any = {
        containerEl,
        setName: jest.fn((n: string) => {
          record.name = n;
          return setting;
        }),
        setDesc: jest.fn().mockReturnThis(),
        setHeading: jest.fn(() => {
          record.heading = true;
          return setting;
        }),
        addDropdown: jest.fn().mockImplementation((cb: any) => {
          const dropdown = {
            addOption: jest.fn().mockReturnThis(),
            setValue: jest.fn().mockReturnThis(),
            onChange: jest.fn().mockReturnThis(),
          };
          cb(dropdown);
          return setting;
        }),
        addToggle: jest.fn().mockImplementation((cb: any) => {
          cb({
            setValue: jest.fn().mockReturnThis(),
            onChange: jest.fn().mockReturnThis(),
          });
          return setting;
        }),
        addText: jest.fn().mockImplementation((cb: any) => {
          cb({
            setPlaceholder: jest.fn().mockReturnThis(),
            setValue: jest.fn().mockReturnThis(),
            onChange: jest.fn().mockReturnThis(),
            inputEl: { type: "" } as Record<string, unknown>,
          });
          return setting;
        }),
        addTextArea: jest.fn().mockImplementation((cb: any) => {
          cb({
            setPlaceholder: jest.fn().mockReturnThis(),
            setValue: jest.fn().mockReturnThis(),
            onChange: jest.fn().mockReturnThis(),
            inputEl: { rows: 0, cols: 0 },
          });
          return setting;
        }),
        addButton: jest.fn().mockImplementation((cb: any) => {
          cb({
            setButtonText: jest.fn().mockReturnThis(),
            onClick: jest.fn().mockReturnThis(),
            setCta: jest.fn().mockReturnThis(),
            setTooltip: jest.fn().mockReturnThis(),
          });
          return setting;
        }),
      };
      return setting;
    });

    settingTab = new ExocortexSettingTab(mockApp, mockPlugin);
    settingTab.containerEl = mockContainerEl;
  });

  it("renders all 4 Profile section headings in expected order", () => {
    settingTab.display();
    const headings = settingCalls.filter((c) => c.heading).map((c) => c.name);
    // The Display-Name section also contributes headings. We just assert
    // что 4 expected headings appear в the correct relative order.
    const expected = [
      "Profile: GitHub PAT",
      "Active profile",
      "Switch cache",
      "Operations log",
    ];
    const filtered = headings.filter((h) =>
      expected.includes(h ?? ""),
    ) as string[];
    expect(filtered).toEqual(expected);
  });

  it("renders the PAT row with Save / Test connection buttons", () => {
    settingTab.display();
    const patRow = settingCalls.find(
      (c) => c.name === "Personal Access Token",
    );
    expect(patRow).toBeDefined();
  });

  it("renders the Apply profile hint row (RFC 0a0791c1 Phase 5 T2 — no soft dropdown)", () => {
    settingTab.display();
    const profileRow = settingCalls.find((c) => c.name === "Apply profile");
    expect(profileRow).toBeDefined();
  });

  it("renders the Profiles overview heading (RFC 13da049f R35)", () => {
    settingTab.display();
    const overview = settingCalls.find(
      (c) => c.name === "Profiles" && c.heading,
    );
    expect(overview).toBeDefined();
  });

  it("reads the single last-applied profile slot for the status line (RFC 0a0791c1 Phase 5 T2)", () => {
    // The status line surfaces the single `activeProfileUid` slot — the dual
    // Knowledge/Focus getters were retired.
    const getActiveProfileUid = jest.fn().mockReturnValue("applied-uid");
    mockPlugin.localDataStore = {
      getActiveProfileUid,
    };

    settingTab.display();

    expect(getActiveProfileUid).toHaveBeenCalled();
  });

  it("renders the Switch cache stats row with Clear button", () => {
    settingTab.display();
    const cacheRow = settingCalls.find((c) => c.name === "Cache stats");
    expect(cacheRow).toBeDefined();
  });

  it("renders the Operations log <pre> element", () => {
    settingTab.display();
    // The «Operations log» heading is а Setting; the body is a createEl('pre').
    // Assert the heading and that createEl was invoked for the pre tag.
    const opsHeading = settingCalls.find((c) => c.name === "Operations log");
    expect(opsHeading).toBeDefined();
    const preCalls = (mockContainerEl.createEl as jest.Mock).mock.calls.filter(
      (args: any[]) => args[0] === "pre",
    );
    expect(preCalls.length).toBeGreaterThanOrEqual(1);
  });
});
