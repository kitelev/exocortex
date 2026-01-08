import { TFile, Keymap } from "obsidian";
import { ILogger } from '@plugin/adapters/logging/ILogger';
import { ExocortexSettings } from '@plugin/domain/settings/ExocortexSettings';
import React from "react";
import { ReactRenderer } from '@plugin/presentation/utils/ReactRenderer';
import {
  DailyTask,
  DailyTasksTableWithToggle,
} from '@plugin/presentation/components/DailyTasksTable';
import {
  AssetClass,
  EffortStatus,
  IVaultAdapter,
  LayoutSelector,
} from "exocortex";
import { MetadataExtractor } from "exocortex";
import { EffortSortingHelpers } from "exocortex";
import { AssetMetadataService } from "./layout/helpers/AssetMetadataService";
import { DailyNoteHelpers } from "./helpers/DailyNoteHelpers";
import { BlockerHelpers } from '@plugin/presentation/utils/BlockerHelpers';
import { getStatusLabel } from '@plugin/domain/property-editor/PropertySchemas';
import { ObsidianApp, ExocortexPluginInterface } from '@plugin/types';
import { SPARQLQueryService } from '@plugin/application/services/SPARQLQueryService';

/**
 * DailyTasksRenderer - Renders daily tasks table using RDF-driven configuration.
 *
 * This renderer supports two modes:
 * 1. RDF-driven mode: Uses LayoutSelector to get SPARQL queries from RDF layout definitions
 * 2. Legacy mode: Falls back to hardcoded TypeScript logic when RDF is unavailable
 *
 * Supports {day} placeholder replacement for daily note date filtering.
 *
 * @see Issue #1460: Refactor DailyTasksRenderer to use RDF
 * @see Implementation Plan: Phase 6.6, Task 4
 */
export class DailyTasksRenderer {
  private logger: ILogger;
  private app: ObsidianApp;
  private settings: ExocortexSettings;
  private plugin: ExocortexPluginInterface;
  private metadataExtractor: MetadataExtractor;
  private reactRenderer: ReactRenderer;
  private refresh: () => Promise<void>;
  private metadataService: AssetMetadataService;
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
    metadataService: AssetMetadataService,
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
    this.metadataService = metadataService;
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
    const dailyNoteInfo = DailyNoteHelpers.extractDailyNoteInfo(
      file,
      this.metadataExtractor,
      this.logger,
    );

    if (!dailyNoteInfo.isDailyNote || !dailyNoteInfo.day) {
      return;
    }

    const day = dailyNoteInfo.day;

    // Try RDF-driven rendering first, fall back to legacy if unavailable
    let tasks: DailyTask[];
    let blockLabel = "Tasks"; // Default label

    if (this.isRdfDrivenAvailable()) {
      try {
        const result = await this.getDailyTasksRdfDriven(file, day);
        if (result) {
          tasks = result.tasks;
          blockLabel = result.label || blockLabel;
          this.logger.debug(`Using RDF-driven rendering for Daily Tasks: ${day}`);
        } else {
          tasks = await this.getDailyTasks(day);
          this.logger.debug(`RDF layout not found, using legacy for Daily Tasks: ${day}`);
        }
      } catch (error) {
        this.logger.warn(`RDF-driven rendering failed, falling back to legacy`, { error });
        tasks = await this.getDailyTasks(day);
      }
    } else {
      tasks = await this.getDailyTasks(day);
      this.logger.debug(`Using legacy rendering for Daily Tasks: ${day}`);
    }

    if (tasks.length === 0) {
      this.logger.debug(`No tasks found for day: ${day}`);
      return;
    }

    const sectionContainer = el.createDiv({
      cls: "exocortex-daily-tasks-section",
    });

    // Render collapsible header if function provided
    if (renderHeader) {
      renderHeader(sectionContainer, "daily-tasks", blockLabel);
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

    if (this.settings.activeFocusArea) {
      const indicatorContainer = contentContainer.createDiv({
        cls: "exocortex-active-focus-indicator",
      });
      indicatorContainer.style.cssText = `
        padding: 8px 12px;
        margin-bottom: 12px;
        background-color: var(--background-modifier-info);
        border-radius: 4px;
        font-size: 0.9em;
      `;
      indicatorContainer.createSpan({
        text: `🎯 Active Focus: ${this.settings.activeFocusArea}`,
      });
    }

    const tableContainer = contentContainer.createDiv({
      cls: "exocortex-daily-tasks-table-container",
    });

    this.reactRenderer.render(
      tableContainer,
      React.createElement(DailyTasksTableWithToggle, {
        tasks,
        showEffortArea: this.settings.showEffortArea,
        onToggleEffortArea: async () => {
          this.settings.showEffortArea = !this.settings.showEffortArea;
          await this.plugin.saveSettings();
          await this.refresh();
        },
        showEffortVotes: this.settings.showEffortVotes,
        onToggleEffortVotes: async () => {
          this.settings.showEffortVotes = !this.settings.showEffortVotes;
          await this.plugin.saveSettings();
          await this.refresh();
        },
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
        onTaskClick: async (path: string, event: React.MouseEvent) => {
          const isModPressed = Keymap.isModEvent(
            event.nativeEvent as MouseEvent,
          );

          if (isModPressed) {
            await this.app.workspace.openLinkText(path, "", "tab");
          } else {
            await this.app.workspace.openLinkText(path, "", false);
          }
        },
        getAssetLabel: (path: string) => this.metadataService.getAssetLabel(path),
        getEffortArea: (metadata: Record<string, unknown>) =>
          this.metadataService.getEffortArea(metadata),
      }),
    );

    this.logger.info(`Rendered ${tasks.length} tasks for DailyNote: ${day}`);
  }

