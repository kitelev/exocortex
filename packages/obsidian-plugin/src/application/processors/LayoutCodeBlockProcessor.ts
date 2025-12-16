/**
 * LayoutCodeBlockProcessor - Renders Layout definitions in markdown code blocks
 *
 * Supports the `exo-layout` code block syntax:
 * ```exo-layout
 * [[emslayout__UpcomingTasksLayout]]
 * ```
 *
 * Features:
 * - Parses wikilink from code block content
 * - Shows loading state during data fetching
 * - Displays error state with helpful messages
 * - Refreshes automatically when vault files change
 *
 * @module application/processors
 * @since 1.0.0
 */

import React from "react";
import {
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  type EventRef,
} from "obsidian";
import type ExocortexPlugin from "@plugin/ExocortexPlugin";
import { LayoutService } from "../layout";
import type { LayoutRenderResult } from "../layout";
import { ReactRenderer } from "@plugin/presentation/utils/ReactRenderer";
import { LoggerFactory } from "@plugin/adapters/logging/LoggerFactory";
import { TableLayoutRenderer } from "@plugin/presentation/renderers/TableLayoutRenderer";
import type { TableLayout } from "@plugin/domain/layout";
import { isTableLayout } from "@plugin/domain/layout";

/**
 * Tracks an active layout block for cleanup and refresh management.
 */
interface ActiveLayout {
  /** The wikilink source from the code block */
  wikilink: string;
  /** Event reference for metadata change listener */
  eventRef?: EventRef;
  /** Debounce timeout for refresh scheduling */
  refreshTimeout?: ReturnType<typeof setTimeout>;
  /** Timestamp when the layout was rendered (for TTL tracking) */
  startTime: number;
}

/**
 * Cleanup component to handle unmounting and resource cleanup.
 */
class LayoutCleanupComponent extends MarkdownRenderChild {
  constructor(
    containerEl: HTMLElement,
    private el: HTMLElement,
    private activeLayouts: Map<HTMLElement, ActiveLayout>,
    private reactRenderer: ReactRenderer,
    private container: HTMLElement,
    private plugin: ExocortexPlugin
  ) {
    super(containerEl);
  }

  override onload(): void {
    // Nothing needed on load
  }

  override onunload(): void {
    const layout = this.activeLayouts.get(this.el);
    if (layout) {
      if (layout.refreshTimeout) {
        clearTimeout(layout.refreshTimeout);
      }
      if (layout.eventRef) {
        this.plugin.app.metadataCache.offref(layout.eventRef);
      }
      this.activeLayouts.delete(this.el);
    }
    this.reactRenderer.unmount(this.container);
  }
}

/**
 * Processor for `exo-layout` code blocks.
 *
 * @example
 * ```exo-layout
 * [[emslayout__UpcomingTasksLayout]]
 * ```
 */
export class LayoutCodeBlockProcessor {
  private plugin: ExocortexPlugin;
  private layoutService: LayoutService | null = null;
  private reactRenderer: ReactRenderer = new ReactRenderer();
  private activeLayouts: Map<HTMLElement, ActiveLayout> = new Map();
  private readonly DEBOUNCE_DELAY = 500;
  /** Maximum age for active layouts (5 minutes in milliseconds) */
  private readonly LAYOUT_MAX_AGE_MS = 5 * 60 * 1000;
  /** Interval for stale layout cleanup (1 minute in milliseconds) */
  private readonly CLEANUP_INTERVAL_MS = 60 * 1000;
  private cleanupIntervalId: ReturnType<typeof setInterval> | null = null;
  private readonly logger = LoggerFactory.create("LayoutCodeBlockProcessor");

  constructor(plugin: ExocortexPlugin) {
    this.plugin = plugin;
    this.startCleanupInterval();
  }

  /**
   * Starts the periodic cleanup interval for stale layouts.
   */
  private startCleanupInterval(): void {
    if (this.cleanupIntervalId !== null) {
      return;
    }
    this.cleanupIntervalId = setInterval(() => {
      this.cleanupStaleLayouts();
    }, this.CLEANUP_INTERVAL_MS);
  }

  /**
   * Stops the periodic cleanup interval.
   */
  private stopCleanupInterval(): void {
    if (this.cleanupIntervalId !== null) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
  }

  /**
   * Cleans up layouts that have exceeded the maximum age (TTL).
   */
  private cleanupStaleLayouts(): void {
    const now = Date.now();
    const staleEntries: HTMLElement[] = [];

    for (const [el, layout] of this.activeLayouts.entries()) {
      const age = now - layout.startTime;
      if (age > this.LAYOUT_MAX_AGE_MS) {
        staleEntries.push(el);
        this.logger.warn(
          `Layout timed out after ${Math.round(age / 1000)}s: ${layout.wikilink}`
        );
      }
    }

    for (const el of staleEntries) {
      const layout = this.activeLayouts.get(el);
      if (layout) {
        if (layout.refreshTimeout) {
          clearTimeout(layout.refreshTimeout);
        }
        if (layout.eventRef) {
          this.plugin.app.metadataCache.offref(layout.eventRef);
        }
        this.activeLayouts.delete(el);
        this.logger.info("Cleaned up stale layout entry");
      }
    }

    if (staleEntries.length > 0) {
      this.logger.info(`Cleaned up ${staleEntries.length} stale layout entries`);
    }
  }

