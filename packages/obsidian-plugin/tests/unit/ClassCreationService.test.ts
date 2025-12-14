import { ClassCreationService } from "exocortex";
import { IVaultAdapter, IFile } from "exocortex";

describe("ClassCreationService", () => {
  let service: ClassCreationService;
  let mockVault: jest.Mocked<IVaultAdapter>;
  let mockParentFile: IFile;

  beforeEach(() => {
    mockVault = {
      getAbstractFileByPath: jest.fn(),
      createFolder: jest.fn(),
      create: jest.fn(),
      modify: jest.fn(),
      read: jest.fn(),
      delete: jest.fn(),
      rename: jest.fn(),
      exists: jest.fn(),
      getFiles: jest.fn(),
    } as any;

    mockParentFile = {
      path: "classes/ParentClass.md",
      basename: "ParentClass",
      extension: "md",
      name: "ParentClass.md",
      parent: null,
    } as IFile;

    service = new ClassCreationService(mockVault);
  });

  describe("createSubclass", () => {
    it("should create subclass with correct frontmatter", async () => {
      const parentMetadata = {
        exo__Asset_isDefinedBy: '"[[Ontology/EXO]]"',
      };

      mockVault.getAbstractFileByPath.mockReturnValue(null);
      mockVault.create.mockResolvedValue({
        path: "classes/test-subclass.md",
        basename: "test-subclass",
        extension: "md",
        name: "test-subclass.md",
        parent: null,
      } as IFile);

      const result = await service.createSubclass(
        mockParentFile,
        "Test Subclass",
        parentMetadata,
      );

      expect(mockVault.createFolder).toHaveBeenCalledWith("classes");
      expect(mockVault.create).toHaveBeenCalled();

      const createArgs = mockVault.create.mock.calls[0];
      const filePath = createArgs[0];
      const content = createArgs[1];

      expect(filePath).toBe("classes/test-subclass.md");
      expect(content).toContain("exo__Asset_label: Test Subclass");
      expect(content).toContain('exo__Instance_class:\n  - "[[exo__Class]]"');
      expect(content).toContain('exo__Class_superClass: "[[ParentClass]]"');
      expect(content).toContain('exo__Asset_isDefinedBy: "[[Ontology/EXO]]"');
      expect(content).toContain("aliases:\n  - Test Subclass");
      expect(result.path).toBe("classes/test-subclass.md");
    });

    it("should not create folder if it already exists", async () => {
      const parentMetadata = {};

      mockVault.getAbstractFileByPath.mockReturnValue({ type: "folder" } as any);
      mockVault.create.mockResolvedValue({
        path: "classes/subclass.md",
        basename: "subclass",
        extension: "md",
        name: "subclass.md",
        parent: null,
      } as IFile);

      await service.createSubclass(mockParentFile, "Subclass", parentMetadata);

      expect(mockVault.createFolder).not.toHaveBeenCalled();
    });

    it("should generate correct filename from label", async () => {
      const parentMetadata = {};

      mockVault.getAbstractFileByPath.mockReturnValue({ type: "folder" } as any);
      mockVault.create.mockResolvedValue({
        path: "classes/complex-subclass-name.md",
        basename: "complex-subclass-name",
        extension: "md",
        name: "complex-subclass-name.md",
        parent: null,
      } as IFile);

      await service.createSubclass(
        mockParentFile,
        "Complex Subclass Name!",
        parentMetadata,
      );

      const createArgs = mockVault.create.mock.calls[0];
      const filePath = createArgs[0];

      expect(filePath).toBe("classes/complex-subclass-name.md");
    });

    it("should inherit isDefinedBy from parent", async () => {
      const parentMetadata = {
        exo__Asset_isDefinedBy: '"[[Custom/Ontology]]"',
      };

      mockVault.getAbstractFileByPath.mockReturnValue({ type: "folder" } as any);
      mockVault.create.mockResolvedValue({
        path: "classes/child.md",
        basename: "child",
        extension: "md",
        name: "child.md",
        parent: null,
      } as IFile);

      await service.createSubclass(mockParentFile, "Child", parentMetadata);

      const createArgs = mockVault.create.mock.calls[0];
      const content = createArgs[1];

      expect(content).toContain('exo__Asset_isDefinedBy: "[[Custom/Ontology]]"');
    });

    it("should use default isDefinedBy if not in parent", async () => {
      const parentMetadata = {};

      mockVault.getAbstractFileByPath.mockReturnValue({ type: "folder" } as any);
      mockVault.create.mockResolvedValue({
        path: "classes/child.md",
        basename: "child",
        extension: "md",
        name: "child.md",
        parent: null,
      } as IFile);

      await service.createSubclass(mockParentFile, "Child", parentMetadata);

      const createArgs = mockVault.create.mock.calls[0];
      const content = createArgs[1];

      expect(content).toContain('exo__Asset_isDefinedBy: "[[Ontology/EXO]]"');
    });

    it("should add .md extension if not present", async () => {
      const parentMetadata = {};

      mockVault.getAbstractFileByPath.mockReturnValue({ type: "folder" } as any);
      mockVault.create.mockResolvedValue({
        path: "classes/test.md",
        basename: "test",
        extension: "md",
        name: "test.md",
        parent: null,
      } as IFile);

      await service.createSubclass(mockParentFile, "Test", parentMetadata);

      const createArgs = mockVault.create.mock.calls[0];
      const filePath = createArgs[0];

      expect(filePath).toBe("classes/test.md");
    });

    it("should include createdAt timestamp", async () => {
      const parentMetadata = {};

      mockVault.getAbstractFileByPath.mockReturnValue({ type: "folder" } as any);
      mockVault.create.mockResolvedValue({
        path: "classes/child.md",
        basename: "child",
        extension: "md",
        name: "child.md",
        parent: null,
      } as IFile);

      await service.createSubclass(mockParentFile, "Child", parentMetadata);

      const createArgs = mockVault.create.mock.calls[0];
      const content = createArgs[1];

      expect(content).toMatch(/exo__Asset_createdAt: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it("should generate valid UUID for uid", async () => {
      const parentMetadata = {};

      mockVault.getAbstractFileByPath.mockReturnValue({ type: "folder" } as any);
      mockVault.create.mockResolvedValue({
        path: "classes/child.md",
        basename: "child",
        extension: "md",
        name: "child.md",
        parent: null,
      } as IFile);

      await service.createSubclass(mockParentFile, "Child", parentMetadata);

      const createArgs = mockVault.create.mock.calls[0];
      const content = createArgs[1];

      expect(content).toMatch(/exo__Asset_uid: [0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/);
    });
  });
});
