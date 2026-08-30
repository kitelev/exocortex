import { TFile, Keymap } from "obsidian";
import { ILogger } from '@plugin/adapters/logging/ILogger';
import { ExocortexSettings } from '@plugin/domain/settings/ExocortexSettings';
import React from "react";
import { ReactRenderer } from '@plugin/presentation/utils/ReactRenderer';
import {
  DailyTask,
  DailyTasksTableWithToggle,
  isDateOnlyTimestamp,
} from '@plugin/presentation/components/DailyTasksTable';
import { AssetClass, IVaultAdapter, IFile } from "@kitelev/exocortex-core";
import { MetadataExtractor } from "@kitelev/exocortex-core";
import { EffortSortingHelpers } from "@kitelev/exocortex-core";
import { AssetMetadataService } from "./layout/helpers/AssetMetadataService";
import { DailyNoteHelpers } from "./helpers/DailyNoteHelpers";
import { BlockerHelpers } from '@plugin/presentation/utils/BlockerHelpers';
import { getStatusLabel } from '@plugin/domain/property-editor/PropertySchemas';
import { DisplayNameResolver } from '@plugin/domain/display-name/DisplayNameResolver';
import { DEFAULT_DISPLAY_NAME_SETTINGS } from '@plugin/domain/settings/ExocortexSettings';
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
        showTimeEstimate: this.settings.showTimeEstimate,
        onToggleTimeEstimate: async () => {
          this.settings.showTimeEstimate = !this.settings.showTimeEstimate;
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

  /**
   * Build a DisplayNameResolver the SAME way the native-link patches do (BodyLinkPatch,
   * InlineTitlePatch, …), so a task's DailyNote-table label is produced by the homoiconic
   * exo__DisplayNameSpec system — the status/class prefix (🔄/✅/❌/👥) comes from vault
   * data, not a hardcoded emoji map. Degrades to a label-only resolver when the plugin's
   * printNameRuleService / displayNameSettings are unavailable (e.g. unit-test mocks).
   */
  private createDisplayNameResolver(): DisplayNameResolver {
    const ruleService = this.plugin.printNameRuleService ?? null;
    const settings =
      this.plugin.settings?.displayNameSettings ?? DEFAULT_DISPLAY_NAME_SETTINGS;
    const metadataResolver = ruleService?.createMetadataResolver() ?? null;
    return new DisplayNameResolver(settings, ruleService, metadataResolver);
  }

  private async getDailyTasks(day: string): Promise<DailyTask[]> {
    try {
      const tasks: DailyTask[] = [];

      const allFiles = this.vaultAdapter.getAllFiles();

      // One resolver per render — carries the compiled vault exo__DisplayNameSpec rules.
      const displayNameResolver = this.createDisplayNameResolver();

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
          // Date-only strings ("2025-11-10") have no time component; deriving
          // hours from `new Date(...)` would expose the viewer's timezone offset
          // (Issue #2766 item 6 — would render as "05:00" in Asia/Almaty).
          if (isDateOnlyTimestamp(timestamp)) return "";
          const date = new Date(timestamp);
          if (isNaN(date.getTime())) return "";
          return date.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          });
        };

        const startTime =
          formatTime(startTimestamp as string | number | null | undefined) || formatTime(plannedStartTimestamp as string | number | null | undefined);
        const endTime =
          formatTime(endTimestamp as string | number | null | undefined) || formatTime(plannedEndTimestamp as string | number | null | undefined);

        // Dual-IRI-robust status label (normalizes [[uid]] / [[uid|label]] / label+UUID forms).
        // isDoing feeds the NON-display sort that lifts Doing tasks to the top — derived from
        // this normalized label, NEVER a naive strict-equality against the label-form enum (the
        // bug that silently dropped 🔄 for UID-canon statuses). The status/class emoji prefixes
        // are no longer derived here — they come from the homoiconic resolver (displayName below).
        const statusLabel = getStatusLabel(effortStatusStr);
        const isDoing = statusLabel === "Doing";

        const label = (metadata.exo__Asset_label as string) || file.basename;

        const isBlocked = BlockerHelpers.isEffortBlocked(this.app, metadata);

        // Resolve prototype classes for overlap detection (Issue #2131)
        // If task has a prototype, look up the prototype's classes
        const prototypeClasses = this.resolvePrototypeClasses(metadata, allFiles);
        const enrichedMetadata = prototypeClasses
          ? { ...metadata, _prototypeClasses: prototypeClasses }
          : metadata;

        // Homoiconic display name: resolve the task through the vault exo__DisplayNameSpec
        // system (same stack as native links). Default exo__Asset_label to the basename so a
        // labelless task keeps the old basename fallback inside the resolved prefix. Falls back
        // to `label` when the resolver produces nothing (e.g. no printNameRuleService in tests).
        const displayName =
          displayNameResolver.resolve({
            metadata: { ...enrichedMetadata, exo__Asset_label: label },
            basename: file.basename,
          }) ?? undefined;

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
          startTimestamp: (startTimestamp || plannedStartTimestamp || null) as string | number | null,
          endTimestamp: (endTimestamp || plannedEndTimestamp || null) as string | number | null,
          status: statusLabel,
          metadata: enrichedMetadata,
          displayName,
          isDoing,
          isBlocked,
        });
      }

      tasks.sort((a, b) => EffortSortingHelpers.sortByStartTime(a, b));

      return tasks;
    } catch (error) {
      this.logger.error("Failed to get daily tasks", { error });
      return [];
    }
  }

  /**
   * Extract target UID from wikilink format.
   * Handles: "[[uid|alias]]", "[[uid]]", "uid"
   */
  private extractWikilinkTarget(value: string): string | null {
    if (!value) return null;

    // Match [[target|alias]] or [[target]]
    const wikilinkMatch = value.match(/\[\[([^\]|]+)/);
    if (wikilinkMatch) {
      return wikilinkMatch[1].trim();
    }

    // Already a plain string (UID)
    return value.trim();
  }

  /**
   * Resolve prototype's classes for a task with exo__Asset_prototype.
   * Returns the prototype's exo__Instance_class if found, null otherwise.
   *
   * @param metadata - Task's metadata containing potential exo__Asset_prototype
   * @param allFiles - All files in vault for prototype lookup
   * @returns Prototype's classes or null if not found
   */
  private resolvePrototypeClasses(
    metadata: Record<string, unknown>,
    allFiles: IFile[],
  ): unknown {
    // Scalar OR single-item YAML list — both shapes exist in production vaults.
    const rawPrototype = metadata.exo__Asset_prototype;
    const prototypeRef = Array.isArray(rawPrototype)
      ? rawPrototype[0]
      : rawPrototype;
    if (!prototypeRef || typeof prototypeRef !== 'string') {
      return null;
    }

    const prototypeTarget = this.extractWikilinkTarget(prototypeRef);
    if (!prototypeTarget) {
      return null;
    }

    // Find prototype file by basename or path
    const prototypeFile = allFiles.find(
      (f) => f.basename === prototypeTarget || f.path === prototypeTarget || f.path.includes(prototypeTarget)
    );

    if (!prototypeFile) {
      return null;
    }

    const prototypeMetadata = this.metadataExtractor.extractMetadata(prototypeFile);
    return prototypeMetadata.exo__Instance_class || null;
  }
}
