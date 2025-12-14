import { TFile, Keymap } from "obsidian";
import React from "react";
import { ReactRenderer } from '@plugin/presentation/utils/ReactRenderer';
import { MetadataExtractor } from "exocortex";
import { AssetPropertiesTable } from '@plugin/presentation/components/AssetPropertiesTable';
import { AssetMetadataService } from "./helpers/AssetMetadataService";
import { PropertyUpdateService } from '@plugin/application/services/PropertyUpdateService';
import { ObsidianApp } from '@plugin/types';

export interface PropertiesRendererOptions {
  /**
   * If true, the aliases property will be filtered out from the displayed metadata.
   * Useful when Relations block is present to avoid redundant information.
   */
  hideAliases?: boolean;
  /**
   * If true, properties will be editable inline.
   */
  editable?: boolean;
}

export class PropertiesRenderer {
  private propertyUpdateService: PropertyUpdateService;

  constructor(
    private app: ObsidianApp,
    private reactRenderer: ReactRenderer,
    private metadataExtractor: MetadataExtractor,
    private metadataService: AssetMetadataService,
  ) {
    this.propertyUpdateService = new PropertyUpdateService(app);
  }

  async render(
    el: HTMLElement,
    file: TFile,
    options?: PropertiesRendererOptions,
    renderHeader?: (container: HTMLElement, sectionId: string, title: string) => void,
    isCollapsed?: boolean,
  ): Promise<void> {
    const metadata = this.metadataExtractor.extractMetadata(file);

    if (Object.keys(metadata).length === 0) {
      return;
    }

    // Filter out aliases if requested (when Relations block is present)
    const filteredMetadata = options?.hideAliases
      ? Object.fromEntries(
          Object.entries(metadata).filter(([key]) => key !== "aliases"),
        )
      : metadata;

    const container = el.createDiv({ cls: "exocortex-properties-section" });

    // Render collapsible header if function provided
    if (renderHeader) {
      renderHeader(container, "properties", "Properties");
    }

    // Create content container
    const contentContainer = container.createDiv({
      cls: "exocortex-section-content",
      attr: {
        "data-collapsed": (isCollapsed || false).toString(),
      },
    });

    // Only render content if not collapsed
    if (!isCollapsed) {
      this.reactRenderer.render(
        contentContainer,
        React.createElement(AssetPropertiesTable, {
          metadata: filteredMetadata,
          onLinkClick: async (path: string, event: React.MouseEvent) => {
            const isModPressed = Keymap.isModEvent(
              event.nativeEvent as MouseEvent,
            );

            if (isModPressed) {
              await this.app.workspace.openLinkText(path, "", "tab");
            } else {
              await this.app.workspace.openLinkText(path, "", false);
            }
          },
          getAssetLabel: (path: string) =>
            this.metadataService.getAssetLabel(path),
          file: file,
          propertyUpdateService: this.propertyUpdateService,
          editable: options?.editable ?? true,
        }),
      );
    }
  }
}
