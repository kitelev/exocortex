import { SessionEventService } from "../../../src/services/SessionEventService";
import { IVaultAdapter, IFile } from "../../../src/interfaces/IVaultAdapter";
import { AssetClass } from "../../../src/domain/constants/AssetClass";

describe("SessionEventService", () => {
  let service: SessionEventService;
  let mockVault: jest.Mocked<IVaultAdapter>;

  beforeEach(() => {
    mockVault = {
      getFrontmatter: jest.fn(),
      getAllFiles: jest.fn(),
      read: jest.fn(),
      create: jest.fn(),
      modify: jest.fn(),
      delete: jest.fn(),
      exists: jest.fn(),
      getAbstractFileByPath: jest.fn(),
      updateFrontmatter: jest.fn(),
      rename: jest.fn(),
      createFolder: jest.fn(),
      getFirstLinkpathDest: jest.fn(),
      process: jest.fn(),
      getDefaultNewFileParent: jest.fn().mockReturnValue({
        path: "",
        name: "",
      }),
    } as jest.Mocked<IVaultAdapter>;

    mockVault.exists.mockResolvedValue(true);

    service = new SessionEventService(mockVault, null);
  });

  describe("createSessionStartEvent", () => {
    it("should create start event with correct frontmatter when no ontology set", async () => {
      const areaName = "Work";
      const mockCreatedFile: IFile = {
        path: "test-uid.md",
        basename: "test-uid",
        name: "test-uid.md",
        parent: null,
      };

      mockVault.getAllFiles.mockReturnValue([]);
      mockVault.create.mockResolvedValue(mockCreatedFile);

      const result = await service.createSessionStartEvent(areaName);

      expect(mockVault.create).toHaveBeenCalled();
      expect(result).toBe(mockCreatedFile);

      const createCall = mockVault.create.mock.calls[0];
      const [filePath, fileContent] = createCall;

      expect(filePath).toMatch(/^[0-9a-f-]+\.md$/);
      expect(fileContent).toContain("exo__Asset_uid:");
      expect(fileContent).toContain('"[[!kitelev]]"');
      expect(fileContent).toContain(`"[[${AssetClass.SESSION_START_EVENT}]]"`);
      expect(fileContent).toContain('ems__Session_area: "[[Work]]"');
      expect(fileContent).toContain("ems__SessionEvent_timestamp:");
      expect(fileContent).not.toContain("exo__Asset_label");
      expect(fileContent).not.toContain("aliases");
    });

    it("should use ontology asset folder and isDefinedBy when ontology is set", async () => {
      const ontologyService = new SessionEventService(mockVault, "kitelev");
      const areaName = "Work";
      const mockOntologyFile: IFile = {
        path: "People/kitelev.md",
        basename: "kitelev",
        name: "kitelev.md",
        parent: {
          path: "People",
          name: "People",
        } as any,
      };
      const mockCreatedFile: IFile = {
        path: "People/test-uid.md",
        basename: "test-uid",
        name: "test-uid.md",
        parent: null,
      };

      mockVault.getAllFiles.mockReturnValue([mockOntologyFile]);
      mockVault.create.mockResolvedValue(mockCreatedFile);

      const result = await ontologyService.createSessionStartEvent(areaName);

      expect(mockVault.create).toHaveBeenCalled();
      expect(result).toBe(mockCreatedFile);

      const createCall = mockVault.create.mock.calls[0];
      const [filePath, fileContent] = createCall;

      expect(filePath).toMatch(/^People\/.+\.md$/);
      expect(fileContent).toContain('"[[kitelev]]"');
      expect(fileContent).not.toContain('"[[!kitelev]]"');
    });

    it("should use correct timestamp format (ISO 8601)", async () => {
      const areaName = "Personal";
      const mockCreatedFile: IFile = {
        path: "test-uid.md",
        basename: "test-uid",
        name: "test-uid.md",
        parent: null,
      };

      mockVault.getAllFiles.mockReturnValue([]);
      mockVault.create.mockResolvedValue(mockCreatedFile);

      await service.createSessionStartEvent(areaName);

      const createCall = mockVault.create.mock.calls[0];
      const [, fileContent] = createCall;

      const timestampMatch = fileContent.match(
        /ems__SessionEvent_timestamp: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/,
      );
      expect(timestampMatch).toBeTruthy();
    });

    it("should default to vault root folder when no ontology set", async () => {
      const areaName = "Work";
      const mockCreatedFile: IFile = {
        path: "test-uid.md",
        basename: "test-uid",
        name: "test-uid.md",
        parent: null,
      };

      mockVault.getAllFiles.mockReturnValue([]);
      mockVault.create.mockResolvedValue(mockCreatedFile);

      await service.createSessionStartEvent(areaName);

      const createCall = mockVault.create.mock.calls[0];
      const [filePath] = createCall;

      expect(filePath).toMatch(/^[0-9a-f-]+\.md$/);
    });

    it("should generate valid UUID for each event", async () => {
      const areaName = "Work";
      const mockCreatedFile: IFile = {
        path: "test-uid.md",
        basename: "test-uid",
        name: "test-uid.md",
        parent: null,
      };

      mockVault.getAllFiles.mockReturnValue([]);
      mockVault.create.mockResolvedValue(mockCreatedFile);

      await service.createSessionStartEvent(areaName);

      const createCall = mockVault.create.mock.calls[0];
      const [, fileContent] = createCall;

      const uuidMatch = fileContent.match(
        /exo__Asset_uid: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/,
      );
      expect(uuidMatch).toBeTruthy();
    });

    it("should create folder if it does not exist", async () => {
      const areaName = "Work";
      const mockCreatedFile: IFile = {
        path: "test-uid.md",
        basename: "test-uid",
        name: "test-uid.md",
        parent: null,
      };

      mockVault.getAllFiles.mockReturnValue([]);
      mockVault.exists.mockResolvedValue(false);
      mockVault.create.mockResolvedValue(mockCreatedFile);

      await service.createSessionStartEvent(areaName);

      expect(mockVault.createFolder).toHaveBeenCalledWith("");
      expect(mockVault.create).toHaveBeenCalled();
    });
  });

  describe("createSessionEndEvent", () => {
    it("should create end event with correct frontmatter", async () => {
      const areaName = "Work";
      const mockCreatedFile: IFile = {
        path: "test-uid.md",
        basename: "test-uid",
        name: "test-uid.md",
        parent: null,
      };

      mockVault.getAllFiles.mockReturnValue([]);
      mockVault.create.mockResolvedValue(mockCreatedFile);

      const result = await service.createSessionEndEvent(areaName);

      expect(mockVault.create).toHaveBeenCalled();
      expect(result).toBe(mockCreatedFile);

      const createCall = mockVault.create.mock.calls[0];
      const [filePath, fileContent] = createCall;

      expect(filePath).toMatch(/^[0-9a-f-]+\.md$/);
      expect(fileContent).toContain("exo__Asset_uid:");
      expect(fileContent).toContain('"[[!kitelev]]"');
      expect(fileContent).toContain(`"[[${AssetClass.SESSION_END_EVENT}]]"`);
      expect(fileContent).toContain('ems__Session_area: "[[Work]]"');
      expect(fileContent).toContain("ems__SessionEvent_timestamp:");
      expect(fileContent).not.toContain("exo__Asset_label");
      expect(fileContent).not.toContain("aliases");
    });

    it("should use same timestamp format as start event", async () => {
      const areaName = "Personal";
      const mockCreatedFile: IFile = {
        path: "test-uid.md",
        basename: "test-uid",
        name: "test-uid.md",
        parent: null,
      };

      mockVault.getAllFiles.mockReturnValue([]);
      mockVault.create.mockResolvedValue(mockCreatedFile);

      await service.createSessionEndEvent(areaName);

      const createCall = mockVault.create.mock.calls[0];
      const [, fileContent] = createCall;

      const timestampMatch = fileContent.match(
        /ems__SessionEvent_timestamp: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/,
      );
      expect(timestampMatch).toBeTruthy();
    });

    it("should handle null areaFile gracefully", async () => {
      const areaName = "Work";
      const mockCreatedFile: IFile = {
        path: "test-uid.md",
        basename: "test-uid",
        name: "test-uid.md",
        parent: null,
      };

      mockVault.getAllFiles.mockReturnValue([]);
      mockVault.create.mockResolvedValue(mockCreatedFile);

      await expect(
        service.createSessionEndEvent(areaName),
      ).resolves.toBe(mockCreatedFile);
    });

    it("should use ontology asset folder for end events", async () => {
      const ontologyService = new SessionEventService(mockVault, "myOntology");
      const areaName = "Work";
      const mockOntologyFile: IFile = {
        path: "Ontologies/myOntology.md",
        basename: "myOntology",
        name: "myOntology.md",
        parent: {
          path: "Ontologies",
          name: "Ontologies",
        } as any,
      };
      const mockCreatedFile: IFile = {
        path: "Ontologies/test-uid.md",
        basename: "test-uid",
        name: "test-uid.md",
        parent: null,
      };

      mockVault.getAllFiles.mockReturnValue([mockOntologyFile]);
      mockVault.create.mockResolvedValue(mockCreatedFile);

      await ontologyService.createSessionEndEvent(areaName);

      const createCall = mockVault.create.mock.calls[0];
      const [filePath] = createCall;

      expect(filePath).toMatch(/^Ontologies\/.+\.md$/);
    });

    it("should create ontology folder if it does not exist", async () => {
      const ontologyService = new SessionEventService(mockVault, "myOntology");
      const areaName = "Work";
      const mockOntologyFile: IFile = {
        path: "Ontologies/myOntology.md",
        basename: "myOntology",
        name: "myOntology.md",
        parent: {
          path: "Ontologies",
          name: "Ontologies",
        } as any,
      };
      const mockCreatedFile: IFile = {
        path: "Ontologies/test-uid.md",
        basename: "test-uid",
        name: "test-uid.md",
        parent: null,
      };

      mockVault.getAllFiles.mockReturnValue([mockOntologyFile]);
      mockVault.exists.mockResolvedValue(false);
      mockVault.create.mockResolvedValue(mockCreatedFile);

      await ontologyService.createSessionEndEvent(areaName);

      expect(mockVault.createFolder).toHaveBeenCalledWith("Ontologies");
      expect(mockVault.create).toHaveBeenCalled();
    });
  });
});
