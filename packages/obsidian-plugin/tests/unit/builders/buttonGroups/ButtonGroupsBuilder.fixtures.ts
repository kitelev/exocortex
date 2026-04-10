import { ButtonGroupsBuilder, ButtonGroupsBuilderConfig } from "../../../../src/presentation/builders/ButtonGroupsBuilder";
import { TFile } from "obsidian";
import { ExocortexSettings } from "../../../../src/domain/settings/ExocortexSettings";
import {
  FolderRepairService,
  MetadataExtractor,
  CommandResolver,
  PreconditionEvaluator,
  GroundingExecutor,
} from "exocortex";
import { ILogger } from "../../../../src/infrastructure/logging/ILogger";

export interface ButtonGroupsBuilderTestContext {
  builder: ButtonGroupsBuilder;
  mockApp: any;
  mockSettings: ExocortexSettings;
  mockPlugin: any;
  mockCommandResolver: jest.Mocked<CommandResolver>;
  mockPreconditionEvaluator: jest.Mocked<PreconditionEvaluator>;
  mockGroundingExecutor: jest.Mocked<GroundingExecutor>;
  mockFolderRepairService: jest.Mocked<FolderRepairService>;
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
    vault: {
      read: jest.fn().mockResolvedValue("---\n---\nMock Label Content"),
    },
  };

  const mockSettings = {
    showEffortArea: true,
    showEffortVotes: true,
  } as ExocortexSettings;

  const mockPlugin = {
    saveSettings: jest.fn(),
  };

  const mockCommandResolver = {
    resolveForAsset: jest.fn().mockResolvedValue([]),
  } as any;

  const mockPreconditionEvaluator = {
    evaluate: jest.fn().mockResolvedValue(true),
  } as any;

  const mockGroundingExecutor = {
    execute: jest.fn().mockResolvedValue({ success: true }),
  } as any;

  const mockFolderRepairService = {
    getExpectedFolder: jest.fn(),
    repairFolder: jest.fn(),
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

  const mockNotificationService = {
    info: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    confirm: jest.fn().mockResolvedValue(true),
  } as any;

  const builder = new ButtonGroupsBuilder({
    app: mockApp,
    settings: mockSettings,
    plugin: mockPlugin,
    commandResolver: mockCommandResolver,
    preconditionEvaluator: mockPreconditionEvaluator,
    groundingExecutor: mockGroundingExecutor,
    folderRepairService: mockFolderRepairService,
    metadataExtractor: mockMetadataExtractor,
    logger: mockLogger,
    refresh: mockRefresh,
    notificationService: mockNotificationService,
  });

  return {
    builder,
    mockApp,
    mockSettings,
    mockPlugin,
    mockCommandResolver,
    mockPreconditionEvaluator,
    mockGroundingExecutor,
    mockFolderRepairService,
    mockMetadataExtractor,
    mockLogger,
    mockRefresh,
  };
}

export { TFile, ButtonGroupsBuilder, ButtonGroupsBuilderConfig };
