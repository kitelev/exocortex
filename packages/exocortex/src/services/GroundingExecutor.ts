import { injectable } from "tsyringe";
import { v4 as uuidv4 } from "uuid";
import type { IFileSystemReader } from "../interfaces/IFileSystemAdapter";
import type { IFileSystemWriter } from "../interfaces/IFileSystemAdapter";
import type { GroundingDefinition } from "../domain/models/CommandDefinition";
import { GroundingType } from "../domain/constants/GroundingType";
import { FrontmatterService } from "../utilities/FrontmatterService";
import { DateFormatter } from "../utilities/DateFormatter";
import { DateTimeParsing } from "../infrastructure/sparql/filters/functions/DateTimeParsing";
import { LoggingService } from "./LoggingService";

/**
 * Result of executing a grounding action.
 *
 * `openPath` is set by `create_instance` to the vault-relative path of the
 * newly written asset; presentation layers use it to open the file in a new
 * tab after a successful run (Issue #3184 B5). Surface-agnostic — the core
 * executor only reports the path; opening is wired by the platform adapter
 * (Obsidian plugin / CLI / test harness).
 */
export interface ExecutionResult {
  readonly success: boolean;
  readonly error?: string;
  readonly openPath?: string;
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

        case GroundingType.PROPERTY_APPEND:
          return await this.executePropertyAppend(
            grounding,
            targetIRI,
            targetFilePath,
            userInput,
          );

        case GroundingType.PROPERTY_INCREMENT:
          return await this.executePropertyIncrement(
            grounding,
            targetFilePath,
          );

