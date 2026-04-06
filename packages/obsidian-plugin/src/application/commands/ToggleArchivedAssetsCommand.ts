import { ICommand } from "./ICommand";
import { ExocortexPluginInterface } from '@plugin/types';
import type { INotificationService } from "exocortex";

export class ToggleArchivedAssetsCommand implements ICommand {
  id = "toggle-archived-assets-visibility";
  name = "Toggle archived assets visibility";

  constructor(
    private plugin: ExocortexPluginInterface,
    private notifier: INotificationService,
  ) {}

  callback = async (): Promise<void> => {
    this.plugin.settings.showArchivedAssets = !this.plugin.settings.showArchivedAssets;
    await this.plugin.saveSettings();
    this.plugin.refreshLayout?.();
    this.notifier.info(
      `Archived assets ${this.plugin.settings.showArchivedAssets ? "shown" : "hidden"}`,
    );
  };
}
