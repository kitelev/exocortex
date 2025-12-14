import { ButtonGroupsBuilder, ButtonGroupsBuilderConfig } from "../../../../src/presentation/builders/ButtonGroupsBuilder";
import { TFile } from "obsidian";
import { ExocortexSettings } from "../../../../src/domain/settings/ExocortexSettings";
import {
  TaskCreationService,
  ProjectCreationService,
  AreaCreationService,
  ClassCreationService,
  ConceptCreationService,
  TaskStatusService,
  PropertyCleanupService,
  FolderRepairService,
  RenameToUidService,
  EffortVotingService,
  LabelToAliasService,
  AssetConversionService,
  MetadataExtractor,
} from "exocortex";
import { ILogger } from "../../../../src/infrastructure/logging/ILogger";

export interface ButtonGroupsBuilderTestContext {
  builder: ButtonGroupsBuilder;
  mockApp: any;
  mockSettings: ExocortexSettings;
  mockPlugin: any;
  mockTaskCreationService: jest.Mocked<TaskCreationService>;
  mockProjectCreationService: jest.Mocked<ProjectCreationService>;
  mockAreaCreationService: jest.Mocked<AreaCreationService>;
  mockClassCreationService: jest.Mocked<ClassCreationService>;
  mockConceptCreationService: jest.Mocked<ConceptCreationService>;
  mockTaskStatusService: jest.Mocked<TaskStatusService>;
  mockPropertyCleanupService: jest.Mocked<PropertyCleanupService>;
  mockFolderRepairService: jest.Mocked<FolderRepairService>;
  mockRenameToUidService: jest.Mocked<RenameToUidService>;
  mockEffortVotingService: jest.Mocked<EffortVotingService>;
  mockLabelToAliasService: jest.Mocked<LabelToAliasService>;
  mockAssetConversionService: jest.Mocked<AssetConversionService>;
  mockMetadataExtractor: jest.Mocked<MetadataExtractor>;
  mockLogger: jest.Mocked<ILogger>;
  mockRefresh: jest.Mock;
}

export function setupButtonGroupsBuilderTest(): ButtonGroupsBuilderTestContext {
  const mockApp = {
    workspace: {
      getLeaf: jest.fn().mockReturnValue({
        openFile: jest.fn(),
      }),
      setActiveLeaf: jest.fn(),
    },
  };

  const mockSettings = {
    activeFocusArea: null,
    showEffortArea: true,
    showEffortVotes: true,
  } as ExocortexSettings;

  const mockPlugin = {
    saveSettings: jest.fn(),
  };

  const mockTaskCreationService = {
    createTask: jest.fn(),
    createRelatedTask: jest.fn(),
  } as any;

  const mockProjectCreationService = {
    createProject: jest.fn(),
  } as any;

  const mockAreaCreationService = {
    createChildArea: jest.fn(),
  } as any;

  const mockClassCreationService = {
    createSubclass: jest.fn(),
  } as any;

  const mockConceptCreationService = {
    createNarrowerConcept: jest.fn(),
  } as any;

  const mockTaskStatusService = {
    setDraftStatus: jest.fn(),
    moveToBacklog: jest.fn(),
    moveToAnalysis: jest.fn(),
    moveToToDo: jest.fn(),
    startEffort: jest.fn(),
    markTaskAsDone: jest.fn(),
    rollbackStatus: jest.fn(),
    planOnToday: jest.fn(),
    planForEvening: jest.fn(),
    shiftDayBackward: jest.fn(),
    shiftDayForward: jest.fn(),
    trashEffort: jest.fn(),
    archiveTask: jest.fn(),
  } as any;

  const mockPropertyCleanupService = {
    cleanEmptyProperties: jest.fn(),
  } as any;

  const mockFolderRepairService = {
    getExpectedFolder: jest.fn(),
    repairFolder: jest.fn(),
  } as any;

  const mockRenameToUidService = {
    renameToUid: jest.fn(),
  } as any;

  const mockEffortVotingService = {
    incrementEffortVotes: jest.fn(),
  } as any;

  const mockLabelToAliasService = {
    copyLabelToAliases: jest.fn(),
  } as any;

  const mockAssetConversionService = {
    convertTaskToProject: jest.fn(),
    convertProjectToTask: jest.fn(),
  } as any;

  const mockMetadataExtractor = {
    extractMetadata: jest.fn(),
    extractInstanceClass: jest.fn(),
    extractStatus: jest.fn(),
    extractIsArchived: jest.fn(),
  } as any;

  const mockLogger = {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  } as any;

  const mockRefresh = jest.fn();

  const builder = new ButtonGroupsBuilder({
    app: mockApp,
    settings: mockSettings,
    plugin: mockPlugin,
    taskCreationService: mockTaskCreationService,
    projectCreationService: mockProjectCreationService,
    areaCreationService: mockAreaCreationService,
    classCreationService: mockClassCreationService,
    conceptCreationService: mockConceptCreationService,
    taskStatusService: mockTaskStatusService,
    propertyCleanupService: mockPropertyCleanupService,
    folderRepairService: mockFolderRepairService,
    renameToUidService: mockRenameToUidService,
    effortVotingService: mockEffortVotingService,
    labelToAliasService: mockLabelToAliasService,
    assetConversionService: mockAssetConversionService,
    metadataExtractor: mockMetadataExtractor,
    logger: mockLogger,
    refresh: mockRefresh,
  });

  return {
    builder,
    mockApp,
    mockSettings,
    mockPlugin,
    mockTaskCreationService,
    mockProjectCreationService,
    mockAreaCreationService,
    mockClassCreationService,
    mockConceptCreationService,
    mockTaskStatusService,
    mockPropertyCleanupService,
    mockFolderRepairService,
    mockRenameToUidService,
    mockEffortVotingService,
    mockLabelToAliasService,
    mockAssetConversionService,
    mockMetadataExtractor,
    mockLogger,
    mockRefresh,
  };
}

export { TFile, ButtonGroupsBuilder, ButtonGroupsBuilderConfig };
