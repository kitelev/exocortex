import { TFile, MetadataCache, App } from "obsidian";
import {
  ApplicationErrorHandler,
  NetworkError,
  type ILogger,
  type INotificationService,
} from "exocortex";

export class AliasSyncService {
  private errorHandler: ApplicationErrorHandler;

  constructor(
    private metadataCache: MetadataCache,
    private app: App,
    logger?: ILogger,
    notifier?: INotificationService,
  ) {
    this.errorHandler = new ApplicationErrorHandler({}, logger, notifier);
  }

  async syncAliases(
    file: TFile,
    oldLabel: string | null,
    newLabel: string,
  ): Promise<void> {
    const fileCache = this.metadataCache.getFileCache(file);
    const frontmatter = fileCache?.frontmatter;

    if (!frontmatter) {
      return;
    }

    const currentAliases = this.parseAliases(frontmatter.aliases);

    const updatedAliases = this.calculateUpdatedAliases(
      currentAliases,
      oldLabel,
      newLabel,
    );

    if (
      JSON.stringify(currentAliases) === JSON.stringify(updatedAliases)
    ) {
      return;
    }

    await this.updateAliasesInFile(file, updatedAliases);
  }

  private parseAliases(aliases: unknown): string[] {
    if (Array.isArray(aliases)) {
      return aliases.filter((a): a is string => typeof a === "string");
    }
    if (typeof aliases === "string") {
      return [aliases];
    }
    return [];
  }

  private calculateUpdatedAliases(
    currentAliases: string[],
    oldLabel: string | null,
    newLabel: string,
  ): string[] {
    if (!oldLabel) {
      return currentAliases;
    }

    const indexOfOldLabel = currentAliases.indexOf(oldLabel);

    if (indexOfOldLabel === -1) {
      return currentAliases;
    }

    const updated = [...currentAliases];
    updated[indexOfOldLabel] = newLabel;
    return updated;
  }

  private async updateAliasesInFile(
    file: TFile,
    newAliases: string[],
  ): Promise<void> {
    await this.errorHandler.executeWithRetry(
      async () => {
        try {
          await this.app.fileManager.processFrontMatter(
            file,
            (frontmatter) => {
              if (newAliases.length === 0) {
                delete frontmatter.aliases;
              } else if (newAliases.length === 1) {
                frontmatter.aliases = newAliases[0];
              } else {
                frontmatter.aliases = newAliases;
              }
            },
          );
        } catch (error) {
          throw new NetworkError(
            `Failed to update aliases in file: ${file.path}`,
            {
              file: file.path,
              newAliases,
              originalError:
                error instanceof Error ? error.message : String(error),
            },
          );
        }
      },
      {
        file: file.path,
        aliasCount: newAliases.length,
      },
    );
  }
}