  private async getDailyTasks(day: string): Promise<DailyTask[]> {
    try {
      const tasks: DailyTask[] = [];

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

        if (isProject) {
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
        const isDoing = effortStatusStr === EffortStatus.DOING;
        const isMeeting = instanceClassArray.some((c: string) =>
          String(c).includes(AssetClass.MEETING),
        );

        const label = metadata.exo__Asset_label || file.basename;

        const isBlocked = BlockerHelpers.isEffortBlocked(this.app, metadata);

        tasks.push({
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
          status: getStatusLabel(effortStatusStr),
          metadata,
          isDone,
          isTrashed,
          isDoing,
          isMeeting,
          isBlocked,
        });
      }

      let filteredTasks = tasks;

      if (this.settings.activeFocusArea) {
        const activeFocusArea = this.settings.activeFocusArea;
        const childAreas = this.getChildAreas(activeFocusArea);
        const relevantAreas = new Set([
          activeFocusArea,
          ...Array.from(childAreas),
        ]);

        filteredTasks = tasks.filter((task) => {
          const taskMetadata = task.metadata;

          const resolvedArea = this.metadataService.getEffortArea(taskMetadata);
          if (resolvedArea) {
            const resolvedAreaStr = String(resolvedArea).replace(
              /^\[\[|\]\]$/g,
              "",
            );
            if (relevantAreas.has(resolvedAreaStr)) {
              return true;
            }
          }

          return false;
        });
      }

      filteredTasks.sort((a, b) => EffortSortingHelpers.sortByStartTime(a, b));

      return filteredTasks;
    } catch (error) {
      this.logger.error("Failed to get daily tasks", { error });
      return [];
    }
  }

  private getChildAreas(
    areaName: string,
    visited: Set<string> = new Set(),
  ): Set<string> {
    const childAreas = new Set<string>();

    if (visited.has(areaName)) {
      return childAreas;
    }
    visited.add(areaName);

    const allFiles = this.vaultAdapter.getAllFiles();

    for (const file of allFiles) {
      const metadata = this.metadataExtractor.extractMetadata(file);

      const areaParent = metadata.ems__Area_parent;
      if (!areaParent) continue;

      const areaParentStr = String(areaParent).replace(/^\[\[|\]\]$/g, "");

      if (areaParentStr === areaName) {
        childAreas.add(file.basename);

        const nestedChildren = this.getChildAreas(file.basename, visited);
        nestedChildren.forEach((child) => childAreas.add(child));
      }
    }

    return childAreas;
  }

  /**
   * RDF-driven task fetching using SPARQL queries from LayoutSelector.
   * Returns null if RDF layout is not available for this asset.
   *
   * Handles {day} placeholder replacement in SPARQL queries.
   */
  private async getDailyTasksRdfDriven(
    file: TFile,
    day: string,
  ): Promise<{ tasks: DailyTask[]; label?: string } | null> {
    if (!this.layoutSelector || !this.sparqlQueryService) {
      return null;
    }

    const assetUri = this.buildAssetUri(file);

    // Get layout from RDF
    const layout = await this.layoutSelector.selectLayout(assetUri);
    if (!layout) {
      return null;
    }

    // Find the daily-tasks-table block
    const dailyTasksBlock = layout.blocks.find(
      block => block.renderer === "daily-tasks-table"
    );
    if (!dailyTasksBlock) {
      // No daily-tasks-table block in this layout, use legacy
      return null;
    }

    // If there's no query in the block, fall back to legacy
    if (!dailyTasksBlock.query) {
      return {
        tasks: await this.getDailyTasks(day),
        label: this.getBlockLabel(),
      };
    }

    // Replace {day} placeholder in the SPARQL query
    // Note: For now, we still use the legacy data fetching as the data source
    // The SPARQL query will be used in future iterations when the triple store
    // contains the full asset graph
    //
    // TODO: Replace with actual SPARQL execution when triple store is populated
    // const query = dailyTasksBlock.query.replace(/\{day\}/g, day);
    // const results = await this.sparqlQueryService.query(query);
    // const tasks = this.buildTasksFromSparqlResults(results);

    // For Phase 1: Use block metadata but legacy data fetching
    return {
      tasks: await this.getDailyTasks(day),
      label: this.getBlockLabel(),
    };
  }

  /**
   * Get the display label for a layout block.
   * Falls back to default "Tasks" if not specified in RDF.
   */
  private getBlockLabel(): string {
    // The block doesn't have a direct label property in the current interface
    // The label comes from rdfs:label on the block in RDF
    // For now, return a default - this can be extended when LayoutBlock interface
    // includes label property
    return "Tasks";
  }
}
