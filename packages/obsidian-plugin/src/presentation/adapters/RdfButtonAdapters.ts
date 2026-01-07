/**
 * RDF Button Adapters
 *
 * Adapts core ActionInterpreter and ConditionEvaluator to the simpler interfaces
 * expected by RdfButtonGroupsBuilder. These adapters bridge the gap between
 * the plugin's button system and the core RDF-driven action/condition system.
 *
 * @see https://github.com/kitelev/exocortex/issues/1429
 * @module presentation/adapters
 * @since 1.3.0
 */

import type { ITripleStore, IFile, IUIProvider } from "exocortex";
import type {
  ActionInterpreter as RdfActionInterpreter,
  ActionContext as RdfActionContext,
  ActionResult as RdfActionResult,
  ConditionEvaluator as RdfConditionEvaluator,
} from "@plugin/presentation/builders/RdfButtonGroupsBuilder";
import { ActionInterpreter as CoreActionInterpreter } from "exocortex";
import { ConditionEvaluator as CoreConditionEvaluator } from "exocortex";
import { LoggerFactory } from "@plugin/adapters/logging/LoggerFactory";

/**
 * Adapts core ActionInterpreter to RdfButtonGroupsBuilder's ActionInterpreter interface.
 *
 * The core ActionInterpreter requires a full ActionContext with tripleStore and uiProvider,
 * while RdfButtonGroupsBuilder uses a simpler interface with just currentAsset.
 */
export class ActionInterpreterAdapter implements RdfActionInterpreter {
  private coreInterpreter: CoreActionInterpreter;
  private tripleStore: ITripleStore;
  private uiProvider: IUIProvider;
  private fileResolver: (assetUri: string) => IFile | null;
  private logger = LoggerFactory.create("ActionInterpreterAdapter");

  constructor(
    coreInterpreter: CoreActionInterpreter,
    tripleStore: ITripleStore,
    uiProvider: IUIProvider,
    fileResolver: (assetUri: string) => IFile | null
  ) {
    this.coreInterpreter = coreInterpreter;
    this.tripleStore = tripleStore;
    this.uiProvider = uiProvider;
    this.fileResolver = fileResolver;
  }

  async execute(
    actionUri: string,
    context: RdfActionContext
  ): Promise<RdfActionResult> {
    try {
      // Resolve current asset URI to file
      const currentFile = this.fileResolver(context.currentAsset);

      // Build full ActionContext for core interpreter
      const coreContext = {
        currentAsset: currentFile ?? undefined,
        tripleStore: this.tripleStore,
        uiProvider: this.uiProvider,
      };

      // Execute through core interpreter
      const result = await this.coreInterpreter.execute(actionUri, coreContext);

      // Map core ActionResult to RdfActionResult
      // Core's navigateTo is IFile | undefined, RDF interface expects string | undefined
      const navigatePath = result.navigateTo?.path;

      return {
        success: result.success,
        navigateTo: navigatePath,
        error: result.message,
      };
    } catch (error) {
      this.logger.error("Action execution failed", { actionUri, error });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/**
 * Adapts core ConditionEvaluator to RdfButtonGroupsBuilder's ConditionEvaluator interface.
 *
 * Both interfaces have the same signature, but this adapter provides proper
 * error handling and logging at the plugin layer.
 */
export class ConditionEvaluatorAdapter implements RdfConditionEvaluator {
  private coreEvaluator: CoreConditionEvaluator;
  private logger = LoggerFactory.create("ConditionEvaluatorAdapter");

  constructor(coreEvaluator: CoreConditionEvaluator) {
    this.coreEvaluator = coreEvaluator;
  }

  async evaluate(conditionUri: string, assetUri: string): Promise<boolean> {
    try {
      return await this.coreEvaluator.evaluate(conditionUri, assetUri);
    } catch (error) {
      this.logger.warn("Condition evaluation failed, defaulting to false", {
        conditionUri,
        assetUri,
        error,
      });
      return false;
    }
  }
}

/**
 * Creates a no-op ActionInterpreter for cases where action execution is disabled.
 *
 * Returns success but does nothing - useful for testing or gradual rollout.
 */
export function createNoOpActionInterpreter(): RdfActionInterpreter {
  const logger = LoggerFactory.create("NoOpActionInterpreter");
  return {
    async execute(
      actionUri: string,
      _context: RdfActionContext
    ): Promise<RdfActionResult> {
      logger.debug("No-op action executed", { actionUri });
      return { success: true };
    },
  };
}

/**
 * Creates a ConditionEvaluator that always returns true.
 *
 * Useful for cases where condition evaluation is disabled or not yet configured.
 */
export function createAlwaysTrueConditionEvaluator(): RdfConditionEvaluator {
  return {
    async evaluate(
      _conditionUri: string,
      _assetUri: string
    ): Promise<boolean> {
      return true;
    },
  };
}