  /**
   * Ensures the LayoutService is initialized.
   */
  private async ensureLayoutServiceInitialized(): Promise<LayoutService> {
    if (this.layoutService === null) {
      this.layoutService = new LayoutService(
        this.plugin.app,
        this.plugin.vaultAdapter
      );
      await this.layoutService.initialize();
    }
    return this.layoutService;
  }

  /**
   * Parses a wikilink from code block content.
   * Supports formats:
   * - [[LayoutName]]
   * - [[Path/To/LayoutName]]
   * - LayoutName (bare name, will be wrapped)
   *
   * @param source - Raw code block content
   * @returns Parsed wikilink string
   */
  parseWikilink(source: string): string {
    const trimmed = source.trim();

    // Already a wikilink
    if (trimmed.startsWith("[[") && trimmed.endsWith("]]")) {
      return trimmed;
    }

    // Bare name - wrap in wikilink
    return `[[${trimmed}]]`;
  }

  /**
   * Process an `exo-layout` code block.
   *
   * @param source - Code block content (wikilink to layout)
   * @param el - Container element
   * @param ctx - Markdown processor context
   */
  async process(
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
  ): Promise<void> {
    el.innerHTML = "";
    el.classList.add("exo-layout-code-block");

    const container = document.createElement("div");
    container.className = "exo-layout-container";
    el.appendChild(container);

    const wikilink = this.parseWikilink(source);

    try {
      // Show loading state
      this.showLoadingState(container, "Loading layout...");

      // Initialize layout service
      const layoutService = await this.ensureLayoutServiceInitialized();

      // Render the layout
      const result = await layoutService.renderLayoutFromWikiLink(
        wikilink,
        ctx.sourcePath
      );

      container.innerHTML = "";

      if (!result.success) {
        this.showErrorState(container, result.error || "Unknown error", wikilink);
        return;
      }

      this.renderLayoutResult(result, container);

      // Track the active layout
      this.activeLayouts.set(el, {
        wikilink,
        startTime: Date.now(),
      });

      // Set up refresh on metadata change
      const eventRef = this.plugin.app.metadataCache.on("changed", () => {
        this.scheduleRefresh(el, container, wikilink, ctx.sourcePath);
      });

      // Register cleanup component
      ctx.addChild(
        new LayoutCleanupComponent(
          el,
          el,
          this.activeLayouts,
          this.reactRenderer,
          container,
          this.plugin
        )
      );

      // Store event ref
      const activeLayout = this.activeLayouts.get(el);
      if (activeLayout) {
        activeLayout.eventRef = eventRef;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to process layout code block: ${errorMessage}`);
      container.innerHTML = "";
      this.showErrorState(container, errorMessage, wikilink);
    }
  }

  /**
   * Schedule a debounced refresh of the layout.
   */
  private scheduleRefresh(
    el: HTMLElement,
    container: HTMLElement,
    wikilink: string,
    sourcePath: string
  ): void {
    const layout = this.activeLayouts.get(el);
    if (!layout) return;

    if (layout.refreshTimeout) {
      clearTimeout(layout.refreshTimeout);
    }

    layout.refreshTimeout = setTimeout(async () => {
      await this.refreshLayout(el, container, wikilink, sourcePath);
    }, this.DEBOUNCE_DELAY);
  }

  /**
   * Refresh a layout after metadata changes.
   */
  private async refreshLayout(
    el: HTMLElement,
    container: HTMLElement,
    wikilink: string,
    sourcePath: string
  ): Promise<void> {
    const layout = this.activeLayouts.get(el);
    if (!layout) return;

    try {
      // Clear layout service cache to get fresh data
      if (this.layoutService) {
        this.layoutService.clearCache();
      }

      const layoutService = await this.ensureLayoutServiceInitialized();

      // Show refresh indicator
      this.showRefreshIndicator(container);

      const result = await layoutService.renderLayoutFromWikiLink(
        wikilink,
        sourcePath
      );

      // Hide refresh indicator
      this.hideRefreshIndicator(container);

      if (!result.success) {
        container.innerHTML = "";
        this.showErrorState(container, result.error || "Unknown error", wikilink);
        return;
      }

      container.innerHTML = "";
      this.renderLayoutResult(result, container);

      // Reset TTL on successful refresh
      layout.startTime = Date.now();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to refresh layout: ${errorMessage}`);
      this.hideRefreshIndicator(container);
    }
  }

