import { injectable } from "tsyringe";
import type { IFileSystemReader } from "../interfaces/IFileSystemAdapter";
import type { IFileSystemWriter } from "../interfaces/IFileSystemAdapter";
import type { GroundingDefinition } from "../domain/models/CommandDefinition";
import { GroundingType } from "../domain/constants/GroundingType";
import { FrontmatterService } from "../utilities/FrontmatterService";

/**
 * Result of executing a grounding action.
 */
export interface ExecutionResult {
  readonly success: boolean;
  readonly error?: string;
}

/**
 * Input parameters collected from the user (for service_call groundings).
 * UI layer collects these via modals; CLI via interactive prompts or --arg flags.
 */
export type UserInput = Record<string, unknown>;

/**
 * A named service that can be invoked by service_call groundings.
 */
export interface IGroundingService {
  execute(targetIRI: string, userInput?: UserInput): Promise<void>;
}

/**
 * Registry for named services callable from vault-defined groundings.
 *
 * Services are registered by ID (e.g., "TaskStatusService") and invoked
 * when a service_call grounding references them.
 */
export class ServiceRegistry {
  private readonly services = new Map<string, IGroundingService>();

  register(serviceId: string, service: IGroundingService): void {
    this.services.set(serviceId, service);
  }

  get(serviceId: string): IGroundingService | undefined {
    return this.services.get(serviceId);
  }

  has(serviceId: string): boolean {
    return this.services.has(serviceId);
  }

  getRegisteredIds(): string[] {
    return Array.from(this.services.keys());
  }
}

/** Maximum depth for composite grounding to prevent infinite recursion */
const MAX_COMPOSITE_DEPTH = 20;

/**
 * Executes grounding actions for dynamic commands (RFC-009 §5.4).
 *
 * The "write side" of the Dynamic Command System. Once a precondition passes,
 * GroundingExecutor applies the actual change to the target asset.
 *
 * Supported grounding types:
 * - `property_set` — set a frontmatter property to a value
 * - `property_delete` — remove a frontmatter property
 * - `composite` — execute multiple groundings sequentially with rollback
 * - `service_call` — delegate to a registered TypeScript service
 * - `sparql_update` — stub (NotImplementedError), pending UpdateExecutor support
 *
 * Variable substitution in targetValue:
 * - `$now` → current ISO 8601 timestamp
 * - `$today` → current date (YYYY-MM-DD)
 * - `$target` → IRI of the target asset
 *
 * Issue #2430
 */
@injectable()
export class GroundingExecutor {
  private readonly frontmatterService: FrontmatterService;
  private readonly fileReader: IFileSystemReader;
  private readonly fileWriter: IFileSystemWriter;
  private readonly serviceRegistry: ServiceRegistry;

  constructor(
    fileReader: IFileSystemReader,
    fileWriter: IFileSystemWriter,
    serviceRegistry: ServiceRegistry,
  ) {
    this.frontmatterService = new FrontmatterService();
    this.fileReader = fileReader;
    this.fileWriter = fileWriter;
    this.serviceRegistry = serviceRegistry;
  }

