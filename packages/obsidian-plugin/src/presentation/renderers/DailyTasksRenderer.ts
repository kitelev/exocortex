import { TFile, Keymap } from "obsidian";
import { ILogger } from '@plugin/adapters/logging/ILogger';
import { ExocortexSettings } from '@plugin/domain/settings/ExocortexSettings';
import React from "react";
import { ReactRenderer } from '@plugin/presentation/utils/ReactRenderer';
import {
  DailyTask,
  DailyTasksTableWithToggle,
} from '@plugin/presentation/components/DailyTasksTable';
import { AssetClass, EffortStatus, IVaultAdapter } from "exocortex";
import { MetadataExtractor } from "exocortex";
import { EffortSortingHelpers } from "exocortex";
import { AssetMetadataService } from "./layout/helpers/AssetMetadataService";
import { DailyNoteHelpers } from "./helpers/DailyNoteHelpers";
import { BlockerHelpers } from '@plugin/presentation/utils/BlockerHelpers';
import { getStatusLabel } from '@plugin/domain/property-editor/PropertySchemas';
import { ObsidianApp, ExocortexPluginInterface } from '@plugin/types';

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
    const tasks = await this.getDailyTasks(day);

    if (tasks.length === 0) {
      this.logger.debug(`No tasks found for day: ${day}`);
      return;
    }

    const sectionContainer = el.createDiv({
      cls: "exocortex-daily-tasks-section",
    });

    // Render collapsible header if function provided
    if (renderHeader) {
      renderHeader(sectionContainer, "daily-tasks", "Tasks");
    } else {
      sectionContainer.createEl("h3", {
        text: "Tasks",
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
}
