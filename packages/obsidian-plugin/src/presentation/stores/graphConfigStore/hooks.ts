/**
 * React hooks for graph configuration.
 * Provides type-safe access to configuration with automatic re-rendering.
 */

import { useCallback, useMemo, useEffect } from "react";
import { useGraphConfigStore } from "./store";
import type {
  GraphConfig,
  GraphConfigStore,
  PhysicsConfig,
  RenderingConfig,
  InteractionConfig,
  FilterConfig,
  LayoutConfig,
  MinimapConfig,
  DeepPartial,
  ConfigPreset,
} from "./types";

/**
 * Hook to access complete graph configuration
 * Re-renders when any config changes
 */
export function useGraphConfig(): GraphConfig {
  return useGraphConfigStore((state: GraphConfigStore) => state.config);
}

/**
 * Hook to access a specific config section
 * Re-renders only when that section changes
 */
export function useGraphConfigSection<K extends keyof GraphConfig>(
  section: K
): GraphConfig[K] {
  return useGraphConfigStore((state: GraphConfigStore) => state.config[section]);
}

/**
 * Hook to access physics configuration
 */
export function usePhysicsConfig(): PhysicsConfig {
  return useGraphConfigStore((state: GraphConfigStore) => state.config.physics);
}

/**
 * Hook to access rendering configuration
 */
export function useRenderingConfig(): RenderingConfig {
  return useGraphConfigStore((state: GraphConfigStore) => state.config.rendering);
}

/**
 * Hook to access interaction configuration
 */
export function useInteractionConfig(): InteractionConfig {
  return useGraphConfigStore((state: GraphConfigStore) => state.config.interaction);
}

/**
 * Hook to access filter configuration
 */
export function useFilterConfig(): FilterConfig {
  return useGraphConfigStore((state: GraphConfigStore) => state.config.filters);
}

/**
 * Hook to access layout configuration
 */
export function useLayoutConfig(): LayoutConfig {
  return useGraphConfigStore((state: GraphConfigStore) => state.config.layout);
}

/**
 * Hook to access minimap configuration
 */
export function useMinimapConfig(): MinimapConfig {
  return useGraphConfigStore((state: GraphConfigStore) => state.config.minimap);
}

/**
 * Hook to get config value at a specific path
 * @example
 * const maxFPS = useConfigValue('rendering.performance.maxFPS');
 */
export function useConfigValue<T = unknown>(path: string): T {
  const getter = useGraphConfigStore((state: GraphConfigStore) => state.get);
  return useMemo(() => getter(path) as T, [getter, path]);
}

/**
 * Hook to update configuration
 * Returns a stable setter function
 */
export function useSetConfig(): (updates: DeepPartial<GraphConfig>) => void {
  return useGraphConfigStore((state: GraphConfigStore) => state.set);
}

/**
 * Hook to reset configuration
 * Returns a stable reset function
 */
export function useResetConfig(): (path?: string) => void {
  return useGraphConfigStore((state: GraphConfigStore) => state.reset);
}

/**
 * Hook to get and set a specific config value
 * Similar to useState but for config values
 * @example
 * const [enabled, setEnabled] = useConfigState('physics.enabled');
 */
export function useConfigState<K extends keyof GraphConfig>(
  section: K
): [GraphConfig[K], (value: DeepPartial<GraphConfig[K]>) => void] {
  const value = useGraphConfigStore((state: GraphConfigStore) => state.config[section]);
  const set = useGraphConfigStore((state: GraphConfigStore) => state.set);

  const setValue = useCallback(
    (newValue: DeepPartial<GraphConfig[K]>) => {
      set({ [section]: newValue } as DeepPartial<GraphConfig>);
    },
    [set, section]
  );

  return [value, setValue];
}

/**
 * Hook to access preset management
 */
