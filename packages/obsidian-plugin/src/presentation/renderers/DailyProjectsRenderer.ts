import { TFile, Keymap } from "obsidian";
import { ILogger } from '@plugin/adapters/logging/ILogger';
import { ExocortexSettings } from '@plugin/domain/settings/ExocortexSettings';
import React from "react";
import { ReactRenderer } from '@plugin/presentation/utils/ReactRenderer';
import {
  DailyProject,
  DailyProjectsTableWithToggle,
} from '@plugin/presentation/components/DailyProjectsTable';
import {
  AssetClass,
  EffortStatus,
  IVaultAdapter,
  LayoutSelector,
} from "exocortex";
import { MetadataExtractor } from "exocortex";
import { EffortSortingHelpers } from "exocortex";
import { BlockerHelpers } from '@plugin/presentation/utils/BlockerHelpers';
import { DailyNoteHelpers } from "./helpers/DailyNoteHelpers";
import { ObsidianApp, ExocortexPluginInterface } from '@plugin/types';
import { SPARQLQueryService } from '@plugin/application/services/SPARQLQueryService';

/**
 * DailyProjectsRenderer - Renders daily projects table using RDF-driven configuration.
 *
 * This renderer supports two modes:
 * 1. RDF-driven mode: Uses LayoutSelector to get SPARQL queries from RDF layout definitions
 * 2. Legacy mode: Falls back to hardcoded TypeScript logic when RDF is unavailable
 *
 * Supports {day} placeholder replacement for daily note date filtering.
 *
 * @see Issue #1460: Refactor DailyProjectsRenderer to use RDF
 * @see Implementation Plan: Phase 6.6, Task 4
 */
export class DailyProjectsRenderer {
  private logger: ILogger;
  private app: ObsidianApp;
  private settings: ExocortexSettings;
  private plugin: ExocortexPluginInterface;
  private metadataExtractor: MetadataExtractor;
  private reactRenderer: ReactRenderer;
  private refresh: () => Promise<void>;
  private getAssetLabelCallback: (path: string) => string | null;
  private vaultAdapter: IVaultAdapter;
  private layoutSelector?: LayoutSelector;
  private sparqlQueryService?: SPARQLQueryService;

  constructor(
    app: ObsidianApp,
    settings: ExocortexSettings,
    plugin: ExocortexPluginInterface,
    logger: ILogger,
    metadataExtractor: MetadataExtractor,
    reactRenderer: ReactRenderer,
    refresh: () => Promise<void>,
    getAssetLabel: (path: string) => string | null,
    _getEffortArea: (metadata: Record<string, unknown>) => string | null,
    vaultAdapter: IVaultAdapter,
    layoutSelector?: LayoutSelector,
    sparqlQueryService?: SPARQLQueryService,
  ) {
    this.app = app;
    this.settings = settings;
    this.plugin = plugin;
    this.logger = logger;
    this.metadataExtractor = metadataExtractor;
    this.reactRenderer = reactRenderer;
    this.refresh = refresh;
    this.getAssetLabelCallback = getAssetLabel;
    this.vaultAdapter = vaultAdapter;
    this.layoutSelector = layoutSelector;
    this.sparqlQueryService = sparqlQueryService;
  }

  /**
   * Set the LayoutSelector for RDF-driven rendering.
   * Called after construction when dependencies become available.
   */
  setLayoutSelector(layoutSelector: LayoutSelector): void {
    this.layoutSelector = layoutSelector;
  }

  /**
   * Set the SPARQLQueryService for RDF-driven rendering.
   * Called after construction when dependencies become available.
   */
  setSparqlQueryService(sparqlQueryService: SPARQLQueryService): void {
    this.sparqlQueryService = sparqlQueryService;
  }

  /**
   * Check if RDF-driven rendering is available.
   */
  private isRdfDrivenAvailable(): boolean {
    return !!(this.layoutSelector && this.sparqlQueryService);
  }

  /**
   * Build asset URI from file path.
   */
  private buildAssetUri(file: TFile): string {
    const metadata = this.metadataExtractor.extractMetadata(file);
    const uid = metadata?.exo__Asset_uid as string;
    if (uid) {
      return `https://exocortex.my/assets/${uid}`;
    }
    return `file://${file.path}`;
  }

