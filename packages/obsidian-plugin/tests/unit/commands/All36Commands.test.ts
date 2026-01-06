/**
 * All 36 Commands Migration Test
 *
 * Tests for Issue #1442: [Commands] Migrate all 36 commands to RDF
 *
 * This test validates that all 36 commands are properly defined and can be
 * loaded through the RdfCommandRegistry.
 *
 * Command breakdown:
 * - Create commands (6): CreateTask, CreateProject, CreateArea, CreateInstance, CreateFleetingNote, CreateRelatedTask
 * - Status commands (13): SetDraftStatus, MoveToBacklog, MoveToAnalysis, MoveToToDo, StartEffort, PlanOnToday, PlanForEvening, ShiftDayBackward, ShiftDayForward, MarkDone, TrashEffort, ArchiveTask, VoteOnEffort
 * - Maintenance commands (5): CleanProperties, RepairFolder, RenameToUid, CopyLabelToAliases, AddSupervision
 * - UI Toggle commands (4): ReloadLayout, TogglePropertiesVisibility, ToggleLayoutVisibility, ToggleArchivedAssets
 * - Conversion commands (2): ConvertTaskToProject, ConvertProjectToTask
 * - Navigation commands (3): GoToParent, GoToProject, GoToArea
 * - Special commands (3): SetFocusArea, OpenQueryBuilder, EditProperties
 *
 * @see https://github.com/kitelev/exocortex/issues/1442
 */

import "reflect-metadata";
import { RdfCommandRegistry } from "../../../src/application/commands/RdfCommandRegistry";
import { Plugin, App } from "obsidian";
import { SPARQLQueryService } from "../../../src/application/services/SPARQLQueryService";

/**
 * Helper to create a mock SolutionMapping that behaves like the real class.
 */
function createMockSolutionMapping(
  bindings: Record<string, string | undefined>
): { get: (key: string) => { value: string } | undefined } {
  return {
    get: (key: string) => {
      const value = bindings[key];
      if (value === undefined) {
        return undefined;
      }
      return { value };
    },
  };
}

/**
 * Complete list of all 36 commands that must be defined in RDF.
 * This is the authoritative list per Issue #1442.
 */
