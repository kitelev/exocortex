import { ExocortexSettingTab } from "../../src/presentation/settings/ExocortexSettingTab";
import { Setting } from "obsidian";
import { createMockApp, createMockPlugin } from "./helpers/testHelpers";

// RFC 0002 §3.6 — the tab is now sectioned (Onboarding & sync / Display /
// Advanced) and the toggles are no longer in a fixed positional order, so
// these tests look up a Setting by NAME (via the capture harness below) rather
// than by array index. The structural section assertions live in
// ExocortexSettingTab.informationArchitecture.test.ts.

interface CapturedToggle {
  setValueArg?: boolean;
  onChangeCb?: (value: boolean) => void | Promise<void>;
}
interface CapturedSetting {
  name?: string;
  heading: boolean;
  toggles: CapturedToggle[];
}

const capture: { settings: CapturedSetting[] } = { settings: [] };

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

describe("ExocortexSettingTab", () => {
  let settingTab: ExocortexSettingTab;
  let mockApp: any;
  let mockPlugin: any;
  let mockContainerEl: any;
  let MockSetting: any;

  const findSetting = (name: string): CapturedSetting | undefined =>
    capture.settings.find((s) => s.name === name);

  beforeEach(() => {
    capture.settings = [];

    // A recursive mock element that supports the Obsidian DOM helpers the
    // settings tab uses (createEl/createDiv/createSpan/appendText/empty).
    const createMockElement: () => any = () => {
      const el = document.createElement("div");
      (el as any).empty = jest.fn();
      (el as any).createEl = jest
        .fn()
        .mockImplementation(() => createMockElement());
      (el as any).createDiv = jest
        .fn()
        .mockImplementation(() => createMockElement());
      (el as any).createSpan = jest
        .fn()
        .mockImplementation(() => createMockElement());
      (el as any).appendText = jest.fn();
      return el;
    };
    mockContainerEl = {
      empty: jest.fn(),
      createEl: jest.fn().mockImplementation(() => createMockElement()),
      createDiv: jest.fn().mockImplementation(() => createMockElement()),
      createSpan: jest.fn().mockImplementation(() => createMockElement()),
      appendText: jest.fn(),
    };

    mockPlugin = createMockPlugin({
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
        lazyBootstrapFolders: [],
        excludedFolders: [],
        exosyncQuarantineRepoUrl: "",
        exosyncStepNotices: false,
        verboseSyncLogging: false,
        displayNameTemplate: "{{exo__Asset_label}}",
        displayNameSettings: {
          defaultTemplate: "{{exo__Asset_label}}",
          classTemplates: {
            "ems__Task": "{{exo__Asset_label}}",
            "ems__TaskPrototype": "{{exo__Asset_label}} (TaskPrototype)",
          },
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

    mockApp = createMockApp();
    mockPlugin.app = mockApp;

    MockSetting = Setting as jest.Mock;
    MockSetting.mockImplementation((containerEl: any) => {
      const record: CapturedSetting = { heading: false, toggles: [] };
      capture.settings.push(record);
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
          cb({
            addOption: jest.fn().mockReturnThis(),
            setValue: jest.fn().mockReturnThis(),
            onChange: jest.fn().mockReturnThis(),
          });
          return setting;
        }),
        addToggle: jest.fn().mockImplementation((cb: any) => {
          const captured: CapturedToggle = {};
          const toggle: any = {
            setValue: jest.fn((v: boolean) => {
              captured.setValueArg = v;
              return toggle;
            }),
            onChange: jest.fn((fn: any) => {
              captured.onChangeCb = fn;
              return toggle;
            }),
            toggleEl: document.createElement("input"),
          };
          record.toggles.push(captured);
          cb(toggle);
          return setting;
        }),
        addText: jest.fn().mockImplementation((cb: any) => {
          const text: any = {
            setPlaceholder: jest.fn(() => text),
            setValue: jest.fn(() => text),
            onChange: jest.fn(() => text),
            inputEl: { type: "" } as Record<string, unknown>,
          };
          cb(text);
          return setting;
        }),
        addTextArea: jest.fn().mockImplementation((cb: any) => {
          const textarea: any = {
            setPlaceholder: jest.fn(() => textarea),
            setValue: jest.fn(() => textarea),
            onChange: jest.fn(() => textarea),
            inputEl: { rows: 0, cols: 0 } as Record<string, unknown>,
          };
          cb(textarea);
          return setting;
        }),
        addButton: jest.fn().mockImplementation((cb: any) => {
          const button: any = {
            setButtonText: jest.fn(() => button),
            onClick: jest.fn(() => button),
            setCta: jest.fn(() => button),
            setTooltip: jest.fn(() => button),
          };
          cb(button);
          return setting;
        }),
      };
      return setting;
    });

    settingTab = new ExocortexSettingTab(mockApp, mockPlugin);
    settingTab.containerEl = mockContainerEl;
  });

  describe("display", () => {
    it("should render all settings", () => {
      settingTab.display();

      expect(mockContainerEl.empty).toHaveBeenCalled();
      // RFC 0002 §3.6 — count = 45 (pre-§3.6) + 3 section headings
      // («Onboarding & sync» / «Display» / «Advanced») = 48.
      expect(MockSetting).toHaveBeenCalledTimes(48);
    });

    it("renders the settings-homoiconization toggle", () => {
      settingTab.display();
      expect(findSetting("Settings homoiconization")).toBeDefined();
    });

    it("renders the layout-visibility toggle wired to layoutVisible", async () => {
      settingTab.display();

      const layout = findSetting("Show layout");
      expect(layout).toBeDefined();
      const toggle = layout!.toggles[0];
      expect(toggle.setValueArg).toBe(true);

      await toggle.onChangeCb?.(false);

      expect(mockPlugin.settings.layoutVisible).toBe(false);
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
      expect(mockPlugin.refreshLayout).toHaveBeenCalled();
    });

    it("renders the archived-assets toggle wired to showArchivedAssets", async () => {
      settingTab.display();

      const archived = findSetting("Show archived assets");
      expect(archived).toBeDefined();
      const toggle = archived!.toggles[0];
      expect(toggle.setValueArg).toBe(false);

      await toggle.onChangeCb?.(true);

      expect(mockPlugin.settings.showArchivedAssets).toBe(true);
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
      expect(mockPlugin.refreshLayout).toHaveBeenCalled();
    });
  });
});
