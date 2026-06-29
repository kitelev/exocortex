import { injectable } from "tsyringe";
import type { GroundingExecutor, UserInput } from "./GroundingExecutor";
import type { ResolvedCommand } from "./CommandResolver";
import type { INotificationService } from "../interfaces/INotificationService";
import type { ILogger } from "../interfaces/ILogger";
import type { ITripleStore } from "../interfaces/ITripleStore";
import type { GroundingDefinition } from "../domain/models/CommandDefinition";
import { GroundingType } from "../domain/constants/GroundingType";
import type { RequiredPropertyResolver } from "./RequiredPropertyResolver";
import { IRI } from "../domain/models/rdf/IRI";
import { Literal } from "../domain/models/rdf/Literal";
import { Namespace } from "../domain/models/rdf/Namespace";
import { DateFormatter } from "../utilities/DateFormatter";

/**
 * Surface-agnostic execution context for a resolved exocmd command.
 *
 * - `targetIRI` / `filePath` describe the asset the command runs against.
 *   They may be `null` for global surfaces (e.g. Obsidian Command Palette
 *   without an active file) — groundings that depend on `$target`
 *   substitution will fail loudly in that case, by design.
 * - `injectedUserInput` lets the caller pre-supply `UserInput` keys (e.g.
 *   owner identity, default folder) before the modal opens. Modal-collected
 *   values override these defaults on key collision.
 * - `onComplete` runs after successful execution. Layout buttons pass their
 *   `refresh` callback; Palette callers pass nothing.
 */
export interface CommandExecutionContext {
  readonly targetIRI: string | null;
  readonly filePath: string | null;
  readonly injectedUserInput?: UserInput;
  readonly onComplete?: () => Promise<void>;
}

/**
 * Platform-specific prompt adapter. Lets {@link CommandExecutionFlow}
 * orchestrate confirm + form prompts without coupling to Obsidian APIs,
 * `window`, or any specific modal renderer.
 *
 * `promptInputSchema` returns `null` if the user cancelled the form.
 * Field shape is intentionally `unknown[]` — schemas are validated by
 * {@link CommandResolver} when parsing `Grounding_inputSchema` JSON, and
 * each adapter is free to type its own field descriptors.
 */
export interface CommandPromptAdapter {
  confirm(message: string): Promise<boolean>;
  promptInputSchema(
    fields: ReadonlyArray<unknown>,
  ): Promise<UserInput | null>;
}

/**
 * Surface-agnostic file-opening hook (Issue #3184 B5). When
 * {@link GroundingExecutor.executeCreateInstance} writes a new asset it
 * returns the vault-relative path via {@link ExecutionResult.openPath};
 * {@link CommandExecutionFlow} forwards that path here so the platform
 * adapter (Obsidian plugin / future CLI) can decide where the file appears.
 *
 * RFC ce27e55d: `opts.sameTab` (when true) requests navigation in the
 * current active leaf (Obsidian `getLeaf(false)`) instead of opening a new
 * tab (`getLeaf("tab")`) — implements `exocmd__Command_openInSameTab`
 * semantics. Adapters that have no notion of tabs (CLI, headless) ignore
 * the second argument.
 *
 * Tests and headless runners may omit the dependency: when undefined the
 * core run pipeline is unchanged (creation succeeds without auto-opening).
 */
export interface IFileOpener {
  open(path: string, opts?: { readonly sameTab?: boolean }): Promise<void>;
}

/**
 * Domain-agnostic execution pipeline for a resolved exocmd command.
 *
 * Pipeline:
 *   1. If `command.confirmMessage` is set → prompt confirm; bail on cancel.
 *   2. If grounding declares `inputSchema` → open form prompt; bail on cancel.
 *      Modal-collected `UserInput` is shallow-merged on top of any
 *      `injectedUserInput` from the call-site.
 *   3. Delegate to `groundingExecutor.execute(...)` with target IRI / file.
 *   4. On success → fire `successMessage` toast (if any) + `onComplete()`.
 *      On failure → fire error toast.
 *
 * Used by both inline layout buttons (via `DynamicCommandButtonGroupBuilder`)
 * and global Obsidian Command Palette entries (via the future
 * `ExocmdCommandPaletteRegistrar`).
 *
 * Source: code-RFC `1429fcd0-0948-4a42-89c4-8d1426e9bc7a` (PR-1).
 */
@injectable()
export class CommandExecutionFlow {
  constructor(
    private readonly groundingExecutor: GroundingExecutor,
    private readonly notificationService: INotificationService,
    private readonly logger: ILogger,
    private readonly prompts: CommandPromptAdapter,
    private readonly tripleStore?: ITripleStore,
    private readonly fileOpener?: IFileOpener,
    // T3 «Create Instance» (project bbe40f8c) — resolves a host class's SHACL
    // required (`minCount > 0`) properties so the create-instance form prompts
    // for them. Optional: absent → no augmentation (back-compat).
    private readonly requiredPropertyResolver?: RequiredPropertyResolver,
  ) {}

