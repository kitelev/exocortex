import { App } from "obsidian";
import { ExocortexPluginInterface } from '@plugin/types';
import { RdfCommandRegistry } from '@plugin/application/commands/RdfCommandRegistry';
import { SPARQLQueryService } from '@plugin/application/services/SPARQLQueryService';
import { LoggerFactory } from '@plugin/adapters/logging/LoggerFactory';

/**
 * CommandManager - orchestrates command registration with Obsidian.
 *
 * Uses RdfCommandRegistry to load command definitions from the RDF triple store
 * and register them with the Obsidian plugin.
 *
 * @since 2.0.0 - Migrated from legacy CommandRegistry to RdfCommandRegistry
 */
export class CommandManager {
  private rdfCommandRegistry: RdfCommandRegistry | null = null;

  constructor(private app: App) {
    // RdfCommandRegistry is lazily initialized in registerAllCommands()
    // to avoid needing a placeholder plugin instance
  }

  /**
   * Register all commands from RDF definitions with the plugin.
   *
   * @param plugin - The Exocortex plugin instance
   * @param _reloadLayoutCallback - Optional callback for layout reload (legacy, kept for API compatibility)
   */
  async registerAllCommands(
    plugin: ExocortexPluginInterface,
    _reloadLayoutCallback?: () => void,
  ): Promise<void> {
    const logger = LoggerFactory.create("CommandManager");
    const sparqlService = new SPARQLQueryService(this.app, logger);

    this.rdfCommandRegistry = new RdfCommandRegistry(plugin, sparqlService);
    await this.rdfCommandRegistry.loadFromTripleStore();
  }
}
