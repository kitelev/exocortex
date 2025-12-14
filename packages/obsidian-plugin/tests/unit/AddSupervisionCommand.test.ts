import { AddSupervisionCommand } from "../../src/application/commands/AddSupervisionCommand";
import { App, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { SupervisionCreationService, LoggingService } from "exocortex";
import { SupervisionInputModal } from "../../src/presentation/modals/SupervisionInputModal";
import { ObsidianVaultAdapter } from "../../src/adapters/ObsidianVaultAdapter";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Notice: jest.fn(),
}));
jest.mock("../../src/presentation/modals/SupervisionInputModal");
jest.mock("exocortex", () => ({
  ...jest.requireActual("exocortex"),
  LoggingService: {
    error: jest.fn(),
  },
}));

describe("AddSupervisionCommand", () => {
  let command: AddSupervisionCommand;
  let mockApp: jest.Mocked<App>;
  let mockSupervisionCreationService: jest.Mocked<SupervisionCreationService>;
  let mockVaultAdapter: jest.Mocked<ObsidianVaultAdapter>;
  let mockLeaf: jest.Mocked<WorkspaceLeaf>;
  let mockTFile: jest.Mocked<TFile>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock leaf
    mockLeaf = {
      openFile: jest.fn(),
    } as unknown as jest.Mocked<WorkspaceLeaf>;

    // Create mock TFile
    mockTFile = {
      path: "test-supervision.md",
      basename: "test-supervision",
    } as jest.Mocked<TFile>;

    // Create mock app
    mockApp = {
      workspace: {
        getLeaf: jest.fn().mockReturnValue(mockLeaf),
        setActiveLeaf: jest.fn(),
        getActiveFile: jest.fn().mockReturnValue(mockTFile),
      },
    } as unknown as jest.Mocked<App>;

    // Create mock services
    mockSupervisionCreationService = {
      createSupervision: jest.fn(),
    } as unknown as jest.Mocked<SupervisionCreationService>;

    mockVaultAdapter = {
      toTFile: jest.fn().mockReturnValue(mockTFile),
    } as unknown as jest.Mocked<ObsidianVaultAdapter>;

    // Create command instance
    command = new AddSupervisionCommand(mockApp, mockSupervisionCreationService, mockVaultAdapter);
  });

  describe("id and name", () => {
    it("should have correct id and name", () => {
      expect(command.id).toBe("add-supervision");
      expect(command.name).toBe("Add supervision");
    });
  });

  describe("callback", () => {
    it("should create supervision and open file when modal is submitted", async () => {
      const formData = { title: "Test Supervision", date: "2024-01-01" };
      const createdFile = { basename: "test-supervision", path: "test-supervision.md" };

      // Mock modal to resolve with form data
      (SupervisionInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback(formData), 0);
        }),
      }));

      mockSupervisionCreationService.createSupervision.mockResolvedValue(createdFile as any);

      await command.callback();

      expect(SupervisionInputModal).toHaveBeenCalledWith(mockApp, expect.any(Function));
      expect(mockSupervisionCreationService.createSupervision).toHaveBeenCalledWith(formData);
      expect(mockVaultAdapter.toTFile).toHaveBeenCalledWith(createdFile);
      expect(mockLeaf.openFile).toHaveBeenCalledWith(mockTFile);
      expect(mockApp.workspace.setActiveLeaf).toHaveBeenCalledWith(mockLeaf, { focus: true });
      expect(Notice).toHaveBeenCalledWith("Supervision created: test-supervision");
    });

    it("should handle modal cancellation", async () => {
      // Mock modal to resolve with null (cancelled)
      (SupervisionInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback(null), 0);
        }),
      }));

      await command.callback();

      expect(SupervisionInputModal).toHaveBeenCalled();
      expect(mockSupervisionCreationService.createSupervision).not.toHaveBeenCalled();
      expect(Notice).not.toHaveBeenCalled();
    });

    it("should handle service error and show error notice", async () => {
      const formData = { title: "Test Supervision" };
      const error = new Error("Failed to create file");

      (SupervisionInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback(formData), 0);
        }),
      }));

      mockSupervisionCreationService.createSupervision.mockRejectedValue(error);

      await command.callback();

      expect(mockSupervisionCreationService.createSupervision).toHaveBeenCalledWith(formData);
      expect(LoggingService.error).toHaveBeenCalledWith("Add supervision error", error);
      expect(Notice).toHaveBeenCalledWith("Failed to create supervision: Failed to create file");
    });

    it("should wait for file to become active", async () => {
      const formData = { title: "Test" };
      const createdFile = { basename: "test-supervision", path: "test-supervision.md" };

      (SupervisionInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback(formData), 0);
        }),
      }));

      mockSupervisionCreationService.createSupervision.mockResolvedValue(createdFile as any);

      // Simulate file becoming active after 3 attempts
      let attempts = 0;
      mockApp.workspace.getActiveFile = jest.fn(() => {
        attempts++;
        return attempts >= 3 ? mockTFile : null;
      });

      await command.callback();

      expect(mockApp.workspace.getActiveFile).toHaveBeenCalledTimes(3);
      expect(Notice).toHaveBeenCalledWith("Supervision created: test-supervision");
    });

    it("should handle workspace error", async () => {
      const formData = { title: "Test" };
      const createdFile = { basename: "test-supervision", path: "test-supervision.md" };

      (SupervisionInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback(formData), 0);
        }),
      }));

      mockSupervisionCreationService.createSupervision.mockResolvedValue(createdFile as any);
      mockLeaf.openFile.mockRejectedValue(new Error("Workspace error"));

      await command.callback();

      expect(LoggingService.error).toHaveBeenCalledWith("Add supervision error", expect.any(Error));
      expect(Notice).toHaveBeenCalledWith("Failed to create supervision: Workspace error");
    });

    it("should handle empty form data gracefully", async () => {
      const formData = {};
      const createdFile = { basename: "untitled-supervision", path: "untitled-supervision.md" };

      (SupervisionInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback(formData), 0);
        }),
      }));

      mockSupervisionCreationService.createSupervision.mockResolvedValue(createdFile as any);

      await command.callback();

      expect(mockSupervisionCreationService.createSupervision).toHaveBeenCalledWith(formData);
      expect(Notice).toHaveBeenCalledWith("Supervision created: untitled-supervision");
    });

    it("should timeout after max attempts waiting for file", async () => {
      const formData = { title: "Test" };
      const createdFile = { basename: "test-supervision", path: "test-supervision.md" };

      (SupervisionInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback(formData), 0);
        }),
      }));

      mockSupervisionCreationService.createSupervision.mockResolvedValue(createdFile as any);

      // File never becomes active
      mockApp.workspace.getActiveFile = jest.fn().mockReturnValue(null);

      await command.callback();

      // Should still complete successfully even if file doesn't become active
      expect(mockApp.workspace.getActiveFile).toHaveBeenCalledTimes(20); // max attempts
      expect(Notice).toHaveBeenCalledWith("Supervision created: test-supervision");
    });

    it("should handle modal error", async () => {
      const modalError = new Error("Modal failed to open");

      (SupervisionInputModal as jest.Mock).mockImplementation(() => ({
        open: jest.fn(() => {
          throw modalError;
        }),
      }));

      await command.callback();

      expect(LoggingService.error).toHaveBeenCalledWith("Add supervision error", modalError);
      expect(Notice).toHaveBeenCalledWith("Failed to create supervision: Modal failed to open");
    });
  });
});