  async run(
    rc: ResolvedCommand,
    ctx: CommandExecutionContext,
  ): Promise<void> {
    const { command } = rc;

    if (command.confirmMessage) {
      const confirmed = await this.prompts.confirm(command.confirmMessage);
      if (!confirmed) return;
    }

    let userInput: UserInput | undefined = ctx.injectedUserInput;
    const inputSchema = CommandExecutionFlow.extractInputSchema(rc);
    if (inputSchema !== null && inputSchema.length > 0) {
      let effectiveSchema = await this.applyLabelDatePrefill(
        inputSchema,
        command.grounding,
        ctx.targetIRI,
      );
      effectiveSchema = await this.applyRequiredPropertyFields(
        effectiveSchema,
        command.grounding,
        ctx,
      );
      const collected = await this.prompts.promptInputSchema(effectiveSchema);
      if (collected === null) return;
      userInput = { ...(ctx.injectedUserInput ?? {}), ...collected };
    }

    const result = await this.groundingExecutor.execute(
      command.grounding,
      ctx.targetIRI ?? "",
      ctx.filePath ?? "",
      userInput,
    );

    const displayPath = ctx.filePath ?? "<no-file>";

    if (result.success) {
      if (command.successMessage) {
        this.notificationService.success(command.successMessage);
      }
      // Match legacy delay so downstream metadata-cache invalidation
      // settles before the layout re-renders. Cf. RFC f1dc284a refresh ordering.
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (ctx.onComplete) {
        await ctx.onComplete();
      }
      // Issue #3184 B5: open the newly created file when create_instance
      // reports a path. Best-effort — failure to open is logged but does
      // not flip the run result (the file was created; the UI may simply
      // remain on the source asset).
      if (result.openPath && this.fileOpener) {
        try {
          // RFC ce27e55d: forward `openInSameTab` to the platform adapter.
          // Obsidian opener branches on the flag; CLI/headless ignores it.
          await this.fileOpener.open(result.openPath, {
            sameTab: command.openInSameTab,
          });
        } catch (error) {
          this.logger.info(
            `[CommandExecutionFlow] Failed to open created file "${result.openPath}": ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      this.logger.info(
        `[CommandExecutionFlow] Executed "${command.name}" on ${displayPath}`,
      );
    } else if (result.notApplicable) {
      // Benign "not applicable" outcome (e.g. a generic status-transition button
      // rendered on a class with no status workflow). Surface as an
      // informational notice — NOT a "Command failed" error — so the user sees a
      // clear, non-alarming message instead of a crash. See ExecutionResult.
      this.notificationService.info(
        result.error ?? "This command is not available for this asset.",
      );
      this.logger.info(
        `[CommandExecutionFlow] Not applicable "${command.name}": ${result.error}`,
      );
    } else {
      this.notificationService.error(
        `Command failed: ${result.error ?? "unknown error"}`,
      );
      this.logger.info(
        `[CommandExecutionFlow] Failed "${command.name}": ${result.error}`,
      );
    }
  }

  /**
   * Read the optional `inputSchema` field that {@link CommandResolver}
   * attaches to grounding definitions when parsing
   * `exocmd__Grounding_inputSchema` JSON.
   */
  private static extractInputSchema(
    rc: ResolvedCommand,
  ): ReadonlyArray<unknown> | null {
    const grounding = rc.command.grounding;
    const raw = (grounding as unknown as Record<string, unknown>)[
      "inputSchema"
    ];
    if (!raw || !Array.isArray(raw)) return null;
    return raw;
  }

  /**
   * Opt-in pre-fill of the `label` modal field for `create_instance` groundings
   * — restores the v15.38 behaviour stripped by PR #2733. Active only when:
   *   - grounding type is `create_instance`,
   *   - `prefillLabelWithDate` is true on the grounding (RDF opt-in),
   *   - a `targetIRI` is available (the asset the user clicked the button on),
   *   - that asset has a non-empty `exo__Asset_label`,
   *   - the schema has a field named `label` without an existing defaultValue.
   *
   * The label source is the CURRENT asset (where the user clicked), not the
   * grounding's `targetPrototype` — that matches the legacy v15.38
   * `CreateInstanceCommand.showModal()` which builds `defaultLabel` from
   * `metadata.exo__Asset_label || file.basename` of the active file.
   *
   * Runtime lookup (not resolver-time) keeps both the source label and the
   * date portion fresh regardless of grounding caching. Defaults already
   * supplied by the schema author win — user-explicit configuration takes
   * precedence over the prefill.
   *
   * Date formatter matches the legacy `CreateInstanceCommand.showModal()` —
   * `DateFormatter.toDateString` uses local-tz calendar parts so the prefill
   * stays "today" in the user's timezone (Almaty UTC+5, etc.) even between
   * 00:00–04:59 local when UTC would still report yesterday.
   *
   * Graceful fallback: missing `tripleStore`, missing `targetIRI`, asset not
   * found, or empty label → returns the schema unchanged (no-op).
   */
  async applyLabelDatePrefill(
    schema: ReadonlyArray<unknown>,
    grounding: GroundingDefinition,
    targetIRI: string | null,
  ): Promise<ReadonlyArray<unknown>> {
    if (grounding.type !== GroundingType.CREATE_INSTANCE) return schema;
    if (!grounding.prefillLabelWithDate) return schema;
    if (!targetIRI) return schema;
    if (!this.tripleStore) return schema;

    const label = await this.resolveAssetLabel(targetIRI);
    if (!label) return schema;

    const today = DateFormatter.toDateString(new Date());
    const prefill = `${label} ${today}`;

    return schema.map((field) => {
      if (typeof field !== "object" || field === null) return field;
      const f = field as Record<string, unknown>;
      if (f.name !== "label") return field;
      const existing = f.defaultValue;
      if (typeof existing === "string" && existing.length > 0) return field;
      return { ...f, defaultValue: prefill };
    });
  }

  /**
   * T3 «Create Instance» (project bbe40f8c) — append the host class's SHACL
   * required (`exo__Property_minCount > 0`) properties as form fields, so the
   * create-instance form prompts for them and the new asset is SHACL-valid.
   *
   * Active ONLY for the host-as-class «Create Instance» flagship — a
   * `create_instance` grounding with **no** `targetClass` (verified the only
   * such grounding; every other create command bakes a `targetClass`). The new
   * instance's class IS the host class (`$targetClassSelf`), so its required
   * properties come from the host class def. No-op (schema unchanged) when:
   *   - the grounding isn't that flagship,
   *   - no resolver is wired (CLI/test harness without a vault store),
   *   - no `filePath` (global palette surface with no active file),
   *   - the resolver throws, or the class has no required properties (common).
   *
   * Fields already covered — by the static schema (e.g. `label`,
   * `exo__Asset_isDefinedBy`) or by the Universal Default Template
   * ({@link ALWAYS_COVERED}: uid/createdAt/updatedAt/label/createdBy/
   * instance_class/isDefinedBy) — are skipped, so the form never double-asks.
   */
  async applyRequiredPropertyFields(
    schema: ReadonlyArray<unknown>,
    grounding: GroundingDefinition,
    ctx: CommandExecutionContext,
  ): Promise<ReadonlyArray<unknown>> {
    if (grounding.type !== GroundingType.CREATE_INSTANCE) return schema;
    if (grounding.targetClass) return schema;
    if (!this.requiredPropertyResolver) return schema;
    if (!ctx.filePath) return schema;

    const hostClassUid = CommandExecutionFlow.basenameUid(ctx.filePath);
    if (!hostClassUid) return schema;

    let required;
    try {
      required = await this.requiredPropertyResolver(hostClassUid);
    } catch (error) {
      this.logger.info(
        `[CommandExecutionFlow] required-property resolution failed for "${hostClassUid}": ${error instanceof Error ? error.message : String(error)}`,
      );
      return schema;
    }
    if (required.length === 0) return schema;

    const covered = new Set<string>(CommandExecutionFlow.ALWAYS_COVERED);
    for (const field of schema) {
      if (
        field &&
        typeof field === "object" &&
        typeof (field as Record<string, unknown>).name === "string"
      ) {
        covered.add((field as Record<string, unknown>).name as string);
      }
    }

    const additions = required
      .filter((f) => !covered.has(f.propertyKey))
      .map((f) => {
        const field: Record<string, unknown> = {
          name: f.propertyKey,
          type: f.fieldType,
          label: f.label,
          required: true,
        };
        if (f.targetClassUid) field.targetClassUid = f.targetClassUid;
        // A boolean is always "filled" — default to false so it submits valid.
        if (f.fieldType === "boolean") field.defaultValue = "false";
        return field;
      });

    if (additions.length === 0) return schema;
    return [...schema, ...additions];
  }

  /** Frontmatter keys always supplied by the Universal Default Template. */
  private static readonly ALWAYS_COVERED: ReadonlyArray<string> = [
    "exo__Asset_uid",
    "exo__Asset_createdAt",
    "exo__Asset_updatedAt",
    "exo__Asset_label",
    "exo__Asset_createdBy",
    "exo__Instance_class",
    "exo__Asset_isDefinedBy",
  ];

  /** Vault-relative file path → its basename UID (UID-canon), or null. */
  private static basenameUid(filePath: string): string | null {
    const base = filePath
      .replace(/^\/+/, "")
      .split("/")
      .pop()
      ?.replace(/\.md$/i, "");
    if (!base) return null;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      base,
    )
      ? base.toLowerCase()
      : null;
  }

  /**
   * Read `exo__Asset_label` literal of the asset identified by `targetIRI`.
   * Returns `undefined` when the triple is missing or non-literal — callers
   * must handle the absence gracefully.
   */
  private async resolveAssetLabel(
    targetIRI: string,
  ): Promise<string | undefined> {
    if (!this.tripleStore) return undefined;
    const subject = new IRI(targetIRI);
    const triples = await this.tripleStore.match(
      subject,
      Namespace.EXO.term("Asset_label"),
      undefined,
    );
    if (triples.length === 0) return undefined;
    const obj = triples[0].object;
    if (obj instanceof Literal) {
      return obj.value.length > 0 ? obj.value : undefined;
    }
    return undefined;
  }
}
