import * as commandsIndex from "../../src/application/commands/index";

describe("Commands Index Exports", () => {
  it("should export ICommand type", () => {
    // Type exports are compile-time only, but we can verify the module exports exist
    expect(commandsIndex).toBeDefined();
  });

  it("should export CommandRegistry class", () => {
    expect(commandsIndex.CommandRegistry).toBeDefined();
    expect(typeof commandsIndex.CommandRegistry).toBe("function");
  });

  it("should export all command classes", () => {
    const expectedCommands = [
      "CreateTaskCommand",
      "CreateProjectCommand",
      "CreateInstanceCommand",
      "CreateRelatedTaskCommand",
      "SetDraftStatusCommand",
      "MoveToBacklogCommand",
      "MoveToAnalysisCommand",
      "MoveToToDoCommand",
      "StartEffortCommand",
      "PlanOnTodayCommand",
      "PlanForEveningCommand",
      "ShiftDayBackwardCommand",
      "ShiftDayForwardCommand",
      "MarkDoneCommand",
      "MarkReviewedCommand",
      "TrashEffortCommand",
      "ArchiveTaskCommand",
      "CleanPropertiesCommand",
      "RepairFolderCommand",
      "RenameToUidCommand",
      "VoteOnEffortCommand",
      "CopyLabelToAliasesCommand",
      "AddSupervisionCommand",
      "ReloadLayoutCommand",
      "ToggleLayoutVisibilityCommand",
      "ToggleArchivedAssetsCommand",
    ];

    expectedCommands.forEach((commandName) => {
      expect(commandsIndex[commandName]).toBeDefined();
      expect(typeof commandsIndex[commandName]).toBe("function");
      // Verify it's a constructor (class)
      expect(commandsIndex[commandName].prototype).toBeDefined();
    });
  });

  it("should export exactly 27 command classes and 1 registry", () => {
    // Filter out type exports (which don't appear at runtime)
    const exports = Object.keys(commandsIndex);
    const commandClasses = exports.filter((key) => key.endsWith("Command"));
    const registryClasses = exports.filter((key) => key.endsWith("Registry"));

    expect(commandClasses.length).toBe(26); // All commands
    expect(registryClasses.length).toBe(1); // CommandRegistry
    expect(exports.length).toBe(27); // Total exports (excluding ICommand type)
  });

  it("should have all exported classes be constructable", () => {
    const exports = Object.keys(commandsIndex);
    exports.forEach((exportName) => {
      const exportedItem = commandsIndex[exportName];
      if (typeof exportedItem === "function") {
        // Check if it has a constructor
        expect(exportedItem.prototype).toBeDefined();
        expect(exportedItem.prototype.constructor).toBe(exportedItem);
      }
    });
  });
});