  /**
   * Execute a grounding action on the target asset.
   *
   * @param grounding - The grounding definition to execute
   * @param targetIRI - IRI of the target asset
   * @param targetFilePath - File path of the target asset in the vault
   * @param userInput - Optional user input for service_call groundings
   * @returns ExecutionResult indicating success or failure
   */
  async execute(
    grounding: GroundingDefinition,
    targetIRI: string,
    targetFilePath: string,
    userInput?: UserInput,
  ): Promise<ExecutionResult> {
    try {
      switch (grounding.type) {
        case GroundingType.PROPERTY_SET:
          return await this.executePropertySet(
            grounding,
            targetIRI,
            targetFilePath,
          );

        case GroundingType.PROPERTY_DELETE:
          return await this.executePropertyDelete(
            grounding,
            targetFilePath,
          );

        case GroundingType.COMPOSITE:
          return await this.executeComposite(
            grounding,
            targetIRI,
            targetFilePath,
            userInput,
            0,
          );

        case GroundingType.SERVICE_CALL:
          return await this.executeServiceCall(
            grounding,
            targetIRI,
            userInput,
          );

        case GroundingType.SPARQL_UPDATE:
          return {
            success: false,
            error:
              "sparql_update grounding not yet implemented. Use property_set/property_delete instead.",
          };

        default:
          return {
            success: false,
            error: `Unknown grounding type: ${(grounding as GroundingDefinition).type}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // -- Private: Grounding Type Implementations --

  private async executePropertySet(
    grounding: GroundingDefinition,
    targetIRI: string,
    filePath: string,
  ): Promise<ExecutionResult> {
    if (!grounding.targetProperty) {
      return { success: false, error: "property_set requires targetProperty" };
    }
    if (grounding.targetValue === undefined) {
      return { success: false, error: "property_set requires targetValue" };
    }

    const substitutedValue = this.substituteVariables(
      grounding.targetValue,
      targetIRI,
    );

    const content = await this.fileReader.readFile(filePath);
    const updated = this.frontmatterService.updateProperty(
      content,
      grounding.targetProperty,
      substitutedValue,
    );
    await this.fileWriter.updateFile(filePath, updated);

    return { success: true };
  }

  private async executePropertyDelete(
    grounding: GroundingDefinition,
    filePath: string,
  ): Promise<ExecutionResult> {
    if (!grounding.targetProperty) {
      return {
        success: false,
        error: "property_delete requires targetProperty",
      };
    }

    const content = await this.fileReader.readFile(filePath);
    const updated = this.frontmatterService.removeProperty(
      content,
      grounding.targetProperty,
    );
    await this.fileWriter.updateFile(filePath, updated);

    return { success: true };
  }

  private async executeComposite(
    grounding: GroundingDefinition,
    targetIRI: string,
    filePath: string,
    userInput: UserInput | undefined,
    depth: number,
  ): Promise<ExecutionResult> {
    if (depth >= MAX_COMPOSITE_DEPTH) {
      return {
        success: false,
        error: `Composite grounding exceeded maximum depth of ${MAX_COMPOSITE_DEPTH}`,
      };
    }

    const steps = grounding.steps ?? [];
    if (steps.length === 0) {
      return { success: true };
    }

    // Capture state before execution for rollback
    let originalContent: string | undefined;
    try {
      originalContent = await this.fileReader.readFile(filePath);
    } catch {
      // File might not exist for service_call-only composites
    }

    const completedSteps: number[] = [];

    try {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const result = await this.executeStep(
          step,
          targetIRI,
          filePath,
          userInput,
          depth + 1,
        );
        if (!result.success) {
          // Rollback completed steps by restoring original file content
          await this.rollback(originalContent, filePath, completedSteps);
          return {
            success: false,
            error: `Composite step ${i} failed: ${result.error}`,
          };
        }
        completedSteps.push(i);
      }

      return { success: true };
    } catch (error) {
      await this.rollback(originalContent, filePath, completedSteps);
      return {
        success: false,
        error: `Composite execution failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async executeServiceCall(
    grounding: GroundingDefinition,
    targetIRI: string,
    userInput?: UserInput,
  ): Promise<ExecutionResult> {
    // service_call uses targetProperty as serviceId (repurposed field)
    const serviceId = grounding.targetProperty;
    if (!serviceId) {
      return { success: false, error: "service_call requires targetProperty as serviceId" };
    }

    const service = this.serviceRegistry.get(serviceId);
    if (!service) {
      return {
        success: false,
        error: `Service not found: "${serviceId}". Registered services: ${this.serviceRegistry.getRegisteredIds().join(", ") || "none"}`,
      };
    }

    await service.execute(targetIRI, userInput);
    return { success: true };
  }

  private async executeStep(
    step: GroundingDefinition,
    targetIRI: string,
    filePath: string,
    userInput: UserInput | undefined,
    depth: number,
  ): Promise<ExecutionResult> {
    // For composite steps, use recursive execute with depth tracking
    if (step.type === GroundingType.COMPOSITE) {
      return this.executeComposite(step, targetIRI, filePath, userInput, depth);
    }
    return this.execute(step, targetIRI, filePath, userInput);
  }

  // -- Private: Rollback --

  private async rollback(
    originalContent: string | undefined,
    filePath: string,
    _completedSteps: number[],
  ): Promise<void> {
    if (originalContent === undefined) return;

    try {
      await this.fileWriter.updateFile(filePath, originalContent);
    } catch (rollbackError) {
      // Log rollback failure but do not throw — prevents masking the original error
      console.error(
        `[GroundingExecutor] Rollback failed for ${filePath}:`,
        rollbackError,
      );
    }
  }

  // -- Private: Variable Substitution --

  /**
   * Substitute custom variables in grounding values.
   * Same variables as PreconditionEvaluator for consistency.
   *
   * - $target → targetIRI (no angle brackets — this is a value, not SPARQL)
   * - $now → current ISO 8601 timestamp
   * - $today → current date (YYYY-MM-DD)
   */
  substituteVariables(value: string, targetIRI: string): string {
    const now = new Date().toISOString();
    const today = now.slice(0, 10);

    return value
      .replace(/\$target/g, targetIRI)
      .replace(/\$now/g, now)
      .replace(/\$today/g, today);
  }
}
