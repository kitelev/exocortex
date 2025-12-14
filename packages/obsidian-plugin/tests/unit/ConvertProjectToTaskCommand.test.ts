import { flushPromises } from "./helpers/testHelpers";
import { ConvertProjectToTaskCommand } from "../../src/application/commands/ConvertProjectToTaskCommand";
import { AssetConversionService } from "exocortex";
import { ObsidianVaultAdapter } from "../../src/adapters/ObsidianVaultAdapter";
import { TFile } from "obsidian";
import type { CommandVisibilityContext } from "exocortex";

describe("ConvertProjectToTaskCommand", () => {
  let command: ConvertProjectToTaskCommand;
  let mockConversionService: jest.Mocked<AssetConversionService>;
  let mockVaultAdapter: jest.Mocked<ObsidianVaultAdapter>;
  let mockFile: TFile;

  beforeEach(() => {
    mockConversionService = {
      convertTaskToProject: jest.fn(),
      convertProjectToTask: jest.fn(),
    } as any;

    mockVaultAdapter = {} as any;

    mockFile = {
      path: "test-project.md",
      basename: "test-project",
      parent: null,
    } as TFile;

    command = new ConvertProjectToTaskCommand(
      mockConversionService,
    );
  });

  describe("id and name", () => {
    it("should have correct id", () => {
      expect(command.id).toBe("convert-project-to-task");
    });

    it("should have correct name", () => {
      expect(command.name).toBe("Convert Project to Task");
    });
  });

  describe("checkCallback", () => {
    it("should return false if context is null", () => {
      const result = command.checkCallback(true, mockFile, null);
      expect(result).toBe(false);
    });

    it("should return false if instanceClass is not ems__Project", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };

      const result = command.checkCallback(true, mockFile, context);
      expect(result).toBe(false);
    });

    it("should return true if instanceClass is ems__Project", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Project]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };

      const result = command.checkCallback(true, mockFile, context);
      expect(result).toBe(true);
    });

    it("should execute conversion when checking is false", async () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Project]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };

      mockConversionService.convertProjectToTask.mockResolvedValue(mockFile as any);

      const result = command.checkCallback(false, mockFile, context);

      // Wait for async execution
      await flushPromises();

      expect(result).toBe(true);
      expect(mockConversionService.convertProjectToTask).toHaveBeenCalledWith(mockFile);
    });

    it("should handle conversion errors gracefully", async () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Project]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };

      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
      mockConversionService.convertProjectToTask.mockRejectedValue(
        new Error("Conversion failed"),
      );

      command.checkCallback(false, mockFile, context);

      // Wait for async execution
      await flushPromises();

      consoleErrorSpy.mockRestore();
    });
  });
});
