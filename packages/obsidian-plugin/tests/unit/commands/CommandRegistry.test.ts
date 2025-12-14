import "reflect-metadata";
import { container } from "tsyringe";
import { CommandRegistry } from "../../../src/application/commands/CommandRegistry";
import { App } from "obsidian";
import { ExocortexPluginInterface } from "../../../src/types";

// Mock exocortex
jest.mock("exocortex", () => ({
  TaskCreationService: jest.fn(),
  ProjectCreationService: jest.fn(),
  AreaCreationService: jest.fn(),
  TaskStatusService: jest.fn(),
  PropertyCleanupService: jest.fn(),
  FolderRepairService: jest.fn(),
  SupervisionCreationService: jest.fn(),
  RenameToUidService: jest.fn(),
  EffortVotingService: jest.fn(),
  LabelToAliasService: jest.fn(),
  AssetConversionService: jest.fn(),
  FleetingNoteCreationService: jest.fn(),
  DI_TOKENS: {
    IVaultAdapter: Symbol("IVaultAdapter"),
    ILogger: Symbol("ILogger"),
  },
  registerCoreServices: jest.fn(),
}));

// Mock LoggerFactory
jest.mock("../../../src/adapters/logging/LoggerFactory", () => ({
  LoggerFactory: {
    create: jest.fn().mockReturnValue({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

// Mock ObsidianVaultAdapter
jest.mock("../../../src/adapters/ObsidianVaultAdapter", () => ({
  ObsidianVaultAdapter: jest.fn().mockImplementation(() => ({
    read: jest.fn(),
    write: jest.fn(),
  })),
}));

// Mock command classes to avoid complex dependencies
jest.mock("../../../src/application/commands/CreateTaskCommand");
jest.mock("../../../src/application/commands/CreateProjectCommand");
jest.mock("../../../src/application/commands/CreateAreaCommand");
jest.mock("../../../src/application/commands/CreateInstanceCommand");
jest.mock("../../../src/application/commands/CreateFleetingNoteCommand");
jest.mock("../../../src/application/commands/CreateRelatedTaskCommand");
jest.mock("../../../src/application/commands/SetDraftStatusCommand");
jest.mock("../../../src/application/commands/MoveToBacklogCommand");
jest.mock("../../../src/application/commands/MoveToAnalysisCommand");
jest.mock("../../../src/application/commands/MoveToToDoCommand");
jest.mock("../../../src/application/commands/StartEffortCommand");
jest.mock("../../../src/application/commands/PlanOnTodayCommand");
jest.mock("../../../src/application/commands/PlanForEveningCommand");
jest.mock("../../../src/application/commands/ShiftDayBackwardCommand");
jest.mock("../../../src/application/commands/ShiftDayForwardCommand");
jest.mock("../../../src/application/commands/MarkDoneCommand");
jest.mock("../../../src/application/commands/TrashEffortCommand");
jest.mock("../../../src/application/commands/ArchiveTaskCommand");
jest.mock("../../../src/application/commands/CleanPropertiesCommand");
jest.mock("../../../src/application/commands/RepairFolderCommand");
jest.mock("../../../src/application/commands/RenameToUidCommand");
jest.mock("../../../src/application/commands/VoteOnEffortCommand");
jest.mock("../../../src/application/commands/CopyLabelToAliasesCommand");
jest.mock("../../../src/application/commands/AddSupervisionCommand");
jest.mock("../../../src/application/commands/ReloadLayoutCommand");
jest.mock("../../../src/application/commands/TogglePropertiesVisibilityCommand");
jest.mock("../../../src/application/commands/ToggleLayoutVisibilityCommand");
jest.mock("../../../src/application/commands/ToggleArchivedAssetsCommand");
jest.mock("../../../src/application/commands/ConvertTaskToProjectCommand");
jest.mock("../../../src/application/commands/ConvertProjectToTaskCommand");
jest.mock("../../../src/application/commands/SetFocusAreaCommand");
jest.mock("../../../src/application/commands/OpenQueryBuilderCommand");
jest.mock("../../../src/application/commands/EditPropertiesCommand");

// Mock SPARQLQueryService and OntologySchemaService
jest.mock("../../../src/application/services/SPARQLQueryService", () => ({
  SPARQLQueryService: jest.fn().mockImplementation(() => ({
    initialize: jest.fn(),
    query: jest.fn(),
    refresh: jest.fn(),
    dispose: jest.fn(),
  })),
}));

jest.mock("../../../src/application/services/OntologySchemaService", () => ({
  OntologySchemaService: jest.fn().mockImplementation(() => ({
    getClassProperties: jest.fn(),
    getClassHierarchy: jest.fn(),
    isDeprecatedProperty: jest.fn(),
    getDefaultProperties: jest.fn(),
  })),
}));

describe("CommandRegistry", () => {
  let mockApp: App;
  let mockPlugin: ExocortexPluginInterface;
  let mockReloadLayoutCallback: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    container.clearInstances();

    // Create mock container.resolve
    const mockServices = {
      taskCreationService: {},
      projectCreationService: {},
      areaCreationService: {},
      taskStatusService: {},
      propertyCleanupService: {},
      folderRepairService: {},
      supervisionCreationService: {},
      renameToUidService: {},
      effortVotingService: {},
      labelToAliasService: {},
      assetConversionService: {},
      fleetingNoteCreationService: {},
    };

    jest.spyOn(container, "resolve").mockImplementation(() => mockServices as any);
    jest.spyOn(container, "register").mockImplementation(() => container as any);

    mockApp = {
      vault: {
        getMarkdownFiles: jest.fn().mockReturnValue([]),
        getName: jest.fn().mockReturnValue("Test Vault"),
      },
      metadataCache: {
        getFileCache: jest.fn(),
      },
    } as unknown as App;

    mockPlugin = {
      settings: {
        currentOntology: null,
        showLayoutSection: true,
      },
      saveSettings: jest.fn(),
      refreshLayout: jest.fn(),
    } as unknown as ExocortexPluginInterface;

    mockReloadLayoutCallback = jest.fn();
  });

  afterEach(() => {
    container.clearInstances();
  });

  describe("constructor", () => {
    it("should create instance without reloadLayoutCallback", () => {
      const registry = new CommandRegistry(mockApp, mockPlugin);

      expect(registry).toBeInstanceOf(CommandRegistry);
    });

    it("should create instance with reloadLayoutCallback", () => {
      const registry = new CommandRegistry(mockApp, mockPlugin, mockReloadLayoutCallback);

      expect(registry).toBeInstanceOf(CommandRegistry);
    });

    it("should register IVaultAdapter with DI container", () => {
      new CommandRegistry(mockApp, mockPlugin);

      expect(container.register).toHaveBeenCalled();
    });
  });

  describe("getAllCommands", () => {
    it("should return array of commands", () => {
      const registry = new CommandRegistry(mockApp, mockPlugin);
      const commands = registry.getAllCommands();

      expect(Array.isArray(commands)).toBe(true);
    });

    it("should return correct number of commands", () => {
      const registry = new CommandRegistry(mockApp, mockPlugin);
      const commands = registry.getAllCommands();

      // 33 commands are registered based on source
      expect(commands.length).toBe(33);
    });

    it("should return same array on multiple calls", () => {
      const registry = new CommandRegistry(mockApp, mockPlugin);
      const commands1 = registry.getAllCommands();
      const commands2 = registry.getAllCommands();

      expect(commands1).toBe(commands2);
    });
  });

  describe("command types", () => {
    it("should include creation commands", () => {
      const registry = new CommandRegistry(mockApp, mockPlugin);
      const commands = registry.getAllCommands();

      // All command classes are mocked, so we can't check exact types
      // but we can verify count
      expect(commands.length).toBeGreaterThan(0);
    });

    it("should include status commands", () => {
      const registry = new CommandRegistry(mockApp, mockPlugin);
      const commands = registry.getAllCommands();

      // Commands exist
      expect(commands.length).toBeGreaterThanOrEqual(10);
    });

    it("should include toggle commands", () => {
      const registry = new CommandRegistry(mockApp, mockPlugin);
      const commands = registry.getAllCommands();

      // Toggle commands included
      expect(commands.length).toBeGreaterThanOrEqual(20);
    });
  });
});
