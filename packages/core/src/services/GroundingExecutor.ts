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
import { resolveTemplateBody } from "./TemplateBodyResolver";
import { base64ToUtf8 } from "../utilities/base64";
import { EffortStatus } from "../domain/constants/EffortStatus";
import { IRI } from "../domain/models/rdf/IRI";
import type { WorkflowDefinition } from "../domain/models/WorkflowDefinition";
import { FrontmatterService } from "../utilities/FrontmatterService";
import {
  serializeYamlScalar,
  STRING_SCALAR_PROPERTIES,
} from "../utilities/yamlScalar";
import { canonicalYamlKey } from "./NoteToRDFConverter";
import type { NamedQueryRunnerPort } from "./NamedQueryRunner";
import { iriToVaultPath, vaultPathToIRI } from "../infrastructure/vault/iri";
import { DateFormatter } from "../utilities/DateFormatter";
import { DateTimeParsing } from "../infrastructure/sparql/filters/functions/DateTimeParsing";
import { LoggingService } from "./LoggingService";

/**
 * RFC 36347daf Phase 2 — EffortStatus enum ↔ TBox UUID bijection. Used by
 * workflow_transition dispatcher to translate WorkflowTransition.to (an
 * EffortStatus symbolic name) into a UID-canon wikilink target. UIDs match
 * vault `assetspaces/ems/<uid>.md` files in `kitelev/exoas-ems` (mounted
 * only in vault-2025 / vault-exodev — NOT a submodule of `exocortex` repo,
 * so a static vault-fixture-parity test along the lines of
 * `grounding-type-vault-fixture-parity.test.ts` is not feasible here).
 *
 * Drift guards (defense in depth):
 *   1. `Record<EffortStatus, string>` — compile-time coverage of all 7 enum values.
 *   2. `GroundingExecutor.status_uid_integrity.test.ts` — runtime UUID-shape
 *      + uniqueness + pinned-UID assertions; catches accidental TS-side
 *      renames before they reach a release.
 *   3. Surface signal at runtime: if a status TBox file is renamed in the vault
 *      without a TS update, the wikilink `[[<old-uid>]]` written by
 *      `executeWorkflowTransition` becomes a broken wikilink — Obsidian renders
 *      it in red and SPARQL queries for the status fail to resolve. NOT caught
 *      by `~/.claude/hooks/validate-wikilinks.sh` (that hook fires only on
 *      Claude Code Write/Edit tool calls, not on plugin runtime writes via
 *      the Obsidian Vault API).
 *
 * Adding a new EffortStatus value forces this map to be updated (TS compile
 * error). Renaming a vault TBox status file requires manually editing this
 * map to the new UID + bumping the submodule pointer.
 */
export const STATUS_UID_BY_ENUM: Readonly<Record<EffortStatus, string>> = {
  [EffortStatus.DRAFT]:    "c42245d0-01de-4c35-bfcf-d910445ea28e",
  [EffortStatus.BACKLOG]:  "753a44d5-846c-4b82-9196-4fd9a4d48777",
  [EffortStatus.DOING]:    "027e78f4-6e16-4b36-b8fb-5510507d5745",
  [EffortStatus.WAITING]:  "0610947c-6a62-41c8-9d44-7863d3ba3a8e",
  [EffortStatus.DONE]:     "7b9b3116-7c3c-438c-9618-94fe301320a6",
  [EffortStatus.TRASHED]:  "5d14f18d-db2b-4847-9ac1-144cb93b2541",
};

const STATUS_ENUM_BY_UID: Readonly<Record<string, EffortStatus>> = Object.freeze(
  Object.fromEntries(
    (Object.entries(STATUS_UID_BY_ENUM) as [EffortStatus, string][]).map(
      ([k, v]) => [v, k],
    ),
  ) as Record<string, EffortStatus>,
);

// RFC 36347daf Phase 2 — UID → AssetClass label map for the built-in status
// workflows (Task/Project/Meeting). Extracted to a shared constant so the
// data-driven WorkflowResolver can reuse it without importing GroundingExecutor
// (avoids an import cycle). Re-exported here for backward compatibility with
// `GroundingExecutor.status_uid_integrity.test.ts`.
export { CLASS_UID_TO_LABEL } from "../domain/constants/WorkflowClassUids";
import {
  installDefaultResolvers,
  getResolver,
  type ResolverContext,
} from "./SubstitutionResolverRegistry";

