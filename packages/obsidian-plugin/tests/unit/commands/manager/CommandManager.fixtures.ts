import { flushPromises } from "../../helpers/testHelpers";
import "reflect-metadata";
import { container } from "tsyringe";
import { CommandManager } from "../../../../src/application/services/CommandManager";
import { TFile, Notice } from "obsidian";
import {
  DI_TOKENS,
  IVaultAdapter,
  TaskFrontmatterGenerator,
  AlgorithmExtractor,
  TaskCreationService,
} from "exocortex";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Notice: jest.fn(),
}));

export let mockLabelInputModalCallback: ((result: any) => void) | null = null;
export let mockSupervisionInputModalCallback: ((result: any) => void) | null =
  null;
export let mockTrashReasonModalCallback: ((result: any) => void) | null = null;

jest.mock("../../../../src/presentation/modals/LabelInputModal", () => ({
  LabelInputModal: jest.fn().mockImplementation((app, onSubmit) => {
    mockLabelInputModalCallback = onSubmit;
    return {
      open: jest.fn(),
    };
  }),
}));

jest.mock("../../../../src/presentation/modals/SupervisionInputModal", () => ({
  SupervisionInputModal: jest.fn().mockImplementation((app, onSubmit) => {
    mockSupervisionInputModalCallback = onSubmit;
    return {
      open: jest.fn(),
    };
  }),
}));

// Mock TrashReasonModal - stores callback so tests can trigger it
jest.mock("../../../../src/presentation/modals/TrashReasonModal", () => ({
  TrashReasonModal: jest.fn().mockImplementation((app, onSubmit) => {
    mockTrashReasonModalCallback = onSubmit;
    return {
      open: jest.fn(),
    };
  }),
}));

export interface CommandManagerTestContext {
  mockApp: any;
  mockPlugin: any;
  commandManager: CommandManager;
  mockFile: TFile;
  registeredCommands: Map<string, any>;
}

export const setupCommandManagerTest = (): CommandManagerTestContext => {
  container.clearInstances();
  jest.clearAllMocks();
  const registeredCommands = new Map<string, any>();

  const mockFile = new TFile("test/path.md");

  const mockGetFileCache = jest.fn().mockReturnValue({
    frontmatter: {},
  });

  const mockApp: any = {
    vault: {
      modify: jest.fn().mockResolvedValue(undefined),
      create: jest.fn().mockResolvedValue(mockFile),
      read: jest.fn().mockResolvedValue("---\n---"),
      getAbstractFileByPath: jest.fn().mockReturnValue(mockFile),
      rename: jest.fn().mockResolvedValue(undefined),
      process: jest.fn().mockResolvedValue("processed content"),
      createFolder: jest.fn().mockResolvedValue(undefined),
    },
    metadataCache: {
      getFileCache: mockGetFileCache,
      getFirstLinkpathDest: jest.fn(),
    },
    fileManager: {
      renameFile: jest.fn().mockResolvedValue(undefined),
      processFrontMatter: jest.fn().mockResolvedValue(undefined),
    },
    workspace: {
      getActiveFile: jest.fn().mockReturnValue(mockFile),
      getLeaf: jest.fn().mockReturnValue({
        openFile: jest.fn().mockResolvedValue(undefined),
      }),
      setActiveLeaf: jest.fn(),
    },
  };

  const mockPlugin: any = {
    addCommand: jest.fn((command: any) => {
      registeredCommands.set(command.id, command);
    }),
    settings: {
      showPropertiesSection: true,
      layoutVisible: true,
      showArchivedAssets: false,
      defaultOntologyAsset: null,
    },
    saveSettings: jest.fn().mockResolvedValue(undefined),
    refreshLayout: jest.fn(),
  };

  const mockVault: any = {
    create: jest.fn().mockResolvedValue({ path: "test-task.md" }),
    read: jest.fn().mockResolvedValue(""),
    modify: jest.fn().mockResolvedValue(undefined),
  };

  container.registerInstance<IVaultAdapter>(DI_TOKENS.IVaultAdapter, mockVault);
  container.register(TaskFrontmatterGenerator, {
    useClass: TaskFrontmatterGenerator,
  });
  container.register(AlgorithmExtractor, { useClass: AlgorithmExtractor });
  container.register(TaskCreationService, { useClass: TaskCreationService });

  const commandManager = new CommandManager(mockApp);

  return {
    mockApp,
    mockPlugin,
    commandManager,
    mockFile,
    registeredCommands,
  };
};

export { TFile, Notice, flushPromises, CommandManager };
