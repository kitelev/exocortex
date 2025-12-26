/**
 * Zustand store for graph configuration management.
 * Provides reactive configuration with persistence and preset support.
 */

import { create } from "zustand";
import { persist, subscribeWithSelector } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import type {
  GraphConfig,
  GraphConfigStore,
  GraphConfigState,
  ConfigPreset,
  DeepPartial,
} from "./types";
import { getDefaultConfig, validateConfig, validatePartialConfig } from "./schema";
import { BUILT_IN_PRESETS, getBuiltInPreset, isBuiltInPreset } from "./presets";

/**
 * Storage key for localStorage persistence
 */
const STORAGE_KEY = "exocortex-graph-config";

/**
 * Prototype pollution dangerous keys that must be blocked
 */
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Check if a property key is dangerous (could cause prototype pollution)
 */
function isDangerousKey(key: string): boolean {
  return DANGEROUS_KEYS.has(key);
}

/**
 * Get value at path from nested object
 */
function getAtPath<T>(obj: Record<string, unknown>, path: string): T | undefined {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current as T;
}

/**
 * Set value at path in nested object (mutates)
 * Guards against prototype pollution by blocking dangerous property names
 */
function setAtPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");

  // Guard against prototype pollution - check all path parts
  for (const part of parts) {
    if (isDangerousKey(part)) {
      console.warn(`[GraphConfig] Blocked attempt to set dangerous property: ${part}`);
      return;
    }
  }

  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== "object" || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
}

/**
 * Deep merge two objects (target is mutated)
 * Guards against prototype pollution by blocking dangerous property names
 */
function deepMerge<T extends Record<string, unknown>>(target: T, source: DeepPartial<T> | undefined | null): T {
  if (!source) return target;

  for (const key of Object.keys(source)) {
    // Guard against prototype pollution - skip dangerous keys
    if (isDangerousKey(key)) {
      continue;
    }

    const sourceValue = (source as Record<string, unknown>)[key];
    const targetValue = (target as Record<string, unknown>)[key];

    if (
      sourceValue !== undefined &&
      typeof sourceValue === "object" &&
      sourceValue !== null &&
      !Array.isArray(sourceValue) &&
      typeof targetValue === "object" &&
      targetValue !== null &&
      !Array.isArray(targetValue)
    ) {
      deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as DeepPartial<Record<string, unknown>>
      );
    } else if (sourceValue !== undefined) {
      (target as Record<string, unknown>)[key] = sourceValue;
    }
  }

  return target;
}

/**
 * Deep clone an object
 * Handles undefined by returning undefined, and Infinity values
 */
function deepClone<T>(obj: T): T {
  if (obj === undefined) return undefined as T;
  if (obj === null) return null as T;

  // Handle special values like Infinity
  return JSON.parse(JSON.stringify(obj, (_, value) => {
    if (value === Infinity) return "Infinity";
    if (value === -Infinity) return "-Infinity";
    return value;
  }), (_, value) => {
    if (value === "Infinity") return Infinity;
    if (value === "-Infinity") return -Infinity;
    return value;
  });
}

/**
 * Get default state with validated config
 */
function getDefaultState(): GraphConfigState {
  return {
    config: getDefaultConfig(),
    activePreset: null,
    customPresets: [],
  };
}

/**
 * Create the graph configuration store with middleware
 */
