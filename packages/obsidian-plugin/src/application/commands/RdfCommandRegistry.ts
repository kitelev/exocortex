/**
 * RdfCommandRegistry
 *
 * Loads and registers commands from RDF definitions in the triple store.
 * Part of the RDF-Driven Architecture implementation for Milestone v1.3.
 *
 * @see https://github.com/kitelev/exocortex/issues/1433
 * @module application/commands
 * @since 1.3.0
 */

import { Plugin, Command, Modifier } from "obsidian";
import { SPARQLQueryService } from "@plugin/application/services/SPARQLQueryService";
import { LoggerFactory } from "@plugin/adapters/logging/LoggerFactory";
import type { ILogger, SolutionMapping, ActionContext, ActionResult, IUIProvider } from "exocortex";
import { ActionInterpreter } from "exocortex";
import { ActionBridge, RdfAction } from "@plugin/application/bridges/ActionBridge";

/**
 * Represents a command definition loaded from RDF.
 */
export interface RdfCommand {
  /** URI of the command in RDF */
  uri: string;
  /** Command ID (used by Obsidian) */
  id: string;
  /** Human-readable command name */
  name: string;
  /** Lucide icon name (optional) */
  icon?: string;
  /** Hotkey string in format "Mod+Shift+K" (optional) */
  hotkey?: string;
  /** URI of the action to execute (optional, for ActionInterpreter) */
  action?: string;
  /** SPARQL ASK query for visibility condition (optional) */
  condition?: string;
  /** Whether command can be executed headlessly (CLI) */
  headless?: boolean;
}

/**
 * Parsed hotkey structure compatible with Obsidian.
 */
export interface ParsedHotkey {
  modifiers: Modifier[];
  key: string;
}

/**
 * Cache entry for condition evaluation results.
 */
interface ConditionCacheEntry {
  result: boolean;
  timestamp: number;
}

/**
 * RdfCommandRegistry loads commands from RDF and registers them with Obsidian.
 *
 * Architecture:
 * - Queries triple store for command definitions using SPARQL
 * - Parses hotkeys from RDF format to Obsidian format
 * - Caches condition evaluation results for performance
 * - Delegates action execution to ActionInterpreter (when available)
 *
 * @example
 * ```typescript
 * const registry = new RdfCommandRegistry(plugin, sparqlService);
 * await registry.loadFromTripleStore();
 * ```
 */
export class RdfCommandRegistry {
  private plugin: Plugin;
  private sparqlService: SPARQLQueryService;
  private logger: ILogger;
  private loadedCommands: RdfCommand[] = [];
  private conditionCache: Map<string, ConditionCacheEntry> = new Map();
  private cacheTtlMs: number = 1000; // 1 second cache TTL
  private actionBridge?: ActionBridge;
  private actionInterpreter?: ActionInterpreter;

  /**
   * SPARQL query to retrieve all commands from RDF.
   * Queries for instances of exo-ui:Command class with their properties.
   */
  private static readonly COMMANDS_QUERY = `
    PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    PREFIX exo-ui: <https://exocortex.my/ontology/exo-ui#>

    SELECT ?cmd ?id ?name ?icon ?hotkey ?action ?condition ?headless
    WHERE {
      ?cmd a exo-ui:Command .
      ?cmd exo-ui:Command_id ?id .
      ?cmd exo-ui:Command_name ?name .
      OPTIONAL { ?cmd exo-ui:Command_icon ?icon }
      OPTIONAL { ?cmd exo-ui:Command_hotkey ?hotkey }
      OPTIONAL { ?cmd exo-ui:Command_action ?action }
      OPTIONAL { ?cmd exo-ui:Command_condition ?condition }
      OPTIONAL { ?cmd exo-ui:Command_headless ?headless }
    }
  `;

  constructor(
    plugin: Plugin,
    sparqlService: SPARQLQueryService,
    actionBridge?: ActionBridge,
    actionInterpreter?: ActionInterpreter
  ) {
    this.plugin = plugin;
    this.sparqlService = sparqlService;
    this.actionBridge = actionBridge;
    this.actionInterpreter = actionInterpreter;
    this.logger = LoggerFactory.create("RdfCommandRegistry");
  }

  /**
   * Load commands from RDF triple store and register them with Obsidian.
   *
   * This method:
   * 1. Queries the triple store for command definitions
   * 2. Parses each command's properties
   * 3. Registers commands with the Obsidian plugin
   *
   * @throws Never - errors are caught and logged
   */
  async loadFromTripleStore(): Promise<void> {
    try {
      this.logger.info("Loading commands from RDF triple store");

      const commands = await this.queryCommands();
      this.loadedCommands = commands;

      for (const command of commands) {
        this.registerCommand(command);
      }

      this.logger.info(`Loaded and registered ${commands.length} commands from RDF`);
    } catch (err) {
      this.logger.error(`Failed to load commands from triple store: ${String(err)}`);
    }
  }

