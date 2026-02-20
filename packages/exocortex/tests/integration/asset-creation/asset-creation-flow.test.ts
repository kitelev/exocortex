/**
 * Integration tests for asset creation flow.
 *
 * These tests verify the complete flow: Configuration → Service → Vault → File
 * They use realistic data and scenarios to ensure all components work together.
 *
 * Issue #2187: Add integration tests for critical user paths
 */

import { GenericAssetCreationService } from "../../../src/services/GenericAssetCreationService";
import { PropertyFieldType } from "../../../src/domain/types/PropertyFieldType";
import { IVaultAdapter, IFile, IFolder } from "../../../src/interfaces/IVaultAdapter";

/**
 * In-memory vault adapter for integration testing.
 * Simulates a real vault with file creation and storage.
 */
class InMemoryVaultAdapter implements Partial<IVaultAdapter> {
  private files: Map<
    string,
    { content: string; metadata: Record<string, unknown> }
  > = new Map();
  private folders: Set<string> = new Set();

  async create(path: string, content: string): Promise<IFile> {
    this.files.set(path, { content, metadata: this.parseMetadata(content) });
    return this.createFileObject(path);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.folders.has(path);
  }

  getAbstractFileByPath(path: string): IFile | IFolder | null {
    if (this.files.has(path)) {
      return this.createFileObject(path);
    }
    if (this.folders.has(path)) {
      return { path, name: path.split("/").pop() || path } as IFolder;
    }
    return null;
  }

  async createFolder(path: string): Promise<void> {
    this.folders.add(path);
  }

  async read(file: IFile): Promise<string> {
    const entry = this.files.get(file.path);
    return entry?.content || "";
  }

  getStoredFiles(): Map<string, { content: string; metadata: Record<string, unknown> }> {
    return this.files;
  }

  getStoredFolders(): Set<string> {
    return this.folders;
  }

  private createFileObject(path: string): IFile {
    const name = path.split("/").pop() || path;
    const basename = name.replace(".md", "");
    const parentPath = path.split("/").slice(0, -1).join("/");
    return {
      path,
      name,
      basename,
      parent: parentPath
        ? { path: parentPath, name: parentPath.split("/").pop() || "" }
        : null,
    } as IFile;
  }

  private parseMetadata(content: string): Record<string, unknown> {
    // Simple YAML frontmatter parser
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};

    const frontmatter: Record<string, unknown> = {};
    const lines = match[1].split("\n");

    for (const line of lines) {
      const colonIndex = line.indexOf(":");
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim();
        let value: string | string[] = line.substring(colonIndex + 1).trim();

        // Handle array values (next lines starting with -)
        if (value === "") {
          const arrayValues: string[] = [];
          const keyIndex = lines.indexOf(line);
          for (let i = keyIndex + 1; i < lines.length; i++) {
            const nextLine = lines[i].trim();
            if (nextLine.startsWith("- ")) {
              arrayValues.push(nextLine.substring(2).trim());
            } else if (nextLine !== "") {
              break;
            }
          }
          if (arrayValues.length > 0) {
            value = arrayValues;
          }
        }

        frontmatter[key] = value;
      }
    }

    return frontmatter;
  }
}

