import { TFile } from "obsidian";
import { ActionButton } from '@plugin/presentation/components/ActionButtonsGroup';
import {
  canTrashEffort,
  canArchiveTask,
  canCleanProperties,
  canRepairFolder,
  canRenameToUid,
  canCopyLabelToAliases,
  canConvertTaskToProject,
  canConvertProjectToTask,
  CommandVisibilityContext,
} from "exocortex";
import { ILogger } from '@plugin/adapters/logging/ILogger';
import { MetadataRecord } from '@plugin/types';
import {
  IButtonGroupBuilder,
  ButtonBuilderContext,
  ButtonBuilderServices,
} from "./ButtonBuilderTypes";

/**
 * Builds maintenance-related buttons (Trash, Archive, Clean Properties, etc.)
 */
export class MaintenanceButtonGroupBuilder implements IButtonGroupBuilder {
  constructor(private services: ButtonBuilderServices) {}

  getGroupId(): string {
    return "maintenance";
  }

  getGroupTitle(): string {
    return "Maintenance";
  }

  build(context: ButtonBuilderContext): ActionButton[] {
    const { file, metadata, visibilityContext, logger, refresh } = context;
    const expectedFolder = visibilityContext.expectedFolder;
    const currentFolder = visibilityContext.currentFolder;

    return [
      this.trashButton(file, visibilityContext, logger, refresh),
      this.archiveButton(file, visibilityContext, logger, refresh),
      this.cleanPropertiesButton(file, visibilityContext, logger, refresh),
      this.repairFolderButton(file, visibilityContext, expectedFolder, currentFolder, logger, refresh),
      this.renameToUidButton(file, metadata, visibilityContext, logger, refresh),
      this.copyLabelToAliasesButton(file, visibilityContext, logger, refresh),
      this.convertTaskToProjectButton(file, visibilityContext, logger, refresh),
      this.convertProjectToTaskButton(file, visibilityContext, logger, refresh),
    ];
  }

  private trashButton(
    file: TFile,
    context: CommandVisibilityContext,
    logger: ILogger,
    refresh: () => Promise<void>,
  ): ActionButton {
    return {
      id: "trash",
      label: "Trash",
      variant: "danger",
      visible: canTrashEffort(context),
      onClick: async () => {
        await this.services.taskStatusService.trashEffort(file);
        await new Promise((resolve) => setTimeout(resolve, 100));
        await refresh();
        logger.info(`Trashed effort: ${file.path}`);
      },
    };
  }

  private archiveButton(
    file: TFile,
    context: CommandVisibilityContext,
    logger: ILogger,
    refresh: () => Promise<void>,
  ): ActionButton {
    return {
      id: "archive",
      label: "Archive",
      variant: "danger",
      visible: canArchiveTask(context),
      onClick: async () => {
        await this.services.taskStatusService.archiveTask(file);
        await new Promise((resolve) => setTimeout(resolve, 100));
        await refresh();
        logger.info(`Archived task: ${file.path}`);
      },
    };
  }

  private cleanPropertiesButton(
    file: TFile,
    context: CommandVisibilityContext,
    logger: ILogger,
    refresh: () => Promise<void>,
  ): ActionButton {
    return {
      id: "clean-properties",
      label: "Clean Properties",
      variant: "secondary",
      visible: canCleanProperties(context),
      onClick: async () => {
        await this.services.propertyCleanupService.cleanEmptyProperties(file);
        await new Promise((resolve) => setTimeout(resolve, 100));
        await refresh();
        logger.info(`Cleaned empty properties: ${file.path}`);
      },
    };
  }

  private repairFolderButton(
    file: TFile,
    context: CommandVisibilityContext,
    expectedFolder: string | null,
    currentFolder: string,
    logger: ILogger,
    refresh: () => Promise<void>,
  ): ActionButton {
    return {
      id: "repair-folder",
      label: "Repair Folder",
      variant: "secondary",
      visible: canRepairFolder(context),
      onClick: async () => {
        if (expectedFolder) {
          await this.services.folderRepairService.repairFolder(
            file,
            expectedFolder,
          );
          await new Promise((resolve) => setTimeout(resolve, 100));
          await refresh();
          logger.info(
            `Repaired folder for ${file.path}: ${currentFolder} -> ${expectedFolder}`,
          );
        }
      },
    };
  }

  private renameToUidButton(
    file: TFile,
    metadata: MetadataRecord,
    context: CommandVisibilityContext,
    logger: ILogger,
    refresh: () => Promise<void>,
  ): ActionButton {
    return {
      id: "rename-to-uid",
      label: "Rename to UID",
      variant: "secondary",
      visible: canRenameToUid(context, file.basename),
      onClick: async () => {
        const oldName = file.basename;
        const uid = String(metadata.exo__Asset_uid);
        await this.services.renameToUidService.renameToUid(file, metadata);
        await new Promise((resolve) => setTimeout(resolve, 100));
        await refresh();
        logger.info(`Renamed "${oldName}" to "${uid}"`);
      },
    };
  }

  private copyLabelToAliasesButton(
    file: TFile,
    context: CommandVisibilityContext,
    logger: ILogger,
    refresh: () => Promise<void>,
  ): ActionButton {
    return {
      id: "copy-label-to-aliases",
      label: "Copy Label to Aliases",
      variant: "secondary",
      visible: canCopyLabelToAliases(context),
      onClick: async () => {
        await this.services.labelToAliasService.copyLabelToAliases(file);
        await new Promise((resolve) => setTimeout(resolve, 100));
        await refresh();
        logger.info(`Copied label to aliases: ${file.path}`);
      },
    };
  }

  private convertTaskToProjectButton(
    file: TFile,
    context: CommandVisibilityContext,
    logger: ILogger,
    refresh: () => Promise<void>,
  ): ActionButton {
    return {
      id: "convert-task-to-project",
      label: "Convert to Project",
      variant: "primary",
      visible: canConvertTaskToProject(context),
      onClick: async () => {
        await this.services.assetConversionService.convertTaskToProject(file);
        await new Promise((resolve) => setTimeout(resolve, 100));
        await refresh();
        logger.info(`Converted Task to Project: ${file.path}`);
      },
    };
  }

  private convertProjectToTaskButton(
    file: TFile,
    context: CommandVisibilityContext,
    logger: ILogger,
    refresh: () => Promise<void>,
  ): ActionButton {
    return {
      id: "convert-project-to-task",
      label: "Convert to Task",
      variant: "primary",
      visible: canConvertProjectToTask(context),
      onClick: async () => {
        await this.services.assetConversionService.convertProjectToTask(file);
        await new Promise((resolve) => setTimeout(resolve, 100));
        await refresh();
        logger.info(`Converted Project to Task: ${file.path}`);
      },
    };
  }
}
