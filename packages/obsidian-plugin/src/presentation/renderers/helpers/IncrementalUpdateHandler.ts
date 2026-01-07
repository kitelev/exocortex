import React from "react";
import { TFile } from "obsidian";
import { MetadataExtractor } from "exocortex";
import { EventListenerManager } from '@plugin/adapters/events/EventListenerManager';
import { BacklinksCacheManager } from '@plugin/adapters/caching/BacklinksCacheManager';
import { ReactRenderer } from '@plugin/presentation/utils/ReactRenderer';
import { ActionButtonsGroup } from '@plugin/presentation/components/ActionButtonsGroup';
import { RdfButtonGroupsBuilder } from '@plugin/presentation/builders/RdfButtonGroupsBuilder';
import { DailyTasksRenderer } from '@plugin/presentation/renderers/DailyTasksRenderer';
import { DailyProjectsRenderer } from '@plugin/presentation/renderers/DailyProjectsRenderer';
import { PropertiesRenderer } from '@plugin/presentation/renderers/layout/PropertiesRenderer';
import { AreaTreeRenderer } from '@plugin/presentation/renderers/layout/AreaTreeRenderer';
import { RelationsRenderer, UniversalLayoutConfig } from '@plugin/presentation/renderers/layout/RelationsRenderer';
import { LayoutSection } from '@plugin/application/services/PropertyDependencyResolver';
import { SectionStateManager } from "./SectionStateManager";

type RenderHeaderFn = (container: HTMLElement, sectionId: string, title: string) => void;

interface RendererDependencies {
  propertiesRenderer: PropertiesRenderer;
  rdfButtonGroupsBuilder?: RdfButtonGroupsBuilder;
  dailyTasksRenderer: DailyTasksRenderer;
  dailyProjectsRenderer: DailyProjectsRenderer;
  areaTreeRenderer: AreaTreeRenderer;
  relationsRenderer: RelationsRenderer;
  reactRenderer: ReactRenderer;
  backlinksCacheManager: BacklinksCacheManager;
  sectionStateManager: SectionStateManager;
  eventListenerManager: EventListenerManager;
  metadataExtractor: MetadataExtractor;
}

/**
 * Update request data for the queue
 */
interface UpdateRequest {
  rootContainer: HTMLElement;
  file: TFile;
  sections: LayoutSection[];
  config: UniversalLayoutConfig;
  version: number;
}

/**
 * Handles incremental updates to layout sections with race condition protection.
 *
 * Key features:
 * - Queue mechanism ensures updates are processed sequentially
 * - Version tracking skips obsolete updates when newer ones are pending
 * - Prevents DOM corruption from concurrent modifications
 */
export class IncrementalUpdateHandler {
  private static readonly SECTION_SELECTORS: Record<LayoutSection, string> = {
    [LayoutSection.PROPERTIES]: ".exocortex-properties-section",
    [LayoutSection.BUTTONS]: ".exocortex-buttons-section",
    [LayoutSection.DAILY_TASKS]: ".exocortex-daily-tasks-section",
    [LayoutSection.DAILY_PROJECTS]: ".exocortex-daily-projects-section",
    [LayoutSection.AREA_TREE]: ".exocortex-area-tree-section",
    [LayoutSection.RELATIONS]: ".exocortex-assets-relations",
  };

  /** Promise chain for sequential update processing */
  private updateQueue: Promise<void> = Promise.resolve();

  /** Current update version counter for obsolete update detection */
  private currentVersion = 0;

  constructor(private deps: RendererDependencies) {}

  /**
   * Queue an update for the specified sections.
   *
   * Updates are processed sequentially to prevent race conditions.
   * If a newer update is queued while this one is waiting, this update
   * will be skipped to avoid unnecessary DOM operations.
   *
   * @param rootContainer - The root container element for all sections
   * @param file - The file being rendered
   * @param sections - Array of sections to update
   * @param config - Layout configuration
   * @returns Promise that resolves when this update completes (or is skipped)
   */
  async updateSections(
    rootContainer: HTMLElement,
    file: TFile,
    sections: LayoutSection[],
    config: UniversalLayoutConfig,
  ): Promise<void> {
    const version = ++this.currentVersion;

    const request: UpdateRequest = {
      rootContainer,
      file,
      sections,
      config,
      version,
    };

    this.updateQueue = this.updateQueue.then(async () => {
      // Skip this update if a newer one has been queued
      if (version < this.currentVersion) {
        return;
      }

      await this.performUpdate(request);
    });

    return this.updateQueue;
  }

  /**
   * Perform the actual DOM update for the given request.
   * This method is only called from within the queue processor.
   */
  private async performUpdate(request: UpdateRequest): Promise<void> {
    const { rootContainer, file, sections, config, version } = request;
    const renderHeader = this.createRenderHeader();

    for (const section of sections) {
      // Check version before each section update to allow early exit
      if (version < this.currentVersion) {
        return;
      }
      await this.updateSection(rootContainer, file, section, config, renderHeader);
    }
  }

