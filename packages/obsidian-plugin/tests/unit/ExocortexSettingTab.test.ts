import { ExocortexSettingTab } from "../../src/presentation/settings/ExocortexSettingTab";
import { Setting } from "obsidian";
import { createMockApp, createMockPlugin } from "./helpers/testHelpers";

// Two-step mock pattern for constructor functions
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

  beforeEach(() => {
    // Create a mock element that has Obsidian's methods (recursive)
    const createMockElement: () => any = () => {
      const el = document.createElement("div");
      // Add Obsidian-specific methods that return mock elements
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
      applyDisplayNameTemplate: jest.fn(),
      configureLogChannels: jest.fn(),
    });

    mockApp = createMockApp();

    // Setup Setting mock implementation
    MockSetting = (Setting as jest.Mock);
    MockSetting.mockImplementation((containerEl: any) => {
      const setting = {
        containerEl,
        setName: jest.fn().mockReturnThis(),
        setDesc: jest.fn().mockReturnThis(),
        setHeading: jest.fn().mockReturnThis(),
        addDropdown: jest.fn().mockImplementation((callback) => {
          const dropdown = {
            addOption: jest.fn().mockReturnThis(),
            setValue: jest.fn().mockReturnThis(),
            onChange: jest.fn().mockReturnThis(),
          };
          callback(dropdown);
          return setting;
        }),
        addToggle: jest.fn().mockImplementation((callback) => {
          const toggle = {
            setValue: jest.fn().mockReturnThis(),
            onChange: jest.fn().mockReturnThis(),
          };
          callback(toggle);
          return setting;
        }),
        addText: jest.fn().mockImplementation((callback) => {
          const text = {
            setPlaceholder: jest.fn().mockReturnThis(),
            setValue: jest.fn().mockReturnThis(),
            onChange: jest.fn().mockReturnThis(),
            // Issue #3320 — PAT field sets inputEl.type = "password".
            // Mock must expose an inputEl object с writable properties.
            inputEl: { type: "" } as Record<string, unknown>,
          };
          callback(text);
          return setting;
        }),
        addTextArea: jest.fn().mockImplementation((callback) => {
          const textArea = {
            setPlaceholder: jest.fn().mockReturnThis(),
            setValue: jest.fn().mockReturnThis(),
            onChange: jest.fn().mockReturnThis(),
            // `inputEl` is mutated by the production code (rows/cols).
            // A plain object is enough — production code only sets properties.
            inputEl: {} as Record<string, unknown>,
          };
          callback(textArea);
          return setting;
        }),
        addButton: jest.fn().mockImplementation((callback) => {
          const button = {
            setButtonText: jest.fn().mockReturnThis(),
            onClick: jest.fn().mockReturnThis(),
            setCta: jest.fn().mockReturnThis(),
          };
          callback(button);
          return setting;
        }),
        addTextArea: jest.fn().mockImplementation((callback) => {
          const textarea = {
            setPlaceholder: jest.fn().mockReturnThis(),
            setValue: jest.fn().mockReturnThis(),
            onChange: jest.fn().mockReturnThis(),
            inputEl: { rows: 0, cols: 0 },
          };
          callback(textarea);
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
      // 9 toggle settings + 1 autoReadingMode toggle + 1 enableExoLayoutRenderer toggle + 1 showIconsInFileExplorer toggle + 1 enableSparqlAutoExecute toggle (#2992) + 1 lazyBootstrapFolders TextArea (RFC c7da0bca Phase 5) + 1 enableShaclValidation toggle (P1.12) + 1 enablePropertiesLabelPatch toggle (RFC-030) + 3 headings + 1 default template + 6 per-class templates + 1 reset button + 4 log level rows = 30
      // RFC c7da0bca Phase 3c-3 — deleted `exocmdBindingsCacheEnabledOnMobile` toggle (-1) once its indexer was deleted in 3c-2.
      // RFC c7da0bca Phase 5 — added `lazyBootstrapFolders` TextArea (+1).
      // Log channels section: 1 heading + 4 log level rows = 5
      // Excluded folders section (#3278): 1 heading + 1 textarea row = +2 → 32
      // Issue #3320 — Profile sections: 4 section headings + PAT row + Switch profile row + Cache stats row + (Operations log has no Setting row, body уходит в createDiv/createEl) = +7 → 39
      // RFC 13da049f R35 — added "Profiles" overview heading (+1) → 40
      expect(MockSetting).toHaveBeenCalledTimes(40);
    });

    it("should render layout visibility toggle as first setting", () => {
      settingTab.display();

      const firstSetting = (MockSetting as jest.Mock).mock.results[0].value;
      expect(firstSetting.setName).toHaveBeenCalledWith("Show layout");
      expect(firstSetting.setDesc).toHaveBeenCalledWith(
        "Display the automatic layout below metadata in reading mode"
      );
    });

    it("should handle layout visibility toggle change", async () => {
      let toggleCallbacks: any[] = [];
      MockSetting.mockImplementation((containerEl: any) => {
        const setting = {
          containerEl,
          setName: jest.fn().mockReturnThis(),
          setDesc: jest.fn().mockReturnThis(),
          setHeading: jest.fn().mockReturnThis(),
          addDropdown: jest.fn().mockReturnThis(),
          addToggle: jest.fn().mockImplementation((callback) => {
            const toggle = {
              setValue: jest.fn().mockReturnThis(),
              onChange: jest.fn().mockReturnThis(),
            };
            toggleCallbacks.push({ toggle, callback, onChange: null });
            toggle.onChange.mockImplementation((cb: any) => {
              toggleCallbacks[toggleCallbacks.length - 1].onChange = cb;
              return toggle;
            });
            callback(toggle);
            return setting;
          }),
          addText: jest.fn().mockImplementation((callback) => {
            const text = {
              setPlaceholder: jest.fn().mockReturnThis(),
              setValue: jest.fn().mockReturnThis(),
              onChange: jest.fn().mockReturnThis(),
              // Issue #3320 — PAT field sets inputEl.type = "password"
              inputEl: { type: "" } as Record<string, unknown>,
            };
            callback(text);
            return setting;
          }),
          addTextArea: jest.fn().mockImplementation((callback) => {
            const textArea = {
              setPlaceholder: jest.fn().mockReturnThis(),
              setValue: jest.fn().mockReturnThis(),
              onChange: jest.fn().mockReturnThis(),
              inputEl: {} as Record<string, unknown>,
            };
            callback(textArea);
            return setting;
          }),
          addButton: jest.fn().mockImplementation((callback) => {
            const button = {
              setButtonText: jest.fn().mockReturnThis(),
              onClick: jest.fn().mockReturnThis(),
              setCta: jest.fn().mockReturnThis(),
            };
            callback(button);
            return setting;
          }),
          addTextArea: jest.fn().mockImplementation((callback) => {
            const textarea = {
              setPlaceholder: jest.fn().mockReturnThis(),
              setValue: jest.fn().mockReturnThis(),
              onChange: jest.fn().mockReturnThis(),
              inputEl: { rows: 0, cols: 0 },
            };
            callback(textarea);
            return setting;
          }),
        };
        return setting;
      });

      settingTab.display();

      // First setting's toggle (layout visibility)
      const layoutToggle = toggleCallbacks[0];
      expect(layoutToggle.toggle.setValue).toHaveBeenCalledWith(true);

      // Trigger onChange
      if (layoutToggle.onChange) {
        await layoutToggle.onChange(false);
      }

      expect(mockPlugin.settings.layoutVisible).toBe(false);
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
      expect(mockPlugin.refreshLayout).toHaveBeenCalled();
    });

    it("should render archived assets toggle", () => {
      settingTab.display();

      const secondSetting = (MockSetting as jest.Mock).mock.results[1].value;
      expect(secondSetting.setName).toHaveBeenCalledWith("Show archived assets");
      expect(secondSetting.setDesc).toHaveBeenCalledWith(
        "Display archived assets in relations table with visual distinction"
      );
    });

    it("should handle archived assets toggle change", async () => {
      let toggleCallbacks: any[] = [];
      MockSetting.mockImplementation((containerEl: any) => {
        const setting = {
          containerEl,
          setName: jest.fn().mockReturnThis(),
          setDesc: jest.fn().mockReturnThis(),
          setHeading: jest.fn().mockReturnThis(),
          addDropdown: jest.fn().mockReturnThis(),
          addToggle: jest.fn().mockImplementation((callback) => {
            const toggle = {
              setValue: jest.fn().mockReturnThis(),
              onChange: jest.fn().mockReturnThis(),
            };
            toggleCallbacks.push({ toggle, callback, onChange: null });
            toggle.onChange.mockImplementation((cb: any) => {
              toggleCallbacks[toggleCallbacks.length - 1].onChange = cb;
              return toggle;
            });
            callback(toggle);
            return setting;
          }),
          addText: jest.fn().mockImplementation((callback) => {
            const text = {
              setPlaceholder: jest.fn().mockReturnThis(),
              setValue: jest.fn().mockReturnThis(),
              onChange: jest.fn().mockReturnThis(),
              // Issue #3320 — PAT field sets inputEl.type = "password"
              inputEl: { type: "" } as Record<string, unknown>,
            };
            callback(text);
            return setting;
          }),
          addTextArea: jest.fn().mockImplementation((callback) => {
            const textArea = {
              setPlaceholder: jest.fn().mockReturnThis(),
              setValue: jest.fn().mockReturnThis(),
              onChange: jest.fn().mockReturnThis(),
              inputEl: {} as Record<string, unknown>,
            };
            callback(textArea);
            return setting;
          }),
          addButton: jest.fn().mockImplementation((callback) => {
            const button = {
              setButtonText: jest.fn().mockReturnThis(),
              onClick: jest.fn().mockReturnThis(),
              setCta: jest.fn().mockReturnThis(),
            };
            callback(button);
            return setting;
          }),
          addTextArea: jest.fn().mockImplementation((callback) => {
            const textarea = {
              setPlaceholder: jest.fn().mockReturnThis(),
              setValue: jest.fn().mockReturnThis(),
              onChange: jest.fn().mockReturnThis(),
              inputEl: { rows: 0, cols: 0 },
            };
            callback(textarea);
            return setting;
          }),
        };
        return setting;
      });

      settingTab.display();

      // Second setting's toggle (archived assets — was third before properties removal)
      const archivedToggle = toggleCallbacks[1];
      expect(archivedToggle.toggle.setValue).toHaveBeenCalledWith(false);

      if (archivedToggle.onChange) {
        await archivedToggle.onChange(true);
      }

      expect(mockPlugin.settings.showArchivedAssets).toBe(true);
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
      expect(mockPlugin.refreshLayout).toHaveBeenCalled();
    });

  });
});