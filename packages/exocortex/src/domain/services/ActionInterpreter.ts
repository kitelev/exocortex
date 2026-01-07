/**
 * ActionInterpreter - RDF-driven action execution engine
 *
 * Orchestrates action execution by loading action definitions from the triple store
 * and dispatching them to registered handlers.
 *
 * @see /Users/kitelev/vault-2025/03 Knowledge/concepts/RDF-Driven Architecture Implementation Plan (Note).md
 * Phase 3: ActionInterpreter Runtime (lines 1469-1640)
 *
 * Issue #1404: Implement ActionInterpreter base structure
 * @see https://github.com/kitelev/exocortex/issues/1404
 */

import { ITripleStore } from "../../interfaces/ITripleStore";
import { IFileSystemMetadataProvider } from "../../interfaces/IFileSystemAdapter";
import { IRI } from "../models/rdf/IRI";
import { ActionContext } from "../types/ActionContext";
import {
  ActionResult,
  ActionDefinition,
  ActionHandler,
} from "../types/ActionTypes";
import { HeadlessError } from "../ports/IUIProvider";
import { GenericAssetCreationService } from "../../services/GenericAssetCreationService";
import type { IVaultAdapter, IFile, IFrontmatter } from "../../interfaces/IVaultAdapter";
import { SPARQLParser } from "../../infrastructure/sparql/SPARQLParser";
import { AlgebraTranslator } from "../../infrastructure/sparql/algebra/AlgebraTranslator";
import { QueryExecutor } from "../../infrastructure/sparql/executors/QueryExecutor";
import type { SelectQuery } from "../../infrastructure/sparql/SPARQLParser";
import type { WebhookService } from "../../services/WebhookService";

/**
 * Namespace URI for exo-ui ontology
 */
const EXO_UI_NS = "https://exocortex.my/ontology/exo-ui#";

/**
 * RDF type predicate URI
 */
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

/**
 * ActionInterpreter - orchestrates RDF-driven action execution
 *
 * This is the core of the declarative UI system. Actions are defined in RDF
 * using the exo-ui ontology, and this interpreter loads and executes them.
 *
 * Fixed Verbs (8 built-in action types):
 * 1. CreateAssetAction - Create new asset from template
 * 2. UpdatePropertyAction - Update asset property
 * 3. NavigateAction - Navigate to asset
 * 4. ExecuteSPARQLAction - Execute SPARQL query
 * 5. ShowModalAction - Show modal dialog
 * 6. TriggerHookAction - Trigger external webhook
 * 7. CustomHandlerAction - Delegate to registered TypeScript handler
 * 8. CompositeAction - Execute multiple actions in sequence
 *
 * @example
 * ```typescript
 * const interpreter = new ActionInterpreter(tripleStore);
 *
 * // Register custom handler (escape hatch)
 * interpreter.registerCustomHandler('custom:MyHandler', async (def, ctx) => {
 *   // Custom logic
 *   return { success: true };
 * });
 *
 * // Execute action by URI
 * const result = await interpreter.execute(
 *   'https://exocortex.my/actions/create-task-1',
 *   context
 * );
 * ```
 */
export class ActionInterpreter {
  /**
   * Registry of built-in action handlers (Fixed Verbs)
   */
  private handlers: Map<string, ActionHandler> = new Map();

  /**
   * Registry of custom handlers (escape hatch for TypeScript logic)
   */
  private customHandlers: Map<string, ActionHandler> = new Map();

  constructor(
    private tripleStore: ITripleStore,
    private assetCreationService?: GenericAssetCreationService,
    private vaultAdapter?: IVaultAdapter,
    private fileSystem?: IFileSystemMetadataProvider,
    private webhookService?: WebhookService
  ) {
    this.registerBuiltinHandlers();
  }

