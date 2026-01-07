/**
 * RdfButtonGroupsBuilder
 *
 * Loads button groups and buttons from RDF definitions and filters by conditions.
 * Part of the RDF-Driven Architecture implementation for Milestone v1.3.
 *
 * This builder queries the triple store for ButtonGroup and Button instances,
 * evaluates visibility conditions, and builds ActionButton arrays ready for rendering.
 *
 * @see https://github.com/kitelev/exocortex/issues/1417
 * @module presentation/builders
 * @since 1.3.0
 */

import { SPARQLQueryService } from "@plugin/application/services/SPARQLQueryService";
import { LoggerFactory } from "@plugin/adapters/logging/LoggerFactory";
import type { ILogger, SolutionMapping } from "exocortex";
import type { ActionButton, ButtonGroup } from "@plugin/presentation/components/ActionButtonsGroup";

/**
 * Interface for executing actions based on RDF action URIs.
 *
 * ActionInterpreter is responsible for translating action URIs
 * (like `ems-ui:StartAction`) into actual operations on assets.
 *
 * @see Issue #1439 for ActionInterpreter implementation
 */
export interface ActionInterpreter {
  /**
   * Execute an action by its URI with given context.
   *
   * @param actionUri - URI of the action to execute (e.g., `ems-ui:StartAction`)
   * @param context - Execution context containing asset URI and other parameters
   * @returns Promise resolving to action result
   */
  execute(actionUri: string, context: ActionContext): Promise<ActionResult>;
}

/**
 * Context passed to action execution.
 */
export interface ActionContext {
  /** URI of the current asset the action operates on */
  currentAsset: string;
}

/**
 * Result of an action execution.
 */
export interface ActionResult {
  /** Whether the action succeeded */
  success: boolean;
  /** Optional navigation target after action */
  navigateTo?: string;
  /** Optional error message if action failed */
  error?: string;
}

/**
 * Interface for evaluating button visibility conditions.
 *
 * ConditionEvaluator checks SPARQL-based conditions to determine
 * whether a button should be visible for the current asset.
 *
 * @see Issue #1405 for ConditionEvaluator implementation
 */
export interface ConditionEvaluator {
  /**
   * Evaluate a condition for the given asset.
   *
   * @param conditionUri - URI of the condition to evaluate
   * @param assetUri - URI of the asset to check against
   * @returns Promise resolving to true if condition is met
   */
  evaluate(conditionUri: string, assetUri: string): Promise<boolean>;
}

/**
 * Internal representation of a button group definition from RDF.
 */
interface GroupDef {
  uri: string;
  label: string;
  order?: string;
}

/**
 * Internal representation of a button definition from RDF.
 */
interface ButtonDef {
  uri: string;
  label: string;
  icon?: string;
  variant?: string;
  order?: string;
  action: string;
  condition?: string;
  tooltip?: string;
}

/**
 * RdfButtonGroupsBuilder loads button groups from RDF and filters by conditions.
 *
 * Architecture:
 * - Queries triple store for ButtonGroup instances using SPARQL
 * - For each group, queries Button instances belonging to that group
 * - Evaluates visibility conditions using ConditionEvaluator
 * - Builds onClick handlers that delegate to ActionInterpreter
 *
 * @example
 * ```typescript
 * const builder = new RdfButtonGroupsBuilder(
 *   sparqlService,
 *   actionInterpreter,
 *   conditionEvaluator
 * );
 * const groups = await builder.buildButtonGroups(assetUri);
 * // groups is ready to pass to ActionButtonsGroup component
 * ```
 */
export class RdfButtonGroupsBuilder {
  private sparqlService: SPARQLQueryService;
  private actionInterpreter: ActionInterpreter;
  private conditionEvaluator: ConditionEvaluator;
  private logger: ILogger;

  /**
   * SPARQL query to retrieve all button groups from RDF.
   */
  private static readonly BUTTON_GROUPS_QUERY = `
    PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    PREFIX exo-ui: <https://exocortex.my/ontology/exo-ui#>

    SELECT ?group ?label ?order
    WHERE {
      ?group a exo-ui:ButtonGroup .
      ?group rdfs:label ?label .
      OPTIONAL { ?group exo-ui:ButtonGroup_order ?order }
    }
    ORDER BY ?order
  `;

  /**
   * SPARQL query template to retrieve buttons for a specific group.
   * Use buildButtonsQuery() to generate the actual query.
   */
  private static readonly BUTTONS_QUERY_TEMPLATE = `
    PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    PREFIX exo-ui: <https://exocortex.my/ontology/exo-ui#>

    SELECT ?button ?label ?icon ?variant ?order ?action ?condition ?tooltip
    WHERE {
      ?button a exo-ui:Button .
      ?button exo-ui:Button_group <GROUP_URI> .
      ?button exo-ui:Button_label ?label .
      ?button exo-ui:Button_action ?action .
      OPTIONAL { ?button exo-ui:Button_icon ?icon }
      OPTIONAL { ?button exo-ui:Button_variant ?variant }
      OPTIONAL { ?button exo-ui:Button_order ?order }
      OPTIONAL { ?button exo-ui:Button_condition ?condition }
      OPTIONAL { ?button exo-ui:Button_tooltip ?tooltip }
    }
    ORDER BY ?order
  `;

  constructor(
    sparqlService: SPARQLQueryService,
    actionInterpreter: ActionInterpreter,
    conditionEvaluator: ConditionEvaluator,
  ) {
    this.sparqlService = sparqlService;
    this.actionInterpreter = actionInterpreter;
    this.conditionEvaluator = conditionEvaluator;
    this.logger = LoggerFactory.create("RdfButtonGroupsBuilder");
  }

