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
      "CreateInstanceCommand",
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

  it("should export command classes and registry", () => {
    const exports = Object.keys(commandsIndex);
    const commandClasses = exports.filter((key) => key.endsWith("Command"));
    const registryClasses = exports.filter((key) => key.endsWith("Registry"));

    expect(commandClasses.length).toBe(11); // 10 commands + BaseContextAssetCreationCommand
    expect(registryClasses.length).toBe(1); // CommandRegistry
    expect(exports.length).toBe(12); // Total exports (excluding ICommand type)
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
