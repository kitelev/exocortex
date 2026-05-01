/**
 * PanelResolver — RFC-024 Phase 3 service that resolves the
 * `exo__Layout_commandPanel` for a given target class and exposes the
 * three precedence helpers that act on the resolved panel:
 *
 *   1. {@link PanelResolver.resolve}      — return the active panel spec.
 *   2. {@link PanelResolver.applyFilter}  — `excludeCommands` trumps
 *      `includeGroups` (RFC-024 §5 rule #2).
 *   3. {@link PanelResolver.isFeatured}   — `featuredBinding` overrides
 *      a binding's variant to `primary` (RFC-024 §5 rule #3).
 *
 * Resolved values are memoised by class reference. Cache invalidation has
 * three orthogonal entry points — one per axis described in the RFC §4
 * Phase 3 service contract:
 *
 *   - {@link PanelResolver.invalidateOnLayoutChange}  — `exo__Layout`
 *     asset edited (the panel spec itself, layout target class, or order).
 *   - {@link PanelResolver.invalidateOnBindingChange} — an
 *     `exocmd__CommandBinding` referenced by `featuredBinding` or
 *     `excludeCommands` was edited / renamed / deleted.
 *   - {@link PanelResolver.invalidateOnClassChange}   — the asset's
 *     `exo__Instance_class` membership changed, so the class key the
 *     panel is cached under is no longer valid for that file.
 *
 * All three reduce to {@link PanelResolver.invalidate}; the named methods
 * are the public contract so wiring code documents which axis fired.
 *
 * @module application/services/PanelResolver
 * @since RFC-024 Phase 3
 */

import {
  applyCommandPanelFilter,
  isFeaturedBinding,
  type BaseLayout,
  type CommandPanel,
} from "@plugin/domain/layout";

/**
 * Callback supplied by the plugin that returns the layout currently
 * targeting the given class reference (already normalised to the bare
 * class name). Returning `null` — or a layout without a `commandPanel`
 * slot — means the resolver falls through to "no panel override".
 */
export type PanelLayoutProvider = (
  classRef: string,
) => Pick<BaseLayout, "commandPanel"> | null;

export interface PanelResolverOptions {
  /**
   * How to discover the layout for a class reference. Defaults to
   * `() => null`, which is useful for tests and for initial wiring before
   * a layout repository is available.
   */
  readonly layoutProvider?: PanelLayoutProvider;
}

/**
 * Reads, resolves, and caches the `exo__Layout_commandPanel` slot for a
 * given target class. Acts as the single source of truth for which
 * command bindings render in a class-specific panel and which one is
 * promoted to `primary`.
 */
export class PanelResolver {
  private readonly layoutProvider: PanelLayoutProvider;
  private readonly cache = new Map<string, CommandPanel | null>();

  constructor(options: PanelResolverOptions = {}) {
    this.layoutProvider = options.layoutProvider ?? (() => null);
  }

  /**
   * Returns the active {@link CommandPanel} spec for the given class, or
   * `null` if no layout declares one. Result is memoised per class.
   */
  resolve(classRef: string): CommandPanel | null {
    const key = this.normaliseClassRef(classRef);
    if (this.cache.has(key)) {
      return this.cache.get(key) ?? null;
    }
    const layout = this.layoutProvider(key);
    const panel = layout?.commandPanel ?? null;
    this.cache.set(key, panel);
    return panel;
  }

  /**
   * Applies the resolved panel's include/exclude rules to a list of
   * candidate commands. Pure pass-through when no panel is declared.
   *
   * @param classRef   - Target class whose panel is consulted.
   * @param candidates - Candidate commands (each with `uid` + optional
   *                     `category`). Order is preserved.
   * @returns Filtered subset honouring rule #2 (exclude trumps include).
   */
  applyFilter<T extends { uid: string; category?: string }>(
    classRef: string,
    candidates: readonly T[],
  ): T[] {
    return applyCommandPanelFilter(
      candidates,
      this.resolve(classRef) ?? undefined,
    );
  }

  /**
   * Reports whether the given binding is the panel's `featuredBinding`
   * for the given class — i.e. its variant should be promoted to
   * `primary` regardless of any binding-level style.
   */
  isFeatured(classRef: string, bindingUid: string): boolean {
    return isFeaturedBinding(
      this.resolve(classRef) ?? undefined,
      bindingUid,
    );
  }

  /**
   * Axis 1 — invalidate after an `exo__Layout` asset is edited. Drops
   * the cache entry for the layout's target class (or every entry when
   * the caller cannot pin down the affected class — e.g. when the layout
   * has just been deleted).
   */
  invalidateOnLayoutChange(classRef?: string): void {
    this.invalidate(classRef);
  }

  /**
   * Axis 2 — invalidate after an `exocmd__CommandBinding` asset is
   * edited / renamed / deleted. Bindings can be referenced by any
   * panel's `excludeCommands` or `featuredBinding`, so the safest
   * invariant is to drop the whole cache.
   */
  invalidateOnBindingChange(): void {
    this.invalidate();
  }

  /**
   * Axis 3 — invalidate after an asset's `exo__Instance_class`
   * membership changes (rename, retype). When the caller knows the
   * affected class, only that key is dropped.
   */
  invalidateOnClassChange(classRef?: string): void {
    this.invalidate(classRef);
  }

  /**
   * Drops a cached resolution. Omit the argument to clear the whole
   * cache. Used internally by the three named axis hooks; exposed so
   * test harnesses can also reset state directly.
   */
  invalidate(classRef?: string): void {
    if (classRef === undefined) {
      this.cache.clear();
      return;
    }
    this.cache.delete(this.normaliseClassRef(classRef));
  }

  /**
   * Strips wikilink syntax and the optional alias suffix so that
   * `[[ems__Task]]`, `[[ems__Task|Task]]`, and `ems__Task` all collapse
   * to the same cache key.
   */
  private normaliseClassRef(classRef: string): string {
    const trimmed = classRef.trim();
    const inner = trimmed.replace(/^\[\[|\]\]$/g, "");
    const pipeIdx = inner.indexOf("|");
    return (pipeIdx >= 0 ? inner.slice(0, pipeIdx) : inner).trim();
  }
}
