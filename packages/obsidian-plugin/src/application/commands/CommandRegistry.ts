import { App } from "obsidian";
import { container } from "tsyringe";
import { ICommand } from "./ICommand";
import { ExocortexPluginInterface } from '@plugin/types';
import { ObsidianVaultAdapter } from '@plugin/adapters/ObsidianVaultAdapter';
import {
  TaskCreationService,
  ProjectCreationService,
  AreaCreationService,
  TaskStatusService,
  PropertyCleanupService,
  FolderRepairService,
  SupervisionCreationService,
  RenameToUidService,
  EffortVotingService,
  LabelToAliasService,
  AssetConversionService,
  FleetingNoteCreationService,
  DI_TOKENS,
  registerCoreServices,
} from "exocortex";
import { LoggerFactory } from '@plugin/adapters/logging/LoggerFactory';
import { SPARQLQueryService } from '@plugin/application/services/SPARQLQueryService';
import { OntologySchemaService } from '@plugin/application/services/OntologySchemaService';

import { CreateTaskCommand } from "./CreateTaskCommand";
import { CreateProjectCommand } from "./CreateProjectCommand";
import { CreateAreaCommand } from "./CreateAreaCommand";
import { CreateInstanceCommand } from "./CreateInstanceCommand";
import { CreateFleetingNoteCommand } from "./CreateFleetingNoteCommand";
import { CreateRelatedTaskCommand } from "./CreateRelatedTaskCommand";
import { SetDraftStatusCommand } from "./SetDraftStatusCommand";
import { MoveToBacklogCommand } from "./MoveToBacklogCommand";
import { MoveToAnalysisCommand } from "./MoveToAnalysisCommand";
import { MoveToToDoCommand } from "./MoveToToDoCommand";
import { StartEffortCommand } from "./StartEffortCommand";
import { PlanOnTodayCommand } from "./PlanOnTodayCommand";
import { PlanForEveningCommand } from "./PlanForEveningCommand";
import { ShiftDayBackwardCommand } from "./ShiftDayBackwardCommand";
import { ShiftDayForwardCommand } from "./ShiftDayForwardCommand";
import { MarkDoneCommand } from "./MarkDoneCommand";
import { TrashEffortCommand } from "./TrashEffortCommand";
import { ArchiveTaskCommand } from "./ArchiveTaskCommand";
import { CleanPropertiesCommand } from "./CleanPropertiesCommand";
import { RepairFolderCommand } from "./RepairFolderCommand";
import { RenameToUidCommand } from "./RenameToUidCommand";
import { VoteOnEffortCommand } from "./VoteOnEffortCommand";
import { CopyLabelToAliasesCommand } from "./CopyLabelToAliasesCommand";
import { AddSupervisionCommand } from "./AddSupervisionCommand";
import { ReloadLayoutCommand } from "./ReloadLayoutCommand";
import { TogglePropertiesVisibilityCommand } from "./TogglePropertiesVisibilityCommand";
import { ToggleLayoutVisibilityCommand } from "./ToggleLayoutVisibilityCommand";
import { ToggleArchivedAssetsCommand } from "./ToggleArchivedAssetsCommand";
import { ConvertTaskToProjectCommand } from "./ConvertTaskToProjectCommand";
import { ConvertProjectToTaskCommand } from "./ConvertProjectToTaskCommand";
import { SetFocusAreaCommand } from "./SetFocusAreaCommand";
import { OpenQueryBuilderCommand } from "./OpenQueryBuilderCommand";
import { EditPropertiesCommand } from "./EditPropertiesCommand";

export class CommandRegistry {
  private commands: ICommand[] = [];
  private vaultAdapter: ObsidianVaultAdapter;

  constructor(
    app: App,
    plugin: ExocortexPluginInterface,
    reloadLayoutCallback?: () => void,
  ) {
    this.vaultAdapter = new ObsidianVaultAdapter(app.vault, app.metadataCache, app);

    // Create logger for services
    const logger = LoggerFactory.create("CommandRegistry");

    // Register infrastructure dependencies with DI container
    container.register(DI_TOKENS.IVaultAdapter, { useValue: this.vaultAdapter });
    container.register(DI_TOKENS.ILogger, { useValue: logger });

    // Register all core services
    registerCoreServices();

    // Resolve services from DI container
    const taskCreationService = container.resolve(TaskCreationService);
    const projectCreationService = container.resolve(ProjectCreationService);
    const areaCreationService = container.resolve(AreaCreationService);
    const taskStatusService = container.resolve(TaskStatusService);
    const propertyCleanupService = container.resolve(PropertyCleanupService);
    const folderRepairService = container.resolve(FolderRepairService);
    const supervisionCreationService = container.resolve(SupervisionCreationService);
    const renameToUidService = container.resolve(RenameToUidService);
    const effortVotingService = container.resolve(EffortVotingService);
    const labelToAliasService = container.resolve(LabelToAliasService);
    const assetConversionService = container.resolve(AssetConversionService);
    const fleetingNoteCreationService = container.resolve(FleetingNoteCreationService);

    // Create ontology schema service for dynamic forms
    const sparqlQueryService = new SPARQLQueryService(app, logger);
    const ontologySchemaService = new OntologySchemaService(sparqlQueryService);

    this.commands = [
      new CreateTaskCommand(app, taskCreationService, this.vaultAdapter, plugin, ontologySchemaService),
      new CreateProjectCommand(app, projectCreationService, this.vaultAdapter),
      new CreateAreaCommand(app, areaCreationService, this.vaultAdapter),
      new CreateInstanceCommand(app, taskCreationService, this.vaultAdapter, plugin, ontologySchemaService),
      new CreateFleetingNoteCommand(app, fleetingNoteCreationService, this.vaultAdapter),
      new CreateRelatedTaskCommand(app, taskCreationService, this.vaultAdapter),
      new SetDraftStatusCommand(taskStatusService),
      new MoveToBacklogCommand(taskStatusService),
      new MoveToAnalysisCommand(taskStatusService),
      new MoveToToDoCommand(taskStatusService),
      new StartEffortCommand(taskStatusService),
      new PlanOnTodayCommand(taskStatusService),
      new PlanForEveningCommand(taskStatusService),
      new ShiftDayBackwardCommand(taskStatusService),
      new ShiftDayForwardCommand(taskStatusService),
      new MarkDoneCommand(taskStatusService),
      new TrashEffortCommand(app, taskStatusService),
      new ArchiveTaskCommand(taskStatusService),
      new CleanPropertiesCommand(propertyCleanupService),
      new RepairFolderCommand(app, folderRepairService),
      new RenameToUidCommand(renameToUidService),
      new VoteOnEffortCommand(effortVotingService),
      new CopyLabelToAliasesCommand(labelToAliasService),
      new AddSupervisionCommand(app, supervisionCreationService, this.vaultAdapter),
      new ReloadLayoutCommand(reloadLayoutCallback),
      new TogglePropertiesVisibilityCommand(plugin),
      new ToggleLayoutVisibilityCommand(plugin),
      new ToggleArchivedAssetsCommand(plugin),
      new ConvertTaskToProjectCommand(assetConversionService),
      new ConvertProjectToTaskCommand(assetConversionService),
      new SetFocusAreaCommand(app, plugin),
      new OpenQueryBuilderCommand(app, plugin),
      new EditPropertiesCommand(app, plugin),
    ];
  }

  getAllCommands(): ICommand[] {
    return this.commands;
  }
}