export const useGraphConfigStore = create<GraphConfigStore>()(
  persist(
    subscribeWithSelector(
      immer<GraphConfigStore>((set, get) => ({
        // Initial state
        ...getDefaultState(),

        // ============================================================
        // Get Configuration
        // ============================================================

        get: <T = GraphConfig>(path?: string): T => {
          const state = get();
          if (!path) {
            return deepClone(state.config) as T;
          }
          const value = getAtPath<T>(state.config as unknown as Record<string, unknown>, path);
          return deepClone(value) as T;
        },

        // ============================================================
        // Set Configuration
        // ============================================================

        set: (updates: DeepPartial<GraphConfig>) => {
          // Validate partial updates
          const validation = validatePartialConfig(updates);
          if (!validation.success) {
            console.warn("[GraphConfig] Invalid configuration update:", validation.error);
            return;
          }

          set((state) => {
            deepMerge(state.config as unknown as Record<string, unknown>, updates as unknown as DeepPartial<Record<string, unknown>>);
            // Clear active preset since config was manually modified
            state.activePreset = null;
          });
        },

        // ============================================================
        // Reset Configuration
        // ============================================================

        reset: (path?: string) => {
          const defaults = getDefaultConfig();

          set((state) => {
            if (!path) {
              // Reset entire config
              state.config = defaults;
              state.activePreset = null;
            } else {
              // Reset specific path
              const defaultValue = getAtPath(
                defaults as unknown as Record<string, unknown>,
                path
              );
              if (defaultValue !== undefined) {
                setAtPath(
                  state.config as unknown as Record<string, unknown>,
                  path,
                  deepClone(defaultValue)
                );
              }
              state.activePreset = null;
            }
          });
        },

        // ============================================================
        // Preset Management
        // ============================================================

        applyPreset: (name: string) => {
          // Try built-in first
          let preset = getBuiltInPreset(name);

          // Then try custom presets
          if (!preset) {
            preset = get().customPresets.find((p) => p.name === name);
          }

          if (!preset) {
            console.warn(`[GraphConfig] Preset "${name}" not found`);
            return;
          }

          set((state) => {
            // Reset to defaults first
            state.config = getDefaultConfig();
            // Apply preset config
            deepMerge(state.config as unknown as Record<string, unknown>, preset.config as unknown as DeepPartial<Record<string, unknown>>);
            state.activePreset = name;
          });
        },

        saveAsPreset: (name: string, description = "") => {
          if (isBuiltInPreset(name)) {
            console.warn(`[GraphConfig] Cannot overwrite built-in preset "${name}"`);
            return;
          }

          set((state) => {
            const existingIndex = state.customPresets.findIndex((p) => p.name === name);
            const newPreset: ConfigPreset = {
              name,
              description,
              config: deepClone(state.config),
            };

            if (existingIndex >= 0) {
              state.customPresets[existingIndex] = newPreset;
            } else {
              state.customPresets.push(newPreset);
            }
            state.activePreset = name;
          });
        },

        deletePreset: (name: string) => {
          if (isBuiltInPreset(name)) {
            console.warn(`[GraphConfig] Cannot delete built-in preset "${name}"`);
            return;
          }

          set((state) => {
            state.customPresets = state.customPresets.filter((p) => p.name !== name);
            if (state.activePreset === name) {
              state.activePreset = null;
            }
          });
        },

        getPresets: () => {
          const state = get();
          return [...BUILT_IN_PRESETS, ...state.customPresets];
        },

        // ============================================================
        // Import/Export
        // ============================================================

        exportConfig: () => {
          const state = get();
          // Use custom replacer to handle Infinity values
          return JSON.stringify(
            {
              config: state.config,
              customPresets: state.customPresets,
            },
            (_, value) => {
              if (value === Infinity) return "__INFINITY__";
              if (value === -Infinity) return "__NEG_INFINITY__";
              return value;
            },
            2
          );
        },

        importConfig: (json: string) => {
          try {
            // Use custom reviver to restore Infinity values
            const parsed = JSON.parse(json, (_, value) => {
              if (value === "__INFINITY__") return Infinity;
              if (value === "__NEG_INFINITY__") return -Infinity;
              return value;
            });

            // Validate config
            if (parsed.config) {
              const validation = validateConfig(parsed.config);
              if (!validation.success) {
                console.warn("[GraphConfig] Invalid imported configuration:", validation.error);
                return false;
              }
            }

            set((state) => {
              if (parsed.config) {
                state.config = parsed.config;
              }
              if (Array.isArray(parsed.customPresets)) {
                // Filter out any that would overwrite built-ins
                state.customPresets = parsed.customPresets.filter(
                  (p: ConfigPreset) => !isBuiltInPreset(p.name)
                );
              }
              state.activePreset = null;
            });

            return true;
          } catch (error) {
            console.error("[GraphConfig] Failed to import configuration:", error);
            return false;
          }
        },

        // ============================================================
        // Subscribe
        // ============================================================

        subscribe: (callback: (config: GraphConfig) => void): (() => void) => {
          return useGraphConfigStore.subscribe(
            (state: GraphConfigStore) => state.config,
            (config: GraphConfig) => callback(deepClone(config))
          );
        },
      }))
    ),
    // Persist configuration
    {
      name: STORAGE_KEY,
      partialize: (state) => ({
        config: state.config,
        customPresets: state.customPresets,
        activePreset: state.activePreset,
      }),
      storage: {
        getItem: (name) => {
          // eslint-disable-next-line no-restricted-globals
          const item = localStorage.getItem(name);
          if (!item) return null;
          try {
            return JSON.parse(item);
          } catch {
            return null;
          }
        },
        setItem: (name, value) => {
          // eslint-disable-next-line no-restricted-globals
          localStorage.setItem(name, JSON.stringify(value));
        },
        removeItem: (name) => {
          // eslint-disable-next-line no-restricted-globals
          localStorage.removeItem(name);
        },
      },
    }
  )
);

/**
 * Get default state for testing
 */
export { getDefaultState };

/**
 * Get default configuration for testing
 */
export { getDefaultConfig };
