import { GenericAssetCreationService } from "../../../src/services/GenericAssetCreationService";
import { PropertyFieldType } from "../../../src/domain/types/PropertyFieldType";
import type { IVaultAdapter, IFile, IFolder } from "../../../src/interfaces/IVaultAdapter";

describe("GenericAssetCreationService", () => {
  let service: GenericAssetCreationService;
  let mockVault: jest.Mocked<IVaultAdapter>;

  beforeEach(() => {
    mockVault = {
      read: jest.fn(),
      create: jest.fn(),
      modify: jest.fn(),
      delete: jest.fn(),
      rename: jest.fn(),
      getAbstractFileByPath: jest.fn(),
      createFolder: jest.fn(),
      exists: jest.fn(),
      getMetadata: jest.fn(),
      getFirstLinkpathDest: jest.fn(),
      getFilesWithTag: jest.fn(),
      getFilesInFolder: jest.fn(),
      getAllMarkdownFiles: jest.fn(),
      toTFile: jest.fn(),
      processFrontMatter: jest.fn(),
    } as unknown as jest.Mocked<IVaultAdapter>;

    // Default mock for createAsset to return a file
    mockVault.create.mockImplementation((path: string, content: string) => {
      const file: IFile = {
        path,
        basename: path.split("/").pop()?.replace(".md", "") || "",
        name: path.split("/").pop() || "",
        parent: { path: path.split("/").slice(0, -1).join("/") } as IFolder,
      };
      return Promise.resolve(file);
    });

    // Default mock for folder existence check
    mockVault.getAbstractFileByPath.mockReturnValue(null);
    mockVault.createFolder.mockResolvedValue(undefined);

    service = new GenericAssetCreationService(mockVault);
  });

  describe("createAsset", () => {
    it("should create asset with UUID-based filename", async () => {
      const config = {
        className: "ems__Task",
        label: "Test Task",
      };

      const file = await service.createAsset(config);

      expect(file.basename).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
      expect(mockVault.create).toHaveBeenCalledTimes(1);
    });

    it("should include class in frontmatter", async () => {
      const config = {
        className: "ems__Task",
        label: "Test Task",
      };

      await service.createAsset(config);

      const createCall = mockVault.create.mock.calls[0];
      const content = createCall[1];

      expect(content).toContain("exo__Instance_class:");
      expect(content).toContain('"[[ems__Task]]"');
    });

    it("should include label and aliases when provided", async () => {
      const config = {
        className: "ems__Task",
        label: "My Important Task",
      };

      await service.createAsset(config);

      const createCall = mockVault.create.mock.calls[0];
      const content = createCall[1];

      expect(content).toContain("exo__Asset_label: My Important Task");
      expect(content).toContain("aliases:");
      expect(content).toContain("- My Important Task");
    });

    it("should not include label if not provided", async () => {
      const config = {
        className: "ems__Task",
      };

      await service.createAsset(config);

      const createCall = mockVault.create.mock.calls[0];
      const content = createCall[1];

      expect(content).not.toContain("exo__Asset_label");
    });

    it("should include createdAt timestamp", async () => {
      const config = {
        className: "ems__Task",
      };

      await service.createAsset(config);

      const createCall = mockVault.create.mock.calls[0];
      const content = createCall[1];

      expect(content).toContain("exo__Asset_createdAt:");
      // Should match ISO timestamp pattern
      expect(content).toMatch(/exo__Asset_createdAt: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it("should include UID in frontmatter", async () => {
      const config = {
        className: "ems__Task",
      };

      await service.createAsset(config);

      const createCall = mockVault.create.mock.calls[0];
      const content = createCall[1];

      expect(content).toContain("exo__Asset_uid:");
      expect(content).toMatch(
        /exo__Asset_uid: [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/
      );
    });

    it("should use default folder path based on class", async () => {
      const config = {
        className: "ems__Task",
        label: "Test Task",
      };

      await service.createAsset(config);

      const createCall = mockVault.create.mock.calls[0];
      const path = createCall[0];

      expect(path).toMatch(/^tasks\/[0-9a-f-]+\.md$/);
    });

    it("should use custom folder path when provided", async () => {
      const config = {
        className: "ems__Task",
        label: "Test Task",
        folderPath: "custom/folder",
      };

      await service.createAsset(config);

      const createCall = mockVault.create.mock.calls[0];
      const path = createCall[0];

      expect(path).toMatch(/^custom\/folder\/[0-9a-f-]+\.md$/);
    });

    it("should create folder if it does not exist", async () => {
      mockVault.getAbstractFileByPath.mockReturnValue(null);

      const config = {
        className: "ems__Task",
        folderPath: "new/folder",
      };

      await service.createAsset(config);

      expect(mockVault.createFolder).toHaveBeenCalledWith("new/folder");
    });

    it("should not create folder if it already exists", async () => {
      mockVault.getAbstractFileByPath.mockReturnValue({} as IFolder);

      const config = {
        className: "ems__Task",
        folderPath: "existing/folder",
      };

      await service.createAsset(config);

      expect(mockVault.createFolder).not.toHaveBeenCalled();
    });

    it("should include additional property values", async () => {
      const config = {
        className: "ems__Task",
        label: "Test Task",
        propertyValues: {
          ems__Effort_taskSize: '"[[ems__TaskSize_S]]"',
          custom_property: "custom value",
        },
      };

      await service.createAsset(config);

      const createCall = mockVault.create.mock.calls[0];
      const content = createCall[1];

      expect(content).toContain('ems__Effort_taskSize: "[[ems__TaskSize_S]]"');
      expect(content).toContain("custom_property: custom value");
    });

    it("should format wikilink property values correctly", async () => {
      const config = {
        className: "ems__Task",
        propertyValues: {
          ems__Effort_parent: "ParentProject",
        },
      };

      const definitions = [
        { name: "ems__Effort_parent", fieldType: PropertyFieldType.Reference },
      ];

      await service.createAsset(config, definitions);

      const createCall = mockVault.create.mock.calls[0];
      const content = createCall[1];

      expect(content).toContain('ems__Effort_parent: "[[ParentProject]]"');
    });

    it("should not format already-wrapped wikilinks", async () => {
      const config = {
        className: "ems__Task",
        propertyValues: {
          ems__Effort_parent: "[[ParentProject]]",
        },
      };

      const definitions = [
        { name: "ems__Effort_parent", fieldType: PropertyFieldType.Reference },
      ];

      await service.createAsset(config, definitions);

      const createCall = mockVault.create.mock.calls[0];
      const content = createCall[1];

      expect(content).toContain('ems__Effort_parent: "[[ParentProject]]"');
      // Should not double-wrap
      expect(content).not.toContain('"[["[[ParentProject]]"]]"');
    });

    it("should format number property values as numbers", async () => {
      const config = {
        className: "ems__Task",
        propertyValues: {
          ems__Effort_votes: 5,
        },
      };

      const definitions = [
        { name: "ems__Effort_votes", fieldType: PropertyFieldType.Number },
      ];

      await service.createAsset(config, definitions);

      const createCall = mockVault.create.mock.calls[0];
      const content = createCall[1];

      expect(content).toContain("ems__Effort_votes: 5");
    });

    it("should format boolean property values as booleans", async () => {
      const config = {
        className: "ems__Task",
        propertyValues: {
          exo__Asset_isArchived: true,
        },
      };

      const definitions = [
        { name: "exo__Asset_isArchived", fieldType: PropertyFieldType.Boolean },
      ];

      await service.createAsset(config, definitions);

      const createCall = mockVault.create.mock.calls[0];
      const content = createCall[1];

      expect(content).toContain("exo__Asset_isArchived: true");
    });

    it("should skip null property values", async () => {
      const config = {
        className: "ems__Task",
        propertyValues: {
          ems__Effort_taskSize: null,
          valid_property: "value",
        },
      };

      await service.createAsset(config);

      const createCall = mockVault.create.mock.calls[0];
      const content = createCall[1];

      expect(content).not.toContain("ems__Effort_taskSize");
      expect(content).toContain("valid_property: value");
    });

    it("should use parent folder when parentFile is provided", async () => {
      const parentFile: IFile = {
        path: "projects/my-project/project.md",
        basename: "project",
        name: "project.md",
        parent: { path: "projects/my-project" } as IFolder,
      };

      const config = {
        className: "ems__Task",
        parentFile,
        parentMetadata: {},
      };

      await service.createAsset(config);

      const createCall = mockVault.create.mock.calls[0];
      const path = createCall[0];

      expect(path).toMatch(/^projects\/my-project\/[0-9a-f-]+\.md$/);
    });

    it("should map class prefixes to correct default folders", async () => {
      const classToFolder: Record<string, string> = {
        ems__Task: "tasks",
        ems__Project: "projects",
        ems__Area: "areas",
        ems__Meeting: "meetings",
        exo__Event: "events",
        ims__Concept: "concepts",
        unknown__Class: "assets",
      };

      for (const [className, expectedFolder] of Object.entries(classToFolder)) {
        mockVault.create.mockClear();

        await service.createAsset({ className });

        const createCall = mockVault.create.mock.calls[0];
        const path = createCall[0];

        expect(path).toMatch(new RegExp(`^${expectedFolder}/[0-9a-f-]+\\.md$`));
      }
    });
  });
});
