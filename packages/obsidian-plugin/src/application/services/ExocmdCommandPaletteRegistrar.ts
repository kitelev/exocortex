import type { App } from "obsidian";
import type {
  CommandResolver,
  CommandExecutionFlow,
  CommandDefinition,
  PreconditionEvaluator,
  EvalContext,
} from "@kitelev/exocortex-core";
import type { IVaultSettings } from "@kitelev/exocortex-core";
import type { ExocortexPluginInterface } from "@plugin/types";
import type { ILogger } from "@plugin/adapters/logging/ILogger";

/**
 * Registers vault-described `exocmd__Command` assets that opt-in via
 * `exocmd__Command_paletteEnabled: true` as global Obsidian Command Palette
 * entries.
 *
 * Two execution shapes are supported:
 *
 * 1. **No-target palette commands** (the original RFC 1429fcd0 PR-2 shape):
 *    commands with no `precondition` and groundings whose semantics do not
 *    require an active file (e.g. `createAsset` writing to a literal default
 *    folder). Wired as `addCommand({ callback })` — always visible.
 *
 * 2. **Active-target palette commands** (Issue #3292): commands with a
 *    host-function `precondition` (e.g. `hasUidFilename`). Wired as
 *    `addCommand({ checkCallback })`; visibility is gated by synchronously
 *    evaluating the host function against the active file's metadata, and
 *    the active file's `obsidian://vault/<encoded-path>` IRI is forwarded as
 *    `targetIRI` at execution time so service-call groundings (e.g.
 *    `duplicateAsset`) can resolve the source file.
 *
 *    SPARQL ASK and `exoql__Query` preconditions are intentionally NOT
 *    supported on the palette code path — Obsidian's `checkCallback` is
 *    synchronous, and pre-caching SPARQL evaluations across active-leaf
 *    changes would be invisible scope growth beyond this issue. A precondition
 *    asset with `sparqlAsk` / `query` but no `hostFunction` causes the command
 *    to be skipped at registration with a warning, so misconfiguration fails
 *    loudly instead of silently surfacing an always-visible button.
 *
 * Source: code-RFC `1429fcd0-0948-4a42-89c4-8d1426e9bc7a` (PR-2) +
 *         Issue #3292 (precondition + active-target extension).
 *
 * Known limitation: Obsidian's public API does NOT expose `removeCommand`,
 * so newly-added (or removed) `paletteEnabled` assets only surface after a
 * plugin reload (Ctrl-Shift-R). `init()` is therefore safe to call exactly
 * once per plugin load.
 */
export class ExocmdCommandPaletteRegistrar {
  constructor(
    private readonly plugin: ExocortexPluginInterface,
    private readonly commandResolver: CommandResolver,
    private readonly commandExecutionFlow: CommandExecutionFlow,
    private readonly vaultSettings: IVaultSettings,
    private readonly logger: ILogger,
    private readonly app?: App,
    private readonly preconditionEvaluator?: PreconditionEvaluator,
  ) {}

  async init(): Promise<void> {
    let entries: Awaited<
      ReturnType<CommandResolver["findPaletteEnabledCommands"]>
    >;
    try {
      entries = await this.commandResolver.findPaletteEnabledCommands();
    } catch (error) {
      this.logger.error(
        "[ExocmdCommandPaletteRegistrar] Failed to resolve palette-enabled commands",
        error instanceof Error ? error : new Error(String(error)),
      );
      return;
    }

    for (const { command, paletteId } of entries) {
      // Capture owner identity at registration time — re-reading on every
      // click would be an unexpected coupling. Plugin reload reflects setting
      // changes (same window as command list refresh, see "Known limitation"
      // above).
      const ownerIdentity = this.vaultSettings.getOwnerIdentity();

      if (this.isActiveTargetCommand(command)) {
        this.registerActiveTargetCommand(
          command,
          paletteId,
          ownerIdentity,
        );
      } else {
        this.registerNoTargetCommand(command, paletteId, ownerIdentity);
      }
    }
  }

  /**
   * Active-target commands have a precondition with a `hostFunction` — they
   * operate on the currently open file and use the precondition to gate
   * Command Palette visibility against it. Falls back to no-target shape
   * (with a warning) if `app` or `preconditionEvaluator` were not injected
   * — preserves backward compatibility with any caller that still uses the
   * 5-argument constructor.
   */
  private isActiveTargetCommand(command: CommandDefinition): boolean {
    const pre = command.precondition;
    if (!pre) return false;

    // SPARQL-only preconditions cannot be evaluated synchronously — skip.
    // Logged at registration so misconfiguration is visible.
    if (!pre.hostFunction) {
      this.logger.warn(
        `[ExocmdCommandPaletteRegistrar] paletteEnabled command "${command.name}" has a non-host-function precondition (sparqlAsk/exoql query) — palette path supports host-function preconditions only; command skipped`,
      );
      return false;
    }

    if (!this.app || !this.preconditionEvaluator) {
      this.logger.warn(
        `[ExocmdCommandPaletteRegistrar] paletteEnabled command "${command.name}" has a host-function precondition but registrar was constructed without app/preconditionEvaluator dependencies — falling back to always-visible no-target registration`,
      );
      return false;
    }

    return true;
  }