// Install built-in resolvers on module import so executor doesn't need an
// explicit bootstrap call from each consumer. Idempotent (Map overwrites).
installDefaultResolvers();

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
  /**
   * Issue #3918 — vault-relative paths of assets created as a SIDE EFFECT by a
   * `composite` grounding (a composite whose steps include one or more
   * `create_instance` steps, plus any created by nested composite steps). Set
   * by `executeComposite`; consumed by `apply --json` to surface a `created`
   * entry (uuid/path/label) per composite-created file.
   *
   * Deliberately DISTINCT from `openPath`: `openPath` is the single path the
   * presentation layer (`CommandExecutionFlow`) opens in a new tab, so a
   * composite leaves `openPath` UNSET and reports its creations via
   * `createdPaths` instead — surfacing-only, no automatic tab-open. Omitted
   * (undefined) when the composite created nothing → today's `{ success: true }`
   * output is byte-identical.
   */
  readonly createdPaths?: readonly string[];
  /**
   * Marks an unsuccessful result as a benign "not applicable" outcome rather
   * than a hard failure. Set by `workflow_transition` when the target asset's
   * class has no applicable status workflow (e.g. `ems__Action`, which has its
   * own one-shot lifecycle, or a class for which no `ems__Workflow` ABox /
   * `ems__Effort_workflow` override exists). The presentation layer surfaces
   * this as an informational notice — NOT a "Command failed" error — so a
   * generic status-transition button rendered on such a class degrades
   * gracefully instead of crashing. See `CommandExecutionFlow`.
   */
  readonly notApplicable?: boolean;
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
 * undefined otherwise. Extending the set of recognised classes requires a
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
 *   - `ExocmdFastResolver` (#3171, removed in Phase 3c) built a mini-store from
 *     the open asset plus `assetspaces/exocmd/*.md` only — never `assetspaces/ems`
 *     where the UUID-named class TBox files live.
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

/**
 * T1 "Create Instance" homoiconic button (project bbe40f8c) — resolve a
 * vault asset reference (bare UID or label) to the vault-relative folder of
 * the file it points at. Powers the `$isDefinedByFolder` target-folder token
 * so a `create_instance` grounding can place the new asset co-located with its
 * chosen `exo__Asset_isDefinedBy` ontology (co-location invariant) WITHOUT a
 * second relocation pass.
 *
 * Injected by the host (plugin via metadataCache, CLI via the folder-repair
 * helpers). A `null` return — no resolver wired, ref not found — leaves the
 * executor to fall back to the host folder, so the create never fails on a
 * resolution gap.
 */
export type RefToFolderResolver = (
  ref: string,
) => string | null | Promise<string | null>;

/**
 * req c03f9e3e — per-ontology efforts routing. Resolves a bare asset reference
 * (a UID, after the executor strips quotes / `[[ ]]` / `|alias`) to that asset's
 * parsed frontmatter, so the executor can make a SECOND hop from the click-target
 * (area → the area's `exo__Asset_isDefinedBy` ontology → that ontology's
 * `exo__Ontology_effortsOntology`). Sibling of {@link RefToFolderResolver}: the
 * core executor is storage-agnostic, so the host injects a metadata-cache (plugin)
 * or filesystem (CLI) backed implementation. A `null` return — no resolver wired,
 * ref not found — makes the two-hop resolver yield nothing, so the create is not
 * routed and co-locates with the click-target (opt-in / no failure on a gap).
 */
export type RefToFrontmatterResolver = (
  ref: string,
) =>
  | Record<string, unknown>
  | null
  | Promise<Record<string, unknown> | null>;

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
  /^__SUBSTITUTE__([a-zA-Z][a-zA-Z0-9_]*)__[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}__$/;

/**
 * RFC 727572d2 — parameterised marker shape emitted for TokenInvocation
 * wrappers. The base64 segment carries the literal `_parameter` (URL-safe
 * encoding so property labels containing `__` round-trip without ambiguity).
 *
 * Shape: `__SUBSTITUTE_P__<resolver-id>__<token-uid>__<base64-param>__`
 */
const PARAMETERISED_MARKER_RE =
  /^__SUBSTITUTE_P__([a-zA-Z][a-zA-Z0-9_]*)__[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}__([A-Za-z0-9_-]*)__$/;

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
 * req 29e0d1b6 — is this about-to-be-written frontmatter value a BARE (unquoted)
 * wikilink?
 *
 * `[[uid]]` written without surrounding quotes is a YAML flow SEQUENCE, not a
 * string, so the RDF converter emits a literal and the reference is lost. The
 * quoted form (`"[[uid]]"`, quotes part of the value) is the correct shape and
 * is deliberately NOT matched here.
 *
 * Scope: the value must be ENTIRELY bracketed (after trimming) — so `[[a]]`, but
 * also `[[a]] and [[b]]` / `[[a]]\n[[b]]`, which are just as flow-sequence-shaped
 * and just as lossy; refusing them is intended. A wikilink embedded in
 * surrounding prose (`see [[a]] for details`) is a string either way, carries no
 * silent-literal risk, and passes.
 *
 * ⛤ Live `targetValueSubstitution` groundings DO carry a wikilink literally
 * (`"[[8bc0c038-…]]"` → the `$nowLocal` token; 5 occurrences in the pinned
 * exocmd assetspace). They never reach this guard in that shape because
 * `CommandResolver` dereferences the wikilink to the target's label first, so
 * the executor sees `$nowLocal`. That safety is a property of the RESOLVER, not
 * of the data: were that dereference to stop, those groundings would start
 * failing here — loudly, which is the correct failure, but the coupling is worth
 * knowing.
 */
function isUnquotedWikilink(value: string): boolean {
  // `[\s\S]` rather than `.` + the `s` flag: the root tsconfig targets ES6 and
  // the dotAll flag is ES2018+ (`TS1501` in CI typecheck).
  return /^\[\[[\s\S]*\]\]$/.test(value.trim());
}

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
 * Variable substitution in serviceCallPayload / appendExpression / property_set values:
 * - `$now` → current ISO 8601 timestamp
 * - `$today` → current date (YYYY-MM-DD)
 * - `$target` → IRI of the target asset
 *
 * Substitution applies to `property_set` raw values and to `service_call`
 * JSON `serviceCallPayload` defaults (Issue #2999 / RFC 5a61a359 Phase C.0,
 * service_call the substitution is performed before `JSON.parse`, so any
 * string position inside the JSON object can reference a token, e.g.
 * `{"prototype":"$target"}` resolves to `{prototype: <targetIRI>}`.
 *
 * Issue #2430, #2999
 */
/**
 * RFC 36347daf Phase 2 — pluggable workflow resolver. Allows
 * `executeWorkflowTransition` to look up the active Workflow for the target
 * asset's class at execution time. Optional — when absent (tests, CLI
 * without store hydration), the workflow_transition dispatch fails loud
 * with a clear error message.
 *
 * `resolveForAssetOrNull` is data-driven: it accepts the raw class references
 * (each UID-canon `"<uid>"`, alias `"<uid>|label"`, or bare label) from the
 * target's possibly multi-valued `exo__Instance_class` and returns the
 * applicable workflow, or `null` when no class has one (a per-asset
 * `ems__Effort_workflow` override, a per-class `ems__Workflow` ABox, and the
 * built-in Task/Project/Meeting defaults are all consulted). A `null` return is
 * NOT an error — the dispatcher treats it as "no status workflow for this class"
 * and degrades gracefully (no crash on non-Effort / lifecycle-only classes such
 * as `ems__Action`).
 */
export type WorkflowResolverPort = {
  resolveForAssetOrNull(
    subjectIRI: IRI,
    classRefs: readonly string[],
  ): Promise<WorkflowDefinition | null>;
};

/**
 * RFC 36347daf Phase 2 — load a Grounding by UID. Used by
 * `executeWorkflowTransition` to resolve `WorkflowTransition_postActions`
 * references at execution time without coupling GroundingExecutor to
 * CommandResolver directly. Plugin/CLI passes
 * `(uid) => commandResolver.loadGroundingByUid(uid)`.
 */
export type GroundingLoaderPort = (
  uid: string,
) => Promise<GroundingDefinition | null>;

/**
 * Subproject 17f58ebe Веха 3 — load an `exotemplate__Template` asset's markdown
 * BODY by UID, for `body_template` groundings that reference a template via
 * `templateRef`. Returns the body (frontmatter stripped) or `null` when the
 * template UID is unresolvable. When absent (CLI/test without a vault index),
 * `body_template` falls back to the inline `bodyTemplate` literal or fails loud.
 * Plugin wires `(uid) => read template file → extractTemplateBody`.
 */
export type TemplateLoaderPort = (uid: string) => Promise<string | null>;

@injectable()
export class GroundingExecutor {
  private readonly frontmatterService: FrontmatterService;
  private readonly fileReader: IFileSystemReader;
  private readonly fileWriter: IFileSystemWriter;
  private readonly serviceRegistry: ServiceRegistry;
  private readonly classLabelToUid?: ClassLabelToUidResolver;
  private readonly refToFolder?: RefToFolderResolver;
  private readonly refToFrontmatter?: RefToFrontmatterResolver;
  private readonly workflowResolver?: WorkflowResolverPort;
  private readonly groundingLoader?: GroundingLoaderPort;
  private readonly templateLoader?: TemplateLoaderPort;
  private readonly namedQueryRunner?: NamedQueryRunnerPort;
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
    options?: {
      clock?: IClock;
      uidGenerator?: IUidGenerator;
      // RFC 36347daf Phase 2 — workflow_transition deps. When absent, the
      // dispatch returns a clear error rather than silently no-op'ing.
      workflowResolver?: WorkflowResolverPort;
      groundingLoader?: GroundingLoaderPort;
      // Subproject 17f58ebe Веха 3 — load exotemplate__Template body by UID for
      // `body_template` groundings that reference a template via `templateRef`.
      templateLoader?: TemplateLoaderPort;
      // RFC 78c2b7d0 C4 — read-side value-source for property_set
      // `targetValueQuery`. When absent, such groundings fail loud.
      namedQueryRunner?: NamedQueryRunnerPort;
      // T1 "Create Instance" (project bbe40f8c) — resolve `$isDefinedByFolder`
      // target-folder token to the chosen ontology's folder. When absent,
      // create_instance falls back to the host folder (never fails).
      refToFolder?: RefToFolderResolver;
      // req c03f9e3e — per-ontology efforts routing. Resolve a bare ref to that
      // asset's frontmatter for the SECOND hop of `targetRefProperty`. When
      // absent, the two-hop resolver yields nothing (no routing, no failure).
      refToFrontmatter?: RefToFrontmatterResolver;
    },
  ) {
    this.frontmatterService = new FrontmatterService();
    this.fileReader = fileReader;
    this.fileWriter = fileWriter;
    this.serviceRegistry = serviceRegistry;
    this.classLabelToUid = classLabelToUid;
    this.refToFolder = options?.refToFolder;
    this.refToFrontmatter = options?.refToFrontmatter;
    this.workflowResolver = options?.workflowResolver;
    this.groundingLoader = options?.groundingLoader;
    this.templateLoader = options?.templateLoader;
    this.namedQueryRunner = options?.namedQueryRunner;
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

        case GroundingType.WORKFLOW_TRANSITION:
          return await this.executeWorkflowTransition(
            grounding,
            targetIRI,
            targetFilePath,
            userInput,
          );

        case GroundingType.BODY_TEMPLATE:
          return await this.executeBodyTemplate(
            grounding,
            targetIRI,
            targetFilePath,
            userInput,
          );

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

    // req faf269bf Scenario 2 — the two TARGET addressings are mutually
    // exclusive. `targetsCreatedInstance` says "write into the asset the
    // previous step created"; `targetQuery` says "write into the asset this
    // query finds". Both set = an ambiguity the engine must NOT arbitrate
    // silently, so refuse before doing any work (nothing is written).
    if (
      grounding.targetQuery !== undefined &&
      grounding.targetsCreatedInstance === true
    ) {
      return {
        success: false,
        error:
          "property_set: targetQuery and targetsCreatedInstance are mutually exclusive (both address the step's TARGET — pick one).",
      };
    }

    // RFC 31c1a0be Phase 5a — typed predicates only.
    // Multiple typed predicates simultaneously = fail-loud (RFC §4 cardinality).
    // RFC 78c2b7d0 C4 — `targetValueQuery` joins the mutually-exclusive set as a
    // fourth value-source (read-side NamedQuery computes the write value).
    let effectiveValue: string | undefined;
    const typedFieldsSet = [
      grounding.targetValueRef !== undefined,
      grounding.targetValueLiteral !== undefined,
      grounding.targetValueSubstitution !== undefined,
      grounding.targetValueQuery !== undefined,
    ].filter(Boolean).length;
    if (typedFieldsSet > 1) {
      return {
        success: false,
        error:
          "property_set: more than one of targetValueRef/targetValueLiteral/targetValueSubstitution/targetValueQuery set (cardinality 0..1 each, mutually exclusive)",
      };
    }
    if (grounding.targetValueRef !== undefined) {
      effectiveValue = `"[[${grounding.targetValueRef}]]"`;
    } else if (grounding.targetValueLiteral !== undefined) {
      effectiveValue = grounding.targetValueLiteral;
    } else if (grounding.targetValueSubstitution !== undefined) {
      effectiveValue = grounding.targetValueSubstitution;
    } else if (grounding.targetValueQuery !== undefined) {
      // RFC 78c2b7d0 C4 — read-side value-source (CQRS bridge). Run the
      // referenced NamedQuery read-only with `$currentAsset` = the target IRI,
      // and use its scalar result as the property value. IRI scalars are
      // wrapped as a wikilink (`"[[<name>]]"`) — matching `targetValueRef`
      // semantics — so a query selecting an entity reference (e.g. the archive
      // ontology in C5) yields a resolvable link; literal scalars pass through.
      const queryValueResult = await this.resolveTargetValueQuery(
        grounding.targetValueQuery,
        targetIRI,
      );
      if (!queryValueResult.success) {
        return queryValueResult;
      }
      effectiveValue = queryValueResult.value;
    } else {
      return {
        success: false,
        error:
          "property_set requires one of targetValueRef/targetValueLiteral/targetValueSubstitution/targetValueQuery",
      };
    }

    // RFC-028 Findings 3+4 (extended for named $input.<key> keys, Issue #3779):
    // fail loudly when the value TEMPLATE references an input that was not
    // provided. Checked against `effectiveValue` (the template) — NOT the
    // substituted output — so a value that legitimately RESOLVES to free text
    // containing a "$input"/"$value" substring (e.g. relabel to
    // "Fix $input handling") is never mis-flagged (#3779 code-review MEDIUM).
    const inputRecord = (userInput ?? {}) as Record<string, unknown>;
    const isProvided = (v: unknown): boolean => v !== undefined && v !== null;
    const referencedKeys = [
      ...effectiveValue.matchAll(/\$input\.([A-Za-z_]\w*)/g),
    ].map((m) => m[1]);
    const usesAnonInput =
      /\$input\b(?!\.)/.test(effectiveValue) || /\$value\b/.test(effectiveValue);
    const missingKey = referencedKeys.find((k) => !isProvided(inputRecord[k]));
    if (missingKey !== undefined || (usesAnonInput && !isProvided(inputRecord.value))) {
      const hint =
        missingKey !== undefined
          ? `--input '{"${missingKey}":...}'`
          : `--input '{"value":...}'`;
      return {
        success: false,
        error: `property_set: value template references an input that was not provided (${hint} required)`,
      };
    }

    const substitutedValue = this.substituteVariables(
      effectiveValue,
      targetIRI,
      userInput,
    );

    // Issue #3779: for string-semantic properties (`exo__Asset_label`,
    // `aliases`) a substitution-derived value (e.g. a relabel `$input.label`
    // = "Meeting: Q3") may contain YAML-significant characters. `updateProperty`
    // writes values verbatim (callers pre-format), so route the substituted
    // value through the same conservative quote-when-needed serializer the
    // create path uses (#3748/#3750). Idempotent: simple labels stay bare,
    // pre-quoted wikilinks pass through, only YAML-unsafe values get quoted.
    // Non-string-scalar properties (timestamps, refs) are untouched. The
    // property name is normalized to prefixed form first so a full-IRI-shaped
    // `targetProperty` still matches the string-scalar set (#3779 review LOW).
    // ⛤ Both the string-scalar lookup AND the physical write key must use the
    // CANONICAL key (req 869561bf): `STRING_SCALAR_PROPERTIES` holds `aliases`,
    // not `exo__Asset_aliases`, and Obsidian reads aliases only from `aliases:`.
    // Before this, the lookup ran on the merely-normalized name (missing the
    // string semantics for the prefixed spelling) and `updateProperty` received
    // the RAW `grounding.targetProperty` (writing a literal, dead key).
    const normalizedTargetProperty = FrontmatterService.normalizeIRI(
      grounding.targetProperty,
    );
    const canonicalTargetProperty = canonicalYamlKey(normalizedTargetProperty);
    const valueToWrite = STRING_SCALAR_PROPERTIES.has(canonicalTargetProperty)
      ? serializeYamlScalar(substitutedValue, true)
      : substitutedValue;

    // ⛤ The WRITE KEY is not decided here. `FrontmatterService.updateProperty`
    // canonicalises on entry, so every writer that reaches the primitive — this
    // step, its `property_delete` / `property_append` / `property_increment` /
    // `property_shift` siblings, the `service_call` twins in
    // `packages/services`, and the plugin — gets the same key without each
    // call site repeating the rule. Deciding it per-call-site is exactly the
    // shape of defect this requirement removes. The canonical name is still
    // needed HERE, but only for the `STRING_SCALAR_PROPERTIES` lookup above:
    // `updateProperty` serialises without `quoteScalars`, so the string
    // semantics for `aliases` have to be applied by the caller.

    // req 29e0d1b6 — refuse an UNQUOTED wikilink instead of writing it.
    //
    // `updateProperty` writes the value VERBATIM, so a bare `[[uid]]` lands in
    // the frontmatter unquoted — which YAML parses as a flow SEQUENCE, not a
    // string. `NoteToRDFConverter` then emits the object as a LITERAL, and the
    // asset silently drops out of every join on that property. Nothing fails:
    // the command reports success and `repairFolder` (whose resolver tolerates
    // both shapes) even relocates the file, so the two parsers disagree with no
    // error surfacing anywhere. That silent literal is the worst of the three
    // possible outcomes, and today it is the only one that LOOKS like success.
    //
    // We refuse loudly rather than normalize: normalizing (accepting `[[uid]]`,
    // `"[[uid]]"` and a bare uid alike) would fix the symptom while HIDING the
    // asymmetry between the two value-source contracts —
    //   - `targetValueSubstitution` writes the substituted value verbatim, so a
    //     reference must arrive ALREADY quoted (`"\"[[uid]]\""` from the CLI;
    //     the plugin's ReferencePicker commits exactly that via
    //     `toReferenceWikilink`), and
    //   - `targetValueRef` takes a BARE uid because the executor wraps it here.
    // The asymmetry is the actual source of confusion; a loud refusal teaches
    // it. String-scalar properties (label/aliases) are unaffected — they go
    // through `serializeYamlScalar`, which quotes them before this check.
    if (isUnquotedWikilink(valueToWrite)) {
      return {
        success: false,
        error:
          `property_set: value ${valueToWrite} is an UNQUOTED wikilink — YAML reads it as a flow ` +
          `sequence, so the graph would receive a literal instead of a link (silent data loss). ` +
          `Pass the QUOTED form for a substituted reference (the quotes are part of the string, ` +
          `e.g. --input '{"<key>":"\\"[[<uid>]]\\""}'), or use targetValueRef, which takes a BARE ` +
          `uid and wraps it itself.`,
      };
    }

    // req faf269bf Scenarios 1+3 — resolve WHICH asset this step writes into.
    // Absent `targetQuery` (every existing grounding) keeps `filePath` exactly
    // as handed in — click-target, or the created instance when the composite
    // threaded it — so prior behaviour is byte-identical (Scenario 4).
    let effectiveFilePath = filePath;
    if (grounding.targetQuery !== undefined) {
      const targetPathResult = await this.resolveTargetQuery(
        grounding.targetQuery,
        targetIRI,
      );
      if (!targetPathResult.success) {
        return targetPathResult;
      }
      effectiveFilePath = targetPathResult.path;
    }

    const content = await this.fileReader.readFile(effectiveFilePath);
    const updated = this.frontmatterService.updateProperty(
      content,
      grounding.targetProperty,
      valueToWrite,
    );
    await this.fileWriter.updateFile(effectiveFilePath, updated);

    return { success: true };
  }

  /**
   * req faf269bf — resolve a `property_set` `targetQuery` to the vault-relative
   * path of the asset the step must write INTO, via the read-side
   * {@link NamedQueryRunner}. Auto-injects `$currentAsset` = the click-target
   * IRI, so a reified link is found FROM one of its ends.
   *
   * Fail-loud on every degraded path, and — critically — the click-target is
   * NEVER a fallback (Scenario 3): a query that matches nothing means the
   * intended target does not exist, and writing to the click-target instead
   * would silently put the value on the wrong asset.
   *
   * Mirrors {@link resolveTargetValueQuery}'s structure; the difference is what
   * is extracted — the RAW `iri` (converted to a path) rather than the
   * reverse-mapped display name, because a basename cannot address a file.
   */
  private async resolveTargetQuery(
    queryUid: string,
    targetIRI: string,
  ): Promise<
    { success: true; path: string } | { success: false; error: string }
  > {
    if (!this.namedQueryRunner) {
      return {
        success: false,
        error:
          "property_set targetQuery requires NamedQueryRunner injection (options.namedQueryRunner). Wire the plugin/CLI before using this target-source.",
      };
    }
    let scalar;
    try {
      scalar = await this.namedQueryRunner.runScalar(queryUid, {
        currentAsset: targetIRI,
      });
    } catch (error) {
      return {
        success: false,
        error: `property_set targetQuery: NamedQuery '${queryUid}' failed — ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    if (scalar === null) {
      return {
        success: false,
        error: `property_set targetQuery: NamedQuery '${queryUid}' matched no asset (empty result set) — refusing to fall back to the click-target.`,
      };
    }
    if (scalar.kind !== "iri") {
      return {
        success: false,
        error: `property_set targetQuery: NamedQuery '${queryUid}' returned a literal ('${scalar.value}'), not an asset reference — a target must be an asset.`,
      };
    }
    if (scalar.iri === undefined) {
      return {
        success: false,
        error: `property_set targetQuery: NamedQuery '${queryUid}' returned an asset reference without its source IRI, so its file path cannot be resolved.`,
      };
    }
    const path = iriToVaultPath(scalar.iri);
    if (path === null) {
      return {
        success: false,
        error: `property_set targetQuery: NamedQuery '${queryUid}' matched '${scalar.iri}', which is not a vault asset IRI (no resolvable file path).`,
      };
    }
    return { success: true, path };
  }

  /**
   * RFC 78c2b7d0 C4 — resolve a `property_set` `targetValueQuery` to its write
   * value via the read-side {@link NamedQueryRunner}. Auto-injects
   * `$currentAsset` = the target IRI; the scalar result is formatted as a
   * wikilink (IRI scalar) or passed through (literal scalar).
   *
   * Fail-loud on every degraded path — a `property_set` that cannot compute a
   * value MUST NOT silently write nothing:
   *   - runner not wired (tests/CLI/plugin missing the injection),
   *   - the NamedQuery throws (missing body, forbidden UPDATE keyword, parse
   *     error — all surfaced verbatim),
   *   - the query produced no scalar (empty result set / non-scalar shape).
   */
  private async resolveTargetValueQuery(
    queryUid: string,
    targetIRI: string,
  ): Promise<
    { success: true; value: string } | { success: false; error: string }
  > {
    if (!this.namedQueryRunner) {
      return {
        success: false,
        error:
          "property_set targetValueQuery requires NamedQueryRunner injection (options.namedQueryRunner). Wire the plugin/CLI before using this value-source.",
      };
    }
    let scalar;
    try {
      scalar = await this.namedQueryRunner.runScalar(queryUid, {
        currentAsset: targetIRI,
      });
    } catch (error) {
      return {
        success: false,
        error: `property_set targetValueQuery: NamedQuery '${queryUid}' failed — ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    if (scalar === null) {
      return {
        success: false,
        error: `property_set targetValueQuery: NamedQuery '${queryUid}' returned no scalar value (empty result set or non-scalar shape).`,
      };
    }
    const value =
      scalar.kind === "iri" ? `"[[${scalar.value}]]"` : scalar.value;
    return { success: true, value };
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

    // Subproject 17f58ebe Веха 3 — track the most-recently-created asset's path
    // so a later step can write into THAT file (the created instance), not the
    // composite click-target.
    //
    // Two step kinds consume this thread (Issue #3867 extended it from the
    // original `body_template`-only form):
    //   1. `body_template` steps — ALWAYS thread (unchanged from Веха 3).
    //   2. any step that opts in via `exocmd__Grounding_targetsCreatedInstance`
    //      (Issue #3867) — e.g. a `property_set` in a `[create_instance,
    //      property_set]` composite that mutates the NEW asset (create task +
    //      move-to-backlog). Opt-in ⇒ default (flag absent) keeps operating on
    //      `filePath`, so existing composites are unchanged.
    // Both are gated on `lastCreatedPath` being set (a prior create_instance
    // step ran); with no create_instance, the step targets the click-target
    // exactly as before — a zero-regression addition. `targetIRI` is
    // intentionally NOT re-pointed: `$target` still resolves to the source
    // asset (link-back), and the just-created asset is not yet in the store.
    let lastCreatedPath: string | undefined;

    // Issue #3918 — every asset written to disk by a create_instance step (and
    // by any nested composite step), collected purely for surfacing via
    // `apply --json`. Independent of `lastCreatedPath` (which drives step
    // targeting) — this is the read-only "what did the composite create?"
    // channel and does NOT set `openPath` (so plugin tab-open is unchanged).
    const createdPaths: string[] = [];

    try {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const stepUsesCreatedPath =
          step.type === GroundingType.BODY_TEMPLATE ||
          step.targetsCreatedInstance === true;
        const stepPath =
          stepUsesCreatedPath && lastCreatedPath ? lastCreatedPath : filePath;
        const result = await this.executeStep(
          step,
          targetIRI,
          stepPath,
          userInput,
          depth + 1,
        );
        if (!result.success) {
          // Rollback completed steps: restore the click-target source content
          // AND (Issue #3921) delete any assets an earlier create_instance step
          // already wrote to disk, so a failing later step leaves no orphans.
          await this.rollback(
            originalContent,
            filePath,
            completedSteps,
            createdPaths,
          );
          return {
            success: false,
            error: `Composite step ${i} failed: ${result.error}`,
          };
        }
        // create_instance returns the new file's path — thread it to a later
        // body_template step.
        if (result.openPath) lastCreatedPath = result.openPath;
        // Issue #3918 — record it (and any nested-composite creations) for
        // surfacing. Additive only: the threading above is untouched.
        if (result.openPath) createdPaths.push(result.openPath);
        if (result.createdPaths && result.createdPaths.length > 0) {
          createdPaths.push(...result.createdPaths);
        }
        completedSteps.push(i);
      }

      return {
        success: true,
        ...(createdPaths.length > 0 ? { createdPaths } : {}),
      };
    } catch (error) {
      // Issue #3921 — pass createdPaths so a mid-composite throw after an
      // earlier create_instance also cleans up the orphaned created asset.
      await this.rollback(
        originalContent,
        filePath,
        completedSteps,
        createdPaths,
      );
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
    // already injected into this executor, so it is wired here inline rather
    // than through a separate conversion-service wrapper. Keeps starter-kit
    // groundings functional with a bare core ServiceRegistry (e.g. CLI usage,
    // tests).
    if (serviceId === "convertToTask") {
      return await this.executeConvertToTask(filePath);
    }

    // RFC-028 Finding 5 + RFC 918a2b65 Phase 4: production vault + starter-kit
    // groundings `abdbdf09` (Convert to task) and `e8c1d18a` (Convert to
    // project) ship with `serviceId = "updateProperty"` + typed
    // `targetValueRef` ∈ {ems__Task UUID, ems__Project UUID}. The grounding
    // schema overloads `targetProperty` as serviceId for service_call, so at
    // dispatch time we detect the class-flip intent from
    // (serviceId=updateProperty, targetValueRef=class UUID/label).
    //
    // `resolveClassFlipTarget` accepts both UUID-canon (post-#3165) and bare
    // label form (CommandResolver may have downgraded when class TBox file is
    // absent from resolution store, see #3220).
    //
    // Link-to-parent (30b9e8d8) uses the same serviceId but carries NO
    // targetValueRef (driven via inputSchema+userInput) and so flows past
    // this short-circuit into the registered updateProperty service below.
    if (serviceId === "updateProperty") {
      // RFC 918a2b65 Phase 4 — class-flip dispatch via typed `targetValueRef`
      // only. Legacy `targetValue` path removed after vault migration
      // (CQ4 legacyCount=0) and property asset 321b5623 deletion. The ref
      // accepts UUID-canon (post-#3165) or bare label (older stores without
      // TBox warm-up).
      const refClass = resolveClassFlipTarget(grounding.targetValueRef);
      if (refClass === "ems__Task") {
        return await this.executeConvertToTask(filePath);
      }
      if (refClass === "ems__Project") {
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

    // Merge grounding.serviceCallPayload (JSON) as defaults into userInput.
    //
    // Issue #2999 (RFC 5a61a359 Phase C.0) + RFC 918a2b65 Phase 4: apply
    // substituteVariables BEFORE JSON.parse so vault groundings can reference
    // $target / $now / $today / $nowLocal / $input / $value inside JSON
    // string values. This unlocks the create-instance-from-prototype pattern:
    // a Grounding with
    //   serviceCallPayload: '{"prototype":"$target"}'
    // resolves $target to the current asset IRI, which `createAsset` then
    // writes as exo__Asset_prototype on the new instance. Substitution is
    // identical to the property_set path (substituteVariables already escapes
    // nothing — JSON safety relies on caller-supplied IRIs being safe; UUID
    // and URL IRIs in the vault contain no `"` or `\\`).
    let mergedInput = userInput;
    // Standalone `Grounding_isDefinedBy` wikilink: inject as a default so
    // `createAsset` (or any service_call that consumes userInput.isDefinedBy)
    // can pin owner identity without burying the link inside the payload.
    // Authored as a real frontmatter wikilink, the identity asset's layout /
    // backlinks list every Grounding that references it. userInput from the
    // modal still wins over this default.
    if (grounding.isDefinedBy) {
      mergedInput = { isDefinedBy: grounding.isDefinedBy, ...(mergedInput ?? {}) };
    }
    if (grounding.serviceCallPayload) {
      try {
        const substituted = this.substituteVariables(
          grounding.serviceCallPayload,
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
        // Not valid JSON — ignore.
      }
    }

    // Issue #4046 — a service_call step that opted into
    // `exocmd__Grounding_targetsCreatedInstance` must make the SERVICE act on
    // the just-created asset, not on the composite click-target.
    //
    // `executeComposite` already re-points `stepPath` (→ `filePath` here) to
    // `lastCreatedPath` for such a step, but every registered service resolves
    // its file from the IRI it is handed — `IGroundingService.execute` has no
    // file-path channel — so the flag was silently ignored for `service_call`
    // and the step "succeeded" while operating on the click-target.
    //
    // Re-expressing `filePath` as an `obsidian://vault/<path>` IRI is the
    // dialect BOTH target resolvers already accept: the CLI's
    // `createPathBasedTargetResolver` strips it via `iriToVaultPath`, and the
    // plugin's `createObsidianTargetResolver` decodes it and looks the path up
    // in `app.vault` (which — unlike `metadataCache` — registers a newly
    // created TFile synchronously). A bare vault-relative path would NOT work:
    // the plugin resolver treats a non-`obsidian://` input as a uid/@id and
    // falls into a metadataCache scan that cannot match a file path.
    //
    // Scoped to the opt-in flag on purpose: with the flag absent this is
    // `targetIRI` byte-for-byte, so every existing grounding is unaffected.
    // With the flag set but NO prior create_instance, `executeComposite` leaves
    // `stepPath === filePath` (the click-target), so the step still targets the
    // click-target. `$target` substitution above deliberately keeps using the
    // source `targetIRI` (link-back semantics, see executeComposite).
    const serviceTargetIRI =
      grounding.targetsCreatedInstance === true && filePath
        ? vaultPathToIRI(filePath)
        : targetIRI;

    await service.execute(serviceTargetIRI, mergedInput);
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
   * Subproject 17f58ebe Веха 3 — `body_template` grounding. Resolve a body
   * template (inline `bodyTemplate` literal OR `templateRef` →
   * `exotemplate__Template` body via the injected loader) and write it as the
   * BODY of the target file, preserving its frontmatter. `$token` markers are
   * resolved via the shared SubstitutionResolverRegistry (Веха 4). Inside a
   * `composite`, the target is the most-recently created asset (the composite
   * threads its path here) — so create_instance + body_template gives a created
   * asset with a templated body.
   */
  private async executeBodyTemplate(
    grounding: GroundingDefinition,
    targetIRI: string,
    targetFilePath: string,
    userInput?: UserInput,
  ): Promise<ExecutionResult> {
    // 1. Source the raw template markdown. templateRef (homoiconic, points at an
    //    exotemplate__Template asset) wins; inline bodyTemplate is the fallback
    //    / test path. Neither → fail loud (a no-op body write is a config error).
    let rawBody: string | null = null;
    if (grounding.templateRef) {
      if (!this.templateLoader) {
        // A templateRef was authored but no loader is wired — degrade to the
        // inline literal if present, else fail loud rather than silently no-op.
        if (grounding.bodyTemplate === undefined) {
          return {
            success: false,
            error: `body_template: templateRef "${grounding.templateRef}" set but no TemplateLoaderPort is wired (and no inline bodyTemplate fallback).`,
          };
        }
        rawBody = grounding.bodyTemplate;
      } else {
        rawBody = await this.templateLoader(grounding.templateRef);
        if (rawBody === null) {
          return {
            success: false,
            error: `body_template: templateRef "${grounding.templateRef}" did not resolve to a template body (asset missing or empty).`,
          };
        }
      }
    } else if (grounding.bodyTemplate !== undefined) {
      rawBody = grounding.bodyTemplate;
    } else {
      return {
        success: false,
        error: "body_template requires bodyTemplate or templateRef",
      };
    }

    // 2. Resolve $token markers via the shared registry (Веха 4). Context is
    //    lenient — unknown / empty / non-scalar tokens stay literal.
    const resolved = resolveTemplateBody(rawBody, {
      userInput,
      targetIRI,
      targetFilePath,
    });

    // 3. Write the resolved markdown as the target file's body, preserving any
    //    frontmatter the create_instance step (or the existing file) wrote.
    let content: string;
    try {
      content = await this.fileReader.readFile(targetFilePath);
    } catch (error) {
      return {
        success: false,
        error: `body_template: failed to read target file "${targetFilePath}": ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const newContent = GroundingExecutor.replaceBody(content, resolved);
    await this.fileWriter.updateFile(targetFilePath, newContent);
    return { success: true };
  }

  /**
   * Replace a markdown file's body (everything after the leading frontmatter
   * block) with `body`, preserving the frontmatter. When the file has no
   * frontmatter, the whole content becomes `body`. `\r?\n` tolerates CRLF.
   *
   * NOTE: an EMPTY frontmatter (`---\n---`) has no line between the fences, so
   * the regex treats it as "no frontmatter" and `body` replaces the whole file.
   * This never triggers on the composite create_instance path (it always writes
   * non-empty frontmatter: uid/label/instance_class/createdAt); it only affects
   * a standalone body_template on an empty-FM file — an acceptable corner.
   */
  private static replaceBody(content: string, body: string): string {
    const fmMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---/);
    if (!fmMatch) return body;
    return `${fmMatch[0]}\n${body}`;
  }

  /**
   * req 915b20b2 — extract a markdown file's BODY (everything after the leading
   * frontmatter block), the inverse of {@link replaceBody}. Strips the single
   * newline that {@link replaceBody} inserts between the frontmatter fence and
   * the body, so `extractBody(replaceBody(fm, body)) === body`. When the content
   * has no leading frontmatter block, the whole content IS the body. Used by
   * `create_instance` `cloneTargetBody` to carry the $target body forward.
   *
   * NOTE (symmetric to {@link replaceBody}): an EMPTY frontmatter (`---\n---`)
   * has no line between the fences, so the regex treats it as "no frontmatter"
   * and the whole content is returned as the body. This never affects the
   * cloneTargetBody path in practice: a real $target always carries non-empty
   * frontmatter (uid/label/instance_class), so its fence is matched and only the
   * true body is extracted.
   */
  private static extractBody(content: string): string {
    const fmMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---/);
    if (!fmMatch) return content;
    return content.slice(fmMatch[0].length).replace(/^\r?\n/, "");
  }

  private async executeCreateInstance(
    grounding: GroundingDefinition,
    targetIRI: string,
    targetFilePath: string,
    userInput?: UserInput,
  ): Promise<ExecutionResult> {
    if (!grounding.targetFolder) {
      return { success: false, error: "create_instance requires targetFolder" };
    }

    const properties: Record<string, unknown> = {};

    // RFC 727572d2 — Read $target frontmatter ONCE for both InheritanceRule
    // step AND $target.property resolver. Previously gated by
    // `grounding.inheritanceRule.length > 0` (RFC 32445c1c); now also needed
    // by Universal Default Template's `$target.property(isDefinedBy)` etc.
    let targetFm: Record<string, string | string[]> | null = null;
    // req 915b20b2 — target BODY clone: captured from the same single read as
    // targetFm when `cloneTargetBody` is set (empty string if the target has no
    // body). `null` = not requested / not read.
    let targetBody: string | null = null;
    const needsTargetRead =
      (grounding.inheritanceRule && grounding.inheritanceRule.length > 0) ||
      (grounding.propertyDefault &&
        grounding.propertyDefault.some(
          (pd) =>
            typeof pd.value === "string" && pd.value.includes("__SUBSTITUTE"),
        )) ||
      // RFC ce27e55d: labelTemplate с токеном `$target.<prop>` нуждается
      // в frontmatter target'а для substituteVariables. Чисто `$nowCompact`
      // или `$today` не требуют target read, поэтому проверяем dotted-form.
      (grounding.labelTemplate !== undefined &&
        /\$target\./.test(grounding.labelTemplate)) ||
      // req 915b20b2 — target body clone needs the target file content too.
      grounding.cloneTargetBody === true;
    if (needsTargetRead && targetIRI && targetFilePath) {
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
      if (grounding.cloneTargetBody) {
        targetBody = GroundingExecutor.extractBody(targetContent);
      }
    }

    // RFC 727572d2 — Resolve grounding's targetClass to canonical UID once
    // for the $grounding.targetClass resolver below.
    let groundingTargetClassUid: string | undefined;
    if (grounding.targetClass) {
      groundingTargetClassUid = await this.resolveClassRefToUid(
        grounding.targetClass,
      );
    }

    // RFC 727572d2 — Step 1 (PropertyDefault, parser-merged Universal +
    // Grounding). The parser (CommandResolver.resolvePropertyDefaults) has
    // already prepended UniversalDefaultTemplate entries and applied Grounding
    // overrides by propertyName. Executor just resolves any remaining markers
    // and writes results.
    //
    // Safety net (RFC 727572d2 Q3): when no PropertyDefault entries arrived
    // AT ALL (no Universal singleton in vault + no Grounding entries), fall
    // back to the legacy hardcoded primitives with a loud warn — protects
    // cold-start race on mobile boot paths from creating empty/invalid assets.
    // req c03f9e3e — per-ontology efforts routing. The resolver chain is
    // synchronous, so the SECOND hop (dereference an asset the click-target
    // points at and read a property off it) is pre-resolved here, up front,
    // into targetRefFm before applyPropertyDefaultStep. No-op (undefined) when
    // no `targetRefProperty` marker is present or no `refToFrontmatter` is wired.
    const targetRefFm = await this.preResolveTargetRefs(
      grounding.propertyDefault,
      targetFm,
    );
    const ctx: ResolverContext = {
      userInput,
      targetIRI,
      targetFilePath,
      targetFm: targetFm ?? undefined,
      targetRefFm,
      groundingTargetClassUid,
    };
    if (grounding.propertyDefault && grounding.propertyDefault.length > 0) {
      this.applyPropertyDefaultStep(properties, grounding.propertyDefault, ctx);
    }

    // RFC 727572d2 Q3 safety net (defense-in-depth). After applying PropertyDefaults
    // — whether from Universal Template, Grounding, or both — check that the essential
    // primitives are present. Fill any gaps from legacy TS primitives (selective top-up,
    // not all-or-nothing). Triggers when:
    //   - Universal singleton is fully absent (no PDs reach executor at all)
    //   - Universal singleton present but does NOT cover one of the 4 essentials
    //     (e.g. partial vault corruption, in-flight migration)
    //   - Grounding-specific PD set overrides Universal entries but leaves gaps
    //
    // Each fired gap-fill is logged so vault health regressions are visible.
    // Phase A top-up: fill missing scalar primitives (uid/createdAt/label/
    // Instance_class). Backlink is deferred to Phase B (after IR step) so
    // we don't write legacy default before IRs get a chance.
    this.applyMissingScalarPrimitives(
      properties,
      userInput,
      groundingTargetClassUid,
      grounding,
      targetIRI,
      targetFm,
      targetFilePath,
    );

    // userInput wins over PropertyDefault and InheritanceRule — apply after
    // PropertyDefault so explicit user values override Universal defaults.
    if (userInput) {
      for (const [key, value] of Object.entries(userInput)) {
        if (key === "label") continue;
        // Issue #3744 — `body` is a reserved engine input (symmetric to
        // `label`): it never becomes a frontmatter key; instead it is written
        // as the created asset's markdown body below.
        if (key === "body") continue;
        // Feature ec15f83e / req 57b03ab3 — `plannedDate` is a reserved engine
        // input (the plugin modal's date field / the CLI `--date` parameter):
        // it never becomes a frontmatter key; it selects the instance's target
        // DATE for `$today`/label resolution + the prototype-time planned-
        // timestamp stamp (see applyPrototypeTimePropagation). Defaults to today.
        if (key === "plannedDate") continue;
        if (value === null || value === undefined) continue;
        properties[key] = value;
      }
    }

    // RFC 727572d2 — Step 2 (InheritanceRule, parser-merged Universal +
    // Grounding). Universal IRs include the per-prototype backlink rules
    // (TaskPrototype → exo__Asset_prototype, etc.) AND the Bug #5 fix
    // (Project → ems__Effort_parent — NOT exo__Asset_prototype).
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

    // Phase B top-up: backlink. Only fires when NO backlink-shaped key was
    // written by PD step / IR step AND grounding has no explicit
    // linkBackProperty. Safety-net for degraded mode where Universal singleton
    // is fully absent (IRs missing → no rule wrote backlink). Bug #5 returns
    // here, but a corrupt asset is preferable to creation failure.
    await this.applyMissingBacklinkTopUp(
      properties,
      grounding,
      targetIRI,
      targetFilePath,
      targetFm,
    );

    // Per-Grounding explicit linkBackProperty (legacy escape hatch) — still
    // honoured when set. Universal IRs handle the default case; per-Grounding
    // explicit overrides win.
    if (targetIRI && grounding.linkBackProperty) {
      if (properties[grounding.linkBackProperty] === undefined) {
        const backLinkTarget = GroundingExecutor.extractBacklinkTarget(
          targetIRI,
          targetFilePath,
        );
        properties[grounding.linkBackProperty] = `"[[${backLinkTarget}]]"`;
      }
    }

    // Feature ec15f83e / req 57b03ab3 — when the $target prototype declares a
    // time-of-day on itself (ems__EffortPrototype_startTime/_endTime), stamp
    // the instance's planned timestamps for the chosen date (default today).
    // No-op for prototypes / create flows without a time-of-day.
    this.applyPrototypeTimePropagation(properties, targetFm, userInput);

    // Determine uid for filename — read from properties (PropertyDefault wrote
    // it via $randomUUIDv4 token; top-up guaranteed it's set otherwise).
    const uid = properties.exo__Asset_uid as string;

    const content = this.frontmatterService.createFrontmatter("", properties);
    // Issue #3136 (Q3.b closure): allow `$targetFolder` / `$target` tokens in
    // `grounding.targetFolder` so new instances can inherit the target's
    // parent folder declaratively (replacing legacy `createTaskForDailyNote`).
    //
    // T1 "Create Instance" (project bbe40f8c): `$isDefinedByFolder` resolves
    // to the folder of the instance's chosen `exo__Asset_isDefinedBy` ontology
    // (co-location invariant). The host page is the class definition (which may
    // live in a different ontology than the one the user picks), so we cannot
    // reuse `$targetFolder` here. Falls back to the host folder when the ref
    // cannot be resolved — a degraded location beats a failed create.
    const resolvedFolder = grounding.targetFolder.includes("$isDefinedByFolder")
      ? await this.resolveIsDefinedByFolder(properties, targetFilePath)
      : this.substituteVariables(
          grounding.targetFolder,
          targetIRI,
          userInput,
          undefined,
          targetFilePath,
        );
    const filePath = resolvedFolder ? `${resolvedFolder}/${uid}.md` : `${uid}.md`;

    // Issue #3744 — `body` is a reserved userInput key (symmetric to `label`):
    // when present and a non-empty string it becomes the new asset's markdown
    // body, written in the same create (one `apply`, no composite grounding,
    // no literal token). Reuses `replaceBody` — the same helper `body_template`
    // uses — to splice the body after the just-built frontmatter. Absent/empty
    // → frontmatter-only content (current behavior; the plugin inline button
    // simply never passes `body`, so zero regression).
    //
    // req 915b20b2 — `cloneTargetBody`: when the grounding asks to clone the
    // click-target's body AND no explicit non-empty `userInput.body` was passed,
    // splice the captured `targetBody` (empty target body → frontmatter-only, no
    // spurious content). Precedence: explicit userInput.body > cloned target
    // body > empty. Frontmatter is never copied — only the markdown body.
    const rawBody = userInput?.body;
    const bodyToWrite =
      typeof rawBody === "string" && rawBody.length > 0
        ? rawBody
        : grounding.cloneTargetBody &&
            typeof targetBody === "string" &&
            targetBody.length > 0
          ? targetBody
          : null;
    const finalContent =
      bodyToWrite !== null
        ? GroundingExecutor.replaceBody(content, bodyToWrite)
        : content;

    await this.fileWriter.createFile(filePath, finalContent);

    // Issue #3184 B5: surface the created file's vault-relative path so the
    // presentation layer can open it in a new tab. Core stays surface-agnostic
    // — actually opening the file is wired by the platform adapter through
    // CommandExecutionFlow's optional IFileOpener dependency.
    return { success: true, openPath: filePath };
  }

  /**
   * Feature ec15f83e / req 57b03ab3 — the target DATE for a newly-created
   * instance: the reserved `plannedDate` userInput (the plugin modal's date
   * field / the CLI `--date` parameter) when a valid `YYYY-MM-DD`; otherwise
   * today's LOCAL calendar day (req 26d79c70 / #3809 — same source and basis as
   * the `$today` SubstitutionToken and `$date`, which use local `Date` getters).
   * Drives BOTH the date-denoting label (`$today` in the labelTemplate) AND the
   * planned timestamps, so the two never disagree — and, since the prototype
   * time-of-day at {@link applyPrototypeTimePropagation} is already a local
   * `"YYYY-MM-DDTHH:MM:SS"`, the DATE and TIME are now both local (the former
   * UTC date slice made them disagree just after local midnight in a UTC+N
   * timezone). `nowDate` lets callers reuse an already-computed `clock.now()`
   * Date (substituteVariables) to avoid a second clock read; both code paths
   * resolve `plannedDate` identically.
   */
  private resolveInstanceDate(userInput?: UserInput, nowDate?: Date): string {
    const explicit = GroundingExecutor.firstScalar(
      userInput?.["plannedDate"] as string | string[] | undefined,
    );
    if (explicit && /^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;
    return DateFormatter.toDateString(nowDate ?? this.clock.now());
  }

  /**
   * Feature ec15f83e / req 57b03ab3 — when the $target prototype declares a
   * time-of-day on itself (`ems__EffortPrototype_startTime`, optionally
   * `_endTime`, in `"HH:MM"` form), stamp the new instance's
   * `ems__Effort_plannedStartTimestamp` (and `_plannedEndTimestamp`) =
   * {@link resolveInstanceDate} + that time, as a FULL timezone-naive local
   * dateTime `"YYYY-MM-DDTHH:MM:SS"` (Asia/Almaty convention — matches the
   * existing `ems__Effort_plannedStartTimestamp` frontmatter shape).
   *
   * No-op only when the prototype declares NO time-of-day at all (neither
   * `startTime` nor `endTime`) → zero regression for create flows without a
   * time. A prototype with only `_endTime` (e.g. an `ems__ActionPrototype`
   * point-in-time intake) stamps just `_plannedEndTimestamp` (#3929). Never
   * overwrites a planned timestamp that an explicit `userInput` already wrote
   * into `properties` (the prototype time is a default, not an override).
   *
   * Reads from `targetFm`, which is only populated when `needsTargetRead` is
   * true (InheritanceRule / `__SUBSTITUTE` PropertyDefault / `$target.`
   * labelTemplate). For the real prototype-instance flow this always holds —
   * the `exo__Asset_prototype` backlink InheritanceRule forces the read — so a
   * time-bearing prototype is always seen; a null `targetFm` is a safe no-op.
   */
  private applyPrototypeTimePropagation(
    properties: Record<string, unknown>,
    targetFm: Record<string, string | string[]> | null,
    userInput?: UserInput,
  ): void {
    if (!targetFm) return;
    const startTime = GroundingExecutor.firstScalar(
      targetFm["ems__EffortPrototype_startTime"],
    );
    const endTime = GroundingExecutor.firstScalar(
      targetFm["ems__EffortPrototype_endTime"],
    );
    // No-op only when the prototype declares NO time-of-day at all. A prototype
    // with only `_endTime` and no `_startTime` (e.g. an ems__ActionPrototype —
    // a point-in-time БАД/med intake at its `_endTime`) must still stamp its
    // planned end timestamp; the earlier `if (!startTime) return` dropped it
    // entirely (#3929).
    if (!startTime && !endTime) return;
    const instanceDate = this.resolveInstanceDate(userInput);
    if (
      startTime &&
      properties["ems__Effort_plannedStartTimestamp"] === undefined
    ) {
      const startTs = GroundingExecutor.combineDateAndTime(
        instanceDate,
        startTime,
      );
      if (startTs !== null) {
        properties["ems__Effort_plannedStartTimestamp"] = startTs;
      } else {
        LoggingService.warn(
          `[GroundingExecutor] prototype ems__EffortPrototype_startTime "${startTime}" is not a valid HH:MM[:SS] time-of-day — skipping plannedStartTimestamp stamp.`,
        );
      }
    }
    if (endTime && properties["ems__Effort_plannedEndTimestamp"] === undefined) {
      const endTs = GroundingExecutor.combineDateAndTime(instanceDate, endTime);
      if (endTs !== null) {
        properties["ems__Effort_plannedEndTimestamp"] = endTs;
      } else {
        LoggingService.warn(
          `[GroundingExecutor] prototype ems__EffortPrototype_endTime "${endTime}" is not a valid HH:MM[:SS] time-of-day — skipping plannedEndTimestamp stamp.`,
        );
      }
    }
  }

  /**
   * First scalar of a frontmatter value (`string | string[]`), trimmed with any
   * surrounding YAML quotes stripped. Returns null for empty / non-string.
   */
  private static firstScalar(
    value: string | string[] | undefined,
  ): string | null {
    if (value === undefined || value === null) return null;
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw !== "string") return null;
    const trimmed = raw
      .trim()
      .replace(/^["'](.*)["']$/, "$1")
      .trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  /**
   * Combine a `YYYY-MM-DD` date with a `"HH:MM"` (or `"HH:MM:SS"`) time-of-day
   * into a full timezone-naive local dateTime `"YYYY-MM-DDTHH:MM:SS"`. A bare
   * `HH:MM` gets `:00` seconds appended; an already-`HH:MM:SS` value passes
   * through. NEVER emits a trailing timezone offset.
   *
   * Returns null when `timeOfDay` is not a valid `HH:MM[:SS]` (HH 00-23, MM/SS
   * 00-59) — the caller then skips stamping rather than splicing a garbage
   * value into the typed `ems__Effort_planned*Timestamp` (which downstream
   * calendar/sort consumers could not parse). Defensive against a malformed
   * user-authored `ems__EffortPrototype_startTime`.
   */
  private static combineDateAndTime(
    date: string,
    timeOfDay: string,
  ): string | null {
    if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(timeOfDay)) return null;
    const time = /^\d{2}:\d{2}$/.test(timeOfDay) ? `${timeOfDay}:00` : timeOfDay;
    return `${date}T${time}`;
  }

  /**
   * T1 "Create Instance" (project bbe40f8c) — resolve the co-located folder for
   * a new instance from its just-written `exo__Asset_isDefinedBy` value, using
   * the injected {@link RefToFolderResolver}. The instance lives in the folder
   * of the file its `isDefinedBy` ontology points at (co-location invariant).
   *
   * Falls back to the host (target) file's parent folder when:
   *   - no `exo__Asset_isDefinedBy` was written (no ontology chosen),
   *   - no resolver is wired (CLI/test harness without a vault index),
   *   - the resolver returns null/throws (ontology file not found).
   * A degraded-but-valid location is preferable to a failed create; the
   * co-location audit (`audit co-location`) surfaces any drift.
   */
  private async resolveIsDefinedByFolder(
    properties: Record<string, unknown>,
    targetFilePath: string,
  ): Promise<string> {
    const hostFolder = GroundingExecutor.parentFolderOf(targetFilePath);
    const rawIsDefinedBy = properties["exo__Asset_isDefinedBy"];
    const ref = GroundingExecutor.extractBareRef(rawIsDefinedBy);
    if (ref && this.refToFolder) {
      try {
        const folder = await this.refToFolder(ref);
        if (folder !== null && folder !== undefined) return folder;
      } catch (error) {
        LoggingService.error(
          `[GroundingExecutor] $isDefinedByFolder resolution failed for ref "${ref}" — falling back to host folder.`,
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
    return hostFolder;
  }

  /** Vault-relative parent folder of a file path (empty when at vault root). */
  private static parentFolderOf(filePath: string): string {
    const normalized = filePath.replace(/^\/+/, "");
    const slashIdx = normalized.lastIndexOf("/");
    return slashIdx >= 0 ? normalized.slice(0, slashIdx) : "";
  }

  /**
   * Strip YAML quotes, wikilink brackets, and any `|alias` segment from a
   * frontmatter ref value (`'"[[<uid>|Label]]"'` → `<uid>`). Returns null when
   * the value is not a string or yields no bare ref.
   */
  private static extractBareRef(value: unknown): string | null {
    if (typeof value !== "string") return null;
    let ref = value.trim();
    ref = ref.replace(/^["']|["']$/g, "").trim();
    ref = ref.replace(/^\[\[/, "").replace(/\]\]$/, "");
    const pipeIdx = ref.indexOf("|");
    if (pipeIdx >= 0) ref = ref.slice(0, pipeIdx);
    ref = ref.trim();
    return ref.length > 0 ? ref : null;
  }

  /**
   * req c03f9e3e — per-ontology efforts routing. Pre-resolve the SECOND hop for
   * every `targetRefProperty(<refKey>|<propKey>)` marker in the grounding's
   * PropertyDefaults. The resolver chain runs synchronously (see
   * {@link resolveSubstitutionMarker}), so a dereference of another asset — which
   * needs an async vault lookup — cannot happen inside a resolver. Instead this
   * runs up front: for each distinct `refKey` referenced by a `targetRefProperty`
   * marker, read the bare ref out of the click-target's own frontmatter
   * (`targetFm[refKey]`), resolve THAT asset's frontmatter via the injected
   * {@link RefToFrontmatterResolver}, and return a map `refKey → frontmatter`
   * placed into {@link ResolverContext.targetRefFm}.
   *
   * Returns `undefined` (no async work, no context field) when there are no such
   * markers, no `refToFrontmatter` resolver is wired, or no target frontmatter was
   * read — the two-hop resolver then yields nothing and the create is not routed
   * (opt-in / zero regression for unconfigured groundings). A resolution failure
   * for one refKey is logged and stored as `null` rather than failing the create.
   */
  private async preResolveTargetRefs(
    propertyDefault: ReadonlyArray<PropertyDefaultResolved> | undefined,
    targetFm: Record<string, string | string[]> | null,
  ): Promise<Record<string, Record<string, unknown> | null> | undefined> {
    if (!propertyDefault || !this.refToFrontmatter || !targetFm) return undefined;
    const refKeys = new Set<string>();
    for (const { value } of propertyDefault) {
      if (typeof value !== "string") continue;
      const refKey = GroundingExecutor.extractTargetRefPropertyRefKey(value);
      if (refKey) refKeys.add(refKey);
    }
    if (refKeys.size === 0) return undefined;

    const map: Record<string, Record<string, unknown> | null> = {};
    for (const refKey of refKeys) {
      // First hop reads the click-target's own ref. isDefinedBy is single-valued
      // per the co-location invariant, but tolerate a single-item YAML-list form
      // (["[[O]]"]) — mirror the second-hop resolver's array unwrap for symmetry.
      const raw = targetFm[refKey];
      const refVal = Array.isArray(raw) ? raw[0] : raw;
      const ref = GroundingExecutor.extractBareRef(refVal);
      if (!ref) {
        map[refKey] = null;
        continue;
      }
      try {
        map[refKey] = await this.refToFrontmatter(ref);
      } catch (error) {
        LoggingService.error(
          `[GroundingExecutor] targetRefProperty second-hop resolution failed for ref "${ref}" (refKey "${refKey}") — routing skipped, instance co-locates with the click-target.`,
          error instanceof Error ? error : new Error(String(error)),
        );
        map[refKey] = null;
      }
    }
    return map;
  }

  /**
   * req c03f9e3e — when `value` is a parameterised `targetRefProperty` marker,
   * decode its `<refKey>|<propKey>` parameter and return the `refKey` (the part
   * before the first `|`); otherwise `null`. Used by {@link preResolveTargetRefs}
   * to discover which of the click-target's own frontmatter refs must be
   * dereferenced for the second hop.
   */
  private static extractTargetRefPropertyRefKey(value: string): string | null {
    const m = value.match(PARAMETERISED_MARKER_RE);
    if (!m || m[1] !== "targetRefProperty") return null;
    const parameter = GroundingExecutor.decodeBase64UrlSafe(m[2]);
    const sep = parameter.indexOf("|");
    if (sep < 0) return null;
    const refKey = parameter.slice(0, sep);
    return refKey.length > 0 ? refKey : null;
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
   * RFC 32445c1c removed the legacy Step 4 (copy-from-target + BLACKLIST).
   * PropertyDefault is now the only path that writes constants such as
   * `ems__Effort_status` into a newly created instance.
   */
  private applyPropertyDefaultStep(
    properties: Record<string, unknown>,
    propertyDefault: ReadonlyArray<PropertyDefaultResolved>,
    ctx: ResolverContext,
  ): void {
    for (const { propertyName, value } of propertyDefault) {
      if (properties[propertyName] !== undefined) continue;
      const resolved = this.resolveSubstitutionMarker(value, ctx);
      if (resolved === null || resolved === undefined) continue;
      // Special handling for known list-typed frontmatter keys (Obsidian
      // semantic): resolver may return string[] for `aliases`-shape writes.
      if (Array.isArray(resolved)) {
        if (resolved.length === 0) continue;
        properties[propertyName] = resolved;
        continue;
      }
      // Special wrap for exo__Instance_class — convention is YAML list with
      // single wikilink-form entry (Form C canonical, per Issue #3123).
      if (propertyName === "exo__Instance_class" && typeof resolved === "string") {
        properties[propertyName] = [resolved];
        continue;
      }
      properties[propertyName] = resolved;
    }
  }

  /**
   * RFC 727572d2 Q3 safety net (defense-in-depth). Selectively top-up any
   * essential primitive that PropertyDefaults did not cover, logging each
   * gap so vault-health regressions surface. The 4 essentials checked are:
   * exo__Asset_uid, exo__Asset_createdAt, exo__Asset_label, exo__Instance_class.
   *
   * Backlink top-up: when neither the grounding's explicit linkBackProperty
   * nor a Universal InheritanceRule has produced a backlink, write the
   * legacy `exo__Asset_prototype` default. Bug #5 returns in this degraded
   * state (Project will get the wrong key), but a corrupt asset is
   * preferable to a creation failure when the vault is unhealthy.
   *
   * Each top-up emits LoggingService.error so the unhealthy state is visible.
   */
  private applyMissingScalarPrimitives(
    properties: Record<string, unknown>,
    userInput: UserInput | undefined,
    groundingTargetClassUid: string | undefined,
    grounding?: GroundingDefinition,
    targetIRI?: string,
    targetFm?: Record<string, string | string[]> | null,
    targetFilePath?: string,
  ): void {
    const missing: string[] = [];

    if (properties.exo__Asset_uid === undefined) {
      properties.exo__Asset_uid = this.uidGen.next();
      missing.push("exo__Asset_uid");
    }

    if (properties.exo__Asset_createdAt === undefined) {
      properties.exo__Asset_createdAt = DateFormatter.toLocalTimestamp(
        this.clock.now(),
      );
      missing.push("exo__Asset_createdAt");
    }

    // exo__Asset_updatedAt: enforced last-modified invariant from birth (task
    // 1af85afd). Created assets carry updatedAt = createdAt. This is a SILENT
    // safety-net (NOT pushed to `missing`): the homoiconic Universal Default
    // Template PropertyDefault is the primary mechanism, but its absence is not
    // an "unhealthy vault" signal the way a missing uid/createdAt/label/class
    // is — the derived updatedAt = createdAt is always recoverable here. Keeping
    // it out of `missing` avoids a spurious unhealthy-state warning on every
    // create_instance until the template PD lands.
    if (properties.exo__Asset_updatedAt === undefined) {
      properties.exo__Asset_updatedAt = properties.exo__Asset_createdAt;
    }

    // RFC ce27e55d: also treat an empty / whitespace-only `exo__Asset_label`
    // written by an upstream PropertyDefault as "missing". Discovered during
    // UI smoke 2026-05-29 — Universal Default Template's PD #3
    // (`exo__Asset_label = $userInputLabel`) writes an empty literal when
    // userInput.label is undefined (one-click flow). That left labels blank
    // on disk because the `=== undefined` guard skipped my labelTemplate
    // fallback. Treat blank PropertyDefault result identically to absent.
    const labelIsBlank =
      typeof properties.exo__Asset_label === "string" &&
      properties.exo__Asset_label.trim().length === 0;
    if (properties.exo__Asset_label === undefined || labelIsBlank) {
      // RFC ce27e55d: labelTemplate fallback before the "Untitled" hardcoded.
      // Active when:
      //   - userInput has no `label` field (one-click flow, no input modal);
      //   - grounding declares `exocmd__Grounding_labelTemplate`;
      //   - substituteVariables succeeds (else fall through to "Untitled").
      //
      // Single source of truth for label decision (advisor adjustment): the
      // executor already owns the property-write at this point. Adding the
      // resolution in CommandExecutionFlow would split logic across two layers.
      let label: string | undefined = userInput?.label as string | undefined;
      if (label === undefined && grounding?.labelTemplate) {
        try {
          const substituted = this.substituteVariables(
            grounding.labelTemplate,
            targetIRI ?? "",
            userInput,
            targetFm ?? undefined,
            targetFilePath,
          );
          // Reviewer MEDIUM: empty / whitespace-only substitution result
          // would otherwise leak into `exo__Asset_label:` as a literally
          // empty value (worse than "Untitled"). Treat blank substituted
          // result as "no label" per RFC ce27e55d contract. Scoped only to
          // labelTemplate path — userInput.label `??` semantics preserved
          // (advisor round-2 — keep RFC diff minimal).
          if (substituted.trim().length > 0) {
            label = substituted;
          }
        } catch (error) {
          LoggingService.error(
            `[GroundingExecutor] labelTemplate substitution failed: ${error instanceof Error ? error.message : String(error)}. Falling back to "Untitled".`,
          );
        }
      }
      // A modal-submitted empty `userInput.label` ("") must not write a blank
      // label to disk nor escape the unhealthy-state signal: it is not
      // `undefined`, so `??` would keep it, and "" !== "Untitled". Treat any
      // blank resolved label as absent → "Untitled" fallback (which is then
      // flagged below). The labelTemplate path already guards blank at its
      // substitution site, so only the userInput.label === "" path reaches here.
      const finalLabel =
        label !== undefined && label.trim().length > 0 ? label : "Untitled";
      properties.exo__Asset_label = finalLabel;
      // ⛤ Test the CANONICAL spelling, not just the bare one. `createFrontmatter`
      // collapses `exo__Asset_aliases` onto `aliases` (req 869561bf), but that
      // happens LATER — so a template / propertyDefault / inheritance-rule
      // supplying the prefixed key would leave `properties.aliases` undefined
      // here, this guard would add the label-derived aliases anyway, and the
      // collapse would then keep whichever landed last. On origin/main both keys
      // survived (ugly, half-dead); silently dropping one would be worse.
      const aliasesAlreadySet = Object.keys(properties).some(
        (k) => canonicalYamlKey(k) === "aliases",
      );
      if (finalLabel !== "Untitled" && !aliasesAlreadySet) {
        properties.aliases = [finalLabel];
      }
      // Only the genuine degraded fallthrough ("Untitled") is an
      // unhealthy-state signal. Reaching this block is NORMAL for the one-click
      // / CLI flow: Universal Default Template PD #3 (`exo__Asset_label =
      // $userInputLabel`) writes an empty literal when no input modal supplies
      // a label, and the labelTemplate / userInput path above is the *designed*
      // completion — not a TS-fallback rescue. Pushing "exo__Asset_label" to
      // `missing[]` unconditionally falsely tripped the "Vault may be in an
      // unhealthy state" ERROR on every healthy labelTemplate-driven create
      // (bug-fix: false-alarm log). Flag only the real "Untitled" fallback.
      if (finalLabel === "Untitled") {
        missing.push("exo__Asset_label");
      }
    }

    if (
      properties.exo__Instance_class === undefined &&
      groundingTargetClassUid
    ) {
      properties.exo__Instance_class = [`"[[${groundingTargetClassUid}]]"`];
      missing.push("exo__Instance_class");
    }

    if (missing.length > 0) {
      LoggingService.error(
        `[GroundingExecutor] Universal Default Template did not cover essential scalar primitives: ${missing.join(", ")}. Filled from legacy TS fallback. Vault may be in an unhealthy state — verify UniversalDefaultTemplate singleton is present and complete.`,
      );
    }
  }

  /**
   * Phase B top-up: legacy `exo__Asset_prototype` backlink default. Fires
   * ONLY when:
   *   - target asset known (targetIRI truthy)
   *   - no per-Grounding explicit linkBackProperty (writes its own value below)
   *   - no Universal/Grounding InheritanceRule has written a common backlink
   *     key (exo__Asset_prototype, ems__Effort_parent)
   *
   * This guards the safety net from double-writing backlink when the IR step
   * already produced one.
   *
   * req 0bb06beb — and it fires ONLY when the target IS a prototype. The old
   * comment framed the choice as «a corrupt asset is preferable to creation
   * failure»; that dilemma was false, because writing NOTHING was never on the
   * table. A missing backlink is a normal state, while an invented one is a lie
   * the graph then carries — measured at 112 assets across the three vaults,
   * each asserting `exo__Asset_prototype` toward a daily note / area / any class
   * without a backlink rule. The net is kept where it is truthful: a real
   * prototype whose Universal InheritanceRules are absent still gets its link.
   */
  private async applyMissingBacklinkTopUp(
    properties: Record<string, unknown>,
    grounding: GroundingDefinition,
    targetIRI: string,
    targetFilePath: string,
    targetFm?: Record<string, string | string[]> | null,
  ): Promise<void> {
    if (!targetIRI || grounding.linkBackProperty) return;
    if (
      properties.exo__Asset_prototype !== undefined ||
      properties.ems__Effort_parent !== undefined
    ) {
      return;
    }
    const backLinkTarget = GroundingExecutor.extractBacklinkTarget(
      targetIRI,
      targetFilePath,
    );
    // Issue #3561: the legacy exo__Asset_prototype default is a degraded-mode
    // safety net — it must fire ONLY when the new instance has no link back to
    // its creation target at all. An InheritanceRule may already have linked it
    // under a relationship key the two named checks above don't enumerate:
    // ems__Effort_area (Task/Project created on an Area) or ems__Area_parent
    // (child Area created on an Area). Maintaining a hard-coded key list is
    // exactly what went stale and produced #3561 (area IRs fire correctly, the
    // instance IS linked, yet the legacy default still wrote a spurious
    // exo__Asset_prototype=[[area]] + a red "No backlink rule fired" error).
    // Detect the link by VALUE instead: if any property already references the
    // target, the asset is not orphaned, so the legacy default (and its noisy
    // Bug #5 warning) must not fire. Future relationship keys are covered for
    // free, eliminating the stale-list bug class.
    if (GroundingExecutor.propertiesReferenceTarget(properties, backLinkTarget)) {
      return;
    }
    // req 0bb06beb — the gate. `exo__Asset_prototype` means «this asset was
    // instantiated from that prototype», so writing it toward a non-prototype
    // is false by definition. `targetFm` is only pre-read when the grounding
    // needed it (inheritanceRule / $target tokens / cloneTargetBody), and the
    // degraded path this net exists for is exactly the one where it was NOT —
    // so read the target here rather than defaulting to a guess. Unreadable or
    // unresolvable target → write nothing: an absent backlink is recoverable,
    // an invented one silently corrupts the graph.
    const fm =
      targetFm ?? (await this.readTargetFrontmatter(targetIRI, targetFilePath));
    if (!(await this.targetIsPrototype(fm))) return;
    // req 0bb06beb — UID-canon reference. `extractBacklinkTarget` falls back to
    // the full vault path for a label-named target, which breaks the moment the
    // target is renamed or moved. The asset's own uid is stable, so prefer it.
    // The raw value may still carry YAML quoting (`exo__Asset_uid: "<uid>"`),
    // which would nest inside the wikilink and corrupt the reference.
    const rawUid = fm?.["exo__Asset_uid"];
    const uid =
      typeof rawUid === "string"
        ? rawUid
            .trim()
            .replace(/^['"]+|['"]+$/g, "")
            .trim()
        : "";
    const canonicalTarget = uid.length > 0 ? uid : backLinkTarget;
    properties.exo__Asset_prototype = `"[[${canonicalTarget}]]"`;
    LoggingService.error(
      "[GroundingExecutor] No backlink rule fired (Universal IRs absent or no class match). Falling back to legacy exo__Asset_prototype default — the target is a prototype, so the link is valid.",
    );
  }

  /**
   * req 0bb06beb — read the click-target's frontmatter on the degraded backlink
   * path, where `executeCreateInstance` had no reason to read it earlier. Any
   * failure yields `null`, which the caller treats as «cannot confirm» and so
   * writes no backlink at all.
   */
  private async readTargetFrontmatter(
    targetIRI: string,
    targetFilePath: string,
  ): Promise<Record<string, string | string[]> | null> {
    // Prefer the caller's path verbatim — `resolveTargetPath` normalises it for
    // wikilink use (strips a leading slash and the `.md`), which is exactly what
    // a file reader must NOT receive. Fall back to deriving it from the IRI so
    // the IRI-only call shape (Issue #3195's fallback branch) is covered too.
    let path = targetFilePath;
    if (!path) {
      const base = GroundingExecutor.resolveTargetPath(targetIRI, "");
      if (!base) return null;
      path = /\.md$/i.test(base) ? base : `${base}.md`;
    }
    try {
      const content = await this.fileReader.readFile(path);
      return this.frontmatterService.parseObject(content) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * req 0bb06beb — true when the click-target is a prototype, i.e. one of its
   * `exo__Instance_class` refs is `exo__Prototype` or reaches it through
   * `exo__Class_superClass`.
   *
   * The walk (rather than a `*Prototype` name-suffix test) is deliberate: the
   * suffix heuristic is exactly what req 5579ffa1 de-hacked, because a prototype
   * subclass need not be named `…Prototype`. Class refs are UID-form under
   * UID-canon (`[[<uid>]]` — verified on live prototypes), so the label is not
   * available inline and the class asset has to be dereferenced.
   */
  private async targetIsPrototype(
    targetFm: Record<string, string | string[]> | null | undefined,
  ): Promise<boolean> {
    if (!targetFm) return false;
    const refs = this.resolveClassRefsFromFrontmatter(targetFm);
    const seen = new Set<string>();
    for (const ref of refs) {
      if (await this.classRefReachesPrototype(ref, 0, seen)) return true;
    }
    return false;
  }

  /**
   * req 0bb06beb — depth- and cycle-bounded `exo__Class_superClass` walk looking
   * for `exo__Prototype`. Without a wired {@link RefToFrontmatterResolver} only
   * the inline label form can be judged, and an unresolvable class yields
   * `false` (fail-closed — see {@link applyMissingBacklinkTopUp}).
   */
  private async classRefReachesPrototype(
    ref: string,
    depth: number,
    seen: Set<string>,
  ): Promise<boolean> {
    if (depth > GroundingExecutor.MAX_PROTOTYPE_CLASS_WALK_DEPTH) return false;
    const trimmed = ref.trim();
    if (!trimmed || seen.has(trimmed)) return false;
    seen.add(trimmed);
    // `<uid>|<label>` and bare `<label>` both carry the label inline.
    const parts = trimmed.split("|");
    const key = parts[0].trim();
    const inlineLabel = (parts[1] ?? parts[0]).trim();
    if (inlineLabel === GroundingExecutor.PROTOTYPE_CLASS_LABEL) return true;
    if (!this.refToFrontmatter || !key) return false;
    let classFm: Record<string, unknown> | null;
    try {
      classFm = await this.refToFrontmatter(key);
    } catch {
      return false;
    }
    if (!classFm) return false;
    if (
      String(classFm["exo__Asset_label"] ?? "").trim() ===
      GroundingExecutor.PROTOTYPE_CLASS_LABEL
    ) {
      return true;
    }
    const supers = classFm["exo__Class_superClass"];
    const list = Array.isArray(supers)
      ? supers
      : supers === undefined || supers === null
        ? []
        : [supers];
    for (const parent of list) {
      const inner = this.extractWikilinkInner(String(parent));
      if (inner && (await this.classRefReachesPrototype(inner, depth + 1, seen))) {
        return true;
      }
    }
    return false;
  }

  /**
   * Issue #3561 — true when any property value already references `target` in
   * wikilink form (`[[<target>]]`), under ANY property name. Lets
   * {@link applyMissingBacklinkTopUp} recognise that an InheritanceRule already
   * linked the new instance to its creation target (ems__Effort_area /
   * ems__Area_parent / ems__Effort_parent / exo__Asset_prototype, or any future
   * relationship key) so the legacy prototype default is not written redundantly.
   * Multi-valued (array) properties are scanned element-wise.
   */
  private static propertiesReferenceTarget(
    properties: Record<string, unknown>,
    target: string,
  ): boolean {
    if (!target) return false;
    // `target` is the fully-bracketed wikilink inner emitted by
    // extractBacklinkTarget (a full UUID under UID-canon, or a whitelisted path
    // form). Because the needle is fully bracketed, `[[A]]` is a substring of
    // `[[B]]` only when A === B — substring match cannot alias one target onto
    // another.
    const needle = `[[${target}]]`;
    const refs = (v: unknown): boolean =>
      typeof v === "string" && v.includes(needle);
    for (const value of Object.values(properties)) {
      if (refs(value)) return true;
      if (Array.isArray(value) && value.some(refs)) return true;
    }
    return false;
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
    ctx: ResolverContext,
  ): string | string[] | null {
    // Parameterised marker (RFC 727572d2 — TokenInvocation form)
    const pmatch = value.match(PARAMETERISED_MARKER_RE);
    if (pmatch) {
      const resolverId = pmatch[1];
      const encodedParam = pmatch[2];
      const parameter = GroundingExecutor.decodeBase64UrlSafe(encodedParam);
      const fn = getResolver(resolverId);
      if (!fn) {
        LoggingService.warn(
          `[GroundingExecutor] Parameterised marker references unknown resolver '${resolverId}' — value left as marker.`,
        );
        return value;
      }
      return fn(ctx, parameter);
    }

    // Plain marker (RFC v2 + RFC 727572d2 non-parameterised context-dependent)
    const match = value.match(SUBSTITUTION_MARKER_RE);
    if (!match) return value;
    const resolverId = match[1];

    // Special-case `target` / `targetFolder` — they need GroundingExecutor's
    // strip-canon helper (#3195) to emit bare UID rather than full path. The
    // registry can't reach the private static; instead the executor short-
    // circuits these two and delegates only the new vocabulary to the
    // registry.
    if (resolverId === "target") {
      const targetIRI = ctx.targetIRI ?? "";
      const targetFilePath = ctx.targetFilePath ?? "";
      const bare = GroundingExecutor.extractBacklinkTarget(
        targetIRI,
        targetFilePath,
      );
      return `"[[${bare}]]"`;
    }
    if (resolverId === "targetFolder") {
      const targetFilePath = ctx.targetFilePath ?? "";
      if (!targetFilePath) return "";
      const normalized = targetFilePath.replace(/^\/+/, "");
      const slashIdx = normalized.lastIndexOf("/");
      return slashIdx >= 0 ? normalized.slice(0, slashIdx) : "";
    }

    const fn = getResolver(resolverId);
    if (!fn) {
      LoggingService.warn(
        `[GroundingExecutor] Marker references unknown resolver '${resolverId}' — value left as marker.`,
      );
      return value;
    }
    return fn(ctx);
  }

  /**
   * URL-safe base64 decoder for {@link PARAMETERISED_MARKER_RE} payload.
   * Mirrors the encoder in CommandResolver.buildParameterisedMarker.
   */
  private static decodeBase64UrlSafe(encoded: string): string {
    // base64ToUtf8 re-pads internally — only the url-safe alphabet needs
    // normalising here.
    return base64ToUtf8(encoded.replace(/-/g, "+").replace(/_/g, "/"));
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
   * RFC 32445c1c removed the legacy Step 4; InheritanceRule is now the only
   * pathway for properties like `ems__Effort_area` / `ems__Effort_parent` to
   * land on a new instance — explicit and declarative, no implicit copy.
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
        rule.targetClassConditionUid,
        targetClassNames,
      );
      if (!conditionOk) continue;
      const excluded = await this.inheritanceExclusionMatches(
        rule.targetClassExclusion,
        rule.targetClassExclusionUids,
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
   * condition (no label AND no UID) = unconditional rule (always matches).
   */
  private async inheritanceConditionMatches(
    conditionLabel: string | undefined,
    conditionUid: string | undefined,
    targetClassNames: string[],
  ): Promise<boolean> {
    if (!conditionLabel && !conditionUid) return true;
    return this.classRefMatchesAny(conditionLabel, conditionUid, targetClassNames);
  }

  /**
   * A rule is excluded when ANY excluded class matches the target. The UID and
   * label exclusion sets are checked independently (Issue #3562 — they are not
   * a positional parallel; either set alone is sufficient to exclude).
   */
  private async inheritanceExclusionMatches(
    exclusionLabels: readonly string[],
    exclusionUids: readonly string[] | undefined,
    targetClassNames: string[],
  ): Promise<boolean> {
    for (const uid of exclusionUids ?? []) {
      if (uid && targetClassNames.includes(uid)) return true;
    }
    for (const label of exclusionLabels) {
      if (await this.classRefMatchesAny(label, undefined, targetClassNames)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Match a class ref — carried as an optional UID-canon form and/or an
   * optional label — against the target's class names.
   *
   * Issue #3562: the UID-canon direct check runs FIRST and needs no external
   * resolver, so a UID-canon condition (`[[82c74542-...]]`) matches a UID-canon
   * target class immediately — even right after `Apply profile`, before the
   * Obsidian `metadataCache` (which backs `classLabelToUid`) has indexed the
   * freshly-mounted class TBox. Previously the only bridge was the label→UID
   * resolver, which lags post-apply and silently skipped conditional
   * inheritance rules (orphaning child areas/tasks) until the next reload.
   *
   * The label-direct and resolver paths remain as fallbacks for legacy
   * label-form data (target authored `[[ems__Area]]`, or a condition that has
   * no UID-canon form). Resolver absence / failure degrades gracefully.
   */
  private async classRefMatchesAny(
    label: string | undefined,
    uid: string | undefined,
    targetClassNames: string[],
  ): Promise<boolean> {
    // 1. UID-canon direct match — resolver-free, fresh immediately post-apply.
    if (uid && targetClassNames.includes(uid)) return true;
    // 2. Label-direct match — target authored in legacy label form.
    if (label && targetClassNames.includes(label)) return true;
    // 3. Fallback: bridge label→UID via the injected resolver (Obsidian
    //    metadataCache in the plugin / fs scan in the CLI). Lags right after
    //    apply, hence steps 1-2 above.
    if (label && this.classLabelToUid) {
      try {
        const resolvedUid = await this.classLabelToUid(label);
        if (
          resolvedUid &&
          resolvedUid.length > 0 &&
          targetClassNames.includes(resolvedUid)
        ) {
          return true;
        }
      } catch {
        // Resolver failures degrade gracefully — direct matches still applied.
      }
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
    createdPaths: readonly string[] = [],
  ): Promise<void> {
    // Restore the click-target source file to its pre-composite content.
    // Skipped when there was nothing on disk to begin with (e.g. service_call-
    // only composites where filePath never existed).
    if (originalContent !== undefined) {
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

    // Issue #3921 — best-effort remove any assets a successful EARLIER
    // create_instance step wrote to disk before a later step failed. Without
    // this the created files are orphaned (partial-composite artifacts). Each
    // delete is fail-soft: a failure is logged and swallowed so it never masks
    // the original step error nor blocks the source-restore above. `createdPaths`
    // only ever holds newly-created instance paths (each a fresh-UID
    // `<folder>/<uid>.md` from executeCreateInstance) — never the click-target
    // `filePath` — so this cannot delete the source asset. Runs regardless of
    // whether `originalContent` was defined, so created files are cleaned up
    // even when the click-target had no on-disk content.
    for (const createdPath of createdPaths) {
      try {
        await this.fileWriter.deleteFile(createdPath);
      } catch (deleteError) {
        LoggingService.error(
          `[GroundingExecutor] Rollback: failed to delete orphaned created asset ${createdPath}`,
          deleteError instanceof Error ? deleteError : new Error(String(deleteError)),
        );
      }
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
   * - $nowCompact → current local timestamp with minute precision in
   *   filename-safe dash-form (YYYY-MM-DD-HH-mm). Powers RFC ce27e55d
   *   one-click labelTemplate use-case
   *   (`$target.exo__Asset_label $nowCompact`).
   * - $todayStart → today at local midnight (YYYY-MM-DDT00:00:00, no TZ) —
   *   matches `DateFormatter.getTodayStartTimestamp()`. A declarative
   *   `property_set` with `$todayStart` is byte-identical to the legacy
   *   `planOnToday` service_call output (removed in Issue #3136). #3811 aligned
   *   the SubstitutionToken `$todayStart` (registry + CommandResolver parse-time)
   *   to this same timezone-naive shape — the former Z-instant form
   *   (`...T00:00:00.000Z`) is gone, so all three `$todayStart` paths agree.
   * - $targetFolder → parent folder (vault-relative) of the $target file.
   *   Resolves to empty string when target is at the vault root. Available
   *   only when callers pass `targetFilePath`; fail-fast otherwise.
   * - $input / $value → userInput.value (RFC-028 Findings 3+4) — powers
   *   "Set Planned Start/End", "Set Scheduled Date", "Set Result" buttons.
   *   Substituted only when userInput.value is defined; callers must gate
   *   missing-input at the executePropertySet layer for fail-loud semantics.
   * - $input.<key> → userInput[<key>] (Issue #3779) — named-input substitution
   *   that lets a vault grounding reference an inputSchema-declared input by
   *   name (e.g. `$input.label`, `$input.parent`) instead of the single
   *   anonymous `$input`/`$value` slot. MUST run before the bare `$input`/
   *   `$value` substitution (more-specific first). A key whose value is
   *   undefined/null is left untouched so executePropertySet's placeholder
   *   gate fails loud rather than persisting a half-substituted literal.
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
    // Feature ec15f83e / req 57b03ab3 — `$today` denotes the instance's nominal
    // DAY, which is the chosen target date (reserved `plannedDate` userInput),
    // defaulting to today's LOCAL calendar day (req 26d79c70 / #3809 — reuse the
    // already-read `date` so the LOCAL getters slice the same instant as the
    // rest of this method). `$now`/`$nowLocal`/`$nowCompact` stay the real clock
    // time (createdAt etc. unaffected).
    const today = this.resolveInstanceDate(userInput, date);
    // `$todayStart` = today's local day at midnight, timezone-naive
    // (YYYY-MM-DDT00:00:00) — matches DateFormatter.getTodayStartTimestamp; now
    // that `today` is the LOCAL day it is local-day-consistent (req 26d79c70).
    const todayStart = `${today}T00:00:00`;
    // RFC ce27e55d $nowCompact: filename-safe minute-precision form derived
    // from nowLocal slices. nowLocal = "YYYY-MM-DDTHH:mm:ss" → indices 0..10
    // = date, 11..13 = hour, 14..16 = minute.
    const nowCompact = `${nowLocal.slice(0, 10)}-${nowLocal.slice(11, 13)}-${nowLocal.slice(14, 16)}`;

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
      // $nowCompact MUST run before $nowLocal/$now (more-specific first) —
      // otherwise the $now prefix would be consumed and leave the "Compact"
      // tail in the output. RFC ce27e55d.
      .replace(/\$nowCompact\b/g, nowCompact)
      .replace(/\$nowLocal/g, nowLocal)
      .replace(/\$now/g, now)
      .replace(/\$todayStart\b/g, todayStart)
      .replace(/\$today/g, today);

    // Input substitution — anonymous `$input`/`$value` → userInput.value;
    // named `$input.<key>` → userInput[<key>] (Issue #3779). Done in a SINGLE
    // regex pass so a resolved value that itself contains a "$input"/"$value"
    // substring is NOT re-scanned and clobbered by a later pass (#3779 review):
    // String.replace advances through the original string and never re-examines
    // inserted replacement text. The alternation tries the named form first so
    // the bare branch never consumes the `$input` prefix of `$input.<key>`. An
    // absent input leaves its placeholder untouched (the executePropertySet
    // template gate then fails loud).
    if (userInput) {
      const ir = userInput as Record<string, unknown>;
      result = result.replace(
        /\$input\.([A-Za-z_]\w*)|\$(?:input|value)\b/g,
        (whole, namedKey?: string) => {
          const v = namedKey !== undefined ? ir[namedKey] : ir.value;
          return v === undefined || v === null ? whole : String(v);
        },
      );
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
   * - `grounding.appendExpression` — value to append, with substituteVariables
   *   resolution (supports `$target.<prop>` dotted-property reads from target
   *   asset frontmatter). RFC 918a2b65 Phase 4 typed predicate (canonical).
   *
   * Behavior:
   * - Empty / missing array → write `[resolvedValue]`.
   * - Existing array without value → append.
   * - Existing array containing value → no-op (idempotent — Set-based dedup).
   *
   * Errors (plain Error with structured message — `GroundingError` class is
   * not yet introduced in the codebase; existing executors also use Error):
   * - Missing `targetProperty` / `appendExpression` on the grounding definition.
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
    // RFC 918a2b65 Phase 4 — typed `appendExpression` only; legacy
    // `targetValue` path removed after vault migration completed.
    if (grounding.appendExpression === undefined) {
      return {
        success: false,
        error: "property_append requires appendExpression",
      };
    }

    const content = await this.fileReader.readFile(filePath);
    const targetFrontmatter =
      this.frontmatterService.parseObject(content) ?? {};

    const resolvedValue = this.substituteVariables(
      grounding.appendExpression,
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
   * RFC 36347daf Phase 2 — workflow_transition dispatcher.
   *
   * Reads target asset frontmatter → resolves asset class + current status →
   * resolves Workflow via injected WorkflowResolver → finds matching
   * WorkflowTransition (from=current, isRollback=direction match) → applies
   * status mutation (frontmatter write) → executes postActions sequentially
   * via injected GroundingLoader.
   *
   * Fails loud when dependencies are absent (test/CLI without store wiring)
   * rather than silently no-op'ing — clearer signal for missing DI plumbing.
   */
  private async executeWorkflowTransition(
    grounding: GroundingDefinition,
    targetIRI: string,
    filePath: string,
    userInput?: UserInput,
  ): Promise<ExecutionResult> {
    if (!this.workflowResolver) {
      return {
        success: false,
        error:
          "workflow_transition requires WorkflowResolver injection (options.workflowResolver). Wire the plugin/CLI before using this grounding type.",
      };
    }

    // 1. Read target frontmatter.
    const content = await this.fileReader.readFile(filePath);
    const fm = this.frontmatterService.parseObject(content) ?? {};

    // 2. Resolve the asset's class references (any class — UID-canon, alias, or
    //    label form; `exo__Instance_class` may be multi-valued). Only a missing
    //    `exo__Instance_class` is a hard stop here; the classes need NOT be
    //    built-in workflow classes — that is decided data-drivenly below.
    const classRefs = this.resolveClassRefsFromFrontmatter(fm);
    if (classRefs.length === 0) {
      return {
        success: false,
        notApplicable: true,
        error:
          "workflow_transition: target asset has no exo__Instance_class — status transitions are not available for it.",
      };
    }

    // 3. Resolve the workflow for this asset's class. Data-driven: a per-asset
    //    `ems__Effort_workflow` override, a per-class `ems__Workflow` ABox, or a
    //    built-in Task/Project/Meeting default — in that order. A `null` return
    //    means the class has NO applicable status workflow (e.g. `ems__Action`'s
    //    own one-shot lifecycle, or any class without a declared workflow). That
    //    is a benign no-op, NOT a crash — generic status buttons that happen to
    //    render on such a class degrade gracefully instead of failing loud.
    let subjectIRI: IRI;
    try {
      subjectIRI = new IRI(targetIRI);
    } catch (error) {
      return {
        success: false,
        error: `workflow_transition: invalid targetIRI "${targetIRI}" — ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const workflow = await this.workflowResolver.resolveForAssetOrNull(
      subjectIRI,
      classRefs,
    );
    if (!workflow) {
      return {
        success: false,
        notApplicable: true,
        error:
          "workflow_transition: this asset's class has no status workflow — status transitions are not available for it.",
      };
    }

    // 4. Resolve current status from ems__Effort_status.
    const currentStatus = this.resolveStatusFromFrontmatter(fm);
    if (!currentStatus) {
      return {
        success: false,
        error:
          "workflow_transition: target asset has no parseable ems__Effort_status value (need wikilink to an ems__EffortStatus* asset).",
      };
    }

    // 5. Find matching transition.
    const direction: "forward" | "rollback" = grounding.direction ?? "forward";
    const isRollback = direction === "rollback";
    const transition = workflow.transitions.find(
      (t) => t.from === currentStatus && t.isRollback === isRollback,
    );
    if (!transition) {
      return {
        success: false,
        error: `workflow_transition: no ${direction} transition from "${currentStatus}" defined in workflow "${workflow.name}" (target class: ${workflow.targetClass}).`,
      };
    }

    // 6. Apply status mutation via existing property_set semantics. Synthesize
    //    a minimal pseudo-grounding so we reuse executePropertySet's wikilink
    //    wrapping + write pipeline. targetValueRef is the destination status
    //    UID (UUID-canon form for vault TBox).
    const toStatusUid = STATUS_UID_BY_ENUM[transition.to as EffortStatus];
    if (!toStatusUid) {
      return {
        success: false,
        error: `workflow_transition: no UID mapping for destination status "${transition.to}" (transition target unreachable).`,
      };
    }
    const statusMutation: GroundingDefinition = {
      id: `${grounding.id}.statusMutation`,
      label: `workflow_transition: ${transition.from} → ${transition.to}`,
      type: GroundingType.PROPERTY_SET,
      targetProperty: "ems__Effort_status",
      targetValueRef: toStatusUid,
    };
    const mutationResult = await this.executePropertySet(
      statusMutation,
      targetIRI,
      filePath,
      userInput,
    );
    if (!mutationResult.success) {
      return {
        success: false,
        error: `workflow_transition: status mutation failed — ${mutationResult.error}`,
      };
    }

    // 7. Execute postActions sequentially. Each action UID is loaded via the
    //    injected GroundingLoader (plugin/CLI wires `commandResolver.loadGroundingByUid`).
    //    Failure mode is INTENTIONALLY WEAKER than executeComposite: this
    //    dispatcher does NOT snapshot the original file content before the
    //    status mutation in step 6, so a postAction failure leaves the asset
    //    in a partially-mutated state (status advanced, but a postAction's
    //    side-effect missing — e.g., Doing→Done with status=Done but no
    //    endTimestamp). Phase 2 accepts this trade-off because (a) postActions
    //    are forgiving timestamp set/delete primitives (idempotent re-run
    //    recovers state), and (b) snapshotting+rollback would require
    //    cross-file coordination since postActions may write to multiple
    //    properties. If stricter atomicity is needed for future grounding
    //    types layered on workflow_transition, add a snapshot/rollback
    //    wrapper analogous to executeComposite's lines 432-469.
    const postActions = transition.postActions ?? [];
    const loader = this.groundingLoader;
    if (postActions.length > 0 && loader === undefined) {
      return {
        success: false,
        error:
          "workflow_transition: transition has postActions but no GroundingLoader injected (options.groundingLoader). Wire commandResolver.loadGroundingByUid in plugin/CLI.",
      };
    }
    for (const actionUid of postActions) {
      if (loader === undefined) break; // unreachable — guarded above
      const action = await loader(actionUid);
      if (!action) {
        return {
          success: false,
          error: `workflow_transition: postAction grounding UID "${actionUid}" could not be loaded (asset missing or invalid Grounding shape).`,
        };
      }
      const actionResult = await this.execute(action, targetIRI, filePath, userInput);
      if (!actionResult.success) {
        return {
          success: false,
          error: `workflow_transition: postAction "${action.label}" (UID ${actionUid}) failed — ${actionResult.error}`,
        };
      }
    }

    return { success: true };
  }

  /**
   * RFC 36347daf Phase 2 (generalised) — extract ALL `exo__Instance_class`
   * references from frontmatter as raw class ref strings for the data-driven
   * {@link WorkflowResolverPort.resolveForAssetOrNull}. Handles string and array
   * shapes and wikilink-form values; returns each inner ref WITHOUT the `[[ ]]`
   * wrapping (`"<uid>"`, `"<uid>|label"`, or `"label"`) — the resolver
   * normalises and maps them. Unlike the previous implementation this is NOT
   * limited to a hardcoded set of classes, and it returns EVERY ref (not just
   * the first) so a multi-valued `exo__Instance_class` still resolves when a
   * workflow-bearing class is not listed first. Empty array when
   * `exo__Instance_class` is absent or carries no usable value.
   */
  private resolveClassRefsFromFrontmatter(
    fm: Record<string, unknown>,
  ): string[] {
    const raw = fm["exo__Instance_class"];
    if (raw === undefined || raw === null) return [];
    const values = Array.isArray(raw) ? raw : [raw];
    const refs: string[] = [];
    for (const v of values) {
      if (typeof v !== "string") continue;
      // Strip wikilink wrapping `"[[...|label]]"` or `"[[label]]"`.
      const inside = v
        .replace(/^\s*"?\[\[/, "")
        .replace(/\]\]"?\s*$/, "")
        .trim();
      if (inside.length > 0) refs.push(inside);
    }
    return refs;
  }

  /**
   * RFC 36347daf Phase 2 — extract current EffortStatus from frontmatter
   * `ems__Effort_status`. Accepts wikilink-form (`"[[<UID>]]"` or
   * `"[[<UID>|ems__EffortStatusDoing]]"` or `"[[ems__EffortStatusDoing]]"`)
   * and resolves to the symbolic EffortStatus enum value (which is what
   * WorkflowTransition.from comparison expects).
   */
  private resolveStatusFromFrontmatter(
    fm: Record<string, unknown>,
  ): string | null {
    let raw = fm["ems__Effort_status"];
    if (raw === undefined || raw === null) return null;
    // ems__Effort_status is cardinality 1 per schema. Tolerate a 1-element
    // array (some YAML pretty-printers may emit list-form) but reject
    // multi-element arrays loudly — a workflow_transition that picked an
    // arbitrary "first" status from a multi-valued frontmatter would silently
    // contradict whichever the UI displays.
    if (Array.isArray(raw)) {
      if (raw.length !== 1) return null;
      raw = raw[0];
    }
    const str = String(raw).trim();
    // Strip wrapping quotes + wikilink brackets.
    const inside = str
      .replace(/^["']/, "")
      .replace(/["']$/, "")
      .replace(/^\[\[/, "")
      .replace(/\]\]$/, "");
    // Symbolic form direct: `ems__EffortStatusDoing`
    if (/^ems__EffortStatus[A-Za-z]+$/.test(inside)) return inside;
    // Alias form `<uid>|ems__EffortStatusDoing`
    if (inside.includes("|")) {
      const alias = inside.split("|")[1].trim();
      if (/^ems__EffortStatus[A-Za-z]+$/.test(alias)) return alias;
    }
    // UID-form: map UID → symbolic.
    const uuidMatch = inside.match(
      /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    );
    if (uuidMatch) {
      const symbolic = STATUS_ENUM_BY_UID[uuidMatch[1].toLowerCase()];
      if (symbolic) return symbolic;
    }
    return null;
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

  /** req 0bb06beb — root prototype class the backlink gate walks toward. */
  private static readonly PROTOTYPE_CLASS_LABEL = "exo__Prototype";

  /**
   * req 0bb06beb — bound on the `exo__Class_superClass` walk. Real chains are
   * shallow (`ems__TaskPrototype` reaches `exo__Prototype` in one hop); the cap
   * plus the visited-set keeps a malformed or cyclic hierarchy from spinning.
   */
  private static readonly MAX_PROTOTYPE_CLASS_WALK_DEPTH = 6;

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