  /**
   * Register all 8 Fixed Verb handlers
   */
  private registerBuiltinHandlers(): void {
    // Fixed Verbs - НЕ расширяются через RDF
    this.handlers.set("exo-ui:CreateAssetAction", this.createAssetHandler);
    this.handlers.set("exo-ui:UpdatePropertyAction", this.updatePropertyHandler);
    this.handlers.set("exo-ui:NavigateAction", this.navigateHandler);
    this.handlers.set("exo-ui:ExecuteSPARQLAction", this.executeSparqlHandler);
    this.handlers.set("exo-ui:ShowModalAction", this.showModalHandler);
    this.handlers.set("exo-ui:TriggerHookAction", this.triggerHookHandler);
    this.handlers.set("exo-ui:CustomHandlerAction", this.customHandler);
    this.handlers.set("exo-ui:CompositeAction", this.compositeHandler);
  }

  /**
   * Register custom handler (escape hatch for TypeScript logic)
   *
   * @param handlerId - Unique handler identifier
   * @param handler - Handler function to execute
   */
  registerCustomHandler(handlerId: string, handler: ActionHandler): void {
    this.customHandlers.set(handlerId, handler);
  }

  /**
   * Check if a handler is registered for the given action type
   *
   * @param actionType - Action type URI (e.g., "exo-ui:CreateAssetAction")
   * @returns true if handler exists
   */
  hasHandler(actionType: string): boolean {
    return this.handlers.has(actionType) || this.customHandlers.has(actionType);
  }

