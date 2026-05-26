import type { App, TFile } from "obsidian";
import { container } from "tsyringe";
import { ExocortexPluginInterface } from '@plugin/types';
import { CommandRegistry } from '@plugin/application/commands/CommandRegistry';
import {
  MetadataExtractor,
  CommandVisibilityContext,
  WikiLinkHelpers,
  GenericAssetCreationService,
  DI_TOKENS,
  registerCoreServices,
  type INotificationService,
} from "exocortex";
import { ObsidianVaultAdapter } from '@plugin/adapters/ObsidianVaultAdapter';
import { LoggerFactory } from '@plugin/adapters/logging/LoggerFactory';
import { ObsidianNotificationService } from '@plugin/infrastructure/di/ObsidianNotificationService';
import { SPARQLQueryService } from '@plugin/application/services/SPARQLQueryService';
import { OntologySchemaService } from '@plugin/application/services/OntologySchemaService';
import { ClassDiscoveryService } from '@plugin/application/services/ClassDiscoveryService';

import { ReloadLayoutCommand } from '@plugin/application/commands/ReloadLayoutCommand';
import { ToggleLayoutVisibilityCommand } from '@plugin/application/commands/ToggleLayoutVisibilityCommand';
import { ToggleArchivedAssetsCommand } from '@plugin/application/commands/ToggleArchivedAssetsCommand';
import { OpenQueryBuilderCommand } from '@plugin/application/commands/OpenQueryBuilderCommand';
import { EditPropertiesCommand } from '@plugin/application/commands/EditPropertiesCommand';
import { CreateAssetCommand } from '@plugin/application/commands/CreateAssetCommand';
// `CreateFleetingNoteCommand` removed in RFC 1429fcd0 PR-3 — the command is
// now registered from the vault `exocmd__Command` asset `692aa011-...` by
// `ExocmdCommandPaletteRegistrar`.

export class CommandManager {
  private commandRegistry: CommandRegistry | null = null;
  private metadataExtractor: MetadataExtractor;
  private vaultAdapter: ObsidianVaultAdapter;

  constructor(private app: App) {
    this.vaultAdapter = new ObsidianVaultAdapter(
      app.vault,
      app.metadataCache,
      app,
    );
    this.metadataExtractor = new MetadataExtractor(this.vaultAdapter);
  }

  registerAllCommands(
    plugin: ExocortexPluginInterface,
    reloadLayoutCallback?: () => void,
  ): void {
    const logger = LoggerFactory.create("CommandManager");

    container.register(DI_TOKENS.IVaultAdapter, { useValue: this.vaultAdapter });
    container.register(DI_TOKENS.ILogger, { useValue: logger });
    registerCoreServices();

    const notifier: INotificationService = new ObsidianNotificationService();

    const genericAssetCreationService = container.resolve(GenericAssetCreationService);
    const sparqlQueryService = new SPARQLQueryService(
      this.app,
      logger,
      undefined,
      plugin.settings?.excludedFolders ?? [],
    );
    const ontologySchemaService = new OntologySchemaService(sparqlQueryService);
    const classDiscoveryService = new ClassDiscoveryService(sparqlQueryService);

    const globalCommands = [
      new ReloadLayoutCommand(reloadLayoutCallback, notifier),
      new ToggleLayoutVisibilityCommand(plugin, notifier),
      new ToggleArchivedAssetsCommand(plugin, notifier),
      new OpenQueryBuilderCommand(this.app, plugin, notifier),
      new EditPropertiesCommand(this.app, plugin, notifier),
      new CreateAssetCommand(this.app, genericAssetCreationService, this.vaultAdapter, classDiscoveryService, notifier, ontologySchemaService),
    ];

    this.commandRegistry = new CommandRegistry(globalCommands);

    const commands = this.commandRegistry.getAllCommands();

    for (const command of commands) {
      if (command.checkCallback) {
        plugin.addCommand({
          id: command.id,
          name: command.name,
          checkCallback: (checking: boolean) => {
            const file = this.app.workspace.getActiveFile();
            if (!file) return false;

            const context = this.getContext(file);
            if (!command.checkCallback) return false;
            return command.checkCallback(checking, file, context);
          },
        });
      } else if (command.callback) {
        plugin.addCommand({
          id: command.id,
          name: command.name,
          callback: command.callback,
        });
      }
    }
  }

  /**
   * Invoke a registered global command by its id.
   *
   * Used by surfaces like the ribbon icon that want to trigger the same flow
   * as the command palette without duplicating handler code. Fire-and-forget:
   * returns once the handler has been invoked, not once it has finished.
   */
  executeCommand(id: string): boolean {
    if (!this.commandRegistry) return false;
    const command = this.commandRegistry
      .getAllCommands()
      .find((c) => c.id === id);
    if (!command) return false;

    if (command.callback) {
      void command.callback();
      return true;
    }

    if (command.checkCallback) {
      const file = this.app.workspace.getActiveFile();
      if (!file) return false;
      const context = this.getContext(file);
      command.checkCallback(false, file, context);
      return true;
    }

    return false;
  }

  private getContext(file: TFile): CommandVisibilityContext | null {
    const context = this.metadataExtractor.extractCommandVisibilityContext(file);

    return {
      ...context,
      expectedFolder: null,
      classIsPrototype: this.resolveClassIsPrototype(context.instanceClass),
    };
  }

  private resolveClassIsPrototype(instanceClass: string | string[] | null): boolean {
    if (!instanceClass) return false;
    if (!this.app.metadataCache?.getFirstLinkpathDest) return false;

    const classes = Array.isArray(instanceClass) ? instanceClass : [instanceClass];

    for (const cls of classes) {
      const normalized = WikiLinkHelpers.normalize(cls);
      if (!normalized) continue;

      const classFile = this.app.metadataCache.getFirstLinkpathDest(normalized, "");
      if (!classFile) continue;

      const classCache = this.app.metadataCache.getFileCache(classFile);
      const classMeta = classCache?.frontmatter;
      if (!classMeta) continue;

      const classInstanceClass = classMeta.exo__Instance_class;
      if (!classInstanceClass) continue;

      const classClasses = Array.isArray(classInstanceClass) ? classInstanceClass : [classInstanceClass];
      for (const cc of classClasses) {
        const normalizedCC = WikiLinkHelpers.normalize(cc);
        if (normalizedCC === "exo__Prototype" || normalizedCC === "ebf717aa-4070-4b37-abde-10a700e354fc") {
          return true;
        }
      }
    }

    return false;
  }
}
