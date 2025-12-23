import { TFile, Keymap } from "obsidian";
import React from "react";
import { ReactRenderer } from '@plugin/presentation/utils/ReactRenderer';
import { MetadataExtractor, AssetClass, AreaHierarchyBuilder, IVaultAdapter } from "exocortex";
import { AreaHierarchyTreeWithToggle, type AreaClickEvent } from '@plugin/presentation/components/AreaHierarchyTree';
import { AssetMetadataService } from "./helpers/AssetMetadataService";
import { AssetRelation } from "./types";
import { ILogger } from '@plugin/adapters/logging/ILogger';
import { ObsidianApp } from '@plugin/types';

export class AreaTreeRenderer {
  constructor(
    private app: ObsidianApp,
    private reactRenderer: ReactRenderer,
    private metadataExtractor: MetadataExtractor,
    private vaultAdapter: IVaultAdapter,
    private metadataService: AssetMetadataService,
    private logger: ILogger,
  ) {}

  async render(
    el: HTMLElement,
    file: TFile,
    relations: AssetRelation[],
    renderHeader?: (container: HTMLElement, sectionId: string, title: string) => void,
    isCollapsed?: boolean,
  ): Promise<void> {
    const metadata = this.metadataExtractor.extractMetadata(file);
    const instanceClass = this.metadataService.extractInstanceClass(metadata);

    if (instanceClass !== AssetClass.AREA) {
      return;
    }

    const hierarchyBuilder = new AreaHierarchyBuilder(this.vaultAdapter);
    const tree = hierarchyBuilder.buildHierarchy(file.path, relations);

    if (!tree) {
      return;
    }

    const sectionContainer = el.createDiv({
      cls: "exocortex-area-tree-section",
    });

    // Render collapsible header if function provided
    if (renderHeader) {
      renderHeader(sectionContainer, "area-tree", "Area tree");
    } else {
      sectionContainer.createEl("h3", {
        text: "Area tree",
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

    const treeContainer = contentContainer.createDiv({
      cls: "exocortex-area-tree-container",
    });

    this.reactRenderer.render(
      treeContainer,
      React.createElement(AreaHierarchyTreeWithToggle, {
        tree,
        currentAreaPath: file.path,
        onAreaClick: async (path: string, event: AreaClickEvent) => {
          // Check for modifier key press - works for both mouse and keyboard events
          const nativeEvent = event.nativeEvent as MouseEvent | KeyboardEvent;
          const isModPressed = Keymap.isModEvent(nativeEvent);

          if (isModPressed) {
            await this.app.workspace.openLinkText(path, "", "tab");
          } else {
            await this.app.workspace.openLinkText(path, "", false);
          }
        },
        getAssetLabel: (path: string) => this.metadataService.getAssetLabel(path),
      }),
    );

    this.logger.info(`Rendered Area Tree for ${file.path}`);
  }
}