  /**
   * Query commands from the RDF triple store.
   *
   * @returns Array of parsed RdfCommand objects
   */
  async queryCommands(): Promise<RdfCommand[]> {
    try {
      const results = await this.sparqlService.query(RdfCommandRegistry.COMMANDS_QUERY);

      return results
        .map((result) => this.parseCommandResult(result))
        .filter((cmd): cmd is RdfCommand => cmd !== null);
    } catch (err) {
      this.logger.error(`Failed to query commands from triple store: ${String(err)}`);
      return [];
    }
  }

  /**
   * Parse a SPARQL result row into an RdfCommand.
   *
   * @param result - SPARQL solution mapping
   * @returns Parsed command or null if required fields are missing
   */
  private parseCommandResult(result: SolutionMapping): RdfCommand | null {
    const uri = this.extractValueFromMapping(result, "cmd");
    const id = this.extractValueFromMapping(result, "id");
    const name = this.extractValueFromMapping(result, "name");

    if (!uri || !id || !name) {
      this.logger.warn(`Skipping command with missing required fields`);
      return null;
    }

    const headlessValue = this.extractValueFromMapping(result, "headless");

    return {
      uri,
      id,
      name,
      icon: this.extractValueFromMapping(result, "icon"),
      hotkey: this.extractValueFromMapping(result, "hotkey"),
      action: this.extractValueFromMapping(result, "action"),
      condition: this.extractValueFromMapping(result, "condition"),
      headless: headlessValue === "true" || headlessValue === "1",
    };
  }

  /**
   * Extract string value from SolutionMapping.
   * Gets the value for a variable name and converts to string.
   */
  private extractValueFromMapping(mapping: SolutionMapping, variable: string): string | undefined {
    const value = mapping.get(variable);

    if (value === null || value === undefined) {
      return undefined;
    }

    // IRI or Literal or BlankNode all have toString()
    if (typeof value === "object" && "value" in value) {
      return String((value as { value: unknown }).value);
    }

    return String(value);
  }

  /**
   * Register a single command with the Obsidian plugin.
   *
   * @param command - Command definition to register
   */
  private registerCommand(command: RdfCommand): void {
    try {
      const obsidianCommand: Command = {
        id: command.id,
        name: command.name,
      };

      // Add icon if specified
      if (command.icon) {
        obsidianCommand.icon = command.icon;
      }

      // Add hotkey if specified
      const parsedHotkey = this.parseHotkey(command.hotkey);
      if (parsedHotkey) {
        obsidianCommand.hotkeys = [parsedHotkey];
      }

      // Add callback or checkCallback based on condition presence
      if (command.condition) {
        obsidianCommand.checkCallback = (checking: boolean) => {
          return this.handleCheckCallback(command, checking);
        };
      } else {
        obsidianCommand.callback = () => {
          this.executeCommand(command);
        };
      }

      this.plugin.addCommand(obsidianCommand);
      this.logger.debug(`Registered command: ${command.id} - ${command.name}`);
    } catch (err) {
      this.logger.error(`Failed to register command ${command.id}: ${String(err)}`);
    }
  }

  /**
   * Handle checkCallback for commands with conditions.
   *
   * @param command - Command to check
   * @param checking - Whether we're just checking (true) or executing (false)
   * @returns Whether the command should be shown/executed
   */
  private handleCheckCallback(command: RdfCommand, checking: boolean): boolean {
    // For synchronous checkCallback, use cached condition result
    const cached = this.getCachedCondition(command);

    if (cached !== undefined) {
      if (!checking && cached) {
        this.executeCommand(command);
      }
      return cached;
    }

    // If no cache, trigger async check and return true by default
    // This ensures command is shown; actual execution will re-check
    this.checkCondition(command, null).catch((err: unknown) => {
      this.logger.error(`Condition check failed for ${command.id}: ${String(err)}`);
    });

    if (!checking) {
      this.executeCommand(command);
    }

    return true;
  }

  /**
   * Execute a command's action via ActionBridge and ActionInterpreter.
   *
   * Maps RDF action definitions to ActionInterpreter's format using ActionBridge,
   * then delegates execution to ActionInterpreter.
   *
   * @param command - Command to execute
   * @see Issue #1998: Integrate ActionBridge into RdfCommandRegistry
   */
  private async executeCommand(command: RdfCommand): Promise<void> {
    this.logger.info("Executing command", { id: command.id, action: command.action });

    // Check if command has an action defined
    if (!command.action) {
      this.logger.warn("Command has no action defined", { id: command.id });
      return;
    }

    // Check if ActionBridge and ActionInterpreter are available
    if (!this.actionBridge || !this.actionInterpreter) {
      this.logger.debug("ActionBridge/ActionInterpreter not available, falling back to logging", {
        action: command.action,
      });
      return;
    }

    try {
      // Map RDF action to ActionInterpreter format using ActionBridge
      const rdfAction: RdfAction = {
        type: command.action,
        params: {}, // Parameters could be extracted from additional RDF properties
      };

      const actionDefinition = this.actionBridge.toActionDefinition(rdfAction);
      this.logger.debug("Mapped action definition", { type: actionDefinition.type });

      // Execute via ActionInterpreter
      // Note: ActionInterpreter.execute takes an action URI, not ActionDefinition
      // For now, we pass the action URI directly
      const context = this.buildActionContext();
      const result: ActionResult = await this.actionInterpreter.execute(command.action, context);

      if (result.success) {
        this.logger.info("Command executed successfully", { id: command.id });
      } else {
        this.logger.warn("Command execution failed", { id: command.id, message: result.message });
      }
    } catch (err) {
      this.logger.error(`Failed to execute command ${command.id}: ${String(err)}`);
    }
  }

