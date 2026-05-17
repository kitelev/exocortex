import type { GroundingExecutor, UserInput } from "./GroundingExecutor";
import type { ResolvedCommand } from "./CommandResolver";
import type { INotificationService } from "../interfaces/INotificationService";
import type { ILogger } from "../interfaces/ILogger";

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
      const collected = await this.prompts.promptInputSchema(inputSchema);
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
}