        case GroundingType.PROPERTY_SHIFT:
          return await this.executePropertyShift(
            grounding,
            targetFilePath,
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

    // RFC 31c1a0be Phase 3 dispatch — typed predicates take priority over
    // legacy `targetValue`. Priority: Ref > Literal > Substitution > legacy.
    // Multiple typed predicates simultaneously = fail-loud (RFC §4 cardinality).
    let effectiveValue: string | undefined;
    const typedFieldsSet = [
      grounding.targetValueRef !== undefined,
      grounding.targetValueLiteral !== undefined,
      grounding.targetValueSubstitution !== undefined,
    ].filter(Boolean).length;
    if (typedFieldsSet > 1) {
      return {
        success: false,
        error:
          "property_set: more than one of targetValueRef/targetValueLiteral/targetValueSubstitution set (cardinality 0..1 each, mutually exclusive)",
      };
    }
    if (grounding.targetValueRef !== undefined) {
      effectiveValue = `"[[${grounding.targetValueRef}]]"`;
    } else if (grounding.targetValueLiteral !== undefined) {
      effectiveValue = grounding.targetValueLiteral;
    } else if (grounding.targetValueSubstitution !== undefined) {
      effectiveValue = grounding.targetValueSubstitution;
    } else if (grounding.targetValue !== undefined) {
      // RFC 31c1a0be Phase 3 backward-compat fallback. Phase 5 removes this branch.
      effectiveValue = grounding.targetValue;
      LoggingService.warn(
        `[legacy] Grounding ${grounding.id ?? "(unknown)"} uses deprecated exocmd__Grounding_targetValue — migrate to typed predicate (Ref/Literal/Substitution) per RFC 31c1a0be`,
      );
    } else {
      return {
        success: false,
        error:
          "property_set requires one of targetValueRef/targetValueLiteral/targetValueSubstitution (or legacy targetValue)",
      };
    }

    // RFC-028 Findings 3+4: fail loudly if $input/$value placeholder is present
    // but no userInput.value is provided. Prevents silently writing the literal
    // string ("$input"/"$value") into frontmatter as a value.
    const needsUserInput = /\$(input|value)\b/.test(effectiveValue);
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
      effectiveValue,
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
    // Standalone `Grounding_isDefinedBy` wikilink (RFC follow-up): inject as a
    // default so `createAsset` (or any service_call that consumes
    // userInput.isDefinedBy) can pin owner identity without burying the link
    // inside JSON `targetValue`. Authored as a real frontmatter wikilink, the
    // identity asset's layout / backlinks list every Grounding that references
    // it. userInput from the modal still wins over this default.
    if (grounding.isDefinedBy) {
      mergedInput = { isDefinedBy: grounding.isDefinedBy, ...(mergedInput ?? {}) };
    }
    if (grounding.targetValue) {
      try {
        const substituted = this.substituteVariables(
          grounding.targetValue,
          targetIRI,
          userInput,
        );
        const defaults = JSON.parse(substituted);
        if (typeof defaults === "object" && defaults !== null) {
          // Spread the already-merged `mergedInput` (which may carry the
          // standalone `Grounding_isDefinedBy` default from the block above),
          // so JSON-derived defaults stack on top without erasing it.
          mergedInput = { ...defaults, ...(mergedInput ?? {}) };
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
   *
   * Issue #3184 B3+B4: `ems__Effort_area` and `exo__Asset_relates` are also
   * blacklisted. Both belong on the prototype-instance (the asset the user
   * clicked); inheriting them into a created instance double-materialises the
   * link that `exo__Asset_prototype` (back-link, see executeCreateInstance)
   * already implies through the RDF graph.
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
      "ems__Effort_area",
      "exo__Asset_relates",
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
      // Issue #3188: emit `exo__Asset_createdAt` as a local timestamp without
      // the trailing `Z` / TZ offset, matching every other creation service
      // in the codebase (Generic/Area/Class/Concept/Supervision asset
      // creation) and the `$nowLocal` substitution token used by composite
      // groundings. The legacy `new Date().toISOString()` produced
      // UTC-suffixed values which then disagreed with the rest of the vault
      // when rendered in the user's local timezone; this one-liner aligns
      // the format.
      exo__Asset_createdAt: DateFormatter.toLocalTimestamp(new Date()),
      exo__Asset_label: label,
    };

    if (label !== "Untitled") {
      properties.aliases = [label];
    }

    if (grounding.targetClass) {
      properties.exo__Instance_class = [`"[[${grounding.targetClass}]]"`];
    }

    // Issue #3184 B1: do NOT materialise `grounding.targetPrototype` (which is
    // the UID of the prototype CLASS, e.g. `ems__TaskPrototype`) into the new
    // instance's `exo__Asset_prototype`. The semantically correct value is the
    // wikilink to the prototype-INSTANCE the user clicked on ($target), and
    // that link is written below by the back-link block whose default for
    // create_instance is now `exo__Asset_prototype` (B2). Keeping a literal
    // class-UID write here would either overwrite the correct back-link value
    // or be silently overwritten — both confusing.

    // Issue #3136 (Q3.b closure): apply propertyDefaults BEFORE userInput so
    // user input wins. Values are passed through substituteVariables, enabling
    // declarative use of `$today` / `$todayStart` / `$targetFolder` / `$target`
    // (replacing the legacy `createTaskForDailyNote` service_call).
    if (grounding.propertyDefaults) {
      for (const [key, rawValue] of Object.entries(grounding.propertyDefaults)) {
        if (typeof rawValue !== "string") continue;
        properties[key] = this.substituteVariables(
          rawValue,
          targetIRI,
          userInput,
          undefined,
          targetFilePath,
        );
      }
    }

    // userInput wins over propertyDefaults and over copy-from-target — apply
    // here so the copy-loop below can skip already-set keys without re-quoting.
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
    //
    // Issue #3184 B1+B2: default for `create_instance` is `exo__Asset_prototype`,
    // not `exo__Asset_source`. The prototype-driven creation flow always links
    // the new instance back to the prototype-instance via `exo__Asset_prototype`,
    // and the separate `exo__Asset_source` field added nothing but duplication
    // (and a confusing extra wikilink in the resulting frontmatter). Groundings
    // that genuinely want a different back-link target (e.g. `ems__Effort_parent`
    // for fork-style "Create related task") still set `linkBackProperty`
    // explicitly and bypass the default.
    if (targetIRI) {
      const backLinkProp =
        grounding.linkBackProperty ?? "exo__Asset_prototype";
      const backLinkTarget = GroundingExecutor.extractBacklinkTarget(targetIRI, targetFilePath);
      properties[backLinkProp] = `"[[${backLinkTarget}]]"`;
    }

    const content = this.frontmatterService.createFrontmatter("", properties);
    // Issue #3136 (Q3.b closure): allow `$targetFolder` / `$target` tokens in
    // `grounding.targetFolder` so new instances can inherit the target's
    // parent folder declaratively (replacing legacy `createTaskForDailyNote`).
    const resolvedFolder = this.substituteVariables(
      grounding.targetFolder,
      targetIRI,
      userInput,
      undefined,
      targetFilePath,
    );
    const filePath = resolvedFolder ? `${resolvedFolder}/${uid}.md` : `${uid}.md`;

    await this.fileWriter.createFile(filePath, content);

    // Issue #3184 B5: surface the created file's vault-relative path so the
    // presentation layer can open it in a new tab. Core stays surface-agnostic
    // — actually opening the file is wired by the platform adapter through
    // CommandExecutionFlow's optional IFileOpener dependency.
    return { success: true, openPath: filePath };
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
   *   matches the canonical `DateFormatter.toLocalTimestamp()` output, so
   *   composite groundings (Mark Done, Start Effort, etc.) write the same
   *   shape as every other effort/asset timestamp in the codebase.
   * - $today → current date (YYYY-MM-DD)
   * - $todayStart → today at local midnight (YYYY-MM-DDT00:00:00, no TZ) —
   *   matches `DateFormatter.getTodayStartTimestamp()`. A declarative
   *   `property_set` with `$todayStart` is byte-identical to the legacy
   *   `planOnToday` service_call output (removed in Issue #3136).
   * - $targetFolder → parent folder (vault-relative) of the $target file.
   *   Resolves to empty string when target is at the vault root. Available
   *   only when callers pass `targetFilePath`; fail-fast otherwise.
   * - $input / $value → userInput.value (RFC-028 Findings 3+4) — powers
   *   "Set Planned Start/End", "Set Scheduled Date", "Set Result" buttons.
   *   Substituted only when userInput.value is defined; callers must gate
   *   missing-input at the executePropertySet layer for fail-loud semantics.
   */
  substituteVariables(
    value: string,
    targetIRI: string,
    userInput?: UserInput,
    targetFrontmatter?: Record<string, string | string[]>,
    targetFilePath?: string,
  ): string {
    const date = new Date();
    const now = date.toISOString();
    const nowLocal = DateFormatter.toLocalTimestamp(date);
    const today = now.slice(0, 10);
    const todayStart = `${today}T00:00:00`;

    // Issue #3132: `$target.<propertyName>` reads from target asset
    // frontmatter. MUST run before bare `$target` substitution (more-specific
    // first), otherwise `$target.foo` would become `<IRI>.foo`. If
    // targetFrontmatter is not supplied (e.g. legacy property_set call sites),
    // any `$target.<prop>` token throws — fail-loud, never silently emits a
    // half-substituted literal.
    let result = value.replace(/\$target\.([A-Za-z_][\w]*)/g, (_, prop) => {
      if (!targetFrontmatter) {
        throw new Error(
          `$target.${prop} substitution requires target frontmatter context; ` +
            `none was supplied (asset IRI: ${targetIRI})`,
        );
      }
      const fmValue = targetFrontmatter[prop];
      if (fmValue === undefined || fmValue === null) {
        throw new Error(
          `$target.${prop} is undefined on asset ${targetIRI}`,
        );
      }
      if (Array.isArray(fmValue)) {
        // Array properties cannot be substituted into a scalar position —
        // refuse rather than emit YAML-like `[a, b]` literal.
        throw new Error(
          `$target.${prop} resolved to an array on asset ${targetIRI}; ` +
            `only scalar properties are supported for substitution`,
        );
      }
      // Strip surrounding YAML quotes if present (parseObject preserves them).
      return String(fmValue).replace(/^["'](.*)["']$/, "$1");
    });

    // $targetFolder is resolved BEFORE the generic `$target` substitution so
    // the latter does not consume the `$target` prefix and leave `Folder`
    // behind. Same applies to $todayStart vs $today below.
    if (/\$targetFolder\b/.test(result)) {
      if (!targetFilePath) {
        throw new Error(
          "$targetFolder substitution requires targetFilePath context; " +
            "none was supplied (asset IRI: " + targetIRI + ")",
        );
      }
      const normalized = targetFilePath.replace(/^\/+/, "");
      const slashIdx = normalized.lastIndexOf("/");
      const targetFolder = slashIdx >= 0 ? normalized.slice(0, slashIdx) : "";
      result = result.replace(/\$targetFolder\b/g, targetFolder);
    }

    result = result
      .replace(/\$target/g, targetIRI)
      .replace(/\$nowLocal/g, nowLocal)
      .replace(/\$now/g, now)
      .replace(/\$todayStart\b/g, todayStart)
      .replace(/\$today/g, today);

    if (userInput?.value !== undefined && userInput.value !== null) {
      const inputStr = String(userInput.value);
      result = result.replace(/\$input\b/g, inputStr).replace(/\$value\b/g, inputStr);
    }

    return result;
  }

  /**
   * Append a resolved value to a frontmatter array property with Set-based
   * dedup. Issue #3132 — declarative replacement for `service_call` /
   * `copyLabelToAliases` (Homoiconicity Invariant Q1).
   *
   * Reads:
   * - `grounding.targetProperty` — array property to append to (e.g. `aliases`).
   * - `grounding.targetValue` — value to append, with substituteVariables
   *   resolution (supports `$target.<prop>` dotted-property reads from target
   *   asset frontmatter).
   *
   * Behavior:
   * - Empty / missing array → write `[resolvedValue]`.
   * - Existing array without value → append.
   * - Existing array containing value → no-op (idempotent — Set-based dedup).
   *
   * Errors (plain Error with structured message — `GroundingError` class is
   * not yet introduced in the codebase; existing executors also use Error):
   * - Missing `targetProperty` / `targetValue` on the grounding definition.
   * - `$target.<prop>` resolved to undefined / null / array.
   */
  private async executePropertyAppend(
    grounding: GroundingDefinition,
    targetIRI: string,
    filePath: string,
    userInput?: UserInput,
  ): Promise<ExecutionResult> {
    if (!grounding.targetProperty) {
      return {
        success: false,
        error: "property_append requires targetProperty",
      };
    }
    if (grounding.targetValue === undefined) {
      return {
        success: false,
        error: "property_append requires targetValue",
      };
    }

    const content = await this.fileReader.readFile(filePath);
    const targetFrontmatter =
      this.frontmatterService.parseObject(content) ?? {};

    const resolvedValue = this.substituteVariables(
      grounding.targetValue,
      targetIRI,
      userInput,
      targetFrontmatter,
    );

    const existingRaw = targetFrontmatter[grounding.targetProperty];
    const existing: string[] = Array.isArray(existingRaw)
      ? existingRaw
      : existingRaw !== undefined
        ? [String(existingRaw)]
        : [];

    // Set-based dedup. Compare against unquoted form so a stored
    // `"Foo"` (with YAML quotes) does not duplicate a plain `Foo`.
    const stripQuotes = (s: string): string =>
      s.replace(/^["'](.*)["']$/, "$1");
    const seen = new Set(existing.map(stripQuotes));
    let merged: string[];
    if (seen.has(stripQuotes(resolvedValue))) {
      merged = existing;
    } else {
      // Preserve YAML-quoted form for string values to round-trip safely
      // through serializeValue (matches LabelToAliasService behavior).
      const formatted = `"${stripQuotes(resolvedValue)}"`;
      merged = [...existing, formatted];
    }

    const updated = this.frontmatterService.updateProperty(
      content,
      grounding.targetProperty,
      merged,
    );
    await this.fileWriter.updateFile(filePath, updated);

    return { success: true };
  }

  /**
   * Increment an integer frontmatter property by `incrementBy` (default 1).
   * Issue #3134 — declarative replacement for `service_call` /
   * `incrementVotes` (Homoiconicity Invariant Q1).
   *
   * Behaviour:
   * - Missing property → write `incrementBy` (treats current as 0).
   * - Existing int → write `current + incrementBy` (preserves YAML int).
   * - Negative delta supported.
   * - YAML-quoted string ("5") is also accepted and coerced to int per
   *   ontology range — output is always emitted as bare int.
   *
   * Errors (returned as { success: false, error }):
   * - Missing `targetProperty` on grounding.
   * - Current value not parseable as integer (e.g. "abc" or "1.5").
   */
  private async executePropertyIncrement(
    grounding: GroundingDefinition,
    filePath: string,
  ): Promise<ExecutionResult> {
    if (!grounding.targetProperty) {
      return {
        success: false,
        error: "property_increment requires targetProperty",
      };
    }

    const delta = grounding.incrementBy ?? 1;
    if (!Number.isFinite(delta) || !Number.isInteger(delta)) {
      return {
        success: false,
        error: `property_increment: incrementBy must be an integer (got ${String(grounding.incrementBy)})`,
      };
    }

    const content = await this.fileReader.readFile(filePath);
    const fm = this.frontmatterService.parseObject(content) ?? {};
    const raw = fm[grounding.targetProperty];

    let current: number;
    if (raw === undefined || raw === null || raw === "") {
      current = 0;
    } else if (Array.isArray(raw)) {
      return {
        success: false,
        error: `property_increment: targetProperty "${grounding.targetProperty}" is an array, expected integer`,
      };
    } else {
      // Strip optional YAML quotes (FrontmatterService.parseObject preserves
      // them for string values). Then require strict integer literal.
      const unquoted = String(raw).replace(/^["'](.*)["']$/, "$1").trim();
      if (!/^-?\d+$/.test(unquoted)) {
        return {
          success: false,
          error: `property_increment: targetProperty "${grounding.targetProperty}" current value "${String(raw)}" is not a valid integer`,
        };
      }
      current = Number.parseInt(unquoted, 10);
    }

    const next = current + delta;
    const updated = this.frontmatterService.updateProperty(
      content,
      grounding.targetProperty,
      next,
    );
    await this.fileWriter.updateFile(filePath, updated);
    return { success: true };
  }

  /**
   * Shift a datetime frontmatter property by an ISO-8601 duration literal.
   * Issue #3134 — declarative replacement for `service_call` / `shiftDay`
   * (Homoiconicity Invariant Q1).
   *
   * Accepts xsd:dayTimeDuration (`P1D`, `-PT2H`, `P1DT12H`) and
   * xsd:yearMonthDuration (`P1M`, `P1Y2M`) shapes. Day-time durations are
   * applied via Date arithmetic (`new Date(getTime() + ms)`); year-month
   * durations use `setMonth(getMonth() + months)`, inheriting JS Date's
   * month-end normalization (Jan 31 + P1M → Mar 03 in non-leap years; see
   * tests for the documented behaviour).
   *
   * Output is formatted via DateFormatter.toLocalTimestamp — no TZ suffix —
   * matching the canonical effort-timestamp shape (RFC-009 +
   * BehavioralRule [[609e78ed-56aa-4697-8d9c-af9efde32c10]]).
   *
   * Errors (returned as { success: false, error }):
   * - Missing `targetProperty` or `shiftDelta` on grounding.
   * - Current value undefined or not parseable as a datetime.
   * - shiftDelta is not a valid ISO-8601 duration literal.
   */
  private async executePropertyShift(
    grounding: GroundingDefinition,
    filePath: string,
  ): Promise<ExecutionResult> {
    if (!grounding.targetProperty) {
      return {
        success: false,
        error: "property_shift requires targetProperty",
      };
    }
    if (!grounding.shiftDelta) {
      return {
        success: false,
        error: "property_shift requires shiftDelta (ISO-8601 duration literal)",
      };
    }

    const content = await this.fileReader.readFile(filePath);
    const fm = this.frontmatterService.parseObject(content) ?? {};
    const raw = fm[grounding.targetProperty];

    if (raw === undefined || raw === null || raw === "") {
      return {
        success: false,
        error: `property_shift: targetProperty "${grounding.targetProperty}" is not set on target asset`,
      };
    }
    if (Array.isArray(raw)) {
      return {
        success: false,
        error: `property_shift: targetProperty "${grounding.targetProperty}" is an array, expected single datetime`,
      };
    }

    const currentStr = String(raw).replace(/^["'](.*)["']$/, "$1").trim();
    const currentDate = new Date(currentStr);
    if (Number.isNaN(currentDate.getTime())) {
      return {
        success: false,
        error: `property_shift: current value "${currentStr}" is not a valid datetime`,
      };
    }

    // Parse duration — auto-detect day-time vs year-month shape.
    let shifted: Date;
    try {
      shifted = GroundingExecutor.applyIsoDuration(currentDate, grounding.shiftDelta);
    } catch (error) {
      return {
        success: false,
        error: `property_shift: invalid shiftDelta "${grounding.shiftDelta}": ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const nextTimestamp = DateFormatter.toLocalTimestamp(shifted);
    const updated = this.frontmatterService.updateProperty(
      content,
      grounding.targetProperty,
      nextTimestamp,
    );
    await this.fileWriter.updateFile(filePath, updated);
    return { success: true };
  }

  /**
   * Apply an ISO-8601 duration to a Date. Auto-detects xsd:yearMonthDuration
   * (PnY[mM] / Pn M — no T component, no day) vs xsd:dayTimeDuration (PnDTnH…)
   * by checking for a `T` separator or a day/time component. Throws on
   * unparseable literals (delegated to DateTimeParsing helpers).
   *
   * For year-month durations: uses JS `setMonth` semantics (Jan 31 + P1M
   * overflows into March in non-leap years — documented behaviour, matches
   * Date.prototype.setMonth contract; no leap-year compensation invented).
   */
  private static applyIsoDuration(date: Date, literal: string): Date {
    const trimmed = literal.trim();
    // Heuristic: a year-month duration is P[-]?nY[mM] or P[-]?nM with no T.
    // A day-time duration has a D component or a T separator.
    const isYearMonth = /^-?P(\d+Y)(\d+M)?$|^-?P\d+M$/.test(trimmed);
    if (isYearMonth) {
      const months = DateTimeParsing.parseYearMonthDuration(trimmed);
      const result = new Date(date.getTime());
      result.setMonth(result.getMonth() + months);
      return result;
    }
    // Fallback: day-time duration (P1D, PT2H, -PT2H30M, P1DT12H, ...).
    const ms = DateTimeParsing.parseDayTimeDuration(trimmed);
    return new Date(date.getTime() + ms);
  }

  /**
   * Derive a stable wikilink target (vault-relative path, no `.md` suffix) for
   * the back-link property write. Falls back to decoding the `obsidian://` URL
   * when no fs path is provided. Without this normalization the executor would
   * emit `[[obsidian://vault/.../<uid>.md]]` instead of the desired
   * `[[<folder>/<basename>]]` form that Obsidian resolves directly.
   */
  private static extractBacklinkTarget(targetIRI: string, targetFilePath: string): string {
    if (targetFilePath) {
      return targetFilePath.replace(/\.md$/i, "").replace(/^\/+/, "");
    }
    if (targetIRI) {
      const m = targetIRI.match(/^obsidian:\/\/vault\/(.+?)(?:\.md)?(?:\?|#|$)/i);
      if (m && m[1]) {
        try {
          return decodeURIComponent(m[1]);
        } catch {
          return m[1];
        }
      }
    }
    return targetIRI;
  }
}
