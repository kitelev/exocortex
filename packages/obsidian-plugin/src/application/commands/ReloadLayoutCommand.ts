import { ICommand } from "./ICommand";
import type { INotificationService } from "exocortex";

export class ReloadLayoutCommand implements ICommand {
  id = "reload-layout";
  name = "Reload layout";

  constructor(
    private reloadLayoutCallback: (() => void) | undefined,
    private notifier: INotificationService,
  ) {}

  callback = (): void => {
    if (this.reloadLayoutCallback) {
      this.reloadLayoutCallback();
      this.notifier.success("Layout reloaded");
    } else {
      this.notifier.error("Failed to reload layout");
    }
  };
}
