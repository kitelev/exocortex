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
        showPropertiesSection: true,
        showArchivedAssets: false,
        showDailyNoteProjects: true,
        useDynamicPropertyFields: false,
        showLabelsInTabTitles: true,
        displayNameTemplate: "{{exo__Asset_label}}",
        sortByDisplayName: false,
        displayNameSettings: {
          defaultTemplate: "{{exo__Asset_label}}",
          classTemplates: {
            "ems__Task": "{{exo__Asset_label}} {{statusEmoji}}",
            "ems__TaskPrototype": "{{exo__Asset_label}} (TaskPrototype)",
          },
          statusEmojis: {
            "DOING": "🟢",
            "DONE": "✅",
          },
        },
      },
      saveSettings: jest.fn().mockResolvedValue(undefined),
      refreshLayout: jest.fn(),
      toggleTabTitleLabels: jest.fn(),
      toggleFileExplorerSort: jest.fn(),
      applyDisplayNameTemplate: jest.fn(),
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
          };
          callback(text);
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
      // 12 original settings (removed showLabelsInFileExplorer, ontology dropdown; kept autoAdjustPlannedEndTimestamp Issue #2142) + 3 headings + 1 default template + 6 per-class templates + 5 status emojis + 1 reset button + 3 webhook settings (heading, toggle, add button) = 31
      expect(MockSetting).toHaveBeenCalledTimes(31);
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
            };
            callback(text);
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

    it("should render properties section toggle", () => {
      settingTab.display();

      const secondSetting = (MockSetting as jest.Mock).mock.results[1].value;
      expect(secondSetting.setName).toHaveBeenCalledWith("Show properties section");
      expect(secondSetting.setDesc).toHaveBeenCalledWith(
        "Display the properties table in the layout"
      );
    });

    it("should handle properties section toggle change", async () => {
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
            };
            callback(text);
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
        };
        return setting;
      });

      settingTab.display();

      // Second setting's toggle (properties section)
      const propertiesToggle = toggleCallbacks[1];
      expect(propertiesToggle.toggle.setValue).toHaveBeenCalledWith(true);

      if (propertiesToggle.onChange) {
        await propertiesToggle.onChange(false);
      }

      expect(mockPlugin.settings.showPropertiesSection).toBe(false);
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
      expect(mockPlugin.refreshLayout).toHaveBeenCalled();
    });

    it("should render archived assets toggle", () => {
      settingTab.display();

      const thirdSetting = (MockSetting as jest.Mock).mock.results[2].value;
      expect(thirdSetting.setName).toHaveBeenCalledWith("Show archived assets");
      expect(thirdSetting.setDesc).toHaveBeenCalledWith(
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
            };
            callback(text);
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
        };
        return setting;
      });

      settingTab.display();

      // Third setting's toggle (archived assets)
      const archivedToggle = toggleCallbacks[2];
      expect(archivedToggle.toggle.setValue).toHaveBeenCalledWith(false);

      if (archivedToggle.onChange) {
        await archivedToggle.onChange(true);
      }

      expect(mockPlugin.settings.showArchivedAssets).toBe(true);
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
      expect(mockPlugin.refreshLayout).toHaveBeenCalled();
    });

    it("should render Daily Note Projects toggle", () => {
      settingTab.display();

      const fourthSetting = (MockSetting as jest.Mock).mock.results[3].value;
      expect(fourthSetting.setName).toHaveBeenCalledWith("Show projects in daily notes");
      expect(fourthSetting.setDesc).toHaveBeenCalledWith(
        "Display the projects section in the layout for daily notes"
      );
    });

    it("should handle Daily Note Projects toggle change", async () => {
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
            };
            callback(text);
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
        };
        return setting;
      });

      settingTab.display();

      // Fourth setting's toggle (Daily Note Projects)
      const dailyProjectsToggle = toggleCallbacks[3];
      expect(dailyProjectsToggle.toggle.setValue).toHaveBeenCalledWith(true);

      if (dailyProjectsToggle.onChange) {
        await dailyProjectsToggle.onChange(false);
      }

      expect(mockPlugin.settings.showDailyNoteProjects).toBe(false);
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
      expect(mockPlugin.refreshLayout).toHaveBeenCalled();
    });

    it("should render Dynamic Property Fields toggle", () => {
      settingTab.display();

      const fifthSetting = (MockSetting as jest.Mock).mock.results[4].value;
      expect(fifthSetting.setName).toHaveBeenCalledWith("Use dynamic property fields");
      expect(fifthSetting.setDesc).toHaveBeenCalledWith(
        "Generate modal fields from ontology (experimental)"
      );
    });

    it("should handle Dynamic Property Fields toggle change", async () => {
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
            };
            callback(text);
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
        };
        return setting;
      });

      settingTab.display();

      // Fifth setting's toggle (Dynamic Property Fields)
      const dynamicFieldsToggle = toggleCallbacks[4];
      expect(dynamicFieldsToggle.toggle.setValue).toHaveBeenCalledWith(false);

      if (dynamicFieldsToggle.onChange) {
        await dynamicFieldsToggle.onChange(true);
      }

      expect(mockPlugin.settings.useDynamicPropertyFields).toBe(true);
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
      // Should NOT call refreshLayout (unlike other toggles)
    });
  });
});