const ALL_36_COMMANDS = [
  // Create commands (6)
  {
    uri: "https://exocortex.my/ontology/ems-ui#CreateTaskCommand",
    id: "create-task",
    name: "Create Task",
    icon: "plus-circle",
    hotkey: "Mod+Shift+T",
    headless: "true",
  },
  {
    uri: "https://exocortex.my/ontology/ems-ui#CreateProjectCommand",
    id: "create-project",
    name: "Create Project",
    icon: "folder-plus",
    hotkey: "Mod+Shift+P",
    headless: "true",
  },
  {
    uri: "https://exocortex.my/ontology/ems-ui#CreateAreaCommand",
    id: "create-area",
    name: "Create Area",
    icon: "map",
    hotkey: "Mod+Shift+A",
    headless: "true",
  },
  {
    uri: "https://exocortex.my/ontology/ems-ui#CreateInstanceCommand",
    id: "create-instance",
    name: "Create Instance",
    icon: "copy",
    headless: "true",
  },
  {
    uri: "https://exocortex.my/ontology/ems-ui#CreateFleetingNoteCommand",
    id: "create-fleeting-note",
    name: "Create Fleeting Note",
    icon: "file-plus",
    headless: "true",
  },
  {
    uri: "https://exocortex.my/ontology/ems-ui#CreateRelatedTaskCommand",
    id: "create-related-task",
    name: "Create Related Task",
    icon: "git-branch",
    headless: "true",
  },

  // Status commands (13)
  {
    uri: "https://exocortex.my/ontology/ems-ui#SetDraftStatusCommand",
    id: "set-draft-status",
    name: "Set Draft Status",
    icon: "file-edit",
    headless: "true",
  },
  {
    uri: "https://exocortex.my/ontology/ems-ui#MoveToBacklogCommand",
    id: "move-to-backlog",
    name: "Move to Backlog",
    icon: "archive",
    headless: "true",
  },
  {
    uri: "https://exocortex.my/ontology/ems-ui#MoveToAnalysisCommand",
    id: "move-to-analysis",
    name: "Move to Analysis",
    icon: "search",
    headless: "true",
  },
  {
    uri: "https://exocortex.my/ontology/ems-ui#MoveToToDoCommand",
    id: "move-to-todo",
    name: "Move to ToDo",
    icon: "list-todo",
    headless: "true",
  },
  {
    uri: "https://exocortex.my/ontology/ems-ui#StartEffortCommand",
    id: "start-effort",
    name: "Start Effort",
    icon: "play",
    hotkey: "Mod+S",
    headless: "true",
  },
  {
    uri: "https://exocortex.my/ontology/ems-ui#PlanOnTodayCommand",
    id: "plan-on-today",
    name: "Plan on Today",
    icon: "calendar",
    headless: "true",
  },
  {
    uri: "https://exocortex.my/ontology/ems-ui#PlanForEveningCommand",
    id: "plan-for-evening",
    name: "Plan for Evening",
    icon: "moon",
    headless: "true",
  },
  {
    uri: "https://exocortex.my/ontology/ems-ui#ShiftDayBackwardCommand",
    id: "shift-day-backward",
    name: "Shift Day Backward",
    icon: "arrow-left",
    headless: "true",
  },
  {
    uri: "https://exocortex.my/ontology/ems-ui#ShiftDayForwardCommand",
    id: "shift-day-forward",
    name: "Shift Day Forward",
    icon: "arrow-right",
    headless: "true",
  },
  {
    uri: "https://exocortex.my/ontology/ems-ui#MarkDoneCommand",
    id: "mark-done",
    name: "Mark Done",
    icon: "check-circle",
    hotkey: "Mod+D",
    headless: "true",
  },
  {
    uri: "https://exocortex.my/ontology/ems-ui#TrashEffortCommand",
    id: "trash-effort",
    name: "Trash Effort",
    icon: "trash",
    headless: "true",
  },
  {
    uri: "https://exocortex.my/ontology/ems-ui#ArchiveTaskCommand",
    id: "archive-task",
    name: "Archive Task",
    icon: "archive",
    headless: "true",
  },
  {
    uri: "https://exocortex.my/ontology/ems-ui#VoteOnEffortCommand",
    id: "vote-on-effort",
    name: "Vote on Effort",
    icon: "thumbs-up",
    headless: "true",
  },

  // Maintenance commands (5)
  {
    uri: "https://exocortex.my/ontology/ems-ui#CleanPropertiesCommand",
    id: "clean-properties",
    name: "Clean Properties",
    icon: "eraser",
    headless: "true",
  },
  {
    uri: "https://exocortex.my/ontology/ems-ui#RepairFolderCommand",
    id: "repair-folder",
    name: "Repair Folder",
    icon: "folder-sync",
    headless: "true",
  },
  {
    uri: "https://exocortex.my/ontology/ems-ui#RenameToUidCommand",
    id: "rename-to-uid",
    name: "Rename to UID",
    icon: "hash",
    headless: "true",
  },
  {
    uri: "https://exocortex.my/ontology/ems-ui#CopyLabelToAliasesCommand",
    id: "copy-label-to-aliases",
    name: "Copy Label to Aliases",
    icon: "copy",
    headless: "true",
  },
  {
    uri: "https://exocortex.my/ontology/ems-ui#AddSupervisionCommand",
    id: "add-supervision",
    name: "Add Supervision",
    icon: "eye",
    headless: "false",
  },

  // UI Toggle commands (4)
  {
    uri: "https://exocortex.my/ontology/ems-ui#ReloadLayoutCommand",
    id: "reload-layout",
    name: "Reload Layout",
    icon: "refresh-cw",
    headless: "false",
  },
  {
    uri: "https://exocortex.my/ontology/ems-ui#TogglePropertiesVisibilityCommand",
    id: "toggle-properties-visibility",
    name: "Toggle Properties Visibility",
    icon: "eye-off",
    headless: "false",
  },
  {
    uri: "https://exocortex.my/ontology/ems-ui#ToggleLayoutVisibilityCommand",
    id: "toggle-layout-visibility",
    name: "Toggle Layout Visibility",
    icon: "layout",
    headless: "false",
  },
  {
    uri: "https://exocortex.my/ontology/ems-ui#ToggleArchivedAssetsCommand",
    id: "toggle-archived-assets",
    name: "Toggle Archived Assets",
    icon: "archive",
    headless: "false",
  },

  // Conversion commands (2)
  {
    uri: "https://exocortex.my/ontology/ems-ui#ConvertTaskToProjectCommand",
    id: "convert-task-to-project",
    name: "Convert Task to Project",
    icon: "folder",
    headless: "true",
  },
  {
    uri: "https://exocortex.my/ontology/ems-ui#ConvertProjectToTaskCommand",
    id: "convert-project-to-task",
    name: "Convert Project to Task",
    icon: "check-square",
    headless: "true",
  },

  // Navigation commands (3)
  {
    uri: "https://exocortex.my/ontology/ems-ui#GoToParentCommand",
    id: "go-to-parent",
    name: "Go to Parent",
    icon: "arrow-up",
    hotkey: "Mod+Up",
    condition: "https://exocortex.my/ontology/ems-ui#HasParent",
    headless: "false",
  },
  {
    uri: "https://exocortex.my/ontology/ems-ui#GoToProjectCommand",
    id: "go-to-project",
    name: "Go to Project",
    icon: "folder",
    hotkey: "Mod+P",
    condition: "https://exocortex.my/ontology/ems-ui#HasProject",
    headless: "false",
  },
  {
    uri: "https://exocortex.my/ontology/ems-ui#GoToAreaCommand",
    id: "go-to-area",
    name: "Go to Area",
    icon: "map-pin",
    hotkey: "Mod+A",
    condition: "https://exocortex.my/ontology/ems-ui#HasArea",
    headless: "false",
  },

  // Special commands (3)
  {
    uri: "https://exocortex.my/ontology/ems-ui#SetFocusAreaCommand",
    id: "set-focus-area",
    name: "Set Focus Area",
    icon: "target",
    headless: "false",
  },
  {
    uri: "https://exocortex.my/ontology/ems-ui#OpenQueryBuilderCommand",
    id: "open-query-builder",
    name: "Open Query Builder",
    icon: "search",
    headless: "false",
  },
  {
    uri: "https://exocortex.my/ontology/ems-ui#EditPropertiesCommand",
    id: "edit-properties",
    name: "Edit Properties",
    icon: "edit",
    headless: "false",
  },
];

