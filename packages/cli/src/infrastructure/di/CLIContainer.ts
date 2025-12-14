import "reflect-metadata";
import { container } from "tsyringe";
import { DI_TOKENS } from "exocortex";
import { NodeLogger } from "./NodeLogger";
import { NodeEventBus } from "./NodeEventBus";
import { NodeConfiguration } from "./NodeConfiguration";
import { NodeNotificationService } from "./NodeNotificationService";

export class CLIContainer {
  static setup(): void {
    container.register(DI_TOKENS.ILogger, {
      useFactory: () => new NodeLogger("exocortex-cli"),
    });

    container.register(DI_TOKENS.IEventBus, {
      useClass: NodeEventBus,
    });

    container.register(DI_TOKENS.IConfiguration, {
      useClass: NodeConfiguration,
    });

    container.register(DI_TOKENS.INotificationService, {
      useClass: NodeNotificationService,
    });
  }

  static reset(): void {
    container.clearInstances();
  }
}
