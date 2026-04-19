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

  describe("Branch coverage improvements", () => {
    describe("label edge cases", () => {
      it("should not include label when label is empty string", async () => {
        const config = { className: "ems__Task", label: "" };
        await service.createAsset(config);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).not.toContain("exo__Asset_label");
        expect(content).not.toContain("aliases");
      });

      it("should not include label when label is only whitespace", async () => {
        const config = { className: "ems__Task", label: "   " };
        await service.createAsset(config);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).not.toContain("exo__Asset_label");
        expect(content).not.toContain("aliases");
      });

      it("should trim whitespace from label", async () => {
        const config = { className: "ems__Task", label: "  My Task  " };
        await service.createAsset(config);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain("exo__Asset_label: My Task");
        expect(content).toContain("- My Task");
      });
    });

    describe("property value skipping", () => {
      it("should skip system property exo__Asset_uid in propertyValues", async () => {
        const config = {
          className: "ems__Task",
          propertyValues: { exo__Asset_uid: "custom-uid", other_prop: "value" },
        };
        await service.createAsset(config);
        const content = mockVault.create.mock.calls[0][1];
        // uid should be auto-generated, not the custom one
        expect(content).not.toContain("custom-uid");
        expect(content).toContain("other_prop: value");
      });

      it("should skip system property exo__Asset_createdAt in propertyValues", async () => {
        const config = {
          className: "ems__Task",
          propertyValues: { exo__Asset_createdAt: "2020-01-01T00:00:00" },
        };
        await service.createAsset(config);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).not.toContain("2020-01-01T00:00:00");
      });

      it("should skip system property exo__Instance_class in propertyValues", async () => {
        const config = {
          className: "ems__Task",
          propertyValues: { exo__Instance_class: ["[[custom_class]]"] },
        };
        await service.createAsset(config);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).not.toContain("custom_class");
      });

      it("should skip system property aliases in propertyValues", async () => {
        const config = {
          className: "ems__Task",
          label: "Test",
          propertyValues: { aliases: "custom-alias" },
        };
        await service.createAsset(config);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).not.toContain("custom-alias");
      });

      it("should skip undefined property values", async () => {
        const config = {
          className: "ems__Task",
          propertyValues: { prop1: undefined, prop2: "value" },
        };
        await service.createAsset(config);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).not.toContain("prop1");
        expect(content).toContain("prop2: value");
      });
    });

    describe("formatValue with field types", () => {
      it("should format Text field type as string", async () => {
        const config = {
          className: "ems__Task",
          propertyValues: { my_text: 42 },
        };
        const definitions = [{ name: "my_text", fieldType: PropertyFieldType.Text }];
        await service.createAsset(config, definitions);
        const content = mockVault.create.mock.calls[0][1];
        // String(42) = "42", MetadataHelpers renders it as 42 in YAML
        expect(content).toContain("my_text: 42");
      });

      it("should format Wikilink field type as wikilink", async () => {
        const config = {
          className: "ems__Task",
          propertyValues: { my_link: "SomeAsset" },
        };
        const definitions = [{ name: "my_link", fieldType: PropertyFieldType.Wikilink }];
        await service.createAsset(config, definitions);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain('"[[SomeAsset]]"');
      });

      it("should format StatusSelect field type as wikilink", async () => {
        const config = {
          className: "ems__Task",
          propertyValues: { status: "ems__EffortStatusDoing" },
        };
        const definitions = [{ name: "status", fieldType: PropertyFieldType.StatusSelect }];
        await service.createAsset(config, definitions);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain('"[[ems__EffortStatusDoing]]"');
      });

      it("should format SizeSelect field type as wikilink", async () => {
        const config = {
          className: "ems__Task",
          propertyValues: { size: "ems__TaskSize_M" },
        };
        const definitions = [{ name: "size", fieldType: PropertyFieldType.SizeSelect }];
        await service.createAsset(config, definitions);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain('"[[ems__TaskSize_M]]"');
      });

      it("should format Number field type from string", async () => {
        const config = {
          className: "ems__Task",
          propertyValues: { my_num: "42" },
        };
        const definitions = [{ name: "my_num", fieldType: PropertyFieldType.Number }];
        await service.createAsset(config, definitions);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain("my_num: 42");
      });

      it("should format Number field type as 0 for non-numeric string", async () => {
        const config = {
          className: "ems__Task",
          propertyValues: { my_num: "abc" },
        };
        const definitions = [{ name: "my_num", fieldType: PropertyFieldType.Number }];
        await service.createAsset(config, definitions);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain("my_num: 0");
      });

      it("should format Boolean field type from string 'true'", async () => {
        const config = {
          className: "ems__Task",
          propertyValues: { my_bool: "true" },
        };
        const definitions = [{ name: "my_bool", fieldType: PropertyFieldType.Boolean }];
        await service.createAsset(config, definitions);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain("my_bool: true");
      });

      it("should format Boolean field type from string 'yes'", async () => {
        const config = {
          className: "ems__Task",
          propertyValues: { my_bool: "yes" },
        };
        const definitions = [{ name: "my_bool", fieldType: PropertyFieldType.Boolean }];
        await service.createAsset(config, definitions);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain("my_bool: true");
      });

      it("should format Boolean field type from string '1'", async () => {
        const config = {
          className: "ems__Task",
          propertyValues: { my_bool: "1" },
        };
        const definitions = [{ name: "my_bool", fieldType: PropertyFieldType.Boolean }];
        await service.createAsset(config, definitions);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain("my_bool: true");
      });

      it("should format Boolean field type from string 'false'", async () => {
        const config = {
          className: "ems__Task",
          propertyValues: { my_bool: "false" },
        };
        const definitions = [{ name: "my_bool", fieldType: PropertyFieldType.Boolean }];
        await service.createAsset(config, definitions);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain("my_bool: false");
      });

      it("should format Boolean field type from number 0 as false", async () => {
        const config = {
          className: "ems__Task",
          propertyValues: { my_bool: 0 },
        };
        const definitions = [{ name: "my_bool", fieldType: PropertyFieldType.Boolean }];
        await service.createAsset(config, definitions);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain("my_bool: false");
      });

      it("should format Boolean field type from number 5 as true", async () => {
        const config = {
          className: "ems__Task",
          propertyValues: { my_bool: 5 },
        };
        const definitions = [{ name: "my_bool", fieldType: PropertyFieldType.Boolean }];
        await service.createAsset(config, definitions);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain("my_bool: true");
      });

      it("should format Boolean field type from object as true", async () => {
        const config = {
          className: "ems__Task",
          propertyValues: { my_bool: {} },
        };
        const definitions = [{ name: "my_bool", fieldType: PropertyFieldType.Boolean }];
        await service.createAsset(config, definitions);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain("my_bool: true");
      });

      it("should format Date field type from Date object", async () => {
        const date = new Date("2025-06-15T10:30:00Z");
        const config = {
          className: "ems__Task",
          propertyValues: { my_date: date },
        };
        const definitions = [{ name: "my_date", fieldType: PropertyFieldType.Date }];
        await service.createAsset(config, definitions);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toMatch(/my_date: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      });

      it("should format DateTime field type from string in local timestamp format", async () => {
        const config = {
          className: "ems__Task",
          propertyValues: { my_dt: "2025-06-15T10:30:00" },
        };
        const definitions = [{ name: "my_dt", fieldType: PropertyFieldType.DateTime }];
        await service.createAsset(config, definitions);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain("my_dt: 2025-06-15T10:30:00");
      });

      it("should format Timestamp field type from ISO UTC string", async () => {
        const config = {
          className: "ems__Task",
          propertyValues: { my_ts: "2025-06-15T10:30:00Z" },
        };
        const definitions = [{ name: "my_ts", fieldType: PropertyFieldType.Timestamp }];
        await service.createAsset(config, definitions);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain("my_ts: 2025-06-15T10:30:00");
      });

      it("should format Timestamp field type from parseable date string", async () => {
        const config = {
          className: "ems__Task",
          propertyValues: { my_ts: "June 15, 2025" },
        };
        const definitions = [{ name: "my_ts", fieldType: PropertyFieldType.Timestamp }];
        await service.createAsset(config, definitions);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toMatch(/my_ts: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      });

      it("should return unparseable date string as-is for Timestamp", async () => {
        const config = {
          className: "ems__Task",
          propertyValues: { my_ts: "not-a-date" },
        };
        const definitions = [{ name: "my_ts", fieldType: PropertyFieldType.Timestamp }];
        await service.createAsset(config, definitions);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain("my_ts: not-a-date");
      });

      it("should format Timestamp field type from number (epoch ms)", async () => {
        const config = {
          className: "ems__Task",
          propertyValues: { my_ts: 1718450000000 },
        };
        const definitions = [{ name: "my_ts", fieldType: PropertyFieldType.Timestamp }];
        await service.createAsset(config, definitions);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toMatch(/my_ts: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      });

      it("should format Timestamp field type from invalid number", async () => {
        const config = {
          className: "ems__Task",
          propertyValues: { my_ts: NaN },
        };
        const definitions = [{ name: "my_ts", fieldType: PropertyFieldType.Timestamp }];
        await service.createAsset(config, definitions);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain("my_ts: NaN");
      });

      it("should format Timestamp from non-string non-number non-Date as String", async () => {
        const config = {
          className: "ems__Task",
          propertyValues: { my_ts: true },
        };
        const definitions = [{ name: "my_ts", fieldType: PropertyFieldType.Timestamp }];
        await service.createAsset(config, definitions);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain("my_ts: true");
      });

      it("should use default switch branch for unknown field type", async () => {
        const config = {
          className: "ems__Task",
          propertyValues: { my_prop: 42 },
        };
        const definitions = [{ name: "my_prop", fieldType: PropertyFieldType.Unknown }];
        await service.createAsset(config, definitions);
        const content = mockVault.create.mock.calls[0][1];
        // default case calls String(value) which produces "42" without quotes in YAML
        expect(content).toContain("my_prop: 42");
      });

      it("should return null for null value with fieldType", async () => {
        const config = {
          className: "ems__Task",
          propertyValues: { my_prop: null },
        };
        const definitions = [{ name: "my_prop", fieldType: PropertyFieldType.Text }];
        await service.createAsset(config, definitions);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).not.toContain("my_prop");
      });
    });

    describe("formatInferredValue (no fieldType)", () => {
      it("should infer boolean value", async () => {
        const config = {
          className: "ems__Task",
          propertyValues: { my_prop: false },
        };
        await service.createAsset(config);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain("my_prop: false");
      });

      it("should infer number value", async () => {
        const config = {
          className: "ems__Task",
          propertyValues: { my_prop: 3.14 },
        };
        await service.createAsset(config);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain("my_prop: 3.14");
      });

      it("should infer Date value", async () => {
        const config = {
          className: "ems__Task",
          propertyValues: { my_prop: new Date("2025-01-01T12:00:00Z") },
        };
        await service.createAsset(config);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toMatch(/my_prop: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      });

      it("should infer quoted wikilink string", async () => {
        const config = {
          className: "ems__Task",
          propertyValues: { my_prop: '"[[SomeAsset]]"' },
        };
        await service.createAsset(config);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain('"[[SomeAsset]]"');
      });

      it("should infer wikilink string starting with [[", async () => {
        const config = {
          className: "ems__Task",
          propertyValues: { my_prop: "[[SomeAsset]]" },
        };
        await service.createAsset(config);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain('"[[SomeAsset]]"');
      });

      it("should infer plain string value", async () => {
        const config = {
          className: "ems__Task",
          propertyValues: { my_prop: "hello world" },
        };
        await service.createAsset(config);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain("my_prop: hello world");
      });

      it("should convert non-string non-number non-boolean non-Date to string", async () => {
        const config = {
          className: "ems__Task",
          propertyValues: { my_prop: [1, 2, 3] },
        };
        await service.createAsset(config);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain("my_prop: 1,2,3");
      });
    });

    describe("formatWikilink edge cases", () => {
      it("should not double-wrap already quoted wikilink", async () => {
        const config = {
          className: "ems__Task",
          propertyValues: { link: '"[[Already]]"' },
        };
        const definitions = [{ name: "link", fieldType: PropertyFieldType.Reference }];
        await service.createAsset(config, definitions);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain('"[[Already]]"');
        expect(content).not.toContain('"[["[[Already]]"]]"');
      });
    });

    describe("inheritParentContext", () => {
      it("should inherit ems__Effort_parent for ems__Task with parent file", async () => {
        const parentFile: IFile = {
          path: "projects/project.md",
          basename: "project",
          name: "project.md",
          parent: { path: "projects" } as IFolder,
        };
        const config = {
          className: "ems__Task",
          parentFile,
          parentMetadata: {},
        };
        await service.createAsset(config);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain('ems__Effort_parent: "[[project]]"');
      });

      it("should set ems__Effort_parent to null when parentFile has no basename", async () => {
        const parentFile: IFile = {
          path: "projects/",
          basename: "",
          name: "",
          parent: { path: "projects" } as IFolder,
        };
        const config = {
          className: "ems__Task",
          parentFile,
          parentMetadata: {},
        };
        await service.createAsset(config);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain("ems__Effort_parent: null");
      });

      it("should inherit ems__Effort_parent for class starting with ems__Task prefix", async () => {
        const parentFile: IFile = {
          path: "projects/project.md",
          basename: "project",
          name: "project.md",
          parent: { path: "projects" } as IFolder,
        };
        const config = {
          className: "ems__TaskPrototype",
          parentFile,
          parentMetadata: {},
        };
        await service.createAsset(config);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain('ems__Effort_parent: "[[project]]"');
      });

      it("should set ems__Effort_area for ems__Task with an ems__Area parent", async () => {
        const parentFile: IFile = {
          path: "areas/development.md",
          basename: "development",
          name: "development.md",
          parent: { path: "areas" } as IFolder,
        };
        const config = {
          className: "ems__Task",
          parentFile,
          parentMetadata: {
            exo__Instance_class: ["[[ems__Area]]"],
          },
        };
        await service.createAsset(config);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain('ems__Effort_area: "[[development]]"');
        expect(content).not.toContain("ems__Effort_parent:");
      });

      it("should set ems__Effort_area to null when Area parent has no basename", async () => {
        const parentFile: IFile = {
          path: "areas/",
          basename: "",
          name: "",
          parent: { path: "areas" } as IFolder,
        };
        const config = {
          className: "ems__Task",
          parentFile,
          parentMetadata: {
            exo__Instance_class: ["[[ems__Area]]"],
          },
        };
        await service.createAsset(config);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain("ems__Effort_area: null");
        expect(content).not.toContain("ems__Effort_parent:");
      });

      it("should set ems__Effort_area for project with area parent (issue #2850)", async () => {
        const parentFile: IFile = {
          path: "areas/my-area.md",
          basename: "my-area",
          name: "my-area.md",
          parent: { path: "areas" } as IFolder,
        };
        const config = {
          className: "ems__Project",
          parentFile,
          parentMetadata: {
            exo__Instance_class: ["[[ems__Area]]"],
          },
        };
        await service.createAsset(config);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain('ems__Effort_area: "[[my-area]]"');
        // Legacy property must not appear (was the duplicate in issue #2850).
        expect(content).not.toContain("ems__Project_area");
      });

      it("should set ems__Effort_area to null when parent has no basename", async () => {
        const parentFile: IFile = {
          path: "areas/",
          basename: "",
          name: "",
          parent: { path: "areas" } as IFolder,
        };
        const config = {
          className: "ems__Project",
          parentFile,
          parentMetadata: {
            exo__Instance_class: ["[[ems__Area]]"],
          },
        };
        await service.createAsset(config);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain("ems__Effort_area: null");
      });

      it("should set ems__Effort_parent when project parent is not an area (issue #2850)", async () => {
        const parentFile: IFile = {
          path: "projects/parent.md",
          basename: "parent",
          name: "parent.md",
          parent: { path: "projects" } as IFolder,
        };
        const config = {
          className: "ems__Project",
          parentFile,
          parentMetadata: {
            exo__Instance_class: ["[[ems__Task]]"],
          },
        };
        await service.createAsset(config);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain('ems__Effort_parent: "[[parent]]"');
        expect(content).not.toContain("ems__Effort_area");
        expect(content).not.toContain("ems__Project_area");
      });

      it("should handle ems__Project class prefix for project area inheritance", async () => {
        const parentFile: IFile = {
          path: "areas/area.md",
          basename: "area",
          name: "area.md",
          parent: { path: "areas" } as IFolder,
        };
        const config = {
          className: "ems__ProjectTemplate",
          parentFile,
          parentMetadata: {
            exo__Instance_class: ["[[ems__Area]]"],
          },
        };
        await service.createAsset(config);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain('ems__Effort_area: "[[area]]"');
      });

      it("should inherit exo__Asset_isDefinedBy from parent (already-quoted value)", async () => {
        const parentFile: IFile = {
          path: "projects/project.md",
          basename: "project",
          name: "project.md",
          parent: { path: "projects" } as IFolder,
        };
        const config = {
          className: "ems__Task",
          parentFile,
          parentMetadata: {
            exo__Asset_isDefinedBy: '"[[my-ontology]]"',
          },
        };
        await service.createAsset(config);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain('exo__Asset_isDefinedBy: "[[my-ontology]]"');
      });

      it("should re-quote inherited exo__Asset_isDefinedBy when metadataCache stripped outer quotes (issue #2850)", async () => {
        // Obsidian metadataCache parses `"[[foo]]"` from YAML and returns the
        // inner string `[[foo]]` — inherited unwrapped value must be re-quoted
        // by the writer so YAML doesn't re-interpret `[[!foo]]` as a tag.
        const parentFile: IFile = {
          path: "areas/area.md",
          basename: "area",
          name: "area.md",
          parent: { path: "areas" } as IFolder,
        };
        const config = {
          className: "ems__Project",
          parentFile,
          parentMetadata: {
            exo__Instance_class: ["[[ems__Area]]"],
            exo__Asset_isDefinedBy: "[[!toos_areas]]",
          },
        };
        await service.createAsset(config);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain('exo__Asset_isDefinedBy: "[[!toos_areas]]"');
        // Unquoted `[[!foo]]` would cause YAMLWarning + empty wikilink.
        expect(content).not.toMatch(/exo__Asset_isDefinedBy:\s*\[\[!/);
      });

      it("should not inherit when parentMetadata has no exo__Asset_isDefinedBy", async () => {
        const parentFile: IFile = {
          path: "projects/project.md",
          basename: "project",
          name: "project.md",
          parent: { path: "projects" } as IFolder,
        };
        const config = {
          className: "ems__Task",
          parentFile,
          parentMetadata: {},
        };
        await service.createAsset(config);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).not.toContain("exo__Asset_isDefinedBy");
      });
    });

    describe("isAreaClass edge cases", () => {
      it("should treat null instanceClass as non-area and emit ems__Effort_parent", async () => {
        const parentFile: IFile = {
          path: "projects/project.md",
          basename: "project",
          name: "project.md",
          parent: { path: "projects" } as IFolder,
        };
        const config = {
          className: "ems__Project",
          parentFile,
          parentMetadata: {
            exo__Instance_class: null,
          },
        };
        await service.createAsset(config);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain('ems__Effort_parent: "[[project]]"');
        expect(content).not.toContain("ems__Project_area");
      });

      it("should handle non-array instanceClass as single value", async () => {
        const parentFile: IFile = {
          path: "areas/area.md",
          basename: "area",
          name: "area.md",
          parent: { path: "areas" } as IFolder,
        };
        const config = {
          className: "ems__Project",
          parentFile,
          parentMetadata: {
            exo__Instance_class: ["[[ems__Area]]"],
          },
        };
        await service.createAsset(config);
        const content = mockVault.create.mock.calls[0][1];
        expect(content).toContain('ems__Effort_area: "[[area]]"');
      });
    });

    describe("getDefaultFolderPath", () => {
      it("should use parent folder path when parentFile has parent", async () => {
        const parentFile: IFile = {
          path: "custom/path/file.md",
          basename: "file",
          name: "file.md",
          parent: { path: "custom/path" } as IFolder,
        };
        const config = {
          className: "ems__Task",
          parentFile,
          parentMetadata: {},
        };
        await service.createAsset(config);
        const path = mockVault.create.mock.calls[0][0];
        expect(path).toMatch(/^custom\/path\//);
      });

      it("should use class prefix folder match for ems__TaskSubtype", async () => {
        const config = { className: "ems__TaskSubtype" };
        await service.createAsset(config);
        const path = mockVault.create.mock.calls[0][0];
        expect(path).toMatch(/^tasks\//);
      });

      it("should default to assets folder for unknown class", async () => {
        const config = { className: "custom__Unknown" };
        await service.createAsset(config);
        const path = mockVault.create.mock.calls[0][0];
        expect(path).toMatch(/^assets\//);
      });

      it("should use parent file path when parent path is null", async () => {
        const parentFile: IFile = {
          path: "root.md",
          basename: "root",
          name: "root.md",
          parent: null,
        };
        const config = {
          className: "ems__Task",
          parentFile,
          parentMetadata: {},
        };
        await service.createAsset(config);
        const path = mockVault.create.mock.calls[0][0];
        // Should fall through to class-based folder since parent.path is undefined
        expect(path).toMatch(/^tasks\//);
      });
    });

    describe("folderPath edge case", () => {
      it("should handle empty folderPath by using default", async () => {
        const config = {
          className: "ems__Task",
          folderPath: "",
        };
        await service.createAsset(config);
        const path = mockVault.create.mock.calls[0][0];
        // empty string is falsy, so falls through to getDefaultFolderPath
        expect(path).toMatch(/\.md$/);
      });
    });

    describe("no parentFile and no parentMetadata - only parentFile provided", () => {
      it("should not inherit context when only parentFile is set without parentMetadata", async () => {
        const parentFile: IFile = {
          path: "projects/project.md",
          basename: "project",
          name: "project.md",
          parent: { path: "projects" } as IFolder,
        };
        const config = {
          className: "ems__Task",
          parentFile,
          // No parentMetadata
        };
        await service.createAsset(config);
        const content = mockVault.create.mock.calls[0][1];
        // Without parentMetadata, inheritParentContext should not be called
        expect(content).not.toContain("ems__Effort_parent");
      });
    });
  });
});
