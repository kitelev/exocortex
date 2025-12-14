import { CreateProjectCommand } from "../../src/application/commands/CreateProjectCommand";
import { App, TFile, Notice, WorkspaceLeaf } from "obsidian";
import {
  ProjectCreationService,
  CommandVisibilityContext,
  LoggingService,
} from "exocortex";
import { LabelInputModal } from "../../src/presentation/modals/LabelInputModal";
import { ObsidianVaultAdapter } from "../../src/adapters/ObsidianVaultAdapter";
import { flushPromises, waitForCondition } from "./helpers/testHelpers";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Notice: jest.fn(),
}));
jest.mock("../../src/presentation/modals/LabelInputModal");
jest.mock("exocortex", () => ({
  ...jest.requireActual("exocortex"),
  canCreateProject: jest.fn(),
  LoggingService: {
    error: jest.fn(),
  },
}));

describe("CreateProjectCommand", () => {
  let command: CreateProjectCommand;
  let mockApp: jest.Mocked<App>;
  let mockProjectCreationService: jest.Mocked<ProjectCreationService>;
  let mockVaultAdapter: jest.Mocked<ObsidianVaultAdapter>;
  let mockFile: jest.Mocked<TFile>;
  let mockContext: CommandVisibilityContext;
  let mockLeaf: jest.Mocked<WorkspaceLeaf>;
  let mockTFile: jest.Mocked<TFile>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock leaf
    mockLeaf = {
      openFile: jest.fn(),
    } as unknown as jest.Mocked<WorkspaceLeaf>;

    // Create mock TFile for created file
    mockTFile = {
      path: "new-project.md",
      basename: "new-project",
    } as jest.Mocked<TFile>;

    // Create mock app
    mockApp = {
      workspace: {
        getLeaf: jest.fn().mockReturnValue(mockLeaf),
        setActiveLeaf: jest.fn(),
        getActiveFile: jest.fn().mockReturnValue(mockTFile),
      },
      metadataCache: {
        getFileCache: jest.fn().mockReturnValue({
          frontmatter: { exo__Instance_class: "ProjectClass" },
        }),
      },
    } as unknown as jest.Mocked<App>;

    // Create mock services
    mockProjectCreationService = {
      createProject: jest.fn(),
    } as unknown as jest.Mocked<ProjectCreationService>;

    mockVaultAdapter = {
      toTFile: jest.fn().mockReturnValue(mockTFile),
    } as unknown as jest.Mocked<ObsidianVaultAdapter>;

    // Create mock file
    mockFile = {
      path: "test-file.md",
      basename: "test-file",
    } as jest.Mocked<TFile>;

    // Create mock context
    mockContext = {
      instanceClass: "Project",
      status: "Active",
      archived: false,
      isDraft: false,
    };

    // Create command instance
    command = new CreateProjectCommand(mockApp, mockProjectCreationService, mockVaultAdapter);
  });

  describe("id and name", () => {
    it("should have correct id and name", () => {
      expect(command.id).toBe("create-project");
      expect(command.name).toBe("Create project");
    });
  });

  describe("checkCallback", () => {
    const mockCanCreateProject = require("exocortex").canCreateProject;

    it("should return false when context is null", () => {
      const result = command.checkCallback(true, mockFile, null);
      expect(result).toBe(false);
      expect(mockProjectCreationService.createProject).not.toHaveBeenCalled();
    });

    it("should return false when canCreateProject returns false", () => {
      mockCanCreateProject.mockReturnValue(false);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(false);
      expect(mockProjectCreationService.createProject).not.toHaveBeenCalled();
    });

    it("should return true when canCreateProject returns true and checking is true", () => {
      mockCanCreateProject.mockReturnValue(true);
      const result = command.checkCallback(true, mockFile, mockContext);
      expect(result).toBe(true);
      expect(mockProjectCreationService.createProject).not.toHaveBeenCalled();
    });

    it("should execute command when checking is false and canCreateProject returns true", async () => {
      mockCanCreateProject.mockReturnValue(true);
      const createdFile = { basename: "new-project", path: "new-project.md" };
      mockProjectCreationService.createProject.mockResolvedValue(createdFile as any);

      // Mock modal to return label
      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test Project", taskSize: null }), 0);
        }),
      }));

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      expect(LabelInputModal).toHaveBeenCalledWith(
        mockApp,
        expect.any(Function)
      );
      expect(mockProjectCreationService.createProject).toHaveBeenCalledWith(
        mockFile,
        { exo__Instance_class: "ProjectClass" },
        "ProjectClass",
        "Test Project"
      );
      expect(mockVaultAdapter.toTFile).toHaveBeenCalledWith(createdFile);
      expect(mockLeaf.openFile).toHaveBeenCalledWith(mockTFile);
      expect(mockApp.workspace.setActiveLeaf).toHaveBeenCalledWith(mockLeaf, { focus: true });
      expect(Notice).toHaveBeenCalledWith("Project created: new-project");
    });

    it("should handle modal cancellation", async () => {
      mockCanCreateProject.mockReturnValue(true);

      // Mock modal to return null (cancelled)
      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: null, taskSize: null }), 0);
        }),
      }));

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      expect(LabelInputModal).toHaveBeenCalled();
      expect(mockProjectCreationService.createProject).not.toHaveBeenCalled();
      expect(Notice).not.toHaveBeenCalled();
    });

    it("should handle service error and show error notice", async () => {
      mockCanCreateProject.mockReturnValue(true);
      const error = new Error("Failed to create project");
      mockProjectCreationService.createProject.mockRejectedValue(error);

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test Project", taskSize: null }), 0);
        }),
      }));

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      expect(mockProjectCreationService.createProject).toHaveBeenCalled();
      expect(LoggingService.error).toHaveBeenCalledWith("Create project error", error);
      expect(Notice).toHaveBeenCalledWith("Failed to create project: Failed to create project");
    });

    it("should handle array instanceClass", async () => {
      mockCanCreateProject.mockReturnValue(true);
      const createdFile = { basename: "new-project", path: "new-project.md" };
      mockProjectCreationService.createProject.mockResolvedValue(createdFile as any);

      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
        frontmatter: { exo__Instance_class: ["ProjectClass", "OtherClass"] },
      });

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "My Project", taskSize: null }), 0);
        }),
      }));

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      expect(mockProjectCreationService.createProject).toHaveBeenCalledWith(
        mockFile,
        { exo__Instance_class: ["ProjectClass", "OtherClass"] },
        "ProjectClass", // First class in array
        "My Project"
      );
      expect(Notice).toHaveBeenCalledWith("Project created: new-project");
    });

    it("should handle missing exo__Instance_class in metadata", async () => {
      mockCanCreateProject.mockReturnValue(true);
      const createdFile = { basename: "new-project", path: "new-project.md" };
      mockProjectCreationService.createProject.mockResolvedValue(createdFile as any);

      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({
        frontmatter: { otherProp: "value" },
      });

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test", taskSize: null }), 0);
        }),
      }));

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      expect(mockProjectCreationService.createProject).toHaveBeenCalledWith(
        mockFile,
        { otherProp: "value" },
        undefined, // No exo__Instance_class
        "Test"
      );
      expect(Notice).toHaveBeenCalledWith("Project created: new-project");
    });

    it("should wait for file to become active", async () => {
      mockCanCreateProject.mockReturnValue(true);
      const createdFile = { basename: "new-project", path: "new-project.md" };
      mockProjectCreationService.createProject.mockResolvedValue(createdFile as any);

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test", taskSize: null }), 0);
        }),
      }));

      // Simulate file becoming active after 3 attempts
      let attempts = 0;
      mockApp.workspace.getActiveFile = jest.fn(() => {
        attempts++;
        return attempts >= 3 ? mockTFile : null;
      });

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await waitForCondition(() => (mockApp.workspace.getActiveFile as jest.Mock).mock.calls.length >= 3);

      expect(mockApp.workspace.getActiveFile).toHaveBeenCalledTimes(3);
      expect(Notice).toHaveBeenCalledWith("Project created: new-project");
    });

    it("should handle missing frontmatter metadata", async () => {
      mockCanCreateProject.mockReturnValue(true);
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue({});
      const createdFile = { basename: "new-project", path: "new-project.md" };
      mockProjectCreationService.createProject.mockResolvedValue(createdFile as any);

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test", taskSize: null }), 0);
        }),
      }));

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      expect(mockProjectCreationService.createProject).toHaveBeenCalledWith(
        mockFile,
        {}, // Empty metadata
        undefined,
        "Test"
      );
      expect(Notice).toHaveBeenCalledWith("Project created: new-project");
    });

    it("should handle null cache from metadataCache", async () => {
      mockCanCreateProject.mockReturnValue(true);
      mockApp.metadataCache.getFileCache = jest.fn().mockReturnValue(null);
      const createdFile = { basename: "new-project", path: "new-project.md" };
      mockProjectCreationService.createProject.mockResolvedValue(createdFile as any);

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test", taskSize: null }), 0);
        }),
      }));

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      await flushPromises();

      expect(mockProjectCreationService.createProject).toHaveBeenCalledWith(
        mockFile,
        {}, // Empty metadata
        undefined,
        "Test"
      );
      expect(Notice).toHaveBeenCalledWith("Project created: new-project");
    });

    it("should timeout after max attempts waiting for file", async () => {
      mockCanCreateProject.mockReturnValue(true);
      const createdFile = { basename: "new-project", path: "new-project.md" };
      mockProjectCreationService.createProject.mockResolvedValue(createdFile as any);

      (LabelInputModal as jest.Mock).mockImplementation((app, callback) => ({
        open: jest.fn(() => {
          setTimeout(() => callback({ label: "Test", taskSize: null }), 0);
        }),
      }));

      // File never becomes active
      mockApp.workspace.getActiveFile = jest.fn().mockReturnValue(null);

      const result = command.checkCallback(false, mockFile, mockContext);
      expect(result).toBe(true);

      // Wait for polling loop to complete (20 attempts × 100ms = 2000ms + buffer)
      await waitForCondition(
        () => (Notice as jest.Mock).mock.calls.length > 0,
        { timeout: 5000, interval: 100 }
      );

      // Should still complete successfully even if file doesn't become active
      expect(mockApp.workspace.getActiveFile).toHaveBeenCalledTimes(20); // max attempts
      expect(Notice).toHaveBeenCalledWith("Project created: new-project");
    });
  });
});