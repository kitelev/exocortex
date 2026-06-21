import { ICommand } from "./ICommand";
import { ExocortexPluginInterface } from '@plugin/types';
import type { INotificationService } from "@kitelev/exocortex-core";

export class ToggleLayoutVisibilityCommand implements ICommand {
  id = "toggle-layout-visibility";
  name = "Toggle layout visibility";

  constructor(
    private plugin: ExocortexPluginInterface,
    private notifier: INotificationService,
  ) {}

  callback = async (): Promise<void> => {
    this.plugin.settings.layoutVisible = !this.plugin.settings.layoutVisible;
    await this.plugin.saveSettings();
    this.plugin.refreshLayout?.();
    this.notifier.info(`Layout ${this.plugin.settings.layoutVisible ? "shown" : "hidden"}`);
  };
}
