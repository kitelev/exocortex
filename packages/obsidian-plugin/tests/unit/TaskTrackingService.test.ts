import { TaskTrackingService } from "../../src/application/services/TaskTrackingService";
import type { App, TFile, Vault, MetadataCache } from "obsidian";
import * as obsidian from "obsidian";

// Mock uuid
jest.mock("uuid", () => ({
  v4: jest.fn(() => "mock-uuid-1234"),
}));

// Mock Platform from obsidian module
jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Platform: undefined // Default to undefined, will be overridden in tests
}));

describe("TaskTrackingService", () => {
  let service: TaskTrackingService;
  let mockApp: App;
  let mockVault: Vault;
  let mockMetadataCache: MetadataCache;
  let consoleWarnSpy: jest.SpyInstance;
  let windowOpenSpy: jest.SpyInstance;

  beforeEach(() => {
    mockVault = {
      getName: jest.fn().mockReturnValue("TestVault"),
      read: jest.fn(),
      modify: jest.fn(),
    } as unknown as Vault;

    mockMetadataCache = {
      getFileCache: jest.fn(),
    } as unknown as MetadataCache;

    mockApp = {
      vault: mockVault,
    } as unknown as App;

    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation();
    windowOpenSpy = jest.spyOn(window, "open").mockImplementation();

    service = new TaskTrackingService(mockApp, mockVault, mockMetadataCache);
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    windowOpenSpy.mockRestore();
  });

  describe("initialization", () => {
    it("should create TaskTrackingService instance", () => {
      expect(service).toBeDefined();
    });

    it("should be an instance of TaskTrackingService", () => {
      expect(service).toBeInstanceOf(TaskTrackingService);
    });

    it("should initialize with null current task", () => {
      expect(service.getCurrentTask()).toBeNull();
    });
  });

  describe("public API", () => {
    it("should have registerListener method", () => {
      expect(typeof service.registerListener).toBe("function");
    });

    it("should have handleFileChange method", () => {
      expect(typeof service.handleFileChange).toBe("function");
    });

    it("should have getCurrentTask method", () => {
      expect(typeof service.getCurrentTask).toBe("function");
    });

    it("should have clearCurrentTask method", () => {
      expect(typeof service.clearCurrentTask).toBe("function");
    });
  });

  describe("registerListener", () => {
    it("should not throw when called", () => {
      expect(() => service.registerListener()).not.toThrow();
    });
  });

  describe("handleFileChange", () => {
    const mockFile = {
      path: "test.md",
      basename: "test"
    } as TFile;

    it("should handle file with no frontmatter", async () => {
      (mockMetadataCache.getFileCache as jest.Mock).mockReturnValue(null);

      await service.handleFileChange(mockFile);

      expect(mockMetadataCache.getFileCache).toHaveBeenCalledWith(mockFile);
      expect(mockVault.read).not.toHaveBeenCalled();
    });

    it("should handle file with empty frontmatter", async () => {
      (mockMetadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {}
      });

      await service.handleFileChange(mockFile);

      expect(mockMetadataCache.getFileCache).toHaveBeenCalledWith(mockFile);
      expect(mockVault.read).not.toHaveBeenCalled();
    });

    it("should handle file with non-DOING status", async () => {
      (mockMetadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          Status: "ems__EffortStatusDone"
        }
      });

      await service.handleFileChange(mockFile);

      expect(mockMetadataCache.getFileCache).toHaveBeenCalledWith(mockFile);
      expect(mockVault.read).not.toHaveBeenCalled();
    });

    it("should handle file with DOING status (plain)", async () => {
      (mockMetadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          Status: "ems__EffortStatusDoing",
          Title: "Test Task"
        }
      });
      (mockVault.read as jest.Mock).mockResolvedValue("---\nStatus: ems__EffortStatusDoing\n---\nContent");

      await service.handleFileChange(mockFile);

      expect(mockMetadataCache.getFileCache).toHaveBeenCalledWith(mockFile);
      expect(windowOpenSpy).toHaveBeenCalled();
    });

    it("should handle file with DOING status (wiki link)", async () => {
      (mockMetadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          Status: "[[ems__EffortStatusDoing]]",
          TaskId: "existing-task-id",
          Title: "Test Task"
        }
      });

      await service.handleFileChange(mockFile);

      expect(mockMetadataCache.getFileCache).toHaveBeenCalledWith(mockFile);
      expect(windowOpenSpy).toHaveBeenCalled();
    });

    it("should handle file with DOING status but no TaskId", async () => {
      (mockMetadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          Status: "ems__EffortStatusDoing"
        }
      });
      (mockVault.read as jest.Mock).mockResolvedValue("---\nStatus: ems__EffortStatusDoing\n---\nContent");
      (mockVault.modify as jest.Mock).mockResolvedValue(undefined);

      await service.handleFileChange(mockFile);

      expect(mockVault.modify).toHaveBeenCalled();
      expect(windowOpenSpy).toHaveBeenCalled();
    });

    it("should handle file without frontmatter start marker", async () => {
      (mockMetadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          Status: "ems__EffortStatusDoing"
        }
      });
      (mockVault.read as jest.Mock).mockResolvedValue("No frontmatter here");

      await service.handleFileChange(mockFile);

      expect(mockVault.modify).not.toHaveBeenCalled();
    });

    it("should handle file with malformed frontmatter", async () => {
      (mockMetadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          Status: "ems__EffortStatusDoing"
        }
      });
      (mockVault.read as jest.Mock).mockResolvedValue("---\nStatus: ems__EffortStatusDoing\nNo closing marker");

      await service.handleFileChange(mockFile);

      expect(mockVault.modify).not.toHaveBeenCalled();
    });

    it("should handle error during file processing", async () => {
      (mockMetadataCache.getFileCache as jest.Mock).mockImplementation(() => {
        throw new Error("Test error");
      });

      await expect(service.handleFileChange(mockFile)).resolves.not.toThrow();
    });
  });

  describe("getCurrentTask and clearCurrentTask", () => {
    it("should return null initially", () => {
      expect(service.getCurrentTask()).toBeNull();
    });

    it("should clear current task", () => {
      service.clearCurrentTask();
      expect(service.getCurrentTask()).toBeNull();
    });

    it("should track current task after processing DOING status", async () => {
      const mockFile = {
        path: "test.md",
        basename: "test"
      } as TFile;

      (mockMetadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          Status: "ems__EffortStatusDoing",
          TaskId: "test-task-id",
          Title: "Test Task"
        }
      });

      await service.handleFileChange(mockFile);

      const currentTask = service.getCurrentTask();
      expect(currentTask).not.toBeNull();
      expect(currentTask?.taskId).toBe("test-task-id");
      expect(currentTask?.title).toBe("Test Task");

      service.clearCurrentTask();
      expect(service.getCurrentTask()).toBeNull();
    });
  });

  describe("Platform detection", () => {
    it.skip("should warn when not on iOS", async () => {
      // Mock Platform as desktop
      (obsidian as any).Platform = { isIOS: false };

      const mockFile = {
        path: "test.md",
        basename: "test"
      } as TFile;

      (mockMetadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          Status: "ems__EffortStatusDoing",
          TaskId: "test-task-id",
          Title: "Test Task"
        }
      });

      await service.handleFileChange(mockFile);

      expect(windowOpenSpy).not.toHaveBeenCalled();

      (obsidian as any).Platform = undefined;
    });

    it.skip("should launch app when on iOS", async () => {
      // Mock Platform as iOS
      (obsidian as any).Platform = { isIOS: true };

      const mockFile = {
        path: "test.md",
        basename: "test"
      } as TFile;

      (mockMetadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          Status: "ems__EffortStatusDoing",
          TaskId: "test-task-id",
          Title: "Test Task"
        }
      });

      await service.handleFileChange(mockFile);

      expect(windowOpenSpy).toHaveBeenCalled();

      (obsidian as any).Platform = undefined;
    });
  });

  describe("URL building", () => {
    it.skip("should build correct callback URL", async () => {
      // Platform is already undefined by default (which allows window.open to be called)

      const mockFile = {
        path: "folder/test file.md",
        basename: "test file"
      } as TFile;

      (mockVault.getName as jest.Mock).mockReturnValue("My Vault");
      (mockMetadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          Status: "ems__EffortStatusDoing",
          TaskId: "test-task-id",
          Title: "Test Task"
        }
      });

      await service.handleFileChange(mockFile);

      expect(windowOpenSpy).toHaveBeenCalledWith(
        expect.stringContaining("exocortex://task/start"),
        "_blank"
      );

      const callUrl = windowOpenSpy.mock.calls[0][0] as string;
      expect(callUrl).toContain("taskId=test-task-id");
      expect(callUrl).toContain("title=Test+Task");
      expect(callUrl).toContain("x-success=");
      expect(callUrl).toContain("vault=My%20Vault");
      expect(callUrl).toContain("filepath=folder%2Ftest%20file.md");
    });
  });
});