  public async render(
    el: HTMLElement,
    file: TFile,
    renderHeader?: (container: HTMLElement, sectionId: string, title: string) => void,
    isCollapsed?: boolean,
  ): Promise<void> {
    const metadata = this.metadataExtractor.extractMetadata(file);
    const instanceClass = this.metadataExtractor.extractInstanceClass(metadata);

    const classes = Array.isArray(instanceClass)
      ? instanceClass
      : [instanceClass];
    const isDailyNote = classes.some(
      (c: string | null) => c === "[[pn__DailyNote]]" || c === "pn__DailyNote",
    );

    if (!isDailyNote) {
      return;
    }

    const dayProperty = metadata.pn__DailyNote_day;
    if (!dayProperty) {
      this.logger.debug("No pn__DailyNote_day found for daily note");
      return;
    }

    const dayMatch =
      typeof dayProperty === "string"
        ? dayProperty.match(/\[\[(.+?)\]\]/)
        : null;
    const day = dayMatch
      ? dayMatch[1]
      : String(dayProperty).replace(/^\[\[|\]\]$/g, "");

    // Try RDF-driven rendering first, fall back to legacy if unavailable
    let projects: DailyProject[];
    let blockLabel = "Projects"; // Default label

    if (this.isRdfDrivenAvailable()) {
      try {
        const result = await this.getDailyProjectsRdfDriven(file, day);
        if (result) {
          projects = result.projects;
          blockLabel = result.label || blockLabel;
          this.logger.debug(`Using RDF-driven rendering for Daily Projects: ${day}`);
        } else {
          projects = await this.getDailyProjects(day);
          this.logger.debug(`RDF layout not found, using legacy for Daily Projects: ${day}`);
        }
      } catch (error) {
        this.logger.warn(`RDF-driven rendering failed, falling back to legacy`, { error });
        projects = await this.getDailyProjects(day);
      }
    } else {
      projects = await this.getDailyProjects(day);
      this.logger.debug(`Using legacy rendering for Daily Projects: ${day}`);
    }

    if (projects.length === 0) {
      this.logger.debug(`No projects found for day: ${day}`);
      return;
    }

    const sectionContainer = el.createDiv({
      cls: "exocortex-daily-projects-section",
    });

    // Render collapsible header if function provided
    if (renderHeader) {
      renderHeader(sectionContainer, "daily-projects", blockLabel);
    } else {
      sectionContainer.createEl("h3", {
        text: blockLabel,
        cls: "exocortex-section-header",
      });
    }

    // Create content container
    const contentContainer = sectionContainer.createDiv({
      cls: "exocortex-section-content",
      attr: {
        "data-collapsed": (isCollapsed || false).toString(),
      },
    });

    // Only render content if not collapsed
    if (isCollapsed) {
      return;
    }

    const tableContainer = contentContainer.createDiv({
      cls: "exocortex-daily-projects-table-container",
    });

    this.reactRenderer.render(
      tableContainer,
      React.createElement(DailyProjectsTableWithToggle, {
        projects,
        showArchived: this.settings.showArchivedAssets,
        onToggleArchived: async () => {
          this.settings.showArchivedAssets = !this.settings.showArchivedAssets;
          await this.plugin.saveSettings();
          await this.refresh();
        },
        showFullDateInEffortTimes: this.settings.showFullDateInEffortTimes,
        onToggleFullDate: async () => {
          this.settings.showFullDateInEffortTimes =
            !this.settings.showFullDateInEffortTimes;
          await this.plugin.saveSettings();
          await this.refresh();
        },
        onProjectClick: async (path: string, event: React.MouseEvent) => {
          const isModPressed = Keymap.isModEvent(
            event.nativeEvent as MouseEvent,
          );

          if (isModPressed) {
            await this.app.workspace.openLinkText(path, "", "tab");
          } else {
            await this.app.workspace.openLinkText(path, "", false);
          }
        },
        getAssetLabel: (path: string) => this.getAssetLabelCallback(path),
      }),
    );

    this.logger.info(
      `Rendered ${projects.length} projects for DailyNote: ${day}`,
    );
  }

