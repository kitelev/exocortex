import "reflect-metadata";
import { container } from "tsyringe";
import { App, Plugin } from "obsidian";
import {
  DI_TOKENS,
  registerCoreServices,
} from "@kitelev/exocortex-core";
import { ObsidianLogger } from "@plugin/infrastructure/di/ObsidianLogger";
import { ObsidianEventBus } from "@plugin/infrastructure/di/ObsidianEventBus";
import { ObsidianConfiguration } from "@plugin/infrastructure/di/ObsidianConfiguration";
import { ObsidianNotificationService } from "@plugin/infrastructure/di/ObsidianNotificationService";
import { ObsidianVaultAdapter } from '@plugin/adapters/ObsidianVaultAdapter';
import { SingleVaultContext } from '@plugin/infrastructure/vault/SingleVaultContext';
import { SingleVaultManager } from '@plugin/infrastructure/vault/SingleVaultManager';

export class PluginContainer {
  static setup(app: App, plugin: Plugin): void {
    container.register(DI_TOKENS.ILogger, {
      useFactory: () => new ObsidianLogger(plugin),
    });

    container.register(DI_TOKENS.IEventBus, {
      useClass: ObsidianEventBus,
    });

    container.register(DI_TOKENS.IConfiguration, {
      useFactory: () => new ObsidianConfiguration(plugin),
    });

    container.register(DI_TOKENS.INotificationService, {
      // useFactory (not useClass) — the service now has an optional constructor
      // param (the activity-log recorder, #3540 follow-up), which tsyringe
      // cannot auto-resolve. Construct it explicitly with no args; it falls back
      // to the module-level default recorder set in ExocortexPlugin.onload().
      useFactory: () => new ObsidianNotificationService(),
    });

    const vaultAdapter = new ObsidianVaultAdapter(
      app.vault,
      app.metadataCache,
      app,
    );

    container.register(DI_TOKENS.IVaultAdapter, {
      useValue: vaultAdapter,
    });

    const vaultContext = new SingleVaultContext(
      app.vault.getName(),
      app.vault.getName(),
      vaultAdapter,
      true,
    );

    container.register(DI_TOKENS.IVaultContext, {
      useValue: vaultContext,
    });

    container.register(DI_TOKENS.IMultiVaultManager, {
      useFactory: () => new SingleVaultManager(vaultContext),
    });

    // Register all core services (lazy resolution - dependencies resolved on demand)
    registerCoreServices();
  }

  static reset(): void {
    container.clearInstances();
  }
}