describe("Asset Creation Flow (Integration)", () => {
  let vault: InMemoryVaultAdapter;
  let service: GenericAssetCreationService;

  beforeEach(() => {
    vault = new InMemoryVaultAdapter();
    service = new GenericAssetCreationService(vault as unknown as IVaultAdapter);
  });

  describe("Task Creation Flow", () => {
    it("should create task with all required frontmatter fields", async () => {
      // Arrange
      const config = {
        className: "ems__Task",
        label: "Implement feature X",
      };

      // Act
      const file = await service.createAsset(config);

      // Assert: File was created
      expect(file).toBeDefined();
      expect(file.path).toMatch(/^tasks\/[0-9a-f-]+\.md$/);

      // Assert: File content has valid frontmatter
      const storedFile = vault.getStoredFiles().get(file.path);
      expect(storedFile).toBeDefined();
      expect(storedFile!.content).toContain("---");

      // Assert: Required fields are present
      const metadata = storedFile!.metadata;
      expect(metadata["exo__Asset_uid"]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
      expect(metadata["exo__Asset_label"]).toBe("Implement feature X");
      expect(metadata["exo__Asset_createdAt"]).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/
      );
    });

    it("should create task with custom properties and persist to storage", async () => {
      // Arrange
      const config = {
        className: "ems__Task",
        label: "Bug fix task",
        propertyValues: {
          ems__Effort_taskSize: '"[[ems__TaskSize_M]]"',
          ems__Effort_priority: 3,
        },
      };

      const propertyDefinitions = [
        { name: "ems__Effort_taskSize", fieldType: PropertyFieldType.StatusSelect },
        { name: "ems__Effort_priority", fieldType: PropertyFieldType.Number },
      ];

      // Act
      const file = await service.createAsset(config, propertyDefinitions);

      // Assert: File was created with custom properties
      const storedFile = vault.getStoredFiles().get(file.path);
      expect(storedFile).toBeDefined();

      const content = storedFile!.content;
      expect(content).toContain('ems__Effort_taskSize: "[[ems__TaskSize_M]]"');
      expect(content).toContain("ems__Effort_priority: 3");
    });

    it("should create folder if it does not exist", async () => {
      // Arrange: No folders exist initially
      expect(vault.getStoredFolders().size).toBe(0);

      // Act
      await service.createAsset({
        className: "ems__Task",
        folderPath: "my-project/tasks",
      });

      // Assert: Folder was created
      expect(vault.getStoredFolders().has("my-project/tasks")).toBe(true);
    });

    it("should not create folder if it already exists", async () => {
      // Arrange: Pre-create folder
      await vault.createFolder("existing-folder");
      expect(vault.getStoredFolders().size).toBe(1);

      // Override getAbstractFileByPath to return folder
      const originalMethod = vault.getAbstractFileByPath.bind(vault);
      vault.getAbstractFileByPath = (path: string) => {
        if (path === "existing-folder") {
          return { path, name: "existing-folder" } as IFolder;
        }
        return originalMethod(path);
      };

      // Act
      await service.createAsset({
        className: "ems__Task",
        folderPath: "existing-folder",
      });

      // Assert: No duplicate folder created (still 1)
      expect(vault.getStoredFolders().size).toBe(1);
    });
  });

  describe("Project Creation Flow", () => {
    it("should create project with correct default folder", async () => {
      // Arrange
      const config = {
        className: "ems__Project",
        label: "Q1 Development Sprint",
      };

      // Act
      const file = await service.createAsset(config);

      // Assert
      expect(file.path).toMatch(/^projects\/[0-9a-f-]+\.md$/);

      const storedFile = vault.getStoredFiles().get(file.path);
      expect(storedFile!.content).toContain('"[[ems__Project]]"');
    });

    it("should create project with parent area reference", async () => {
      // Arrange: Create parent area first
      const areaFile = await service.createAsset({
        className: "ems__Area",
        label: "Work",
        folderPath: "areas",
      });

      // Create project with parent reference
      const projectConfig = {
        className: "ems__Project",
        label: "Exocortex Development",
        parentFile: areaFile,
        parentMetadata: {
          exo__Instance_class: ["[[ems__Area]]"],
        },
      };

      // Act
      const projectFile = await service.createAsset(projectConfig);

      // Assert: Project has parent reference
      const storedFile = vault.getStoredFiles().get(projectFile.path);
      expect(storedFile!.content).toContain("ems__Project_area:");
    });
  });

  describe("Meeting Creation Flow", () => {
    it("should create meeting with timestamp properties", async () => {
      // Arrange
      const now = new Date();
      const config = {
        className: "ems__Meeting",
        label: "Weekly Standup",
        propertyValues: {
          ems__Meeting_scheduledAt: now,
          ems__Meeting_duration: 30,
        },
      };

      const propertyDefinitions = [
        { name: "ems__Meeting_scheduledAt", fieldType: PropertyFieldType.DateTime },
        { name: "ems__Meeting_duration", fieldType: PropertyFieldType.Number },
      ];

      // Act
      const file = await service.createAsset(config, propertyDefinitions);

      // Assert
      expect(file.path).toMatch(/^meetings\/[0-9a-f-]+\.md$/);

      const storedFile = vault.getStoredFiles().get(file.path);
      expect(storedFile!.content).toContain("ems__Meeting_scheduledAt:");
      expect(storedFile!.content).toContain("ems__Meeting_duration: 30");
    });
  });

  describe("Error Handling", () => {
    it("should handle validation errors gracefully", async () => {
      // Arrange: Invalid property values (null should be skipped)
      const config = {
        className: "ems__Task",
        label: "Task with invalid data",
        propertyValues: {
          valid_property: "valid value",
          null_property: null,
          undefined_property: undefined,
        },
      };

      // Act
      const file = await service.createAsset(config);

      // Assert: File was created with valid properties only
      const storedFile = vault.getStoredFiles().get(file.path);
      expect(storedFile!.content).toContain("valid_property: valid value");
      expect(storedFile!.content).not.toContain("null_property");
      expect(storedFile!.content).not.toContain("undefined_property");
    });

    it("should create unique UIDs for each asset", async () => {
      // Act: Create multiple assets
      const files = await Promise.all([
        service.createAsset({ className: "ems__Task", label: "Task 1" }),
        service.createAsset({ className: "ems__Task", label: "Task 2" }),
        service.createAsset({ className: "ems__Task", label: "Task 3" }),
      ]);

      // Assert: All files have unique basenames (UIDs)
      const basenames = new Set(files.map((f) => f.basename));
      expect(basenames.size).toBe(3);
    });
  });

  describe("Property Formatting", () => {
    it("should format wikilink properties correctly", async () => {
      // Arrange
      const config = {
        className: "ems__Task",
        propertyValues: {
          ems__Effort_status: "ems__EffortStatusDoing",
        },
      };

      const propertyDefinitions = [
        { name: "ems__Effort_status", fieldType: PropertyFieldType.StatusSelect },
      ];

      // Act
      const file = await service.createAsset(config, propertyDefinitions);

      // Assert
      const storedFile = vault.getStoredFiles().get(file.path);
      expect(storedFile!.content).toContain(
        'ems__Effort_status: "[[ems__EffortStatusDoing]]"'
      );
    });

    it("should format boolean properties correctly", async () => {
      // Arrange
      const config = {
        className: "ems__Task",
        propertyValues: {
          exo__Asset_isArchived: false,
          custom_flag: true,
        },
      };

      const propertyDefinitions = [
        { name: "exo__Asset_isArchived", fieldType: PropertyFieldType.Boolean },
        { name: "custom_flag", fieldType: PropertyFieldType.Boolean },
      ];

      // Act
      const file = await service.createAsset(config, propertyDefinitions);

      // Assert
      const storedFile = vault.getStoredFiles().get(file.path);
      expect(storedFile!.content).toContain("exo__Asset_isArchived: false");
      expect(storedFile!.content).toContain("custom_flag: true");
    });

    it("should format date properties correctly", async () => {
      // Arrange
      const testDate = new Date("2024-03-15T10:30:00");
      const config = {
        className: "ems__Task",
        propertyValues: {
          ems__Effort_startTimestamp: testDate,
        },
      };

      const propertyDefinitions = [
        {
          name: "ems__Effort_startTimestamp",
          fieldType: PropertyFieldType.DateTime,
        },
      ];

      // Act
      const file = await service.createAsset(config, propertyDefinitions);

      // Assert
      const storedFile = vault.getStoredFiles().get(file.path);
      expect(storedFile!.content).toContain("ems__Effort_startTimestamp:");
      // Should contain ISO-like timestamp
      expect(storedFile!.content).toMatch(/ems__Effort_startTimestamp: \d{4}-\d{2}-\d{2}T/);
    });
  });

  describe("Class-to-Folder Mapping", () => {
    const classToFolderTestCases = [
      { className: "ems__Task", expectedFolder: "tasks" },
      { className: "ems__Project", expectedFolder: "projects" },
      { className: "ems__Area", expectedFolder: "areas" },
      { className: "ems__Meeting", expectedFolder: "meetings" },
      { className: "exo__Event", expectedFolder: "events" },
      { className: "ims__Concept", expectedFolder: "concepts" },
      { className: "custom__Unknown", expectedFolder: "assets" },
    ];

    it.each(classToFolderTestCases)(
      "should map $className to $expectedFolder folder",
      async ({ className, expectedFolder }) => {
        // Act
        const file = await service.createAsset({ className });

        // Assert
        expect(file.path).toMatch(new RegExp(`^${expectedFolder}/[0-9a-f-]+\\.md$`));
      }
    );
  });

  describe("Parent Context Inheritance", () => {
    it("should inherit parent reference for tasks created from projects", async () => {
      // Arrange: Create parent project
      const projectFile = await service.createAsset({
        className: "ems__Project",
        label: "Parent Project",
        folderPath: "projects",
      });

      // Create task with parent reference
      const taskConfig = {
        className: "ems__Task",
        label: "Child Task",
        parentFile: projectFile,
        parentMetadata: {
          exo__Instance_class: ["[[ems__Project]]"],
          exo__Asset_label: "Parent Project",
        },
      };

      // Act
      const taskFile = await service.createAsset(taskConfig);

      // Assert: Task has parent reference
      const storedFile = vault.getStoredFiles().get(taskFile.path);
      expect(storedFile!.content).toContain("ems__Effort_parent:");
    });
  });
});
