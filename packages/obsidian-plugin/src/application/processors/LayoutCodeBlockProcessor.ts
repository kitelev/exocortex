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
import type { MarkdownPostProcessorContext, EventRef } from "obsidian";
import { MarkdownRenderChild, TFile } from "obsidian";
import type ExocortexPlugin from "@plugin/ExocortexPlugin";
import { LayoutService } from "../layout";
import type { LayoutRenderResult } from "../layout";
import { ReactRenderer } from "@plugin/presentation/utils/ReactRenderer";
import { LoggerFactory } from "@plugin/adapters/logging/LoggerFactory";
import { TableLayoutRenderer } from "@plugin/presentation/renderers/TableLayoutRenderer";
import { WikilinkLabelResolver } from "@plugin/presentation/utils/WikilinkLabelResolver";
import { DisplayNameResolver } from "@plugin/domain/display-name/DisplayNameResolver";
import { DEFAULT_DISPLAY_NAME_SETTINGS } from "@plugin/domain/settings/ExocortexSettings";
import type { TableLayout, CommandRef } from "@plugin/domain/layout";
import { isTableLayout } from "@plugin/domain/layout";
// #3654 Part 2 (#3777) — layout action buttons execute through the EXISTING
// structural exocmd command pipeline (CommandExecutionFlow → GroundingExecutor),
// the same path the structural inline command buttons use — NOT a parallel
// raw-SPARQL-UPDATE engine (rejected in #3777).
import {
  CommandExecutionFlow,
  createTripleStoreRequiredPropertyResolver,
} from "@kitelev/exocortex-core";
import type { ResolvedCommand, EvalContext } from "@kitelev/exocortex-core";
import { ObsidianCommandPromptAdapter } from "@plugin/infrastructure/adapters/ObsidianCommandPromptAdapter";
import { ObsidianFileOpener } from "@plugin/infrastructure/services/ObsidianFileOpener";

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
 * Identifies a rendered layout block so an executed action button can refresh
 * it (#3654 Part 2 / #3777). The processor already has `refreshLayout(el,
 * container, wikilink, sourcePath)`; this threads the three non-container args
 * down to the action-button `onComplete` closure.
 */
interface LayoutRefreshContext {
  el: HTMLElement;
  wikilink: string;
  sourcePath: string;
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
  private wikilinkResolver: WikilinkLabelResolver;
  private activeLayouts: Map<HTMLElement, ActiveLayout> = new Map();
  private readonly DEBOUNCE_DELAY = 500;
  /** Maximum age for active layouts (5 minutes in milliseconds) */
  private readonly LAYOUT_MAX_AGE_MS = 5 * 60 * 1000;
  /** Interval for stale layout cleanup (1 minute in milliseconds) */
  private readonly CLEANUP_INTERVAL_MS = 60 * 1000;
  private cleanupIntervalId: ReturnType<typeof setInterval> | null = null;
  private readonly logger = LoggerFactory.create("LayoutCodeBlockProcessor");

  /**
   * Lazily-built execution pipeline for structural exocmd layout actions
   * (#3654 Part 2 / #3777). Built from the plugin's already-wired
   * `GroundingExecutor` + `CommandResolver` + notifier the FIRST time an action
   * button is clicked — the plugin services are not ready at construction time.
   */
  private commandExecutionFlow: CommandExecutionFlow | null = null;

  constructor(plugin: ExocortexPlugin) {
    this.plugin = plugin;
    this.wikilinkResolver = new WikilinkLabelResolver(plugin.app);
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
        this.plugin.vaultAdapter,
        undefined,
        undefined,
        this.plugin.settings?.excludedFolders ?? [],
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

      this.renderLayoutResult(result, container, {
        el,
        wikilink,
        sourcePath: ctx.sourcePath,
      });

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
      this.renderLayoutResult(result, container, { el, wikilink, sourcePath });

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
    container: HTMLElement,
    // #3654 Part 2 (#3777) — identifies THIS layout block so an executed action
    // button can refresh it (`onComplete`). Absent (e.g. some tests) → action
    // execution still works; the post-run refresh is simply a no-op.
    refreshCtx?: LayoutRefreshContext
  ): void {
    if (!result.layout || !result.rows) {
      this.showErrorState(container, "No layout data available", "");
      return;
    }

    // Handle different layout types
    if (isTableLayout(result.layout)) {
      this.renderTableLayout(result.layout, result.rows, container, refreshCtx);
    } else {
      // Non-table layouts inside a code block are a documented limitation, not
      // an error — surface an informational notice instead of the red
      // "Error loading layout" state (UX audit finding F6).
      this.showUnsupportedLayoutState(container, result.layout.type);
    }
  }

  /**
   * Render a table layout using React.
   */
  private renderTableLayout(
    layout: TableLayout,
    rows: import("@plugin/presentation/renderers/cell-renderers").TableRow[],
    container: HTMLElement,
    // #3654 Part 2 (#3777) — identifies THIS block so an executed action button
    // can refresh it. Absent → the post-run refresh is a no-op.
    refreshCtx?: LayoutRefreshContext
  ): void {
    // #3654 Part 2 (#3777) — refresh THIS layout block after a structural
    // command executes (`CommandExecutionFlow` onComplete). No-op when the
    // block's identity wasn't threaded down (some tests render directly).
    const refresh = async (): Promise<void> => {
      if (refreshCtx) {
        await this.refreshLayout(
          refreshCtx.el,
          container,
          refreshCtx.wikilink,
          refreshCtx.sourcePath
        );
      }
    };
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
        // req `71cc75f3` — route every cell wikilink label through the homoiconic
        // displayName system (the SAME `exo__DisplayNameSpec` stack as native links, the
        // DailyNote table a577316f and the relation/query tables 3f65eb4a) BEFORE the plain
        // resolver, so a status/class-conditional prefix (🔄 for a Doing ems__Task, …) that
        // the user declared as vault data appears in configured `exocortex` code-block tables
        // too — consistently with those other surfaces. Null-safe: no resolver / no file /
        // labelless path → the plain `getAssetLabel`. For a class whose displayName template
        // equals the plain label (the common case) the output is byte-identical to today; a
        // class WITH its own template (prototype suffix, pn__DailyNote basename) intentionally
        // adopts the SAME template already shown on native links / the other tables.
        getAssetLabel: (path: string) =>
          this.resolveHomoiconicDisplayName(path) ??
          this.wikilinkResolver.getAssetLabel(path),
        // Gate action buttons by precondition (#3654 Part 1 + Part 2, #3777):
        // a structural exocmd command is gated by its own
        // `exocmd__Command_precondition` via `PreconditionEvaluator` (unified
        // with Part 1); a legacy raw command by its `exo__Precondition_sparql`
        // ASK. true ⇒ shown, false ⇒ hidden. `$target`/`targetIRI` resolves to
        // the row's REAL store subject IRI (threaded through `LayoutService`
        // metadata), so the gate matches the live asset.
        onCheckPrecondition: (cmd, assetUri, assetPath) =>
          this.checkCommandPrecondition(cmd, assetUri, assetPath),
        // #3654 Part 2 (#3777) — execute a structural exocmd layout action.
        // Resolve the referenced structural command via `CommandResolver` and
        // run it through the EXISTING `CommandExecutionFlow` → `GroundingExecutor`
        // pipeline (the same path structural inline buttons use), targeting the
        // row asset and refreshing THIS block on success. A raw-only /
        // unresolvable command surfaces an honest notice (the raw-SPARQL-UPDATE
        // engine was rejected in #3777), never a silent no-op (#3628).
        onExecuteCommand: (cmd, assetUri, assetPath) =>
          this.executeCommand(cmd, assetUri, assetPath, refresh),
        // Surface action-button failures to the user instead of failing silently
        // (#3628). Routed through the central notifier (eslint forbids `new
        // Notice` elsewhere).
        onError: (message: string) => {
          this.plugin.notifier?.error(message);
        },
      })
    );
  }

  /**
   * req `71cc75f3` — resolve a cell wikilink's display label through the homoiconic
   * `exo__DisplayNameSpec` system, the SAME `DisplayNameResolver` + `PrintNameRuleService`
   * stack native links, the DailyNote tasks table (a577316f) and the layout relation/query
   * tables (3f65eb4a) use. Reads the linked asset's real frontmatter (instance class + status)
   * so a conditional spec (matchPath/matchValue, req ed4201d1) is evaluated per-render.
   *
   * Returns `null` — so the caller falls through to the plain `wikilinkResolver.getAssetLabel`
   * — when there is NO resolver (`printNameRuleService` absent, e.g. a unit-test mock), the
   * path resolves to no file, the file has no frontmatter, OR the asset is labelless (kept null
   * so no basename substitution leaks into the general property-value cell path). A class with
   * no applicable spec renders the default `{{exo__Asset_label}}` template = the plain label
   * (byte-identical); a class WITH a `classTemplates` entry (prototype suffix, pn__DailyNote
   * basename) renders that template — the SAME one native links and the other tables already
   * apply — so this surface stays consistent with them.
   */
  private resolveHomoiconicDisplayName(path: string): string | null {
    const ruleService = this.plugin.printNameRuleService;
    if (!ruleService) {
      return null;
    }

    const file = this.resolveLinkedFile(path);
    if (!file) {
      return null;
    }

    const metadata =
      this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!metadata) {
      return null;
    }

    // Labelless asset → the plain resolver returns null today; preserve that (do NOT
    // substitute a basename) by falling through to the plain getAssetLabel.
    if (this.wikilinkResolver.getAssetLabel(path) === null) {
      return null;
    }

    const settings =
      this.plugin.settings?.displayNameSettings ?? DEFAULT_DISPLAY_NAME_SETTINGS;
    const metadataResolver = ruleService.createMetadataResolver();
    const resolver = new DisplayNameResolver(settings, ruleService, metadataResolver);

    const resolved = resolver.resolve({ metadata, basename: file.basename });
    return typeof resolved === "string" && resolved.trim() !== "" ? resolved : null;
  }

  /**
   * Resolve a wikilink path to its `TFile` the SAME way `WikilinkLabelResolver.getAssetLabel`
   * does (linkpath dest + a `.md` retry), so the homoiconic resolver reads the exact same
   * target file as the plain fallback.
   */
  private resolveLinkedFile(path: string): TFile | null {
    let file = this.plugin.app.metadataCache.getFirstLinkpathDest(path, "");
    if (!file && !path.endsWith(".md")) {
      file = this.plugin.app.metadataCache.getFirstLinkpathDest(path + ".md", "");
    }
    return file instanceof TFile ? file : null;
  }

  /**
   * Evaluates an `exo-layout` action button's `exo__Precondition_sparql` ASK to
   * decide whether the button is shown (#3654 Part 1).
   *
   * Substitutes `$target` → `<assetUri>` (the same text-substitution convention
   * as the structural `PreconditionEvaluator.substituteVariables`) and runs the
   * ASK via {@link SPARQLApi.ask}. `assetUri` is the store's real subject IRI
   * (threaded through `LayoutService.transformToTableRows` → row metadata), so
   * the ASK evaluates against the asset that actually exists in the graph.
   *
   * Only `$target` is substituted; date macros (`$now`, `$today`, …) are not
   * supported on this niche layout-action surface — a precondition using one
   * would fail to parse, which the caller (`ActionsRenderer`) catches and treats
   * as "hide the button" (conservative, never a false-positive show).
   */
  private async checkPrecondition(
    sparql: string,
    assetUri: string
  ): Promise<boolean> {
    const api = this.plugin.getSPARQLApi();
    if (!api) {
      throw new Error(
        "SPARQL API is not available for layout-action preconditions"
      );
    }
    const substituted = sparql.replace(/\$target/g, `<${assetUri}>`);
    return api.ask(substituted);
  }

  /**
   * Command-oriented precondition gate for an `exo-layout` action button
   * (#3654 Part 2 / #3777). Unifies the Part-1 raw ASK gate with the structural
   * command's own precondition:
   *
   * - Structural command (`cmd.structural`) → resolve it via
   *   {@link CommandResolver.loadCommand} and evaluate its
   *   `exocmd__Command_precondition` through the SAME {@link PreconditionEvaluator}
   *   the structural inline command buttons use. A structural command with no
   *   precondition evaluates to `true` (shown). Unresolvable → keep visible; the
   *   click handler surfaces the honest "no command" notice.
   * - Legacy raw command with `cmd.preconditionSparql` → the Part-1
   *   {@link checkPrecondition} SPARQL ASK gate (unchanged).
   * - Neither → `true` (shown).
   *
   * Engine-not-ready (resolver / evaluator absent, e.g. cold start) → `true`
   * (don't hide a button just because the graph is still warming up — matches
   * the structural inline-button behaviour).
   */
  private async checkCommandPrecondition(
    cmd: CommandRef,
    assetUri: string,
    assetPath?: string
  ): Promise<boolean> {
    if (cmd.structural) {
      const resolver = this.plugin.commandResolver;
      const evaluator = this.plugin.preconditionEvaluator;
      if (!resolver || !evaluator) return true;
      try {
        const command = await resolver.loadCommand(cmd.uid);
        if (!command) return true;
        const evalContext: EvalContext = {
          targetIRI: assetUri,
          filePath: assetPath,
          fileBasename: assetPath
            ? (assetPath.split("/").pop() ?? undefined)
            : undefined,
          currentFolder: assetPath
            ? assetPath.split("/").slice(0, -1).join("/") || undefined
            : undefined,
        };
        return await evaluator.evaluate(
          command.precondition,
          assetUri,
          evalContext
        );
      } catch {
        // Conservative: hide on evaluation error (never a false-positive show),
        // matching the raw-ASK gate's catch behaviour.
        return false;
      }
    }
    if (cmd.preconditionSparql) {
      return this.checkPrecondition(cmd.preconditionSparql, assetUri);
    }
    return true;
  }

  /**
   * Lazily build the structural-command execution pipeline (#3654 Part 2 /
   * #3777) from the plugin's already-wired services. Returns `null` when the
   * engine is not ready (no `GroundingExecutor` / `CommandResolver` yet).
   *
   * Mirrors the palette registrar's `CommandExecutionFlow` construction so
   * layout action buttons and Command-Palette entries execute identically.
   */
  private getCommandExecutionFlow(): CommandExecutionFlow | null {
    if (this.commandExecutionFlow) return this.commandExecutionFlow;
    const groundingExecutor = this.plugin.groundingExecutor;
    const commandResolver = this.plugin.commandResolver;
    const notifier = this.plugin.notifier;
    if (!groundingExecutor || !commandResolver || !notifier) return null;
    const tripleStore = this.plugin.sparql?.getTripleStore?.();
    this.commandExecutionFlow = new CommandExecutionFlow(
      groundingExecutor,
      notifier,
      this.logger,
      new ObsidianCommandPromptAdapter(this.plugin.app),
      tripleStore,
      new ObsidianFileOpener(this.plugin.app),
      tripleStore
        ? createTripleStoreRequiredPropertyResolver(tripleStore)
        : undefined
    );
    return this.commandExecutionFlow;
  }

  /**
   * Execute an `exo-layout` action button (#3654 Part 2 / #3777).
   *
   * Resolves the referenced STRUCTURAL exocmd command via
   * {@link CommandResolver.loadCommand} and runs it through the EXISTING
   * {@link CommandExecutionFlow} — the same pipeline the structural inline
   * command buttons use — with the layout context: `targetIRI` = the row's real
   * store subject IRI, `filePath` = the row's asset path, `onComplete` =
   * refresh THIS layout block. `CommandExecutionFlow` handles confirm / input
   * schema / grounding execution / success + error notices.
   *
   * A raw-only or unresolvable command (no structural typed grounding →
   * `loadCommand` returns `null`) surfaces an honest notice instead of a silent
   * no-op (#3628): the parallel raw-SPARQL-UPDATE engine was rejected in #3777,
   * so a layout action must reference a structural exocmd command.
   */
  private async executeCommand(
    cmd: CommandRef,
    assetUri: string,
    assetPath: string | undefined,
    refresh: () => Promise<void>
  ): Promise<void> {
    const resolver = this.plugin.commandResolver;
    const flow = this.getCommandExecutionFlow();
    if (!resolver || !flow) {
      this.plugin.notifier?.error(
        `Cannot run "${cmd.label}": the command engine is not ready yet — try again once indexing completes.`
      );
      return;
    }

    const command = await resolver.loadCommand(cmd.uid);
    if (!command) {
      this.plugin.notifier?.error(
        `Cannot run "${cmd.label}": no structural exocmd command was found for this layout action. ` +
          `Layout actions must reference a structural exocmd command (with exocmd__Command_grounding); ` +
          `the raw-SPARQL-UPDATE execution path is not supported.`
      );
      return;
    }

    const rc: ResolvedCommand = {
      command,
      // `CommandExecutionFlow.run` reads only `rc.command`; a minimal synthetic
      // binding satisfies the type. Layout-action button metadata (label,
      // position) lives in the LayoutActions asset, not a CommandBinding — so
      // no real binding exists to resolve here (unlike inline command buttons).
      binding: {
        id: `layout-action-${cmd.uid}`,
        label: cmd.label,
        commandRef: cmd.uid,
      },
    };

    await flow.run(rc, {
      targetIRI: assetUri,
      filePath: assetPath ?? null,
      onComplete: refresh,
    });
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
   * Show an informational notice for layout types that cannot yet be rendered
   * inside a code block (e.g. graph / calendar / list layouts). This is a
   * documented limitation — NOT a failure — so it deliberately avoids the
   * "Error loading layout" error state, which would tell the user something
   * went wrong when nothing did (UX audit finding F6).
   */
  private showUnsupportedLayoutState(
    container: HTMLElement,
    layoutType: string
  ): void {
    const noticeDiv = document.createElement("div");
    noticeDiv.className = "exo-layout-notice";

    const titleEl = document.createElement("div");
    titleEl.className = "exo-layout-notice-title";
    titleEl.textContent = "Layout not available in code blocks";
    noticeDiv.appendChild(titleEl);

    const messageEl = document.createElement("div");
    messageEl.className = "exo-layout-notice-message";
    messageEl.textContent =
      `Code blocks currently support table layouts only — the "${layoutType}" ` +
      `layout isn't available here yet.`;
    noticeDiv.appendChild(messageEl);

    container.appendChild(noticeDiv);
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
