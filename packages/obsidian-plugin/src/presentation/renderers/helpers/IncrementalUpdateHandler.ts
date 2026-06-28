import React from "react";
import { TFile } from "obsidian";
import { EventListenerManager } from '@plugin/adapters/events/EventListenerManager';
import { BacklinksCacheManager } from '@plugin/adapters/caching/BacklinksCacheManager';
import { ReactRenderer } from '@plugin/presentation/utils/ReactRenderer';
import { ActionButtonsGroup } from '@plugin/presentation/components/ActionButtonsGroup';
import { ButtonGroupsBuilder } from '@plugin/presentation/builders/ButtonGroupsBuilder';
import { DailyTasksRenderer } from '@plugin/presentation/renderers/DailyTasksRenderer';
import { AreaTreeRenderer } from '@plugin/presentation/renderers/layout/AreaTreeRenderer';
import { RelationsRenderer, UniversalLayoutConfig } from '@plugin/presentation/renderers/layout/RelationsRenderer';
import { LayoutSection } from '@plugin/application/services/PropertyDependencyResolver';
import { SectionStateManager } from "./SectionStateManager";

type RenderHeaderFn = (container: HTMLElement, sectionId: string, title: string) => void;

interface RendererDependencies {
  buttonGroupsBuilder: ButtonGroupsBuilder;
  dailyTasksRenderer: DailyTasksRenderer;
  areaTreeRenderer: AreaTreeRenderer;
  relationsRenderer: RelationsRenderer;
  reactRenderer: ReactRenderer;
  backlinksCacheManager: BacklinksCacheManager;
  sectionStateManager: SectionStateManager;
  eventListenerManager: EventListenerManager;
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
  private static readonly SECTION_SELECTORS: Partial<Record<LayoutSection, string>> = {
    [LayoutSection.BUTTONS]: ".exocortex-buttons-section",
    [LayoutSection.DAILY_TASKS]: ".exocortex-daily-tasks-section",
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
    if (!selector) return;
    const containerElement = rootContainer.querySelector(selector);
    if (!(containerElement instanceof HTMLElement)) return;
    const container = containerElement;

    switch (section) {
      case LayoutSection.BUTTONS:
        await this.updateButtons(rootContainer, container, file);
        break;
      case LayoutSection.DAILY_TASKS:
      case LayoutSection.AREA_TREE:
      case LayoutSection.RELATIONS:
        await this.updateRelationSection(rootContainer, container, file, section, config, renderHeader);
        break;
    }
  }

  private async updateButtons(
    rootContainer: HTMLElement,
    container: HTMLElement,
    file: TFile,
  ): Promise<void> {
    container.remove();
    const buttonGroups = await this.deps.buttonGroupsBuilder.build(file);
    if (buttonGroups.length > 0) {
      const buttonsContainer = rootContainer.createDiv({ cls: "exocortex-buttons-section" });
      this.deps.reactRenderer.render(
        buttonsContainer,
        React.createElement(ActionButtonsGroup, { groups: buttonGroups }),
      );
    }
  }

  private async updateRelationSection(
    rootContainer: HTMLElement,
    container: HTMLElement,
    file: TFile,
    section: LayoutSection,
    config: UniversalLayoutConfig,
    renderHeader: RenderHeaderFn,
  ): Promise<void> {
    const parent = container.parentElement || rootContainer;
    // RELATIONS now always renders a fresh `.exocortex-assets-relations`
    // container into `parent` — including the F11 empty-state. Emptying the old
    // container (instead of removing it) would leave an orphan sibling that
    // accumulates a duplicate "No related assets yet" block on every empty
    // incremental re-render. Remove it (like `updateButtons`) so exactly one
    // relations container survives. DAILY_TASKS / AREA_TREE keep emptying —
    // their renderers may legitimately no-op on an irrelevant asset, and their
    // queue/concurrency semantics depend on the container staying attached.
    if (section === LayoutSection.RELATIONS) {
      container.remove();
    } else {
      container.empty();
    }
    const relations = await this.deps.relationsRenderer.getAssetRelations(file, config);
    const { sectionStateManager: ssm } = this.deps;

    switch (section) {
      case LayoutSection.DAILY_TASKS:
        await this.deps.dailyTasksRenderer.render(
          parent, file, renderHeader, ssm.isCollapsed("daily-tasks"));
        break;
      case LayoutSection.AREA_TREE:
        await this.deps.areaTreeRenderer.render(
          parent, file, relations, renderHeader, ssm.isCollapsed("area-tree"));
        break;
      case LayoutSection.RELATIONS:
        await this.deps.relationsRenderer.render(
          parent, relations, config, renderHeader, ssm.isCollapsed("relations"), file);
        break;
    }
  }
}
