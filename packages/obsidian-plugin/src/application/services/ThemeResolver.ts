/**
 * ThemeResolver — RFC-024 Phase 1 service that resolves the visual accent
 * color for a given target class. Falls back through a three-layer chain:
 *
 *   1. `exo__Layout_accentColor` declared on a matching `exo__Layout` asset.
 *   2. Plugin-built-in default for well-known classes (Task/Project/Area/
 *      Knowledge).
 *   3. `null` — caller should omit the accent and rely on Obsidian's
 *      existing styling.
 *
 * Resolved values are memoised by class reference. The caller is responsible
 * for invoking {@link ThemeResolver.invalidate} when the underlying vault
 * asset changes (e.g. in response to `app.metadataCache.on("changed")`).
 *
 * @module application/services/ThemeResolver
 * @since RFC-024 Phase 1
 */

import type { BaseLayout, LabelTypography } from "@plugin/domain/layout";

/**
 * Plugin-built-in accent defaults per RFC-024 §4 Phase 1.
 * Tasks → green, Projects → purple, Areas → orange, Knowledge → blue.
 *
 * Keys are class references as stored in `exo__Instance_class` — both the
 * bare form (e.g. `ems__Task`) and wikilink form (`[[ems__Task]]`) are
 * supported via {@link ThemeResolver.normaliseClassRef}.
 */
export const CLASS_DEFAULT_ACCENT: ReadonlyMap<string, string> = new Map<
  string,
  string
>([
  ["ems__Task", "var(--color-green)"],
  ["ems__Project", "var(--color-purple)"],
  ["ems__Area", "var(--color-orange)"],
  ["ims__Concept", "var(--color-blue)"],
]);

/**
 * Callback supplied by the plugin that returns the layout currently
 * targeting the given class reference (normalised to the bare class name).
 * Returning `null` means no layout is declared for that class in the vault.
 */
export type LayoutProvider = (
  classRef: string,
) => Pick<BaseLayout, "accentColor" | "icon" | "labelTypography"> | null;

export interface ThemeResolverOptions {
  /**
   * How to discover the layout for a class reference. Defaults to
   * `() => null`, which falls straight through to plugin-built-in defaults
   * — useful for tests and for initial wiring before a LayoutService is
   * available.
   */
  readonly layoutProvider?: LayoutProvider;
}

interface ResolvedVisualSlots {
  accentColor: string | null;
  icon: string | null;
  labelTypography: LabelTypography | null;
}

/**
 * Reads, resolves, and caches the visual slots declared on an `exo__Layout`
 * asset for a given target class.
 */
export class ThemeResolver {
  private readonly layoutProvider: LayoutProvider;
  private readonly cache = new Map<string, ResolvedVisualSlots>();

  constructor(options: ThemeResolverOptions = {}) {
    this.layoutProvider = options.layoutProvider ?? (() => null);
  }

  /**
   * Returns the accent colour for the given class or `null` if neither a
   * layout override nor a plugin-built-in default applies.
   */
  resolveAccent(classRef: string): string | null {
    return this.resolve(classRef).accentColor;
  }

  /**
   * Returns the icon name for the given class or `null` if not declared.
   */
  resolveIcon(classRef: string): string | null {
    return this.resolve(classRef).icon;
  }

  /**
   * Returns the label typography size for the given class or `null`.
   */
  resolveLabelTypography(classRef: string): LabelTypography | null {
    return this.resolve(classRef).labelTypography;
  }

  /**
   * Drops a cached resolution. Call after a layout asset edit, delete or
   * rename. Omit the argument to clear the whole cache.
   */
  invalidate(classRef?: string): void {
    if (classRef === undefined) {
      this.cache.clear();
      return;
    }
    this.cache.delete(this.normaliseClassRef(classRef));
  }

  private resolve(classRef: string): ResolvedVisualSlots {
    const key = this.normaliseClassRef(classRef);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const layout = this.layoutProvider(key);
    const accentColor =
      layout?.accentColor ?? CLASS_DEFAULT_ACCENT.get(key) ?? null;
    const icon = layout?.icon ?? null;
    const labelTypography = layout?.labelTypography ?? null;

    const resolved: ResolvedVisualSlots = {
      accentColor,
      icon,
      labelTypography,
    };
    this.cache.set(key, resolved);
    return resolved;
  }

  /**
   * Strips wikilink syntax and the optional alias suffix so that
   * `[[ems__Task]]`, `[[ems__Task|Task]]`, and `ems__Task` all collapse to
   * the same cache key.
   */
  private normaliseClassRef(classRef: string): string {
    const trimmed = classRef.trim();
    const inner = trimmed.replace(/^\[\[|\]\]$/g, "");
    const pipeIdx = inner.indexOf("|");
    return (pipeIdx >= 0 ? inner.slice(0, pipeIdx) : inner).trim();
  }
}
