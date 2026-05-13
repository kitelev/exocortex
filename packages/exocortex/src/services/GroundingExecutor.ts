import { injectable } from "tsyringe";
import { v4 as uuidv4 } from "uuid";
import type { IFileSystemReader } from "../interfaces/IFileSystemAdapter";
import type { IFileSystemWriter } from "../interfaces/IFileSystemAdapter";
import type { GroundingDefinition } from "../domain/models/CommandDefinition";
import { GroundingType } from "../domain/constants/GroundingType";
import { FrontmatterService } from "../utilities/FrontmatterService";
import { DateFormatter } from "../utilities/DateFormatter";
import { LoggingService } from "./LoggingService";

/**
 * Result of executing a grounding action.
 */
export interface ExecutionResult {
  readonly success: boolean;
  readonly error?: string;
}

/**
 * Extract a class token (e.g. "ems__Task") from a `Grounding_targetValue`
 * string as parsed by CommandResolver.getObsidianWikilinkValue. The parser
 * emits either the plain literal ("ems__Task") or the wrapped wikilink form
 * (`"[[ems__Task]]"`), depending on whether the underlying RDF triple stored
 * the value as a Literal or an IRI. Returns the inner class token for either
 * shape; returns undefined for absent/empty/unrecognised values.
 *
 * Kept module-local (not exported) — it only exists to bridge the parser's
 * polymorphic output to the service_call composite short-circuit.
 */
