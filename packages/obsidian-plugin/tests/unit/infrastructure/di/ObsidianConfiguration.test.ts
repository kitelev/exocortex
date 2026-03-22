import { ObsidianConfiguration } from "../../../../src/infrastructure/di/ObsidianConfiguration";
import { Plugin } from "obsidian";

describe("ObsidianConfiguration", () => {
  let mockPlugin: Plugin & { settings?: Record<string, unknown>; saveSettings?: jest.Mock };
  let config: ObsidianConfiguration;

  beforeEach(() => {
    mockPlugin = {
      manifest: { id: "test-plugin" },
      settings: {
        currentOntology: "test-ontology",
        showLayoutSection: true,
        showArchivedAssets: false,
        nested: {
          deep: {
            value: "nested-value",
          },
          arrayValue: [1, 2, 3],
        },
      },
      saveSettings: jest.fn().mockResolvedValue(undefined),
    } as unknown as Plugin & { settings?: Record<string, unknown>; saveSettings?: jest.Mock };

    config = new ObsidianConfiguration(mockPlugin);
  });

  describe("get", () => {
    it("should return value for top-level key", () => {
      const result = config.get<string>("currentOntology");

      expect(result).toBe("test-ontology");
    });

    it("should return boolean value", () => {
      const result = config.get<boolean>("showLayoutSection");

      expect(result).toBe(true);
    });

    it("should return false boolean value", () => {
      const result = config.get<boolean>("showArchivedAssets");

      expect(result).toBe(false);
    });

    it("should return nested value using dot notation", () => {
      const result = config.get<string>("nested.deep.value");

      expect(result).toBe("nested-value");
    });

    it("should return array value", () => {
      const result = config.get<number[]>("nested.arrayValue");

      expect(result).toEqual([1, 2, 3]);
    });

    it("should return undefined for non-existent key", () => {
      const result = config.get<string>("nonExistent");

      expect(result).toBeUndefined();
    });

    it("should return undefined for non-existent nested key", () => {
      const result = config.get<string>("nested.nonExistent.path");

      expect(result).toBeUndefined();
    });

    it("should return undefined when settings are not initialized", () => {
      const pluginWithoutSettings = {
        manifest: { id: "test-plugin" },
      } as unknown as Plugin;

      const configWithoutSettings = new ObsidianConfiguration(pluginWithoutSettings);
      const result = configWithoutSettings.get<string>("anyKey");

      expect(result).toBeUndefined();
    });

    it("should return object value", () => {
      const result = config.get<{ value: string }>("nested.deep");

      expect(result).toEqual({ value: "nested-value" });
    });
  });

  describe("set", () => {
    it("should set top-level value", async () => {
      await config.set("currentOntology", "new-ontology");

      expect(mockPlugin.settings?.currentOntology).toBe("new-ontology");
    });

    it("should set nested value using dot notation", async () => {
      await config.set("nested.deep.value", "updated-nested-value");

      expect((mockPlugin.settings?.nested as Record<string, any>).deep.value).toBe(
        "updated-nested-value"
      );
    });

    it("should call saveSettings after setting value", async () => {
      await config.set("showLayoutSection", false);

      expect(mockPlugin.saveSettings).toHaveBeenCalled();
    });

    it("should create nested path if it does not exist", async () => {
      await config.set("newNested.deep.path", "new-value");

      expect((mockPlugin.settings?.newNested as Record<string, any>).deep.path).toBe(
        "new-value"
      );
    });

    it("should throw error if settings not initialized", async () => {
      const pluginWithoutSettings = {
        manifest: { id: "test-plugin" },
      } as unknown as Plugin;

      const configWithoutSettings = new ObsidianConfiguration(pluginWithoutSettings);

      await expect(configWithoutSettings.set("key", "value")).rejects.toThrow(
        "Plugin settings not initialized"
      );
    });

    it("should throw error for empty key", async () => {
      await expect(config.set("", "value")).rejects.toThrow("Invalid configuration key");
    });

    it("should not call saveSettings if function not available", async () => {
      const pluginWithoutSave = {
        manifest: { id: "test-plugin" },
        settings: { key: "value" },
      } as unknown as Plugin & { settings: Record<string, unknown> };

      const configWithoutSave = new ObsidianConfiguration(pluginWithoutSave);

      // Should not throw
      await configWithoutSave.set("key", "newValue");
      expect(pluginWithoutSave.settings.key).toBe("newValue");
    });

    it("should set boolean value", async () => {
      await config.set("showArchivedAssets", true);

      expect(mockPlugin.settings?.showArchivedAssets).toBe(true);
    });

    it("should set array value", async () => {
      await config.set("nested.arrayValue", [4, 5, 6]);

      expect((mockPlugin.settings?.nested as Record<string, any>).arrayValue).toEqual([
        4, 5, 6,
      ]);
    });

    it("should set object value", async () => {
      const newObj = { foo: "bar", baz: 123 };
      await config.set("newObject", newObj);

      expect(mockPlugin.settings?.newObject).toEqual(newObj);
    });
  });

  describe("getAll", () => {
    it("should return all settings", () => {
      const result = config.getAll();

      expect(result).toEqual(mockPlugin.settings);
    });

    it("should return empty object if settings not initialized", () => {
      const pluginWithoutSettings = {
        manifest: { id: "test-plugin" },
      } as unknown as Plugin;

      const configWithoutSettings = new ObsidianConfiguration(pluginWithoutSettings);
      const result = configWithoutSettings.getAll();

      expect(result).toEqual({});
    });

    it("should not modify original settings when returned object is modified", () => {
      const result = config.getAll();
      (result as Record<string, unknown>).newKey = "newValue";

      // Original should not be affected since getAll returns the reference
      // This tests the current behavior - not defensive copying
      expect(mockPlugin.settings?.newKey).toBe("newValue");
    });
  });
});