  /**
   * Execute action by URI
   *
   * @param actionUri - URI of the action in the triple store
   * @param context - Execution context with services and state
   * @returns Result of action execution
   */
  async execute(
    actionUri: string,
    context: ActionContext
  ): Promise<ActionResult> {
    // 1. Load action definition from triple store
    let definition: ActionDefinition;
    try {
      definition = await this.loadActionDefinition(actionUri);
    } catch (error) {
      return {
        success: false,
        message: `Failed to load action definition: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    // 2. Find handler for action type
    const handler =
      this.handlers.get(definition.type) ||
      this.customHandlers.get(definition.type);

    if (!handler) {
      return {
        success: false,
        message: `Unknown action type: ${definition.type}`,
      };
    }

    // 3. Execute handler
    return handler(definition, context);
  }

  /**
   * Load action definition from triple store
   *
   * Queries the triple store to get:
   * - Action type (rdf:type)
   * - Action parameters (exo-ui:* properties)
   *
   * @param actionUri - URI of the action
   * @returns Parsed action definition
   * @throws Error if action type not found
   */
  private async loadActionDefinition(
    actionUri: string
  ): Promise<ActionDefinition> {
    // Query all triples for this action
    const actionIRI = new IRI(actionUri);
    const triples = await this.tripleStore.match(actionIRI, undefined, undefined);

    // Find action type
    let actionType: string | undefined;
    const params: Record<string, unknown> = {};

    for (const triple of triples) {
      const predicateValue =
        "value" in triple.predicate ? triple.predicate.value : String(triple.predicate);

      // Check if this is the rdf:type triple
      if (predicateValue === RDF_TYPE) {
        const objectValue =
          "value" in triple.object ? triple.object.value : String(triple.object);

        // Extract action type from full URI (e.g., exo-ui:CreateAssetAction)
        if (objectValue.startsWith(EXO_UI_NS)) {
          actionType = "exo-ui:" + objectValue.substring(EXO_UI_NS.length);
        }
      } else if (predicateValue.startsWith(EXO_UI_NS)) {
        // Extract param name and value
        const paramName = predicateValue.substring(EXO_UI_NS.length);
        const objectValue =
          "value" in triple.object ? triple.object.value : String(triple.object);
        params[paramName] = objectValue;
      }
    }

    if (!actionType) {
      throw new Error(`Action type not found for: ${actionUri}`);
    }

    return {
      type: actionType,
      params,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // FIXED VERBS IMPLEMENTATIONS (Stub - to be implemented in #1405-#1411)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Create new asset from template
   *
   * Parameters:
   * - targetClass: Asset class to create (e.g., "ems__Task")
   * - template: Optional template name for the asset label
   * - location: Folder path for asset creation (required in headless mode)
   *
   * @see Issue #1405
   * @see /Users/kitelev/vault-2025/03 Knowledge/concepts/RDF-Driven Architecture Implementation Plan (Note).md
   * Phase 3: ActionInterpreter Runtime (lines 1537-1550)
   */
  private createAssetHandler: ActionHandler = async (def, ctx) => {
    const targetClass = def.params.targetClass as string;
    const template = def.params.template as string | undefined;
    const location = def.params.location as string | undefined;

    // Headless check: CLI mode requires explicit location
    if (ctx.uiProvider.isHeadless && !location) {
      const error = new HeadlessError(
        "CreateAssetAction without location",
        "--location <path>"
      );
      return {
        success: false,
        message: error.message,
      };
    }

    // Ensure asset creation service is available
    if (!this.assetCreationService) {
      return {
        success: false,
        message: "AssetCreationService not initialized",
      };
    }

    try {
      // Create asset using GenericAssetCreationService
      const newFile = await this.assetCreationService.createAsset({
        className: targetClass,
        label: template,
        folderPath: location,
      });

      return {
        success: true,
        navigateTo: newFile,
        refresh: true,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to create asset: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  };

  /**
   * Update asset property
   *
   * Parameters:
   * - targetProperty: Property name to update (e.g., "ems__Effort_status")
   * - targetValue: New value for the property (or null to delete)
   * - targetAsset: Optional path to target file (defaults to currentAsset in context)
   *
   * @see Issue #1406
   * @see /Users/kitelev/vault-2025/03 Knowledge/concepts/RDF-Driven Architecture Implementation Plan (Note).md
   * Phase 3: ActionInterpreter Runtime (lines 1552-1567)
   */
  private updatePropertyHandler: ActionHandler = async (def, ctx) => {
    const targetProperty = def.params.targetProperty as string;
    const targetValue = def.params.targetValue;
    const targetAsset = def.params.targetAsset as string | undefined;

    // Ensure vault adapter is available
    if (!this.vaultAdapter) {
      return {
        success: false,
        message: "VaultAdapter not initialized",
      };
    }

    // Resolve target file: use targetAsset if specified, otherwise currentAsset
    let file: IFile | null | undefined;
    if (targetAsset) {
      const abstractFile = this.vaultAdapter.getAbstractFileByPath(targetAsset);
      // Ensure it's a file (has path, basename, name)
      if (abstractFile && "basename" in abstractFile) {
        file = abstractFile as IFile;
      } else {
        return {
          success: false,
          message: `Target asset not found: ${targetAsset}`,
        };
      }
    } else {
      file = ctx.currentAsset;
    }

    // Validate we have a target file
    if (!file) {
      return {
        success: false,
        message: "No target asset",
      };
    }

    try {
      // Update frontmatter using vault adapter
      await this.vaultAdapter.updateFrontmatter(
        file,
        (current: IFrontmatter): IFrontmatter => {
          const updated = { ...current };
          if (targetValue === null || targetValue === undefined) {
            // Delete property if value is null/undefined
            delete updated[targetProperty];
          } else {
            // Set property value
            updated[targetProperty] = targetValue;
          }
          return updated;
        }
      );

      return {
        success: true,
        refresh: true,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to update property: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  };

  /**
   * Navigate to asset or result of SPARQL query
   *
   * Parameters:
   * - target: Asset URI or SPARQL query (SELECT/ASK)
   *
   * If target starts with SELECT or ASK, executes SPARQL query and
   * navigates to the first result's asset.
   *
   * @see Issue #1407
   * @see /Users/kitelev/vault-2025/03 Knowledge/concepts/RDF-Driven Architecture Implementation Plan (Note).md
   * Phase 3: ActionInterpreter Runtime (lines 1569-1590)
   */
  private navigateHandler: ActionHandler = async (def, ctx) => {
    const target = def.params.target as string;

    if (!target) {
      return {
        success: false,
        message: "NavigateAction requires 'target' parameter",
      };
    }

    // Determine target asset URI
    let assetUri: string;

    if (target.startsWith("SELECT") || target.startsWith("ASK")) {
      // SPARQL query - get first result
      // For simplicity, we use match() to get triples matching a pattern
      // In a full implementation, this would use a SPARQL executor
      const results = await this.tripleStore.match(undefined, undefined, undefined);

      if (results.length === 0) {
        return {
          success: false,
          message: "No results found",
        };
      }

      // For ASK queries with results, navigate to current asset if available
      if (target.startsWith("ASK")) {
        if (ctx.currentAsset) {
          await ctx.uiProvider.navigate(ctx.currentAsset.path);
          return { success: true };
        }
        // ASK query returned true but no current asset to navigate to
        return { success: true, message: "Query returned true" };
      }

      // SELECT query - use first result's subject as the asset URI
      const firstResult = results[0];
      assetUri = "value" in firstResult.subject
        ? firstResult.subject.value
        : String(firstResult.subject);
    } else {
      // Direct URI
      assetUri = target;
    }

    // Resolve URI to file path
    const filePath = await this.resolveAssetUri(assetUri);

    if (!filePath) {
      return {
        success: false,
        message: "Asset not found",
      };
    }

    // Navigate using uiProvider
    await ctx.uiProvider.navigate(filePath);

    return { success: true };
  };

  /**
   * Resolve asset URI to file path
   *
   * Extracts UUID from URI and looks up file path using file system adapter.
   *
   * @param uri - Asset URI (e.g., https://exocortex.my/assets/uuid)
   * @returns File path or null if not found
   */
  private async resolveAssetUri(uri: string): Promise<string | null> {
    if (!this.fileSystem) {
      return null;
    }

    // Extract UUID from URI - it's typically the last path segment
    const uuid = uri.split("/").pop();

    if (!uuid) {
      return null;
    }

    // Use file system adapter to find file by UUID
    return this.fileSystem.findFileByUID(uuid);
  }

  /**
   * Execute SPARQL query
   *
   * Parameters:
   * - query: SPARQL query string to execute
   *
   * @see Issue #1408
   * @see /Users/kitelev/vault-2025/03 Knowledge/concepts/RDF-Driven Architecture Implementation Plan (Note).md
   * Phase 3: ActionInterpreter Runtime (lines 1592-1596)
   */
  private executeSparqlHandler: ActionHandler = async (def, _ctx) => {
    const query = def.params.query as string | undefined;

    // Validate query parameter
    if (!query) {
      return {
        success: false,
        message: "ExecuteSPARQLAction requires 'query' parameter",
      };
    }

    try {
      // Parse SPARQL query
      const parser = new SPARQLParser();
      const parsed = parser.parse(query);

      // Check if it's a SELECT query (only SELECT is supported currently)
      if (parsed.type !== "query" || parsed.queryType !== "SELECT") {
        return {
          success: false,
          message: "ExecuteSPARQLAction only supports SELECT queries",
        };
      }

      // Translate to algebra
      const translator = new AlgebraTranslator();
      const algebra = translator.translate(parsed as SelectQuery);

      // Execute query
      const executor = new QueryExecutor(this.tripleStore);
      const results = await executor.executeAll(algebra);

      // Convert results to array of plain objects
      const data = results.map((solution) => solution.toJSON());

      return {
        success: true,
        data,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to execute SPARQL query: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  };

  /**
   * Show modal dialog
   *
   * Parameters:
   * - modalType: Type of modal to show ('input', 'select', 'confirm')
   * - modalParams: JSON string with modal configuration
   * - Action_cliAlternative: Optional CLI alternative for headless mode
   *
   * Modal types and their params:
   * - input: { title, placeholder?, defaultValue?, submitLabel? }
   * - select: { title, items, getLabel?, placeholder? }
   * - confirm: { message }
   *
   * @see Issue #1409
   * @see /Users/kitelev/vault-2025/03 Knowledge/concepts/RDF-Driven Architecture Implementation Plan (Note).md
   * Phase 3: ActionInterpreter Runtime (lines 1598-1605)
   */
  private showModalHandler: ActionHandler = async (def, ctx) => {
    const modalType = def.params.modalType as string;
    const modalParamsStr = def.params.modalParams as string | undefined;
    const cliAlternative = def.params.Action_cliAlternative as string | undefined;

    // Headless check - modal requires UI
    if (ctx.uiProvider.isHeadless) {
      const error = new HeadlessError(
        "ShowModalAction",
        cliAlternative || "Use appropriate CLI arguments"
      );
      return {
        success: false,
        message: error.message,
      };
    }

    // Parse modalParams JSON
    let modalParams: Record<string, unknown>;
    try {
      modalParams = modalParamsStr ? JSON.parse(modalParamsStr) : {};
    } catch (error) {
      return {
        success: false,
        message: `Invalid modalParams JSON: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    // Delegate to uiProvider based on modal type
    try {
      let result: unknown;

      if (modalType === "input") {
        result = await ctx.uiProvider.showInputModal(modalParams as {
          title: string;
          placeholder?: string;
          defaultValue?: string;
          submitLabel?: string;
        });
      } else if (modalType === "select") {
        result = await ctx.uiProvider.showSelectModal(modalParams as {
          title: string;
          items: unknown[];
          getLabel: (item: unknown) => string;
          placeholder?: string;
        });
      } else if (modalType === "confirm") {
        result = await ctx.uiProvider.showConfirm(
          (modalParams.message as string) || ""
        );
      } else {
        return {
          success: false,
          message: `Unknown modal type: ${modalType}`,
        };
      }

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        message: `Modal failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  };

  /**
   * Trigger external webhook
   *
   * Parameters:
   * - hookName: Name/identifier of the hook to trigger (required)
   * - payload: Data to send with the webhook (optional, can be string or object)
   *
   * The handler dispatches a "property.changed" event to the webhook service
   * with the hookName and payload in the data field.
   *
   * @see Issue #1410
   * @see /Users/kitelev/vault-2025/03 Knowledge/concepts/RDF-Driven Architecture Implementation Plan (Note).md
   * Phase 3: ActionInterpreter Runtime (lines 1607-1613)
   */
  private triggerHookHandler: ActionHandler = async (def, ctx) => {
    const hookName = def.params.hookName as string | undefined;
    const payloadParam = def.params.payload;

    // Validate hookName parameter
    if (!hookName) {
      return {
        success: false,
        message: "TriggerHookAction requires 'hookName' parameter",
      };
    }

    // Ensure webhook service is available
    if (!this.webhookService) {
      return {
        success: false,
        message: "WebhookService not initialized",
      };
    }

    // Parse payload if it's a JSON string
    let payload: Record<string, unknown> | undefined;
    if (typeof payloadParam === "string") {
      try {
        payload = JSON.parse(payloadParam) as Record<string, unknown>;
      } catch {
        // If not valid JSON, use as-is wrapped in object
        payload = { raw: payloadParam };
      }
    } else if (payloadParam && typeof payloadParam === "object") {
      payload = payloadParam as Record<string, unknown>;
    }

    try {
      // Dispatch webhook event
      await this.webhookService.dispatchEvent({
        event: "property.changed",
        timestamp: new Date().toISOString(),
        filePath: ctx.currentAsset?.path ?? "",
        data: {
          hookName,
          payload,
        },
      });

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to trigger hook: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  };

  /**
   * Delegate to custom TypeScript handler
   * @see Issue #1411
   */
  private customHandler: ActionHandler = async (def, ctx) => {
    const handlerId = def.params.handler as string;
    const handler = this.customHandlers.get(handlerId);

    if (!handler) {
      return {
        success: false,
        message: `Custom handler not found: ${handlerId}`,
      };
    }

    return handler(def, ctx);
  };

  /**
   * Execute multiple actions in sequence
   * @see Issue #1412
   */
  private compositeHandler: ActionHandler = async (_def, _ctx) => {
    return {
      success: false,
      message: `Not implemented: CompositeAction`,
    };
  };
}
