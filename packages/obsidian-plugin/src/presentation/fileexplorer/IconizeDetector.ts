/**
 * IconizeDetector — RFC-024 §8 (T7.2). Detects whether the Iconize community
 * plugin (`obsidian-icon-folder`) is installed and enabled at startup, so the
 * Exocortex File Explorer overlay can log the coexistence handshake.
 *
 * Per-row skip is enforced by `FileExplorerIconPatch.hasIconizeOverlay`
 * (DOM-marker based). This detector is the startup-time discovery counterpart
 * — it does not affect overlay behaviour, only emits a log line so users
 * understand which plugin "wins" on iconized rows.
 */

const ICONIZE_PLUGIN_IDS = ["obsidian-icon-folder"] as const;

export interface IconizeDetectionResult {
  detected: boolean;
  pluginId: string | null;
}

interface AppLike {
  plugins?: {
    plugins?: Record<string, unknown>;
    enabledPlugins?: Set<string> | string[];
  };
}

export class IconizeDetector {
  static detect(app: unknown): IconizeDetectionResult {
    const plugins = (app as AppLike | null | undefined)?.plugins?.plugins;
    if (!plugins || typeof plugins !== "object") {
      return { detected: false, pluginId: null };
    }
    for (const id of ICONIZE_PLUGIN_IDS) {
      if (plugins[id]) {
        return { detected: true, pluginId: id };
      }
    }
    return { detected: false, pluginId: null };
  }
}