  private registerNoTargetCommand(
    command: CommandDefinition,
    paletteId: string,
    ownerIdentity: string | null,
  ): void {
    this.plugin.addCommand({
      id: paletteId,
      name: command.name,
      callback: () => {
        void this.commandExecutionFlow.run(
          { command, binding: SYNTHETIC_PALETTE_BINDING },
          {
            targetIRI: null,
            filePath: null,
            injectedUserInput: { ownerIdentity },
          },
        );
      },
    });

    this.logger.info(
      `[ExocmdCommandPaletteRegistrar] Registered "${command.name}" as palette command "${paletteId}"`,
    );
  }

  private registerActiveTargetCommand(
    command: CommandDefinition,
    paletteId: string,
    ownerIdentity: string | null,
  ): void {
    // `isActiveTargetCommand` already enforced all three of these to be
    // present — narrow once here so the closure body stays clean.
    const { app, preconditionEvaluator: evaluator } = this;
    const hostFunctionName = command.precondition?.hostFunction;
    if (!app || !evaluator || !hostFunctionName) {
      // Defensive — should never fire given `isActiveTargetCommand` returned
      // true. Keeps the type narrowing local without `!` assertions.
      this.logger.warn(
        `[ExocmdCommandPaletteRegistrar] Unexpected: active-target registration called without complete deps for "${command.name}"`,
      );
      this.registerNoTargetCommand(command, paletteId, ownerIdentity);
      return;
    }

    this.plugin.addCommand({
      id: paletteId,
      name: command.name,
      checkCallback: (checking: boolean): boolean => {
        const ctx = readActiveFileContext(app);
        if (ctx === null) return false;

        // Synchronously evaluate the host-function precondition.
        // `evaluateHostFunctionSync` returns null only when the host
        // function is not registered — treat as fail-closed.
        const visible = evaluator.evaluateHostFunctionSync(
          hostFunctionName,
          ctx.targetIRI,
          ctx.evalContext,
        );
        if (visible !== true) return false;

        if (!checking) {
          void this.commandExecutionFlow.run(
            { command, binding: SYNTHETIC_PALETTE_BINDING },
            {
              targetIRI: ctx.targetIRI,
              filePath: ctx.filePath,
              injectedUserInput: { ownerIdentity },
            },
          );
        }
        return true;
      },
    });

    this.logger.info(
      `[ExocmdCommandPaletteRegistrar] Registered active-target palette command "${command.name}" (id=${paletteId}, precondition=${hostFunctionName})`,
    );
  }
}

/**
 * Extracts the precondition `EvalContext` + targetIRI/filePath payload from
 * the currently active markdown file. Returns `null` when there is no
 * active file — the precondition is treated as "fail closed" upstream, so
 * the command stays hidden.
 *
 * The shape mirrors `DynamicCommandButtonGroupBuilder` (`evalContext` with
 * `targetIRI`, `fileBasename`, `currentFolder`, `assetUid`) so existing
 * host functions (e.g. `hasNonUidFilename` / `hasUidFilename`) work on the
 * palette code path without modification.
 */
function readActiveFileContext(app: App): {
  targetIRI: string;
  filePath: string;
  evalContext: EvalContext;
} | null {
  const file = app.workspace.getActiveFile();
  if (!file) return null;

  const targetIRI = `obsidian://vault/${encodeURI(file.path)}`;
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  const rawUid = frontmatter?.exo__Asset_uid;
  const assetUid = typeof rawUid === "string" ? rawUid : undefined;

  return {
    targetIRI,
    filePath: file.path,
    evalContext: {
      targetIRI,
      fileBasename: file.basename,
      currentFolder: file.parent?.path,
      filePath: file.path,
      assetUid,
    },
  };
}

/**
 * Placeholder `CommandBindingDefinition` for palette-surface commands which,
 * unlike inline-button commands, have no `CommandBinding` asset. The flow
 * does not read `rc.binding` for the palette code path; the field is present
 * only to satisfy the `ResolvedCommand` shape.
 */
const SYNTHETIC_PALETTE_BINDING = {
  id: "synthetic:palette",
  label: "synthetic:palette",
  commandRef: "synthetic:palette",
  targetClass: "synthetic:palette",
} as const;
