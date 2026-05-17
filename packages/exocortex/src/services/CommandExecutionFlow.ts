import { injectable } from "tsyringe";
import type { GroundingExecutor, UserInput } from "./GroundingExecutor";
import type { ResolvedCommand } from "./CommandResolver";
import type { INotificationService } from "../interfaces/INotificationService";
import type { ILogger } from "../interfaces/ILogger";
import type { GroundingDefinition } from "../domain/models/CommandDefinition";
import { GroundingType } from "../domain/constants/GroundingType";
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
      const effectiveSchema = CommandExecutionFlow.applyLabelDatePrefill(
        inputSchema,
        command.grounding,
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
      this.logger.info(
        `[CommandExecutionFlow] Executed "${command.name}" on ${displayPath}`,
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
   *   - the resolver populated `prototypeLabel`,
   *   - the schema has a field named `label` without an existing defaultValue.
   *
   * The current date is computed here (not in the resolver) so it stays fresh
   * regardless of grounding caching. Defaults already supplied by the schema
   * author win — user-explicit configuration takes precedence over the prefill.
   *
   * Date formatter matches the legacy `CreateInstanceCommand.showModal()` —
   * `DateFormatter.toDateString` uses local-tz calendar parts so the prefill
   * stays "today" in the user's timezone (Almaty UTC+5, etc.) even between
   * 00:00–04:59 local when UTC would still report yesterday.
   */
  static applyLabelDatePrefill(
    schema: ReadonlyArray<unknown>,
    grounding: GroundingDefinition,
  ): ReadonlyArray<unknown> {
    if (grounding.type !== GroundingType.CREATE_INSTANCE) return schema;
    if (!grounding.prefillLabelWithDate) return schema;
    if (!grounding.prototypeLabel) return schema;

    const today = DateFormatter.toDateString(new Date());
    const prefill = `${grounding.prototypeLabel} ${today}`;

    return schema.map((field) => {
      if (typeof field !== "object" || field === null) return field;
      const f = field as Record<string, unknown>;
      if (f.name !== "label") return field;
      const existing = f.defaultValue;
      if (typeof existing === "string" && existing.length > 0) return field;
      return { ...f, defaultValue: prefill };
    });
  }
}
