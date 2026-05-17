import type { CommandResolver, CommandExecutionFlow } from "exocortex";
import type { IVaultSettings } from "exocortex";
import type { ExocortexPluginInterface } from "@plugin/types";
import type { ILogger } from "@plugin/adapters/logging/ILogger";

/**
 * Registers vault-described `exocmd__Command` assets that opt-in via
 * `exocmd__Command_paletteEnabled: true` as global Obsidian Command Palette
 * entries. Wires each command's callback to {@link CommandExecutionFlow.run}
 * with `targetIRI`/`filePath` = null (Palette has no active file) and
 * pre-injects the user's owner-identity wikilink so that `createAsset`-style
 * groundings can write `exo__Asset_isDefinedBy` without parent inheritance.
 *
 * Source: code-RFC `1429fcd0-0948-4a42-89c4-8d1426e9bc7a` (PR-2).
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
  }
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