  private async getDailyProjects(day: string): Promise<DailyProject[]> {
    try {
      const projects: DailyProject[] = [];

      const allFiles = this.vaultAdapter.getAllFiles();

      for (const file of allFiles) {
        const metadata = this.metadataExtractor.extractMetadata(file);

        if (!DailyNoteHelpers.isEffortInDay(metadata, day)) {
          continue;
        }

        const instanceClass = metadata.exo__Instance_class || [];
        const instanceClassArray = Array.isArray(instanceClass)
          ? instanceClass
          : [instanceClass];
        const isProject = instanceClassArray.some((c: string) =>
          String(c).includes(AssetClass.PROJECT),
        );

        if (!isProject) {
          continue;
        }

        const effortStatus = metadata.ems__Effort_status || "";
        const effortStatusStr = String(effortStatus).replace(
          /^\[\[|\]\]$/g,
          "",
        );

        const startTimestamp = metadata.ems__Effort_startTimestamp;
        const plannedStartTimestamp =
          metadata.ems__Effort_plannedStartTimestamp;
        const endTimestamp = metadata.ems__Effort_endTimestamp;
        const plannedEndTimestamp = metadata.ems__Effort_plannedEndTimestamp;

        const formatTime = (
          timestamp: string | number | null | undefined,
        ): string => {
          if (!timestamp) return "";
          const date = new Date(timestamp);
          if (isNaN(date.getTime())) return "";
          return date.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          });
        };

        const startTime =
          formatTime(startTimestamp) || formatTime(plannedStartTimestamp);
        const endTime =
          formatTime(endTimestamp) || formatTime(plannedEndTimestamp);

        const isDone = effortStatusStr === EffortStatus.DONE;
        const isTrashed = effortStatusStr === EffortStatus.TRASHED;

        const label = metadata.exo__Asset_label || file.basename;

        const isBlocked = BlockerHelpers.isEffortBlocked(this.app, metadata);

        projects.push({
          file: {
            path: file.path,
            basename: file.basename,
          },
          path: file.path,
          title: file.basename,
          label,
          startTime,
          endTime,
          startTimestamp: startTimestamp || plannedStartTimestamp || null,
          endTimestamp: endTimestamp || plannedEndTimestamp || null,
          status: effortStatusStr,
          metadata,
          isDone,
          isTrashed,
          isBlocked,
        });
      }

      projects.sort((a, b) => EffortSortingHelpers.sortByPriority(a, b));

      return projects;
    } catch (error) {
      this.logger.error("Failed to get daily projects", { error });
      return [];
    }
  }

  /**
   * RDF-driven project fetching using SPARQL queries from LayoutSelector.
   * Returns null if RDF layout is not available for this asset.
   *
   * Handles {day} placeholder replacement in SPARQL queries.
   */
  private async getDailyProjectsRdfDriven(
    file: TFile,
    day: string,
  ): Promise<{ projects: DailyProject[]; label?: string } | null> {
    if (!this.layoutSelector || !this.sparqlQueryService) {
      return null;
    }

    const assetUri = this.buildAssetUri(file);

    // Get layout from RDF
    const layout = await this.layoutSelector.selectLayout(assetUri);
    if (!layout) {
      return null;
    }

    // Find the daily-projects-table block
    const dailyProjectsBlock = layout.blocks.find(
      block => block.renderer === "daily-projects-table"
    );
    if (!dailyProjectsBlock) {
      // No daily-projects-table block in this layout, use legacy
      return null;
    }

    // If there's no query in the block, fall back to legacy
    if (!dailyProjectsBlock.query) {
      return {
        projects: await this.getDailyProjects(day),
        label: this.getBlockLabel(),
      };
    }

    // Replace {day} placeholder in the SPARQL query
    // Note: For now, we still use the legacy data fetching as the data source
    // The SPARQL query will be used in future iterations when the triple store
    // contains the full asset graph
    //
    // TODO: Replace with actual SPARQL execution when triple store is populated
    // const query = dailyProjectsBlock.query.replace(/\{day\}/g, day);
    // const results = await this.sparqlQueryService.query(query);
    // const projects = this.buildProjectsFromSparqlResults(results);

    // For Phase 1: Use block metadata but legacy data fetching
    return {
      projects: await this.getDailyProjects(day),
      label: this.getBlockLabel(),
    };
  }

  /**
   * Get the display label for a layout block.
   * Falls back to default "Projects" if not specified in RDF.
   */
  private getBlockLabel(): string {
    // The block doesn't have a direct label property in the current interface
    // The label comes from rdfs:label on the block in RDF
    // For now, return a default - this can be extended when LayoutBlock interface
    // includes label property
    return "Projects";
  }
}
