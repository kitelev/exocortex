import { App, TFile } from "obsidian";
import { ILogger } from '@plugin/adapters/logging/ILogger';
import { LoggerFactory } from '@plugin/adapters/logging/LoggerFactory';
import {
  ApplicationErrorHandler,
  NetworkError,
  type INotificationService,
} from "exocortex";

export class PropertyUpdateService {
  private logger: ILogger;
  private errorHandler: ApplicationErrorHandler;

  constructor(
    private app: App,
    notifier?: INotificationService,
  ) {
    this.logger = LoggerFactory.create("PropertyUpdateService");
    this.errorHandler = new ApplicationErrorHandler({}, this.logger, notifier);
  }

  async updateProperty(
    file: TFile,
    propertyKey: string,
    newValue: unknown,
  ): Promise<void> {
    this.logger.debug(
      `Updating property "${propertyKey}" in file: ${file.path}`,
    );

    await this.errorHandler.executeWithRetry(
      async () => {
        try {
          await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
            if (
              newValue === null ||
              newValue === undefined ||
              newValue === ""
            ) {
              delete frontmatter[propertyKey];
            } else {
              frontmatter[propertyKey] = newValue;
            }
          });
        } catch (error) {
          throw new NetworkError(
            `Failed to update property "${propertyKey}" in file: ${file.path}`,
            {
              file: file.path,
              propertyKey,
              originalError:
                error instanceof Error ? error.message : String(error),
            },
          );
        }
      },
      {
        file: file.path,
        propertyKey,
      },
    );

    this.logger.debug(
      `Successfully updated property "${propertyKey}" in file: ${file.path}`,
    );
  }

  async updateTextProperty(
    file: TFile,
    propertyKey: string,
    newValue: string,
  ): Promise<void> {
    const trimmedValue = newValue.trim();
    await this.updateProperty(file, propertyKey, trimmedValue || null);
  }

  async updateDateTimeProperty(
    file: TFile,
    propertyKey: string,
    newValue: string | null,
  ): Promise<void> {
    await this.updateProperty(file, propertyKey, newValue);
  }

  async updateNumberProperty(
    file: TFile,
    propertyKey: string,
    newValue: number | null,
  ): Promise<void> {
    await this.updateProperty(file, propertyKey, newValue);
  }

  async updateBooleanProperty(
    file: TFile,
    propertyKey: string,
    newValue: boolean,
  ): Promise<void> {
    await this.updateProperty(file, propertyKey, newValue);
  }
}
