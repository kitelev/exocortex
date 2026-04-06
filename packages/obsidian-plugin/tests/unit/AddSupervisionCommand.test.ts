import { AddSupervisionCommand } from "../../src/application/commands/AddSupervisionCommand";
import { App, Notice, TFile } from "obsidian";
import { SupervisionCreationService, LoggingService } from "exocortex";
import { showSupervisionModal } from "../../src/presentation/modals/modalSchemas";
import { ObsidianVaultAdapter } from "../../src/adapters/ObsidianVaultAdapter";
import { CommandHelpers } from "../../src/application/commands/helpers/CommandHelpers";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Notice: jest.fn(),
}));
jest.mock("../../src/presentation/modals/modalSchemas");
jest.mock("exocortex", () => ({
  ...jest.requireActual("exocortex"),
  LoggingService: {
    error: jest.fn(),
  },
}));

const mockShowSupervisionModal = showSupervisionModal as jest.MockedFunction<typeof showSupervisionModal>;

describe("AddSupervisionCommand", () => {
  let command: AddSupervisionCommand;
  let mockNotifier: any;
  let mockApp: jest.Mocked<App>;
  let mockSupervisionCreationService: jest.Mocked<SupervisionCreationService>;
  let mockVaultAdapter: jest.Mocked<ObsidianVaultAdapter>;
  let mockTFile: jest.Mocked<TFile>;
  let openFileSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    mockTFile = {
      path: "test-supervision.md",
      basename: "test-supervision",
    } as jest.Mocked<TFile>;

    mockApp = {
      workspace: {},
    } as unknown as jest.Mocked<App>;

    mockSupervisionCreationService = {
      createSupervision: jest.fn(),
    } as unknown as jest.Mocked<SupervisionCreationService>;

    mockVaultAdapter = {
      toTFile: jest.fn().mockReturnValue(mockTFile),
    } as unknown as jest.Mocked<ObsidianVaultAdapter>;

    openFileSpy = jest
      .spyOn(CommandHelpers, "openFileInNewTab")
      .mockResolvedValue(undefined);

    mockNotifier = { info: jest.fn(), success: jest.fn(), error: jest.fn(), warn: jest.fn(), confirm: jest.fn() };
    command = new AddSupervisionCommand(mockApp, mockSupervisionCreationService, mockVaultAdapter, mockNotifier);
  });

  afterEach(() => {
    openFileSpy.mockRestore();
  });

  describe("id and name", () => {
    it("should have correct id and name", () => {
      expect(command.id).toBe("add-supervision");
      expect(command.name).toBe("Add supervision");
    });
  });

  describe("callback", () => {
    it("should create supervision and open file when modal is submitted", async () => {
      const formData = {
        situation: "Test",
        emotions: "",
        thoughts: "",
        behavior: "",
        shortTermConsequences: "",
        longTermConsequences: "",
        desiredBehavior: "",
      };
      const createdFile = { basename: "test-supervision", path: "test-supervision.md" };

      mockShowSupervisionModal.mockResolvedValue(formData);
      mockSupervisionCreationService.createSupervision.mockResolvedValue(createdFile as any);

      await command.callback();

      expect(mockShowSupervisionModal).toHaveBeenCalledWith(mockApp);
      expect(mockSupervisionCreationService.createSupervision).toHaveBeenCalledWith(formData);
      expect(mockVaultAdapter.toTFile).toHaveBeenCalledWith(createdFile);
      expect(openFileSpy).toHaveBeenCalledWith(mockApp, mockTFile);
      expect(mockNotifier.success).toHaveBeenCalledWith("Supervision created: test-supervision");
    });

    it("should handle modal cancellation", async () => {
      mockShowSupervisionModal.mockResolvedValue(null);

      await command.callback();

      expect(mockShowSupervisionModal).toHaveBeenCalled();
      expect(mockSupervisionCreationService.createSupervision).not.toHaveBeenCalled();
      expect(mockNotifier.success).not.toHaveBeenCalled();
    });

    it("should handle service error and show error notice", async () => {
      const formData = {
        situation: "Test",
        emotions: "",
        thoughts: "",
        behavior: "",
        shortTermConsequences: "",
        longTermConsequences: "",
        desiredBehavior: "",
      };
      const error = new Error("Failed to create file");

      mockShowSupervisionModal.mockResolvedValue(formData);
      mockSupervisionCreationService.createSupervision.mockRejectedValue(error);

      await command.callback();

      expect(mockSupervisionCreationService.createSupervision).toHaveBeenCalledWith(formData);
      expect(LoggingService.error).toHaveBeenCalledWith("Add supervision error", error);
      expect(mockNotifier.error).toHaveBeenCalledWith("Failed to create supervision: Failed to create file");
    });
  });
});
