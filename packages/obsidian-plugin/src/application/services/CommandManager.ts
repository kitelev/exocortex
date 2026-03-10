import { App, TFile } from "obsidian";
import { ExocortexPluginInterface } from '@plugin/types';
import { CommandRegistry } from '@plugin/application/commands/CommandRegistry';
import { MetadataExtractor } from "exocortex";
import { ObsidianVaultAdapter } from '@plugin/adapters/ObsidianVaultAdapter';
import { CommandVisibilityContext, WikiLinkHelpers } from "exocortex";

export class CommandManager {
  private commandRegistry: CommandRegistry | null = null;
  private metadataExtractor: MetadataExtractor;
  private vaultAdapter: ObsidianVaultAdapter;

  constructor(private app: App) {
    this.vaultAdapter = new ObsidianVaultAdapter(
      app.vault,
      app.metadataCache,
      app,
    );
    this.metadataExtractor = new MetadataExtractor(this.vaultAdapter);
    // CommandRegistry is lazily initialized in registerAllCommands()
    // to avoid needing a placeholder plugin instance
  }

  registerAllCommands(
    plugin: ExocortexPluginInterface,
    reloadLayoutCallback?: () => void,
  ): void {
    this.commandRegistry = new CommandRegistry(this.app, plugin, reloadLayoutCallback);

    const commands = this.commandRegistry.getAllCommands();

    for (const command of commands) {
      if (command.checkCallback) {
        plugin.addCommand({
          id: command.id,
          name: command.name,
          checkCallback: (checking: boolean) => {
            const file = this.app.workspace.getActiveFile();
            if (!file) return false;

            const context = this.getContext(file);
            if (!command.checkCallback) return false;
            return command.checkCallback(checking, file, context);
          },
        });
      } else if (command.callback) {
        plugin.addCommand({
          id: command.id,
          name: command.name,
          callback: command.callback,
        });
      }
    }
  }

  private getContext(file: TFile): CommandVisibilityContext | null {
    const context = this.metadataExtractor.extractCommandVisibilityContext(file);

    return {
      ...context,
      expectedFolder: null,
      classIsPrototype: this.resolveClassIsPrototype(context.instanceClass),
    };
  }

  /**
   * Check if any of the asset's instance classes is a prototype (Issue #2261).
   * Resolves UUID-based class references by looking up the class file's metadata.
   */
  private resolveClassIsPrototype(instanceClass: string | string[] | null): boolean {
    if (!instanceClass) return false;
    if (!this.app.metadataCache?.getFirstLinkpathDest) return false;

    const classes = Array.isArray(instanceClass) ? instanceClass : [instanceClass];

    for (const cls of classes) {
      const normalized = WikiLinkHelpers.normalize(cls);
      if (!normalized) continue;

      const classFile = this.app.metadataCache.getFirstLinkpathDest(normalized, "");
      if (!classFile) continue;

      const classCache = this.app.metadataCache.getFileCache(classFile);
      const classMeta = classCache?.frontmatter;
      if (!classMeta) continue;

      const classInstanceClass = classMeta.exo__Instance_class;
      if (!classInstanceClass) continue;

      const classClasses = Array.isArray(classInstanceClass) ? classInstanceClass : [classInstanceClass];
      for (const cc of classClasses) {
        const normalizedCC = WikiLinkHelpers.normalize(cc);
        if (normalizedCC === "exo__Prototype" || normalizedCC === "ebf717aa-4070-4b37-abde-10a700e354fc") {
          return true;
        }
      }
    }

    return false;
  }
}
