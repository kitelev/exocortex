import { ExocortexSettingTab } from "../../src/presentation/settings/ExocortexSettingTab";
import { Setting } from "obsidian";
import { createMockApp, createMockTFile, createMockPlugin } from "./helpers/testHelpers";

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
        defaultOntologyAsset: null,
        layoutVisible: true,
        showPropertiesSection: true,
        showArchivedAssets: false,
        showDailyNoteProjects: true,
        useDynamicPropertyFields: false,
        showLabelsInFileExplorer: true,
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
      toggleFileExplorerLabels: jest.fn(),
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

  describe("getOntologyAssets", () => {
    it("should find files with exo__Ontology class", () => {
      const mockFiles = [
        createMockTFile("ontology1.md"),
        createMockTFile("ontology2.md"),
        createMockTFile("not-ontology.md"),
      ];

      mockApp.vault.getMarkdownFiles.mockReturnValue(mockFiles);
      mockApp.metadataCache.getFileCache.mockImplementation((file: any) => {
        if (file.basename === "ontology1") {
          return {
            frontmatter: {
              exo__Instance_class: "exo__Ontology",
            },
          };
        } else if (file.basename === "ontology2") {
          return {
            frontmatter: {
              exo__Instance_class: "[[exo__Ontology]]",
            },
          };
        } else {
          return {
            frontmatter: {
              exo__Instance_class: "ems__Task",
            },
          };
        }
      });

      const result = settingTab["getOntologyAssets"]();

      expect(result).toEqual(["ontology1", "ontology2"]);
      expect(mockApp.vault.getMarkdownFiles).toHaveBeenCalled();
    });

    it("should handle multiple class formats", () => {
      const mockFiles = [
        createMockTFile("ontology-plain.md"),
        createMockTFile("ontology-linked.md"),
        createMockTFile("ontology-quoted.md"),
      ];

      mockApp.vault.getMarkdownFiles.mockReturnValue(mockFiles);
      mockApp.metadataCache.getFileCache.mockImplementation((file: any) => {
        if (file.basename === "ontology-plain") {
          return {
            frontmatter: {
              exo__Instance_class: "exo__Ontology",
            },
          };
        } else if (file.basename === "ontology-linked") {
          return {
            frontmatter: {
              exo__Instance_class: "[[exo__Ontology]]",
            },
          };
        } else if (file.basename === "ontology-quoted") {
          return {
            frontmatter: {
              exo__Instance_class: '"[[exo__Ontology]]"',
            },
          };
        }
        return null;
      });

      const result = settingTab["getOntologyAssets"]();

      expect(result).toEqual(["ontology-linked", "ontology-plain", "ontology-quoted"]);
    });

    it("should handle array of classes", () => {
      const mockFiles = [
        createMockTFile("multi-class.md"),
      ];

      mockApp.vault.getMarkdownFiles.mockReturnValue(mockFiles);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Instance_class: ["ems__Task", "exo__Ontology", "ems__Project"],
        },
      });

      const result = settingTab["getOntologyAssets"]();

      expect(result).toEqual(["multi-class"]);
    });

    it("should sort results alphabetically", () => {
      const mockFiles = [
        createMockTFile("zebra.md"),
        createMockTFile("apple.md"),
        createMockTFile("middle.md"),
      ];

      mockApp.vault.getMarkdownFiles.mockReturnValue(mockFiles);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Instance_class: "exo__Ontology",
        },
      });

      const result = settingTab["getOntologyAssets"]();

      expect(result).toEqual(["apple", "middle", "zebra"]);
    });

    it("should ignore files without frontmatter", () => {
      const mockFiles = [
        createMockTFile("no-frontmatter.md"),
        createMockTFile("with-frontmatter.md"),
      ];

      mockApp.vault.getMarkdownFiles.mockReturnValue(mockFiles);
      mockApp.metadataCache.getFileCache.mockImplementation((file: any) => {
        if (file.basename === "no-frontmatter") {
          return { frontmatter: null };
        }
        return {
          frontmatter: {
            exo__Instance_class: "exo__Ontology",
          },
        };
      });

      const result = settingTab["getOntologyAssets"]();

      expect(result).toEqual(["with-frontmatter"]);
    });

    it("should ignore files without exo__Instance_class", () => {
      const mockFiles = [
        createMockTFile("no-class.md"),
        createMockTFile("with-class.md"),
      ];

      mockApp.vault.getMarkdownFiles.mockReturnValue(mockFiles);
      mockApp.metadataCache.getFileCache.mockImplementation((file: any) => {
        if (file.basename === "no-class") {
          return {
            frontmatter: {
              other_property: "value",
            },
          };
        }
        return {
          frontmatter: {
            exo__Instance_class: "exo__Ontology",
          },
        };
      });

      const result = settingTab["getOntologyAssets"]();

      expect(result).toEqual(["with-class"]);
    });

    it("should ignore files with non-ontology classes", () => {
      const mockFiles = [
        createMockTFile("task.md"),
        createMockTFile("project.md"),
        createMockTFile("ontology.md"),
      ];

      mockApp.vault.getMarkdownFiles.mockReturnValue(mockFiles);
      mockApp.metadataCache.getFileCache.mockImplementation((file: any) => {
        if (file.basename === "task") {
          return {
            frontmatter: {
              exo__Instance_class: "ems__Task",
            },
          };
        } else if (file.basename === "project") {
          return {
            frontmatter: {
              exo__Instance_class: "ems__Project",
            },
          };
        }
        return {
          frontmatter: {
            exo__Instance_class: "exo__Ontology",
          },
        };
      });

      const result = settingTab["getOntologyAssets"]();

      expect(result).toEqual(["ontology"]);
    });

    it("should return empty array when no ontologies found", () => {
      const mockFiles = [
        createMockTFile("file1.md"),
        createMockTFile("file2.md"),
      ];

      mockApp.vault.getMarkdownFiles.mockReturnValue(mockFiles);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Instance_class: "ems__Task",
        },
      });

      const result = settingTab["getOntologyAssets"]();

      expect(result).toEqual([]);
    });
  });

  describe("display", () => {
    it("should render all settings", () => {
      const getOntologySpy = jest
        .spyOn(settingTab as any, "getOntologyAssets")
        .mockReturnValue(["Ontology1", "Ontology2"]);

      settingTab.display();

      expect(mockContainerEl.empty).toHaveBeenCalled();
      expect(getOntologySpy).toHaveBeenCalledTimes(1);
      // 10 original settings (added properties block) + 3 headings + 1 default template + 6 per-class templates + 5 status emojis + 1 reset button = 26
      expect(MockSetting).toHaveBeenCalledTimes(26);
    });

    it("should render ontology dropdown with correct options", () => {
      jest.spyOn(settingTab as any, "getOntologyAssets").mockReturnValue([
        "Ontology1",
        "Ontology2",
      ]);

      let dropdownCallbacks: any[] = [];
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
            dropdownCallbacks.push({ dropdown, callback });
            callback(dropdown);
            return setting;
          }),
          addToggle: jest.fn().mockReturnThis(),
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

      // First Setting should be the ontology dropdown
      const firstSetting = (MockSetting as jest.Mock).mock.results[0].value;
      expect(firstSetting.setName).toHaveBeenCalledWith("Default ontology asset");
      expect(firstSetting.setDesc).toHaveBeenCalledWith(
        "Choose the ontology asset to use for created events"
      );

      // Check dropdown options
      const { dropdown } = dropdownCallbacks[0];
      expect(dropdown.addOption).toHaveBeenCalledWith("", "None (use events folder)");
      expect(dropdown.addOption).toHaveBeenCalledWith("Ontology1", "Ontology1");
      expect(dropdown.addOption).toHaveBeenCalledWith("Ontology2", "Ontology2");
      expect(dropdown.setValue).toHaveBeenCalledWith("");
    });

    it("should handle ontology dropdown change", async () => {
      jest.spyOn(settingTab as any, "getOntologyAssets").mockReturnValue(["Ontology1"]);

      // Track onChange callbacks for each dropdown
      const onChangeCallbacks: Array<(value: string) => Promise<void>> = [];
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
              onChange: jest.fn().mockImplementation((cb) => {
                onChangeCallbacks.push(cb);
                return dropdown;
              }),
            };
            callback(dropdown);
            return setting;
          }),
          addToggle: jest.fn().mockReturnThis(),
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

      // First dropdown onChange is for ontology
      const ontologyOnChange = onChangeCallbacks[0];
      if (ontologyOnChange) {
        await ontologyOnChange("Ontology1");
      }

      expect(mockPlugin.settings.defaultOntologyAsset).toBe("Ontology1");
      expect(mockPlugin.saveSettings).toHaveBeenCalled();

      // Test clearing the value
      if (ontologyOnChange) {
        await ontologyOnChange("");
      }

      expect(mockPlugin.settings.defaultOntologyAsset).toBeNull();
      expect(mockPlugin.saveSettings).toHaveBeenCalledTimes(2);
    });

    it("should render layout visibility toggle", () => {
      jest.spyOn(settingTab as any, "getOntologyAssets").mockReturnValue([]);

      settingTab.display();

      const secondSetting = (MockSetting as jest.Mock).mock.results[1].value;
      expect(secondSetting.setName).toHaveBeenCalledWith("Show layout");
      expect(secondSetting.setDesc).toHaveBeenCalledWith(
        "Display the automatic layout below metadata in reading mode"
      );
    });

    it("should handle layout visibility toggle change", async () => {
      jest.spyOn(settingTab as any, "getOntologyAssets").mockReturnValue([]);

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

      // Second setting's toggle (layout visibility)
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
      jest.spyOn(settingTab as any, "getOntologyAssets").mockReturnValue([]);

      settingTab.display();

      const thirdSetting = (MockSetting as jest.Mock).mock.results[2].value;
      expect(thirdSetting.setName).toHaveBeenCalledWith("Show properties section");
      expect(thirdSetting.setDesc).toHaveBeenCalledWith(
        "Display the properties table in the layout"
      );
    });

    it("should handle properties section toggle change", async () => {
      jest.spyOn(settingTab as any, "getOntologyAssets").mockReturnValue([]);

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

      // Third setting's toggle (properties section)
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
      jest.spyOn(settingTab as any, "getOntologyAssets").mockReturnValue([]);

      settingTab.display();

      const fourthSetting = (MockSetting as jest.Mock).mock.results[3].value;
      expect(fourthSetting.setName).toHaveBeenCalledWith("Show archived assets");
      expect(fourthSetting.setDesc).toHaveBeenCalledWith(
        "Display archived assets in relations table with visual distinction"
      );
    });

    it("should handle archived assets toggle change", async () => {
      jest.spyOn(settingTab as any, "getOntologyAssets").mockReturnValue([]);

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

      // Fourth setting's toggle (archived assets)
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
      jest.spyOn(settingTab as any, "getOntologyAssets").mockReturnValue([]);

      settingTab.display();

      const fifthSetting = (MockSetting as jest.Mock).mock.results[4].value;
      expect(fifthSetting.setName).toHaveBeenCalledWith("Show projects in daily notes");
      expect(fifthSetting.setDesc).toHaveBeenCalledWith(
        "Display the projects section in the layout for daily notes"
      );
    });

    it("should handle Daily Note Projects toggle change", async () => {
      jest.spyOn(settingTab as any, "getOntologyAssets").mockReturnValue([]);

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

      // Fifth setting's toggle (Daily Note Projects)
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
      jest.spyOn(settingTab as any, "getOntologyAssets").mockReturnValue([]);

      settingTab.display();

      const sixthSetting = (MockSetting as jest.Mock).mock.results[5].value;
      expect(sixthSetting.setName).toHaveBeenCalledWith("Use dynamic property fields");
      expect(sixthSetting.setDesc).toHaveBeenCalledWith(
        "Generate modal fields from ontology (experimental)"
      );
    });

    it("should handle Dynamic Property Fields toggle change", async () => {
      jest.spyOn(settingTab as any, "getOntologyAssets").mockReturnValue([]);

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

      // Sixth setting's toggle (Dynamic Property Fields)
      const dynamicFieldsToggle = toggleCallbacks[4];
      expect(dynamicFieldsToggle.toggle.setValue).toHaveBeenCalledWith(false);

      if (dynamicFieldsToggle.onChange) {
        await dynamicFieldsToggle.onChange(true);
      }

      expect(mockPlugin.settings.useDynamicPropertyFields).toBe(true);
      expect(mockPlugin.saveSettings).toHaveBeenCalled();
      // Should NOT call refreshLayout (unlike other toggles)
    });

    it("should set dropdown value to existing setting", () => {
      mockPlugin.settings.defaultOntologyAsset = "ExistingOntology";
      jest.spyOn(settingTab as any, "getOntologyAssets").mockReturnValue([
        "ExistingOntology",
        "OtherOntology",
      ]);

      // Track dropdown values by dropdown index
      const dropdownValues: string[] = [];
      MockSetting.mockImplementation((containerEl: any) => {
        const setting = {
          containerEl,
          setName: jest.fn().mockReturnThis(),
          setDesc: jest.fn().mockReturnThis(),
          setHeading: jest.fn().mockReturnThis(),
          addDropdown: jest.fn().mockImplementation((callback) => {
            const dropdown = {
              addOption: jest.fn().mockReturnThis(),
              setValue: jest.fn().mockImplementation((value: string) => {
                dropdownValues.push(value);
                return dropdown;
              }),
              onChange: jest.fn().mockReturnThis(),
            };
            callback(dropdown);
            return setting;
          }),
          addToggle: jest.fn().mockReturnThis(),
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

      // First dropdown is the ontology dropdown, which should have ExistingOntology
      expect(dropdownValues[0]).toBe("ExistingOntology");
    });
  });
});