function extractClassFromTargetValue(
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  const wrapped = value.match(/^"?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]"?$/);
  if (wrapped) return wrapped[1];
  return value;
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
 * Substitution applies to `property_set` raw values and to `service_call`
 * JSON `targetValue` defaults (Issue #2999 / RFC 5a61a359 Phase C.0). For
 * service_call the substitution is performed before `JSON.parse`, so any
 * string position inside the JSON object can reference a token, e.g.
 * `{"prototype":"$target"}` resolves to `{prototype: <targetIRI>}`.
 *
 * Issue #2430, #2999
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
            userInput,
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
            targetFilePath,
            userInput,
          );

        case GroundingType.CREATE_INSTANCE:
          return await this.executeCreateInstance(
            grounding,
            targetIRI,
            targetFilePath,
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
    userInput?: UserInput,
  ): Promise<ExecutionResult> {
    if (!grounding.targetProperty) {
      return { success: false, error: "property_set requires targetProperty" };
    }
    if (grounding.targetValue === undefined) {
      return { success: false, error: "property_set requires targetValue" };
    }

    // RFC-028 Findings 3+4: fail loudly if $input/$value placeholder is present
    // but no userInput.value is provided. Prevents silently writing the literal
    // string ("$input"/"$value") into frontmatter as a value.
    const needsUserInput = /\$(input|value)\b/.test(grounding.targetValue);
    if (
      needsUserInput &&
      (userInput === undefined ||
        userInput.value === undefined ||
        userInput.value === null)
    ) {
      return {
        success: false,
        error:
          "property_set: targetValue contains $input/$value placeholder but no userInput.value provided",
      };
    }

    const substitutedValue = this.substituteVariables(
      grounding.targetValue,
      targetIRI,
      userInput,
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
    filePath: string,
    userInput?: UserInput,
  ): Promise<ExecutionResult> {
    // service_call uses targetProperty as serviceId (repurposed field)
    const serviceId = grounding.targetProperty;
    if (!serviceId) {
      return { success: false, error: "service_call requires targetProperty as serviceId" };
    }

    // RFC-028 Finding 5: built-in Project→Task conversion. Vault grounding
    // `abdbdf09` ("Convert to task") dispatches serviceId="convertToTask".
    // The conversion only needs the target file and the frontmatter pipeline
    // already injected into this executor, so it is wired here rather than
    // requiring the plugin populator to bridge AssetConversionService through
    // a wrapper. Keeps starter-kit groundings functional with a bare core
    // ServiceRegistry (e.g. CLI usage, tests).
    if (serviceId === "convertToTask") {
      return await this.executeConvertToTask(filePath);
    }

    // RFC-028 Finding 5 completion: production vault + starter-kit groundings
    // `abdbdf09` (Convert to task) and `e8c1d18a` (Convert to project) ship
    // with `serviceId = "updateProperty"` + `targetValue` ∈ {"ems__Task",
    // "ems__Project"}.  The grounding schema overloads `targetProperty` as
    // serviceId for service_call, so at dispatch time we can detect the
    // class-flip intent from (serviceId=updateProperty, targetValue=class).
    //
    // IMPORTANT: the CommandResolver reads `Grounding_targetValue` via
    // `getObsidianWikilinkValue`, which returns different shapes depending on
    // how the underlying RDF triple is stored:
    //   - plain string literal `"ems__Task"` → stays `"ems__Task"` (CLI tests
    //     and some vaults; also matches PR #2860 unit-test fixtures).
    //   - IRI (`ems#Task`) → wrapped as `"[[ems__Task]]"` (vault production
    //     state observed 2026-04-19T14:37Z via exocortex-cli triple dump on
    //     grounding `abdbdf09`).
    // Match both shapes so whichever the parser produces dispatches correctly.
    //
    // Link-to-parent (30b9e8d8) uses the same serviceId but carries NO
    // targetValue (driven via inputSchema+userInput) and so flows past this
    // short-circuit into the registered updateProperty service below.
    if (serviceId === "updateProperty") {
      const targetClass = extractClassFromTargetValue(grounding.targetValue);
      if (targetClass === "ems__Task") {
        return await this.executeConvertToTask(filePath);
      }
      if (targetClass === "ems__Project") {
        return await this.executeConvertToProject(filePath);
      }
    }

    const service = this.serviceRegistry.get(serviceId);
    if (!service) {
      return {
        success: false,
        error: `Service not found: "${serviceId}". Registered services: ${this.serviceRegistry.getRegisteredIds().join(", ") || "none"}`,
      };
    }

    // Merge grounding.targetValue (JSON) as defaults into userInput.
    //
    // Issue #2999 (RFC 5a61a359 Phase C.0): apply substituteVariables BEFORE
    // JSON.parse so vault groundings can reference $target / $now / $today /
    // $nowLocal / $input / $value inside JSON string values. This unlocks the
    // create-instance-from-prototype pattern: a Grounding with
    //   targetValue: '{"prototype":"$target"}'
    // resolves $target to the current asset IRI, which `createAsset` then
    // writes as exo__Asset_prototype on the new instance. Substitution is
    // identical to the property_set path (substituteVariables already escapes
    // nothing — JSON safety relies on caller-supplied IRIs being safe; UUID
    // and URL IRIs in the vault contain no `"` or `\\`). Backwards compatible:
    // groundings without `$<token>` substrings are unchanged by the regex
    // pass, so existing literal-JSON targetValues (e.g. updateProperty +
    // {"property":"ems__Effort_parent"}) continue to parse identically.
    let mergedInput = userInput;
    if (grounding.targetValue) {
      try {
        const substituted = this.substituteVariables(
          grounding.targetValue,
          targetIRI,
          userInput,
        );
        const defaults = JSON.parse(substituted);
        if (typeof defaults === "object" && defaults !== null) {
          mergedInput = { ...defaults, ...(userInput ?? {}) };
        }
      } catch {
        // Not valid JSON — ignore (e.g. plain string targetValue)
      }
    }

    await service.execute(targetIRI, mergedInput);
    return { success: true };
  }

  private async executeConvertToTask(filePath: string): Promise<ExecutionResult> {
    const content = await this.fileReader.readFile(filePath);
    const updated = this.frontmatterService.updateProperty(
      content,
      "exo__Instance_class",
      `["[[ems__Task]]"]`,
    );
    await this.fileWriter.updateFile(filePath, updated);
    return { success: true };
  }

  private async executeConvertToProject(filePath: string): Promise<ExecutionResult> {
    const content = await this.fileReader.readFile(filePath);
    const updated = this.frontmatterService.updateProperty(
      content,
      "exo__Instance_class",
      `["[[ems__Project]]"]`,
    );
    await this.fileWriter.updateFile(filePath, updated);
    return { success: true };
  }

  /**
   * Frontmatter keys that must NEVER be copied from $target into a newly
   * created instance. These either identify the source asset (uid, label,
   * aliases, createdAt) or describe its lifecycle state (status, timestamps),
   * neither of which is meaningful on the new asset. exo__Instance_class is
   * blacklisted because the new instance has its own class supplied via
   * grounding.targetClass.
   */
  private static readonly CREATE_INSTANCE_BLACKLIST: ReadonlySet<string> =
    new Set([
      "exo__Asset_uid",
      "exo__Asset_createdAt",
      "exo__Asset_updatedAt",
      "exo__Instance_class",
      "exo__Asset_label",
      "aliases",
      "ems__Effort_status",
      "ems__Effort_startTimestamp",
      "ems__Effort_endTimestamp",
      "ems__Effort_resolutionTimestamp",
    ]);

  private async executeCreateInstance(
    grounding: GroundingDefinition,
    targetIRI: string,
    targetFilePath: string,
    userInput?: UserInput,
  ): Promise<ExecutionResult> {
    if (!grounding.targetFolder) {
      return { success: false, error: "create_instance requires targetFolder" };
    }

    const uid = uuidv4();
    const label = (userInput?.label as string) ?? "Untitled";

    const properties: Record<string, unknown> = {
      exo__Asset_uid: uid,
      exo__Asset_createdAt: new Date().toISOString(),
      exo__Asset_label: label,
    };

    if (label !== "Untitled") {
      properties.aliases = [label];
    }

    if (grounding.targetClass) {
      properties.exo__Instance_class = [`"[[${grounding.targetClass}]]"`];
    }

    if (grounding.targetPrototype) {
      properties.exo__Asset_prototype = `"[[${grounding.targetPrototype}]]"`;
    }

    // userInput wins over copy-from-target — apply first so the copy-loop
    // below can skip already-set keys without re-quoting.
    if (userInput) {
      for (const [key, value] of Object.entries(userInput)) {
        if (key === "label") continue;
        if (value === null || value === undefined) continue;
        properties[key] = value;
      }
    }

    // Copy-from-target: read $target frontmatter and inherit any non-blacklisted
    // property the new instance does not already have. Wikilink values are
    // re-quoted so they round-trip through the YAML serializer.
    if (targetIRI && targetFilePath) {
      let targetContent: string;
      try {
        targetContent = await this.fileReader.readFile(targetFilePath);
      } catch (error) {
        return {
          success: false,
          error: `create_instance: failed to read $target file "${targetFilePath}": ${error instanceof Error ? error.message : String(error)}`,
        };
      }

      const targetFm = this.frontmatterService.parseObject(targetContent);
      if (targetFm) {
        for (const [key, value] of Object.entries(targetFm)) {
          if (GroundingExecutor.CREATE_INSTANCE_BLACKLIST.has(key)) continue;
          if (properties[key] !== undefined) continue;
          properties[key] = this.reformatCopiedValue(value);
        }
      }
    }

    // Back-link to $target — configurable per grounding (RFC Phase 2).
    // Fallback to legacy `exo__Asset_source` preserves behaviour for existing
    // groundings that have no `Grounding_linkBackProperty` set.
    if (targetIRI) {
      const backLinkProp = grounding.linkBackProperty ?? "exo__Asset_source";
      properties[backLinkProp] = `"[[${targetIRI}]]"`;
    }

    const content = this.frontmatterService.createFrontmatter("", properties);
    const filePath = `${grounding.targetFolder}/${uid}.md`;

    await this.fileWriter.createFile(filePath, content);

    return { success: true };
  }

  /**
   * Re-quote wikilink values copied from $target frontmatter so they survive
   * round-trip through the YAML serializer. Mirrors the logic of
   * `GenericAssetCreationService.formatWikilink` so copy-from-target ассеты
   * look identical to ones produced by the modal-driven creation path.
   */
  private reformatCopiedValue(value: string | string[]): string | string[] {
    if (Array.isArray(value)) {
      return value.map((item) => this.reformatWikilink(item));
    }
    return this.reformatWikilink(value);
  }

  private reformatWikilink(value: string): string {
    if (value.startsWith('"[[') && value.endsWith(']]"')) return value;
    if (value.startsWith("[[") && value.endsWith("]]")) return `"${value}"`;
    return value;
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
      LoggingService.error(
        `[GroundingExecutor] Rollback failed for ${filePath}`,
        rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError)),
      );
    }
  }

  // -- Private: Variable Substitution --

  /**
   * Substitute custom variables in grounding values.
   * Same variables as PreconditionEvaluator for consistency.
   *
   * - $target → targetIRI (no angle brackets — this is a value, not SPARQL)
   * - $now → current ISO 8601 UTC timestamp (with milliseconds and Z suffix)
   * - $nowLocal → current local timestamp (YYYY-MM-DDTHH:mm:ss, no ms, no tz) —
   *   matches the format written by `TaskStatusService.startEffort/markTaskAsDone`,
   *   so composite groundings can chain status + timestamp writes consistently
   *   with palette commands.
   * - $today → current date (YYYY-MM-DD)
   * - $input / $value → userInput.value (RFC-028 Findings 3+4) — powers
   *   "Set Planned Start/End", "Set Scheduled Date", "Set Result" buttons.
   *   Substituted only when userInput.value is defined; callers must gate
   *   missing-input at the executePropertySet layer for fail-loud semantics.
   */
  substituteVariables(
    value: string,
    targetIRI: string,
    userInput?: UserInput,
  ): string {
    const date = new Date();
    const now = date.toISOString();
    const nowLocal = DateFormatter.toLocalTimestamp(date);
    const today = now.slice(0, 10);

    let result = value
      .replace(/\$target/g, targetIRI)
      .replace(/\$nowLocal/g, nowLocal)
      .replace(/\$now/g, now)
      .replace(/\$today/g, today);

    if (userInput?.value !== undefined && userInput.value !== null) {
      const inputStr = String(userInput.value);
      result = result.replace(/\$input\b/g, inputStr).replace(/\$value\b/g, inputStr);
    }

    return result;
  }
}
