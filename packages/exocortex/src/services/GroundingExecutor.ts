import { injectable } from "tsyringe";
import type { IFileSystemReader } from "../interfaces/IFileSystemAdapter";
import type { IFileSystemWriter } from "../interfaces/IFileSystemAdapter";
import type { IClock } from "./IClock";
import { liveClock } from "./IClock";
import type { IUidGenerator } from "./IUidGenerator";
import { liveUidGenerator } from "./IUidGenerator";
import type {
  GroundingDefinition,
  InheritanceRuleResolved,
  PropertyDefaultResolved,
} from "../domain/models/CommandDefinition";
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
 * RFC 918a2b65 Phase 2 — translate a `Grounding_targetValueRef` value into a
 * class label for the `service_call/updateProperty` class-flip dispatch
 * (Convert to Task / Convert to Project). The ref arrives as one of:
 *   - bare label `"ems__Task"` (older vault clones, test fixtures, CLI usage
 *     without TBox warm-up);
 *   - bare UUID `"1b20a8f0-..."` (post-#3165 migration, UUID-canon TBox).
 *
 * Returns the class label (`"ems__Task"` or `"ems__Project"`) if recognised;
 * undefined otherwise. Coupled to the same two classes the legacy
 * `extractClassFromTargetValue` recognises — extending this requires a
 * separate RFC for class-flip generalisation (`class_convert` grounding type).
 */
function resolveClassFlipTarget(
  ref: string | undefined,
): string | undefined {
  if (!ref) return undefined;
  // UUID-canon match — the only two class-flip targets in scope today.
  if (ref === "1b20a8f0-d745-4e93-91db-4531b3df120e") return "ems__Task";
  if (ref === "7db5eeff-718a-49b0-8d2b-39b084a356e3") return "ems__Project";
  // Bare label match (CommandResolver may have downgraded to label-form when
  // the class TBox file was absent from the resolution store, see #3220).
  if (ref === "ems__Task" || ref === "ems__Project") return ref;
  return undefined;
}

/**
 * Input parameters collected from the user (for service_call groundings).
 * UI layer collects these via modals; CLI via interactive prompts or --arg flags.
 */
export type UserInput = Record<string, unknown>;

/**
 * Issue #3220 — execution-time class-label → canonical-UID resolver.
 *
 * `create_instance` writes `exo__Instance_class` from `grounding.targetClass`.
 * That value may arrive in label-form (e.g. `"ems__Task"`) instead of the
 * UUID-canon form (`"1b20a8f0-..."`) whenever the command was resolved against
 * a store that does NOT contain the class TBox file — which is exactly what
 * the cold-start resolution paths use:
 *
 *   - `ExocmdFastResolver` (#3171) builds a mini-store from the open asset
 *     plus `assetspaces/exocmd/*.md` only — never `assetspaces/ems` where the
 *     UUID-named class TBox files live.
 *   - the persisted binding cache (#3183) yields `ResolvedCommand`s whose
 *     `grounding.targetClass` was baked at write time and survives an Obsidian
 *     restart on disk.
 *
 * In both cases `CommandResolver.findUidByLabel` (#3212) returns null for lack
 * of the TBox label triple, so the grounding bakes the bare label. Re-resolving
 * here, at execution time, against an always-warm source (the Obsidian metadata
 * cache, injected by the plugin) guarantees UID-form regardless of which path
 * produced the grounding. A `null` return (no resolver wired, test/CLI harness,
 * unknown label) leaves the ref untouched — backward-compatible label-form.
 */
export type ClassLabelToUidResolver = (
  label: string,
) => string | null | Promise<string | null>;

/** UUID-v4 sniff used to skip resolution for already-canonical class refs. */
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * RFC v2 Phase 3a marker emitted by CommandResolver for context-dependent
 * SubstitutionToken resolvers (`target`, `targetFolder`). Context-independent
 * resolvers (`today`, `todayStart`) are resolved at parse time and never reach
 * the executor in marker form. Shape: `__SUBSTITUTE__<resolver-id>__<token-uid>__`.
 *
 * Phase 3b executor recognises this exact shape and substitutes the resolved
 * value at execution time when the click-target IRI / file path is known.
 */
const SUBSTITUTION_MARKER_RE =
  /^__SUBSTITUTE__(target|targetFolder)__[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}__$/;

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
  private readonly classLabelToUid?: ClassLabelToUidResolver;
  private readonly clock: IClock;
  private readonly uidGen: IUidGenerator;

  constructor(
    fileReader: IFileSystemReader,
    fileWriter: IFileSystemWriter,
    serviceRegistry: ServiceRegistry,
    // Issue #3220 — optional. When omitted (tests, CLI, headless runners) the
    // executor preserves its prior label-form behaviour for class refs that
    // arrived non-canonical. The Obsidian plugin injects a metadata-cache-
    // backed implementation so production create_instance always emits UID-form.
    classLabelToUid?: ClassLabelToUidResolver,
    options?: { clock?: IClock; uidGenerator?: IUidGenerator },
  ) {
    this.frontmatterService = new FrontmatterService();
    this.fileReader = fileReader;
    this.fileWriter = fileWriter;
    this.serviceRegistry = serviceRegistry;
    this.classLabelToUid = classLabelToUid;
    this.clock = options?.clock ?? liveClock();
    this.uidGen = options?.uidGenerator ?? liveUidGenerator();
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

    // RFC 31c1a0be Phase 5a — typed predicates only.
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
    } else {
      return {
        success: false,
        error:
          "property_set requires one of targetValueRef/targetValueLiteral/targetValueSubstitution",
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
          "property_set: substituted value contains $input/$value placeholder but no userInput.value provided",
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
      // RFC 918a2b65 Phase 2 — priority chain: targetValueRef (typed) wins,
      // legacy targetValue (string/wikilink) is the deprecated fallback.
      // targetValueRef is the canonical class-flip predicate after Phase 5b;
      // it can be either UUID-canon (post-#3165 migration) or bare label
      // (older stores without TBox lookup). Both shapes are accepted.
      const refClass = resolveClassFlipTarget(grounding.targetValueRef);
      if (refClass === "ems__Task") {
        return await this.executeConvertToTask(filePath);
      }
      if (refClass === "ems__Project") {
        return await this.executeConvertToProject(filePath);
      }
      const legacyClass = extractClassFromTargetValue(grounding.targetValue);
      if (legacyClass === "ems__Task") {
        return await this.executeConvertToTask(filePath);
      }
      if (legacyClass === "ems__Project") {
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
    // RFC 918a2b65 Phase 2 — priority chain: serviceCallPayload (typed) first,
    // legacy targetValue is the deprecated fallback. CommandResolver emits a
    // one-shot deprecation warn at parse time when targetValue is used for
    // service_call/property_append, so this dispatch stays silent. Both fields
    // may briefly coexist mid-migration — the typed predicate wins definitively.
    const payloadSource = grounding.serviceCallPayload ?? grounding.targetValue;
    if (payloadSource) {
      try {
        const substituted = this.substituteVariables(
          payloadSource,
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
        // Not valid JSON — ignore (e.g. plain string targetValue used as class
        // ref for `updateProperty` class-flip dispatch handled above).
      }
    }

    await service.execute(targetIRI, mergedInput);
    return { success: true };
  }

  private async executeConvertToTask(filePath: string): Promise<ExecutionResult> {
    const content = await this.fileReader.readFile(filePath);
    // Issue #3222: route the hardcoded class label through the same
    // execution-time resolver as create_instance (#3220) so the written
    // exo__Instance_class is UUID-canon when a resolver is wired; falls back
    // to label-form for tests/CLI/headless. See resolveClassRefToUid.
    const classRef = await this.resolveClassRefToUid("ems__Task");
    const updated = this.frontmatterService.updateProperty(
      content,
      "exo__Instance_class",
      `["[[${classRef}]]"]`,
    );
    await this.fileWriter.updateFile(filePath, updated);
    return { success: true };
  }

  private async executeConvertToProject(filePath: string): Promise<ExecutionResult> {
    const content = await this.fileReader.readFile(filePath);
    // Issue #3222: see executeConvertToTask — same UID-canon resolution.
    const classRef = await this.resolveClassRefToUid("ems__Project");
    const updated = this.frontmatterService.updateProperty(
      content,
      "exo__Instance_class",
      `["[[${classRef}]]"]`,
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

    const uid = this.uidGen.next();
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
      exo__Asset_createdAt: DateFormatter.toLocalTimestamp(this.clock.now()),
      exo__Asset_label: label,
    };

    if (label !== "Untitled") {
      properties.aliases = [label];
    }

    if (grounding.targetClass) {
      // Issue #3220: re-resolve label-form refs to UID at execution time. See
      // {@link ClassLabelToUidResolver} for why resolver-time resolution
      // (CommandResolver.findUidByLabel, #3212) is insufficient in production
      // cold-start paths. Already-UUID refs and unresolvable labels pass through.
      const classRef = await this.resolveClassRefToUid(grounding.targetClass);
      properties.exo__Instance_class = [`"[[${classRef}]]"`];
    }

    // Issue #3184 B1: do NOT materialise `grounding.targetPrototype` (which is
    // the UID of the prototype CLASS, e.g. `ems__TaskPrototype`) into the new
    // instance's `exo__Asset_prototype`. The semantically correct value is the
    // wikilink to the prototype-INSTANCE the user clicked on ($target), and
    // that link is written below by the back-link block whose default for
    // create_instance is now `exo__Asset_prototype` (B2). Keeping a literal
    // class-UID write here would either overwrite the correct back-link value
    // or be silently overwritten — both confusing.

    // RFC v2 Phase 3b — Step 2 (PropertyDefault, declarative ref-form).
    // Apply ref-form PropertyDefaults from `grounding.propertyDefault` (parser
    // emits resolved values for `today` / `todayStart` and
    // `__SUBSTITUTE__<resolver>__<token-uid>__` markers for `target` /
    // `targetFolder`; executor substitutes the markers at runtime when the
    // click-target context is known). PropertyDefault explicitly bypasses
    // CREATE_INSTANCE_BLACKLIST per RFC v2 §Precedence — blacklist applies ONLY
    // to copy-from-target step 4. The legacy JSON-literal `propertyDefaults`
    // path was removed in RFC v2 Phase 5 (#3167) after vault migration to
    // ref-form completed (Phase 4a, #3165).
    if (grounding.propertyDefault && grounding.propertyDefault.length > 0) {
      this.applyPropertyDefaultStep(
        properties,
        grounding.propertyDefault,
        targetIRI,
        targetFilePath,
      );
    }

    // userInput wins over PropertyDefault and over copy-from-target — apply
    // here so the copy-loop below can skip already-set keys without re-quoting.
    if (userInput) {
      for (const [key, value] of Object.entries(userInput)) {
        if (key === "label") continue;
        if (value === null || value === undefined) continue;
        properties[key] = value;
      }
    }

    // Parse $target frontmatter once — shared by Step 3 (InheritanceRule, reads
    // source-property values) and Step 4 (copy-from-target, fills gaps).
    let targetFm: Record<string, string | string[]> | null = null;
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
      targetFm = this.frontmatterService.parseObject(targetContent) ?? null;
    }

    // RFC v2 Phase 3b — Step 3 (InheritanceRule, declarative ref-form).
    // Apply each applicable rule (condition match, exclusion non-match) in
    // priority-descending order. Like Step 2, this bypasses CREATE_INSTANCE_BLACKLIST
    // — `ems__Effort_area` and `ems__Effort_parent` are in the BLACKLIST but
    // are LEGITIMATE inheritance targets per RFC. Step 3 only writes keys not
    // already set by Steps 1 (userInput) or 2 (PropertyDefault).
    if (
      grounding.inheritanceRule &&
      grounding.inheritanceRule.length > 0 &&
      targetFm
    ) {
      await this.applyInheritanceRuleStep(
        properties,
        grounding.inheritanceRule,
        targetFm,
      );
    }

    // Step 4: Copy-from-target — read $target frontmatter and inherit any
    // non-blacklisted property the new instance does not already have.
    // Wikilink values are re-quoted so they round-trip through the YAML
    // serializer. BLACKLIST applies ONLY here per RFC v2 §Precedence.
    if (targetFm) {
      for (const [key, value] of Object.entries(targetFm)) {
        if (GroundingExecutor.CREATE_INSTANCE_BLACKLIST.has(key)) continue;
        if (properties[key] !== undefined) continue;
        properties[key] = this.reformatCopiedValue(value);
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
   * Issue #3220 — resolve a class reference to its canonical UUID at execution
   * time, falling back to the original ref when resolution is unavailable.
   *
   * Skips already-UUID refs (full-path resolution + the parser-layer bypass
   * #3212/#3214 already produce these). For label-form refs (the cold-start
   * gap), delegates to the injected {@link ClassLabelToUidResolver}; a missing
   * resolver, a `null`/empty result, or a thrown error all preserve the prior
   * label-form behaviour rather than failing the creation.
   */
  private async resolveClassRefToUid(classRef: string): Promise<string> {
    if (UUID_V4_RE.test(classRef)) return classRef;
    if (!this.classLabelToUid) return classRef;
    try {
      const uid = await this.classLabelToUid(classRef);
      return uid && uid.length > 0 ? uid : classRef;
    } catch {
      return classRef;
    }
  }

  /**
   * RFC v2 Phase 3b — Step 2 implementation. Apply ref-form PropertyDefaults
   * declared by the Grounding via `exocmd__Grounding_propertyDefault`.
   *
   * Higher-priority steps (userInput) already populated `properties`; this
   * step only writes keys not already set. Values flow from CommandResolver
   * (Phase 3a) either fully-resolved (e.g. `today` → `2026-05-23`) or as
   * `__SUBSTITUTE__<resolver-id>__<token-uid>__` markers for context-dependent
   * resolvers (`target`, `targetFolder`) that the executor swaps in at runtime.
   *
   * Bypasses `CREATE_INSTANCE_BLACKLIST` by design — `ems__Effort_status` is
   * blacklisted (to prevent literal copy-from-target) but PropertyDefault MUST
   * be able to set it. RFC v2 §Precedence: BLACKLIST scopes only Step 4.
   */
  private applyPropertyDefaultStep(
    properties: Record<string, unknown>,
    propertyDefault: ReadonlyArray<PropertyDefaultResolved>,
    targetIRI: string,
    targetFilePath: string,
  ): void {
    for (const { propertyName, value } of propertyDefault) {
      if (properties[propertyName] !== undefined) continue;
      properties[propertyName] = this.resolveSubstitutionMarker(
        value,
        targetIRI,
        targetFilePath,
      );
    }
  }

  /**
   * Swap context-dependent SubstitutionToken markers for runtime-resolved
   * values. Non-marker strings pass through unchanged.
   *
   * - `__SUBSTITUTE__target__<uid>__` → `"[[<target-uid>]]"` where target-uid is
   *   the canonical UID-or-path emitted by {@link extractBacklinkTarget}.
   * - `__SUBSTITUTE__targetFolder__<uid>__` → vault-relative folder portion of
   *   `targetFilePath`. Empty string when target is at vault root.
   *
   * Unknown markers (defensive — parser whitelists resolver-ids upstream) and
   * non-marker strings are returned unchanged so production callers keep
   * receiving the parser's literal output.
   */
  private resolveSubstitutionMarker(
    value: string,
    targetIRI: string,
    targetFilePath: string,
  ): string {
    const match = value.match(SUBSTITUTION_MARKER_RE);
    if (!match) return value;
    const resolverId = match[1];
    if (resolverId === "target") {
      const bare = GroundingExecutor.extractBacklinkTarget(
        targetIRI,
        targetFilePath,
      );
      return `"[[${bare}]]"`;
    }
    if (resolverId === "targetFolder") {
      if (!targetFilePath) return "";
      const normalized = targetFilePath.replace(/^\/+/, "");
      const slashIdx = normalized.lastIndexOf("/");
      return slashIdx >= 0 ? normalized.slice(0, slashIdx) : "";
    }
    return value;
  }

  /**
   * RFC v2 Phase 3b — Step 3 implementation. Apply ref-form InheritanceRules
   * declared by the Grounding via `exocmd__Grounding_inheritanceRule`.
   *
   * Resolution per RFC v2 §Precedence:
   *   1. Filter rules where `targetClassCondition` is absent OR matches one of
   *      the target's classes (`exo__Instance_class` is multi-valued).
   *   2. Filter out rules where ANY `targetClassExclusion` matches a target class.
   *   3. Sort by `priority` desc (stable — JS Array.sort is stable since ES2019).
   *   4. Apply: for each rule, read `sourcePropertyName` from target frontmatter,
   *      write it to `targetPropertyName` on the new instance — only if no
   *      higher-priority step (userInput / PropertyDefault) already set it.
   *      Higher-priority rules within Step 3 also win because the
   *      `properties[key] !== undefined` guard fires once any rule has written.
   *
   * Like Step 2, this bypasses CREATE_INSTANCE_BLACKLIST (`ems__Effort_area`
   * / `ems__Effort_parent` are intentional inheritance targets — BLACKLIST
   * scopes only Step 4 copy-from-target).
   *
   * Source-value formatting handles two common shapes:
   * - Bare UUID (e.g. target's `exo__Asset_uid`) → wrapped as `"[[<uid>]]"`
   *   so the new asset's frontmatter receives a valid wikilink.
   * - Already wikilink-form (e.g. target's `exo__Asset_isDefinedBy`) → passed
   *   through `reformatWikilink` for YAML round-trip safety.
   */
  private async applyInheritanceRuleStep(
    properties: Record<string, unknown>,
    inheritanceRule: ReadonlyArray<InheritanceRuleResolved>,
    targetFm: Record<string, string | string[]>,
  ): Promise<void> {
    const targetClassNames = this.extractTargetClassNames(targetFm);

    const applicable: InheritanceRuleResolved[] = [];
    for (const rule of inheritanceRule) {
      const conditionOk = await this.inheritanceConditionMatches(
        rule.targetClassCondition,
        targetClassNames,
      );
      if (!conditionOk) continue;
      const excluded = await this.inheritanceExclusionMatches(
        rule.targetClassExclusion,
        targetClassNames,
      );
      if (excluded) continue;
      applicable.push(rule);
    }

    // Sort by priority descending; JS Array.sort is stable (ES2019+), so equal
    // priorities preserve the authoring/triple-store order — deterministic.
    applicable.sort((a, b) => b.priority - a.priority);

    for (const rule of applicable) {
      if (properties[rule.targetPropertyName] !== undefined) continue;
      const sourceValue = targetFm[rule.sourcePropertyName];
      if (sourceValue === undefined || sourceValue === null) continue;
      properties[rule.targetPropertyName] = this.formatInheritedValue(
        sourceValue,
      );
    }
  }

  /**
   * Check if a class condition matches any of the target's classes. Absent
   * condition = unconditional rule (always matches).
   *
   * Matching is dual-form: direct symbolic equality (target authored with
   * `[[ems__Area]]` style) OR via the injected ClassLabelToUidResolver
   * (target authored with UID-canon `[[82c74542-...]]`). Resolver absence /
   * failure falls back to direct-only — backward-compatible with test/CLI
   * harnesses that don't wire the Obsidian metadata-cache adapter.
   */
  private async inheritanceConditionMatches(
    condition: string | undefined,
    targetClassNames: string[],
  ): Promise<boolean> {
    if (!condition) return true;
    return this.classMatchesAny(condition, targetClassNames);
  }

  private async inheritanceExclusionMatches(
    exclusions: readonly string[],
    targetClassNames: string[],
  ): Promise<boolean> {
    for (const ex of exclusions) {
      if (await this.classMatchesAny(ex, targetClassNames)) return true;
    }
    return false;
  }

  private async classMatchesAny(
    label: string,
    targetClassNames: string[],
  ): Promise<boolean> {
    if (targetClassNames.includes(label)) return true;
    if (!this.classLabelToUid) return false;
    try {
      const uid = await this.classLabelToUid(label);
      if (uid && uid.length > 0 && targetClassNames.includes(uid)) return true;
    } catch {
      // Resolver failures degrade gracefully — direct-only match still applied.
    }
    return false;
  }

  /**
   * Extract bare class refs from target's `exo__Instance_class` frontmatter
   * entry. Handles both string and array forms; unwraps `[[<inner>]]` and
   * `[[<inner>|<alias>]]` wikilink shapes; strips surrounding YAML quotes.
   */
  private extractTargetClassNames(
    targetFm: Record<string, string | string[]>,
  ): string[] {
    const raw = targetFm["exo__Instance_class"];
    if (raw === undefined || raw === null) return [];
    const arr = Array.isArray(raw) ? raw : [raw];
    const out: string[] = [];
    for (const item of arr) {
      const inner = this.extractWikilinkInner(String(item));
      if (inner) out.push(inner);
    }
    return out;
  }

  private extractWikilinkInner(s: string): string {
    const m = s.match(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/);
    if (m) return m[1].trim();
    return s.replace(/^["']|["']$/g, "").trim();
  }

  /**
   * Format an inherited source value for the new instance's frontmatter.
   *
   * - Already wikilink-form (`"[[...]]"` / `[[...]]`) → `reformatWikilink`
   *   ensures YAML-quoted round-trip.
   * - Bare UUID v4 (e.g. target's `exo__Asset_uid`) → wrap as `"[[<uid>]]"`
   *   so the new asset receives a valid wikilink (per RFC v2 InheritanceRule
   *   asset description for `ems__Effort_area` / `ems__Effort_parent`).
   * - Anything else (literal scalar) → pass-through.
   * - Array source → element-wise scalar formatting.
   */
  private formatInheritedValue(
    value: string | string[],
  ): string | string[] {
    if (Array.isArray(value)) {
      return value.map((item) => this.formatInheritedScalar(String(item)));
    }
    return this.formatInheritedScalar(String(value));
  }

  private formatInheritedScalar(value: string): string {
    if (/^"?\[\[.+\]\]"?$/.test(value)) {
      return this.reformatWikilink(value);
    }
    if (UUID_V4_RE.test(value)) {
      return `"[[${value}]]"`;
    }
    return value;
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
    const date = this.clock.now();
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
   * - Missing `targetProperty` / `appendExpression` (or legacy `targetValue`)
   *   on the grounding definition. RFC 918a2b65 Phase 2: `appendExpression`
   *   is the canonical predicate; legacy `targetValue` is the deprecated
   *   transitional fallback.
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
    // RFC 918a2b65 Phase 2 — priority chain: appendExpression (typed) first,
    // legacy targetValue is the deprecated fallback. CommandResolver emits the
    // one-shot deprecation warn at parse time for legacy use.
    const exprSource = grounding.appendExpression ?? grounding.targetValue;
    if (exprSource === undefined) {
      return {
        success: false,
        error: "property_append requires appendExpression",
      };
    }

    const content = await this.fileReader.readFile(filePath);
    const targetFrontmatter =
      this.frontmatterService.parseObject(content) ?? {};

    const resolvedValue = this.substituteVariables(
      exprSource,
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
   * Matches a bare UUID v4-shaped basename (the UID-canon filename convention,
   * 2026-05-17). Anchored — must be the *entire* basename, so a folder named
   * `<uuid>` embedded mid-path does not trip it.
   */
  private static readonly UUID_BASENAME_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /**
   * Derive a stable wikilink target (vault-relative path, no `.md` suffix) for
   * the back-link property write. Falls back to decoding the `obsidian://` URL
   * when no fs path is provided. Without this normalization the executor would
   * emit `[[obsidian://vault/.../<uid>.md]]` instead of an Obsidian-resolvable
   * link.
   *
   * Issue #3195 — strip-canon: when the target is a UUID-named file (the
   * UID-canon TBox/ABox convention, 2026-05-17), the link must be the BARE UID
   * (`[[<uid>]]`), not the full vault-relative path
   * (`[[assetspaces/shared-identities/<uid>]]`). Both forms resolve to the same
   * file at runtime, but the path-form violates the convention and leaks a
   * folder prefix into `exo__Asset_prototype` (and any other back-link this
   * helper feeds). Non-UUID basenames (e.g. whitelisted `pn__DailyNote`
   * `YYYY-MM-DD`, `period__Week` `YYYY-Www`) keep their path-form so Obsidian
   * still resolves them.
   */
  private static extractBacklinkTarget(targetIRI: string, targetFilePath: string): string {
    const path = GroundingExecutor.resolveTargetPath(targetIRI, targetFilePath);
    const basename = path.split("/").pop() ?? path;
    if (GroundingExecutor.UUID_BASENAME_RE.test(basename)) {
      return basename;
    }
    return path;
  }

  /**
   * Resolve the raw vault-relative path (no `.md` suffix, no leading slash) of
   * the back-link target, from either the fs path or the `obsidian://` IRI.
   * Split out from {@link extractBacklinkTarget} so the strip-canon gate has a
   * single exit point covering both the fs-path and IRI-fallback branches
   * (Issue #3195).
   */
  private static resolveTargetPath(targetIRI: string, targetFilePath: string): string {
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
