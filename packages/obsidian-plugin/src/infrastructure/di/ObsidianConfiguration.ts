import type { IConfiguration } from "exocortex";
import { Plugin } from "obsidian";
import type { ExocortexPluginInterface } from '@plugin/types';

export class ObsidianConfiguration implements IConfiguration {
  constructor(private plugin: Plugin) {}

  get<T>(key: string): T | undefined {
    const exoPlugin = this.plugin as unknown as ExocortexPluginInterface;
    const settings = exoPlugin.settings;
    if (!settings) {
      return undefined;
    }

    const keys = key.split(".");
    let value: unknown = settings;

    for (const k of keys) {
      if (value && typeof value === "object" && k in value) {
        value = (value as Record<string, unknown>)[k];
      } else {
        return undefined;
      }
    }

    return value as T;
  }

  async set<T>(key: string, value: T): Promise<void> {
    const exoPlugin = this.plugin as unknown as ExocortexPluginInterface;
    const settings = exoPlugin.settings;
    if (!settings) {
      throw new Error("Plugin settings not initialized");
    }

    const keys = key.split(".");
    const lastKey = keys.pop();
    if (!lastKey) {
      throw new Error("Invalid configuration key");
    }
    let current: Record<string, unknown> = settings;

    for (const k of keys) {
      if (!current[k] || typeof current[k] !== "object") {
        current[k] = {};
      }
      current = current[k] as Record<string, unknown>;
    }

    current[lastKey] = value;

    if (typeof exoPlugin.saveSettings === "function") {
      await exoPlugin.saveSettings();
    }
  }

  getAll(): Record<string, unknown> {
    const exoPlugin = this.plugin as unknown as ExocortexPluginInterface;
    return exoPlugin.settings || {};
  }
}
