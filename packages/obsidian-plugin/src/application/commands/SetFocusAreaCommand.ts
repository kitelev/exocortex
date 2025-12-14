import { App, Notice } from "obsidian";
import { container } from "tsyringe";
import { ICommand } from "./ICommand";
import { ExocortexPluginInterface } from '@plugin/types';
import {
  AreaSelectionModal,
  AreaSelectionModalResult,
} from '@plugin/presentation/modals/AreaSelectionModal';
import { SessionEventService } from "exocortex";
import { LoggerFactory } from '@plugin/adapters/logging/LoggerFactory';

export class SetFocusAreaCommand implements ICommand {
  id = "set-focus-area";
  name = "Set Focus Area";
  private sessionEventService: SessionEventService;
  private readonly logger = LoggerFactory.create("SetFocusAreaCommand");

  constructor(
    private app: App,
    private plugin: ExocortexPluginInterface,
  ) {
    this.sessionEventService = container.resolve(SessionEventService);
    this.sessionEventService.setDefaultOntologyAsset(
      (this.plugin.settings?.defaultOntologyAsset as string | null) ?? null,
    );
  }

  callback = async (): Promise<void> => {
    const modal = new AreaSelectionModal(
      this.app,
      async (result: AreaSelectionModalResult) => {
        await this.handleAreaSelection(result);
      },
      this.plugin.settings.activeFocusArea || null,
    );

    modal.open();
  };

  private async handleAreaSelection(
    result: AreaSelectionModalResult,
  ): Promise<void> {
    const previousArea = this.plugin.settings.activeFocusArea;
    const newArea = result.selectedArea;

    try {
      // Case 1: Switching from one area to another
      if (previousArea && newArea && previousArea !== newArea) {
        await this.sessionEventService.createSessionEndEvent(previousArea);
        await this.sessionEventService.createSessionStartEvent(newArea);
      }
      // Case 2: Activating focus (null → area)
      else if (!previousArea && newArea) {
        await this.sessionEventService.createSessionStartEvent(newArea);
      }
      // Case 3: Deactivating focus (area → null)
      else if (previousArea && !newArea) {
        await this.sessionEventService.createSessionEndEvent(previousArea);
      }
      // Case 4: No change (null → null or same area) - no events created

      this.plugin.settings.activeFocusArea = newArea;

      await this.plugin.saveSettings();
      this.plugin.refreshLayout?.();

      if (newArea) {
        new Notice(`Focus area set to: ${newArea}`);
      } else {
        if (previousArea) {
          new Notice("Focus area cleared - showing all efforts");
        } else {
          new Notice("No focus area selected");
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      new Notice(
        `Failed to ${previousArea && newArea ? "switch" : newArea ? "activate" : "deactivate"} focus area. ${errorMessage}`,
      );
      this.logger.error("Session event creation failed", error instanceof Error ? error : new Error(String(error)));
    }
  }
}