  /**
   * Build ActionContext for command execution.
   *
   * Creates a minimal ActionContext with the required dependencies.
   * This is a placeholder - in production, the context should be provided
   * from the plugin initialization with proper IUIProvider and ITripleStore.
   *
   * @returns ActionContext for action execution
   */
  private buildActionContext(): ActionContext {
    // Get the triple store from SPARQLQueryService
    const tripleStore = this.sparqlService.getTripleStore();

    // Create a minimal headless UI provider for now
    // In production, this should be the ObsidianUIProvider
    const headlessUIProvider: IUIProvider = {
      isHeadless: false,
      navigate: async (path: string) => {
        this.logger.debug("Navigate requested", { path });
      },
      showInputModal: async () => "",
      showSelectModal: async <T>() => null as unknown as T,
      showConfirm: async () => false,
      notify: (message: string) => {
        this.logger.info("Notify", { message });
      },
    };

    return {
      tripleStore,
      uiProvider: headlessUIProvider,
    };
  }

  /**
   * Parse a hotkey string into Obsidian's Hotkey format.
   *
   * @param hotkey - Hotkey string like "Mod+Shift+T" or "Ctrl+D"
   * @returns Parsed hotkey or undefined if invalid
   *
   * @example
   * ```typescript
   * parseHotkey("Mod+Shift+T") // { modifiers: ["Mod", "Shift"], key: "T" }
   * parseHotkey("Mod+Up")      // { modifiers: ["Mod"], key: "ArrowUp" }
   * ```
   */
  parseHotkey(hotkey: string | null | undefined): ParsedHotkey | undefined {
    if (!hotkey || typeof hotkey !== "string" || hotkey.trim() === "") {
      return undefined;
    }

    const parts = hotkey.split("+").map((p) => p.trim());
    if (parts.length < 2) {
      return undefined;
    }

    // Last part is the key, rest are modifiers
    const key = this.normalizeKey(parts[parts.length - 1]);
    const modifiers = parts.slice(0, -1) as Modifier[];

    return {
      modifiers,
      key,
    };
  }

  /**
   * Normalize key names to Obsidian's expected format.
   */
  private normalizeKey(key: string): string {
    const keyMap: Record<string, string> = {
      Up: "ArrowUp",
      Down: "ArrowDown",
      Left: "ArrowLeft",
      Right: "ArrowRight",
    };

    return keyMap[key] || key;
  }

  /**
   * Check if a command's condition is satisfied.
   *
   * @param command - Command with condition to check
   * @param _context - Context for condition evaluation (file, etc.) - reserved for future use
   * @returns Whether the condition is satisfied
   */
  async checkCondition(command: RdfCommand, _context: unknown): Promise<boolean> {
    // No condition means always show
    if (!command.condition) {
      return true;
    }

    // Check cache first
    const cached = this.getCachedCondition(command);
    if (cached !== undefined) {
      return cached;
    }

    try {
      // Execute SPARQL ASK query
      const results = await this.sparqlService.query(command.condition);

      // ASK queries return results, non-empty means true
      const result = results.length > 0;

      // Cache the result
      this.setCachedCondition(command, result);

      return result;
    } catch (err) {
      this.logger.error(`Condition check failed for ${command.id}: ${String(err)}`);
      return false;
    }
  }

  /**
   * Get cached condition result if still valid.
   */
  private getCachedCondition(command: RdfCommand): boolean | undefined {
    const cacheKey = `${command.uri}:${command.condition}`;
    const entry = this.conditionCache.get(cacheKey);

    if (!entry) {
      return undefined;
    }

    const age = Date.now() - entry.timestamp;
    if (age > this.cacheTtlMs) {
      this.conditionCache.delete(cacheKey);
      return undefined;
    }

    return entry.result;
  }

  /**
   * Cache a condition result.
   */
  private setCachedCondition(command: RdfCommand, result: boolean): void {
    const cacheKey = `${command.uri}:${command.condition}`;
    this.conditionCache.set(cacheKey, {
      result,
      timestamp: Date.now(),
    });
  }

  /**
   * Get all commands that have been loaded.
   */
  getLoadedCommands(): RdfCommand[] {
    return [...this.loadedCommands];
  }

  /**
   * Clear the condition cache.
   * Useful when underlying data has changed.
   */
  clearConditionCache(): void {
    this.conditionCache.clear();
  }

  /**
   * Set the cache TTL (for testing).
   */
  setCacheTtl(ttlMs: number): void {
    this.cacheTtlMs = ttlMs;
  }
}