  /**
   * Render the layout result to the container.
   */
  private renderLayoutResult(
    result: LayoutRenderResult,
    container: HTMLElement
  ): void {
    if (!result.layout || !result.rows) {
      this.showErrorState(container, "No layout data available", "");
      return;
    }

    // Handle different layout types
    if (isTableLayout(result.layout)) {
      this.renderTableLayout(result.layout, result.rows, container);
    } else {
      // For non-table layouts, show a placeholder for now
      this.showErrorState(
        container,
        `Layout type "${result.layout.type}" is not yet supported in code blocks`,
        ""
      );
    }
  }

  /**
   * Render a table layout using React.
   */
  private renderTableLayout(
    layout: TableLayout,
    rows: import("@plugin/presentation/renderers/cell-renderers").TableRow[],
    container: HTMLElement
  ): void {
    this.reactRenderer.render(
      container,
      React.createElement(TableLayoutRenderer, {
        layout,
        rows,
        onLinkClick: (path: string) => {
          this.plugin.app.workspace.openLinkText(path, "", false, { active: true });
        },
        onCellChange: async (rowId: string, columnUid: string, newValue: unknown) => {
          // Find the row to get the path
          const row = rows.find((r) => r.id === rowId);
          if (!row || !this.layoutService) return;

          // Find the column to get the property name
          const column = layout.columns?.find((c) => c.uid === columnUid);
          if (!column) return;

          await this.layoutService.handleCellEdit(
            row.path,
            column.property,
            newValue as import("@plugin/presentation/renderers/cell-renderers").CellValue
          );
        },
      })
    );
  }

  /**
   * Show loading state.
   */
  private showLoadingState(container: HTMLElement, message: string): void {
    container.innerHTML = "";
    const loadingDiv = document.createElement("div");
    loadingDiv.className = "exo-layout-loading";
    loadingDiv.textContent = message;
    container.appendChild(loadingDiv);
  }

  /**
   * Show error state with helpful message.
   */
  private showErrorState(
    container: HTMLElement,
    error: string,
    wikilink: string
  ): void {
    const errorDiv = document.createElement("div");
    errorDiv.className = "exo-layout-error";

    const titleEl = document.createElement("div");
    titleEl.className = "exo-layout-error-title";
    titleEl.textContent = "Error loading layout";
    errorDiv.appendChild(titleEl);

    if (wikilink) {
      const linkEl = document.createElement("div");
      linkEl.className = "exo-layout-error-link";
      linkEl.textContent = `Layout: ${wikilink}`;
      errorDiv.appendChild(linkEl);
    }

    const messageEl = document.createElement("div");
    messageEl.className = "exo-layout-error-message";
    messageEl.textContent = error;
    errorDiv.appendChild(messageEl);

    container.appendChild(errorDiv);
  }

  /**
   * Show refresh indicator overlay.
   */
  private showRefreshIndicator(container: HTMLElement): void {
    const existing = container.querySelector(".exo-layout-refresh-indicator");
    if (!existing) {
      const indicator = document.createElement("div");
      indicator.className = "exo-layout-refresh-indicator";

      const spinner = document.createElement("div");
      spinner.className = "exo-layout-spinner";
      indicator.appendChild(spinner);

      const text = document.createElement("span");
      text.textContent = "Refreshing...";
      indicator.appendChild(text);

      container.insertBefore(indicator, container.firstChild);
    }
  }

  /**
   * Hide refresh indicator.
   */
  private hideRefreshIndicator(container: HTMLElement): void {
    const indicator = container.querySelector(".exo-layout-refresh-indicator");
    if (indicator) {
      indicator.remove();
    }
  }

  /**
   * Returns the number of active layouts being tracked.
   */
  getActiveLayoutCount(): number {
    return this.activeLayouts.size;
  }

  /**
   * Cleans up all active layouts, timers, and event refs.
   * Should be called in onunload() methods.
   */
  cleanup(): void {
    // Stop the periodic cleanup interval
    this.stopCleanupInterval();

    // Clear all active layout timeouts and event refs
    for (const [el, layout] of this.activeLayouts.entries()) {
      if (layout.refreshTimeout) {
        clearTimeout(layout.refreshTimeout);
      }
      if (layout.eventRef) {
        this.plugin.app.metadataCache.offref(layout.eventRef);
      }
      this.activeLayouts.delete(el);
    }

    // Clear React renderer
    this.reactRenderer.cleanup();

    // Dispose layout service
    if (this.layoutService) {
      void this.layoutService.dispose();
      this.layoutService = null;
    }
  }

  /**
   * Returns the maximum age in milliseconds before layouts are considered stale.
   * Useful for testing.
   */
  getLayoutMaxAge(): number {
    return this.LAYOUT_MAX_AGE_MS;
  }

  /**
   * Returns the cleanup interval in milliseconds.
   * Useful for testing.
   */
  getCleanupInterval(): number {
    return this.CLEANUP_INTERVAL_MS;
  }

  /**
   * Manually triggers stale layout cleanup.
   * Useful for testing.
   */
  triggerCleanup(): void {
    this.cleanupStaleLayouts();
  }
}