export function usePresets(): {
  activePreset: string | null;
  presets: ConfigPreset[];
  applyPreset: (name: string) => void;
  saveAsPreset: (name: string, description?: string) => void;
  deletePreset: (name: string) => void;
} {
  const activePreset = useGraphConfigStore((state: GraphConfigStore) => state.activePreset);
  const getPresets = useGraphConfigStore((state: GraphConfigStore) => state.getPresets);
  const applyPreset = useGraphConfigStore((state: GraphConfigStore) => state.applyPreset);
  const saveAsPreset = useGraphConfigStore((state: GraphConfigStore) => state.saveAsPreset);
  const deletePreset = useGraphConfigStore((state: GraphConfigStore) => state.deletePreset);

  const presets = useMemo(() => getPresets(), [getPresets]);

  return {
    activePreset,
    presets,
    applyPreset,
    saveAsPreset,
    deletePreset,
  };
}

/**
 * Hook to access import/export functionality
 */
export function useConfigImportExport(): {
  exportConfig: () => string;
  importConfig: (json: string) => boolean;
} {
  const exportConfig = useGraphConfigStore((state: GraphConfigStore) => state.exportConfig);
  const importConfig = useGraphConfigStore((state: GraphConfigStore) => state.importConfig);

  return { exportConfig, importConfig };
}

/**
 * Hook to subscribe to config changes with a custom selector
 * Useful for performance-critical components
 * Returns an unsubscribe function for manual cleanup
 */
export function useConfigSubscription<T>(
  selector: (config: GraphConfig) => T,
  callback: (value: T) => void
): () => void {
  const subscribe = useGraphConfigStore((state: GraphConfigStore) => state.subscribe);

  // Use useEffect for proper subscription lifecycle management
  useEffect(() => {
    const unsubscribe = subscribe((config: GraphConfig) => {
      callback(selector(config));
    });
    return unsubscribe;
  }, [subscribe, selector, callback]);

  // Return a no-op for backwards compatibility - actual cleanup is in useEffect
  return useCallback(() => {
    // Cleanup is handled by useEffect
  }, []);
}

/**
 * Hook for physics-specific settings with setters
 */
export function usePhysicsSettings(): {
  physics: PhysicsConfig;
  setPhysicsEnabled: (enabled: boolean) => void;
  setChargeStrength: (strength: number) => void;
  setLinkDistance: (distance: number) => void;
  setCollisionEnabled: (enabled: boolean) => void;
} {
  const physics = usePhysicsConfig();
  const set = useSetConfig();

  return {
    physics,
    setPhysicsEnabled: useCallback(
      (enabled: boolean) => set({ physics: { enabled } }),
      [set]
    ),
    setChargeStrength: useCallback(
      (strength: number) => set({ physics: { charge: { strength } } }),
      [set]
    ),
    setLinkDistance: useCallback(
      (distance: number) => set({ physics: { link: { distance } } }),
      [set]
    ),
    setCollisionEnabled: useCallback(
      (enabled: boolean) => set({ physics: { collision: { enabled } } }),
      [set]
    ),
  };
}

/**
 * Hook for rendering-specific settings with setters
 */
export function useRenderingSettings(): {
  rendering: RenderingConfig;
  setMaxFPS: (fps: number) => void;
  setAntialias: (enabled: boolean) => void;
  setNodeRadius: (radius: number) => void;
  setShowLabels: (threshold: number) => void;
  setShowGrid: (enabled: boolean) => void;
} {
  const rendering = useRenderingConfig();
  const set = useSetConfig();

  return {
    rendering,
    setMaxFPS: useCallback(
      (maxFPS: number) => set({ rendering: { performance: { maxFPS } } }),
      [set]
    ),
    setAntialias: useCallback(
      (antialias: boolean) => set({ rendering: { performance: { antialias } } }),
      [set]
    ),
    setNodeRadius: useCallback(
      (defaultRadius: number) => set({ rendering: { nodes: { defaultRadius } } }),
      [set]
    ),
    setShowLabels: useCallback(
      (showThreshold: number) => set({ rendering: { labels: { showThreshold } } }),
      [set]
    ),
    setShowGrid: useCallback(
      (showGrid: boolean) => set({ rendering: { background: { showGrid } } }),
      [set]
    ),
  };
}