  /**
   * Build button groups for the given asset.
   *
   * This method:
   * 1. Loads all button groups from RDF
   * 2. For each group, loads and filters buttons by condition
   * 3. Returns only groups with at least one visible button
   *
   * @param assetUri - URI of the asset to build buttons for
   * @returns Array of button groups with visible buttons
   */
  async buildButtonGroups(assetUri: string): Promise<ButtonGroup[]> {
    try {
      this.logger.debug("Building button groups for asset", { assetUri });

      // 1. Load all button groups
      const groupDefs = await this.loadButtonGroups();

      // 2. For each group, load and filter buttons
      const result: ButtonGroup[] = [];

      for (const groupDef of groupDefs) {
        const buttons = await this.loadButtonsForGroup(groupDef.uri, assetUri);

        if (buttons.length > 0) {
          result.push({
            id: groupDef.uri,
            title: groupDef.label,
            buttons,
          });
        }
      }

      this.logger.debug("Built button groups", {
        assetUri,
        groupCount: result.length,
      });

      return result;
    } catch (err) {
      this.logger.error(`Failed to build button groups: ${String(err)}`);
      return [];
    }
  }

  /**
   * Load all button group definitions from RDF.
   *
   * @returns Array of group definitions
   */
  private async loadButtonGroups(): Promise<GroupDef[]> {
    try {
      const results = await this.sparqlService.query(
        RdfButtonGroupsBuilder.BUTTON_GROUPS_QUERY,
      );

      return results
        .map((result) => this.parseGroupResult(result))
        .filter((def): def is GroupDef => def !== null);
    } catch (err) {
      this.logger.error(`Failed to load button groups: ${String(err)}`);
      return [];
    }
  }

  /**
   * Parse a SPARQL result row into a GroupDef.
   */
  private parseGroupResult(result: SolutionMapping): GroupDef | null {
    const uri = this.extractValueFromMapping(result, "group");
    const label = this.extractValueFromMapping(result, "label");

    if (!uri || !label) {
      return null;
    }

    return {
      uri,
      label,
      order: this.extractValueFromMapping(result, "order"),
    };
  }

  /**
   * Load buttons for a specific group and filter by condition.
   *
   * @param groupUri - URI of the button group
   * @param assetUri - URI of the current asset (for condition evaluation)
   * @returns Array of ActionButton objects for visible buttons
   */
  private async loadButtonsForGroup(
    groupUri: string,
    assetUri: string,
  ): Promise<ActionButton[]> {
    try {
      // Build query with specific group URI
      const query = this.buildButtonsQuery(groupUri);
      const results = await this.sparqlService.query(query);

      const buttonDefs = results
        .map((result) => this.parseButtonResult(result))
        .filter((def): def is ButtonDef => def !== null);

      // Filter by condition and build ActionButton objects
      const buttons: ActionButton[] = [];

      for (const def of buttonDefs) {
        // Check visibility condition
        if (def.condition) {
          try {
            const visible = await this.conditionEvaluator.evaluate(
              def.condition,
              assetUri,
            );
            if (!visible) {
              continue;
            }
          } catch (err) {
            this.logger.warn(
              `Condition evaluation failed for button ${def.uri}: ${String(err)}`,
            );
            continue; // Skip button if condition evaluation fails
          }
        }

        buttons.push(this.buildActionButton(def, assetUri));
      }

      return buttons;
    } catch (err) {
      this.logger.error(
        `Failed to load buttons for group ${groupUri}: ${String(err)}`,
      );
      return [];
    }
  }

  /**
   * Build SPARQL query for buttons in a specific group.
   */
  private buildButtonsQuery(groupUri: string): string {
    return RdfButtonGroupsBuilder.BUTTONS_QUERY_TEMPLATE.replace(
      "GROUP_URI",
      groupUri,
    );
  }

  /**
   * Parse a SPARQL result row into a ButtonDef.
   */
  private parseButtonResult(result: SolutionMapping): ButtonDef | null {
    const uri = this.extractValueFromMapping(result, "button");
    const label = this.extractValueFromMapping(result, "label");
    const action = this.extractValueFromMapping(result, "action");

    if (!uri || !label || !action) {
      return null;
    }

    return {
      uri,
      label,
      icon: this.extractValueFromMapping(result, "icon"),
      variant: this.extractValueFromMapping(result, "variant"),
      order: this.extractValueFromMapping(result, "order"),
      action,
      condition: this.extractValueFromMapping(result, "condition"),
      tooltip: this.extractValueFromMapping(result, "tooltip"),
    };
  }

  /**
   * Build an ActionButton from a button definition.
   */
  private buildActionButton(def: ButtonDef, assetUri: string): ActionButton {
    const actionInterpreter = this.actionInterpreter;

    return {
      id: def.uri,
      label: def.label,
      icon: def.icon,
      variant: (def.variant as ActionButton["variant"]) || "secondary",
      tooltip: def.tooltip,
      onClick: async () => {
        await actionInterpreter.execute(def.action, { currentAsset: assetUri });
      },
    };
  }

  /**
   * Extract string value from SolutionMapping.
   */
  private extractValueFromMapping(
    mapping: SolutionMapping,
    variable: string,
  ): string | undefined {
    const value = mapping.get(variable);

    if (value === null || value === undefined) {
      return undefined;
    }

    // IRI or Literal or BlankNode all have value property
    if (typeof value === "object" && "value" in value) {
      return String((value as { value: unknown }).value);
    }

    return String(value);
  }
}
