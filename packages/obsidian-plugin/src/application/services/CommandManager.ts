import { App, TFile } from "obsidian";
import { container } from "tsyringe";
import { ExocortexPluginInterface } from '@plugin/types';
import { CommandRegistry } from '@plugin/application/commands/CommandRegistry';
import {
  MetadataExtractor,
  CommandVisibilityContext,
  WikiLinkHelpers,
  FleetingNoteCreationService,
  GenericAssetCreationService,
  DI_TOKENS,
  registerCoreServices,
} from "exocortex";
import { ObsidianVaultAdapter } from '@plugin/adapters/ObsidianVaultAdapter';
import { LoggerFactory } from '@plugin/adapters/logging/LoggerFactory';
import { SPARQLQueryService } from '@plugin/application/services/SPARQLQueryService';
import { OntologySchemaService } from '@plugin/application/services/OntologySchemaService';
import { ClassDiscoveryService } from '@plugin/application/services/ClassDiscoveryService';

import { ReloadLayoutCommand } from '@plugin/application/commands/ReloadLayoutCommand';
import { ToggleLayoutVisibilityCommand } from '@plugin/application/commands/ToggleLayoutVisibilityCommand';
import { ToggleArchivedAssetsCommand } from '@plugin/application/commands/ToggleArchivedAssetsCommand';
import { OpenQueryBuilderCommand } from '@plugin/application/commands/OpenQueryBuilderCommand';
import { EditPropertiesCommand } from '@plugin/application/commands/EditPropertiesCommand';
import { CreateAssetCommand } from '@plugin/application/commands/CreateAssetCommand';
import { CreateFleetingNoteCommand } from '@plugin/application/commands/CreateFleetingNoteCommand';

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

    const fleetingNoteCreationService = container.resolve(FleetingNoteCreationService);
    const genericAssetCreationService = container.resolve(GenericAssetCreationService);
    const sparqlQueryService = new SPARQLQueryService(this.app, logger);
    const ontologySchemaService = new OntologySchemaService(sparqlQueryService);
    const classDiscoveryService = new ClassDiscoveryService(sparqlQueryService);

    const globalCommands = [
      new ReloadLayoutCommand(reloadLayoutCallback),
      new ToggleLayoutVisibilityCommand(plugin),
      new ToggleArchivedAssetsCommand(plugin),
      new OpenQueryBuilderCommand(this.app, plugin),
      new EditPropertiesCommand(this.app, plugin),
      new CreateAssetCommand(this.app, genericAssetCreationService, this.vaultAdapter, classDiscoveryService, ontologySchemaService),
      new CreateFleetingNoteCommand(this.app, fleetingNoteCreationService, this.vaultAdapter),
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
