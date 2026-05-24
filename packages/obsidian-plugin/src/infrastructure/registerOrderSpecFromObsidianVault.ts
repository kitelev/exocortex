import type { App } from "obsidian";
import {
  registerOrderSpecLoader,
  type FrontmatterOrderSpec,
} from "exocortex";

/**
 * Plugin-side loader for `exo__FrontmatterOrderSpec` assets.
 *
 * Scans `app.vault.getMarkdownFiles()` for an asset with
 * `exo__FrontmatterOrderSpec_default: true` in its frontmatter and
 * registers an OrderSpecLoader that returns it.
 *
 * Called once during plugin `onload()`. Loader closes over `app` so
 * each invocation re-reads the current frontmatter via metadataCache
 * (which means vault edits picked up on next creation without plugin reload).
 *
 * Returns void; if no spec asset exists, the loader returns null and
 * `loadDefaultSpec()` falls back to legacy insertion order.
 *
 * RFC 27a7a877.
 */
export function registerOrderSpecFromObsidianVault(app: App): void {
  registerOrderSpecLoader(() => loadSpecFromVault(app));
}

function loadSpecFromVault(app: App): FrontmatterOrderSpec | null {
  const files = app.vault.getMarkdownFiles();
  for (const f of files) {
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    if (!fm) continue;
    if (fm["exo__FrontmatterOrderSpec_default"] !== true) continue;
    return {
      head: toStringArray(fm["exo__FrontmatterOrderSpec_head"]),
      tail: toStringArray(fm["exo__FrontmatterOrderSpec_tail"]),
      middleStrategy: typeof fm["exo__FrontmatterOrderSpec_middleStrategy"] === "string"
        ? fm["exo__FrontmatterOrderSpec_middleStrategy"]
        : "alphabetical",
    };
  }
  return null;
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

// Exported for tests that need to bypass the closure-app pattern.
export { loadSpecFromVault };