  /**
   * Get the current version number.
   * Useful for testing and debugging.
   */
  getCurrentVersion(): number {
    return this.currentVersion;
  }

  /**
   * Check if there are pending updates in the queue.
   * Returns true if the queue has unprocessed updates.
   */
  hasPendingUpdates(): boolean {
    // Check if queue promise is not yet resolved
    let pending = true;
    this.updateQueue.then(() => { pending = false; });
    return pending;
  }

  private createRenderHeader(): RenderHeaderFn {
    return (container: HTMLElement, sectionId: string, title: string) =>
      this.deps.sectionStateManager.renderHeader(
        container, sectionId, title, this.deps.eventListenerManager);
  }

  private async updateSection(
    rootContainer: HTMLElement,
    file: TFile,
    section: LayoutSection,
    config: UniversalLayoutConfig,
    renderHeader: RenderHeaderFn,
  ): Promise<void> {
    const selector = IncrementalUpdateHandler.SECTION_SELECTORS[section];
    const containerElement = rootContainer.querySelector(selector);
    if (!(containerElement instanceof HTMLElement)) return;
    const container = containerElement;

    switch (section) {
      case LayoutSection.PROPERTIES:
        await this.updateProperties(rootContainer, container, file, renderHeader);
        break;
      case LayoutSection.BUTTONS:
        await this.updateButtons(rootContainer, container, file);
        break;
      case LayoutSection.DAILY_TASKS:
      case LayoutSection.DAILY_PROJECTS:
      case LayoutSection.AREA_TREE:
      case LayoutSection.RELATIONS:
        await this.updateRelationSection(rootContainer, container, file, section, config, renderHeader);
        break;
    }
  }

  private async updateProperties(
    rootContainer: HTMLElement,
    container: HTMLElement,
    file: TFile,
    renderHeader: RenderHeaderFn,
  ): Promise<void> {
    container.empty();
    const backlinks = this.deps.backlinksCacheManager.getBacklinks(file.path);
    await this.deps.propertiesRenderer.render(
      container.parentElement || rootContainer,
      file,
      { hideAliases: backlinks && backlinks.size > 0 },
      renderHeader,
      this.deps.sectionStateManager.isCollapsed("properties"),
    );
  }

  private async updateButtons(
    rootContainer: HTMLElement,
    container: HTMLElement,
    file: TFile,
  ): Promise<void> {
    container.remove();

    if (!this.deps.rdfButtonGroupsBuilder) {
      return;
    }

    const assetUri = this.buildAssetUri(file);
    const buttonGroups = await this.deps.rdfButtonGroupsBuilder.buildButtonGroups(assetUri);

    if (buttonGroups.length > 0) {
      const buttonsContainer = rootContainer.createDiv({ cls: "exocortex-buttons-section" });
      this.deps.reactRenderer.render(
        buttonsContainer,
        React.createElement(ActionButtonsGroup, { groups: buttonGroups }),
      );
    }
  }

  /**
   * Build asset URI from file path.
   * Uses the file's UID if available, otherwise the file path.
   */
  private buildAssetUri(file: TFile): string {
    const metadata = this.deps.metadataExtractor.extractMetadata(file);
    const uid = metadata?.exo__Asset_uid as string;

    if (uid) {
      return `https://exocortex.my/assets/${uid}`;
    }

    // Fall back to file path
    return `file://${file.path}`;
  }

  private async updateRelationSection(
    rootContainer: HTMLElement,
    container: HTMLElement,
    file: TFile,
    section: LayoutSection,
    config: UniversalLayoutConfig,
    renderHeader: RenderHeaderFn,
  ): Promise<void> {
    container.empty();
    const relations = await this.deps.relationsRenderer.getAssetRelations(file, config);
    const parent = container.parentElement || rootContainer;
    const { sectionStateManager: ssm } = this.deps;

    switch (section) {
      case LayoutSection.DAILY_TASKS:
        await this.deps.dailyTasksRenderer.render(
          parent, file, renderHeader, ssm.isCollapsed("daily-tasks"));
        break;
      case LayoutSection.DAILY_PROJECTS:
        await this.deps.dailyProjectsRenderer.render(
          parent, file, renderHeader, ssm.isCollapsed("daily-projects"));
        break;
      case LayoutSection.AREA_TREE:
        await this.deps.areaTreeRenderer.render(
          parent, file, relations, renderHeader, ssm.isCollapsed("area-tree"));
        break;
      case LayoutSection.RELATIONS:
        await this.deps.relationsRenderer.render(
          parent, relations, config, renderHeader, ssm.isCollapsed("relations"));
        break;
    }
  }
}