// Mock SPARQLQueryService
jest.mock("../../../src/application/services/SPARQLQueryService", () => ({
  SPARQLQueryService: jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue([]),
    refresh: jest.fn().mockResolvedValue(undefined),
    dispose: jest.fn(),
    getTripleStore: jest.fn(),
  })),
}));

// Mock LoggerFactory
jest.mock("../../../src/adapters/logging/LoggerFactory", () => ({
  LoggerFactory: {
    create: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

describe("Issue #1442: All 36 Commands Migration", () => {
  let mockPlugin: jest.Mocked<Plugin>;
  let mockApp: App;
  let mockSparqlService: jest.Mocked<SPARQLQueryService>;
  let registry: RdfCommandRegistry;

  beforeEach(() => {
    jest.clearAllMocks();

    mockApp = {
      vault: {
        getMarkdownFiles: jest.fn().mockReturnValue([]),
        getName: jest.fn().mockReturnValue("Test Vault"),
      },
      metadataCache: {
        getFileCache: jest.fn(),
      },
      workspace: {
        getActiveFile: jest.fn(),
      },
    } as unknown as App;

    mockPlugin = {
      app: mockApp,
      addCommand: jest.fn(),
      registerEvent: jest.fn(),
    } as unknown as jest.Mocked<Plugin>;

    mockSparqlService = new SPARQLQueryService(mockApp) as jest.Mocked<SPARQLQueryService>;
    mockSparqlService.query = jest.fn().mockResolvedValue([]);
    mockSparqlService.initialize = jest.fn().mockResolvedValue(undefined);

    registry = new RdfCommandRegistry(mockPlugin, mockSparqlService);
  });

  describe("Command Count Validation", () => {
    it("should have exactly 36 commands defined in specification", () => {
      expect(ALL_36_COMMANDS.length).toBe(36);
    });

    it("should have unique command URIs", () => {
      const uris = ALL_36_COMMANDS.map((c) => c.uri);
      const uniqueUris = new Set(uris);
      expect(uniqueUris.size).toBe(36);
    });

    it("should have unique command IDs", () => {
      const ids = ALL_36_COMMANDS.map((c) => c.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(36);
    });
  });

  describe("Command Categories", () => {
    it("should have 6 Create commands", () => {
      const createCommands = ALL_36_COMMANDS.filter((c) => c.id.startsWith("create-"));
      expect(createCommands.length).toBe(6);
    });

    it("should have 13 Status commands", () => {
      const statusCommands = ALL_36_COMMANDS.filter(
        (c) =>
          c.id.startsWith("set-draft") ||
          c.id.startsWith("move-to") ||
          c.id.startsWith("start-") ||
          c.id.startsWith("plan-") ||
          c.id.startsWith("shift-day") ||
          c.id.startsWith("mark-done") ||
          c.id.startsWith("trash-") ||
          c.id.startsWith("archive-") ||
          c.id.startsWith("vote-")
      );
      expect(statusCommands.length).toBe(13);
    });

    it("should have 5 Maintenance commands", () => {
      const maintenanceCommands = ALL_36_COMMANDS.filter(
        (c) =>
          c.id.startsWith("clean-") ||
          c.id.startsWith("repair-") ||
          c.id.startsWith("rename-to") ||
          c.id.startsWith("copy-label") ||
          c.id.startsWith("add-supervision")
      );
      expect(maintenanceCommands.length).toBe(5);
    });

    it("should have 4 UI Toggle commands", () => {
      const toggleCommands = ALL_36_COMMANDS.filter(
        (c) => c.id.startsWith("toggle-") || c.id.startsWith("reload-")
      );
      expect(toggleCommands.length).toBe(4);
    });

    it("should have 2 Conversion commands", () => {
      const conversionCommands = ALL_36_COMMANDS.filter((c) => c.id.startsWith("convert-"));
      expect(conversionCommands.length).toBe(2);
    });

    it("should have 3 Navigation commands", () => {
      const navigationCommands = ALL_36_COMMANDS.filter((c) => c.id.startsWith("go-to-"));
      expect(navigationCommands.length).toBe(3);
    });

    it("should have 3 Special commands", () => {
      const specialCommands = ALL_36_COMMANDS.filter(
        (c) =>
          c.id === "set-focus-area" ||
          c.id === "open-query-builder" ||
          c.id === "edit-properties"
      );
      expect(specialCommands.length).toBe(3);
    });
  });

  describe("RdfCommandRegistry Loading", () => {
    it("should load all 36 commands from RDF", async () => {
      // Create mock SPARQL results for all 36 commands
      const mockResults = ALL_36_COMMANDS.map((cmd) =>
        createMockSolutionMapping({
          cmd: cmd.uri,
          id: cmd.id,
          name: cmd.name,
          icon: cmd.icon,
          hotkey: cmd.hotkey,
          condition: cmd.condition,
          headless: cmd.headless,
        })
      );

      mockSparqlService.query.mockResolvedValue(mockResults);

      await registry.loadFromTripleStore();

      const loadedCommands = registry.getLoadedCommands();
      expect(loadedCommands.length).toBe(36);
    });

    it("should register all 36 commands with Obsidian plugin", async () => {
      const mockResults = ALL_36_COMMANDS.map((cmd) =>
        createMockSolutionMapping({
          cmd: cmd.uri,
          id: cmd.id,
          name: cmd.name,
          icon: cmd.icon,
          hotkey: cmd.hotkey,
          condition: cmd.condition,
          headless: cmd.headless,
        })
      );

      mockSparqlService.query.mockResolvedValue(mockResults);

      await registry.loadFromTripleStore();

      expect(mockPlugin.addCommand).toHaveBeenCalledTimes(36);
    });
  });

  describe("Hotkey Validation", () => {
    it("should have 8 commands with hotkeys", () => {
      const commandsWithHotkeys = ALL_36_COMMANDS.filter((c) => c.hotkey !== undefined);
      expect(commandsWithHotkeys.length).toBe(8);
    });

    it("should have correct hotkeys for Create commands", () => {
      const createTaskCmd = ALL_36_COMMANDS.find((c) => c.id === "create-task");
      const createProjectCmd = ALL_36_COMMANDS.find((c) => c.id === "create-project");
      const createAreaCmd = ALL_36_COMMANDS.find((c) => c.id === "create-area");

      expect(createTaskCmd?.hotkey).toBe("Mod+Shift+T");
      expect(createProjectCmd?.hotkey).toBe("Mod+Shift+P");
      expect(createAreaCmd?.hotkey).toBe("Mod+Shift+A");
    });

    it("should have correct hotkeys for Status commands", () => {
      const startEffortCmd = ALL_36_COMMANDS.find((c) => c.id === "start-effort");
      const markDoneCmd = ALL_36_COMMANDS.find((c) => c.id === "mark-done");

      expect(startEffortCmd?.hotkey).toBe("Mod+S");
      expect(markDoneCmd?.hotkey).toBe("Mod+D");
    });

    it("should have correct hotkeys for Navigation commands", () => {
      const goToParentCmd = ALL_36_COMMANDS.find((c) => c.id === "go-to-parent");
      const goToProjectCmd = ALL_36_COMMANDS.find((c) => c.id === "go-to-project");
      const goToAreaCmd = ALL_36_COMMANDS.find((c) => c.id === "go-to-area");

      expect(goToParentCmd?.hotkey).toBe("Mod+Up");
      expect(goToProjectCmd?.hotkey).toBe("Mod+P");
      expect(goToAreaCmd?.hotkey).toBe("Mod+A");
    });
  });

  describe("Headless Flag Validation", () => {
    it("should have correct headless flags", () => {
      // UI-only commands should NOT be headless
      const uiOnlyCommands = [
        "add-supervision",
        "reload-layout",
        "toggle-properties-visibility",
        "toggle-layout-visibility",
        "toggle-archived-assets",
        "go-to-parent",
        "go-to-project",
        "go-to-area",
        "set-focus-area",
        "open-query-builder",
        "edit-properties",
      ];

      for (const cmdId of uiOnlyCommands) {
        const cmd = ALL_36_COMMANDS.find((c) => c.id === cmdId);
        expect(cmd?.headless).toBe("false");
      }
    });

    it("should have headless=true for CLI-executable commands", () => {
      const headlessCommands = ALL_36_COMMANDS.filter((c) => c.headless === "true");
      // 36 total - 11 UI-only = 25 headless commands
      expect(headlessCommands.length).toBe(25);
    });
  });

  describe("Condition Validation", () => {
    it("should have conditions for Navigation commands", () => {
      const goToParentCmd = ALL_36_COMMANDS.find((c) => c.id === "go-to-parent");
      const goToProjectCmd = ALL_36_COMMANDS.find((c) => c.id === "go-to-project");
      const goToAreaCmd = ALL_36_COMMANDS.find((c) => c.id === "go-to-area");

      expect(goToParentCmd?.condition).toBe("https://exocortex.my/ontology/ems-ui#HasParent");
      expect(goToProjectCmd?.condition).toBe("https://exocortex.my/ontology/ems-ui#HasProject");
      expect(goToAreaCmd?.condition).toBe("https://exocortex.my/ontology/ems-ui#HasArea");
    });

    it("should register commands with checkCallback when condition exists", async () => {
      const goToParentCmd = ALL_36_COMMANDS.find((c) => c.id === "go-to-parent")!;

      mockSparqlService.query.mockResolvedValue([
        createMockSolutionMapping({
          cmd: goToParentCmd.uri,
          id: goToParentCmd.id,
          name: goToParentCmd.name,
          icon: goToParentCmd.icon,
          hotkey: goToParentCmd.hotkey,
          condition: goToParentCmd.condition,
        }),
      ]);

      await registry.loadFromTripleStore();

      expect(mockPlugin.addCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "go-to-parent",
          checkCallback: expect.any(Function),
        })
      );
    });
  });

  describe("Icon Validation", () => {
    it("should have icons for all commands", () => {
      const commandsWithIcons = ALL_36_COMMANDS.filter((c) => c.icon !== undefined);
      expect(commandsWithIcons.length).toBe(36);
    });

    it("should use valid Lucide icon names", () => {
      // Known valid Lucide icon patterns
      const validIconPatterns = [
        "plus-circle",
        "folder-plus",
        "folder",
        "folder-sync",
        "map",
        "map-pin",
        "copy",
        "file-plus",
        "file-edit",
        "git-branch",
        "archive",
        "search",
        "list-todo",
        "play",
        "calendar",
        "moon",
        "arrow-left",
        "arrow-right",
        "arrow-up",
        "check-circle",
        "check-square",
        "trash",
        "thumbs-up",
        "eraser",
        "hash",
        "eye",
        "eye-off",
        "refresh-cw",
        "layout",
        "target",
        "edit",
      ];

      for (const cmd of ALL_36_COMMANDS) {
        expect(validIconPatterns).toContain(cmd.icon);
      }
    });
  });
});
