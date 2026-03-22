import { TaskCreationService } from "../../../src/services/TaskCreationService";
import { TaskFrontmatterGenerator } from "../../../src/services/TaskFrontmatterGenerator";
import { AlgorithmExtractor } from "../../../src/services/AlgorithmExtractor";
import { AssetClass } from "../../../src/domain/constants/AssetClass";
import type { IVaultAdapter, IFile } from "../../../src/interfaces/IVaultAdapter";

jest.mock("uuid", () => ({
  v4: () => "test-uuid-1234-5678-9abc-def012345678",
}));

describe("TaskCreationService", () => {
  let service: TaskCreationService;
  let mockVault: jest.Mocked<IVaultAdapter>;
  let frontmatterGenerator: TaskFrontmatterGenerator;
  let algorithmExtractor: AlgorithmExtractor;

  const createMockFile = (overrides?: Partial<IFile>): IFile => ({
    path: "projects/my-project.md",
    basename: "my-project",
    name: "my-project.md",
    parent: { path: "projects", name: "projects" },
    ...overrides,
  });

  const baseMetadata = {
    exo__Asset_isDefinedBy: '"[[!kitelev]]"',
    exo__Instance_class: `"[[${AssetClass.PROJECT}]]"`,
  };

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
      updateLinks: jest.fn(),
      createFolder: jest.fn(),
      getFirstLinkpathDest: jest.fn(),
      process: jest.fn(),
      getDefaultNewFileParent: jest.fn(),
    } as jest.Mocked<IVaultAdapter>;

    frontmatterGenerator = new TaskFrontmatterGenerator();
    algorithmExtractor = new AlgorithmExtractor();

    service = new TaskCreationService(
      mockVault,
      frontmatterGenerator,
      algorithmExtractor,
    );
  });

  describe("createTask", () => {
    it("should create a task file in the source folder", async () => {
      const sourceFile = createMockFile();
      const createdFile = createMockFile({
        path: "projects/test-uuid-1234-5678-9abc-def012345678.md",
        basename: "test-uuid-1234-5678-9abc-def012345678",
        name: "test-uuid-1234-5678-9abc-def012345678.md",
      });
      mockVault.create.mockResolvedValue(createdFile);

      const result = await service.createTask(
        sourceFile,
        baseMetadata,
        AssetClass.PROJECT,
      );

      expect(result).toBe(createdFile);
      expect(mockVault.create).toHaveBeenCalledWith(
        "projects/test-uuid-1234-5678-9abc-def012345678.md",
        expect.stringContaining("exo__Asset_uid"),
      );
    });

    it("should create task with label", async () => {
      const sourceFile = createMockFile();
      const createdFile = createMockFile();
      mockVault.create.mockResolvedValue(createdFile);

      await service.createTask(
        sourceFile,
        baseMetadata,
        AssetClass.PROJECT,
        "My Task Label",
      );

      const content = mockVault.create.mock.calls[0][1];
      expect(content).toContain("My Task Label");
    });

    it("should create task with taskSize", async () => {
      const sourceFile = createMockFile();
      const createdFile = createMockFile();
      mockVault.create.mockResolvedValue(createdFile);

      await service.createTask(
        sourceFile,
        baseMetadata,
        AssetClass.PROJECT,
        undefined,
        "S",
      );

      const content = mockVault.create.mock.calls[0][1];
      expect(content).toContain("ems__Task_size: S");
    });

    it("should create task with plannedStartTimestamp", async () => {
      const sourceFile = createMockFile();
      const createdFile = createMockFile();
      mockVault.create.mockResolvedValue(createdFile);

      await service.createTask(
        sourceFile,
        baseMetadata,
        AssetClass.PROJECT,
        undefined,
        null,
        "2025-06-15T10:00:00",
      );

      const content = mockVault.create.mock.calls[0][1];
      expect(content).toContain("ems__Effort_plannedStartTimestamp: 2025-06-15T10:00:00");
    });

    it("should extract Algorithm section from TaskPrototype source", async () => {
      const sourceFile = createMockFile({
        path: "prototypes/my-proto.md",
        basename: "my-proto",
        name: "my-proto.md",
        parent: { path: "prototypes", name: "prototypes" },
      });
      const createdFile = createMockFile();
      mockVault.create.mockResolvedValue(createdFile);

      const protoContent = `---
exo__Instance_class: "[[${AssetClass.TASK_PROTOTYPE}]]"
---

## Algorithm

Step 1: Do this
Step 2: Do that

## Notes

Some notes`;
      mockVault.read.mockResolvedValue(protoContent);

      await service.createTask(
        sourceFile,
        { ...baseMetadata, exo__Instance_class: `"[[${AssetClass.TASK_PROTOTYPE}]]"` },
        AssetClass.TASK_PROTOTYPE,
      );

      const content = mockVault.create.mock.calls[0][1];
      expect(content).toContain("## Algorithm");
      expect(content).toContain("Step 1: Do this");
      expect(content).toContain("Step 2: Do that");
    });

    it("should not extract Algorithm if section not found in TaskPrototype", async () => {
      const sourceFile = createMockFile({
        path: "prototypes/my-proto.md",
        basename: "my-proto",
        name: "my-proto.md",
        parent: { path: "prototypes", name: "prototypes" },
      });
      const createdFile = createMockFile();
      mockVault.create.mockResolvedValue(createdFile);

      const protoContent = `---
exo__Instance_class: "[[${AssetClass.TASK_PROTOTYPE}]]"
---

## Notes

Some notes only`;
      mockVault.read.mockResolvedValue(protoContent);

      await service.createTask(
        sourceFile,
        { ...baseMetadata, exo__Instance_class: `"[[${AssetClass.TASK_PROTOTYPE}]]"` },
        AssetClass.TASK_PROTOTYPE,
      );

      const content = mockVault.create.mock.calls[0][1];
      expect(content).not.toContain("## Algorithm");
    });

    it("should handle sourceFile with null parent (root folder)", async () => {
      const sourceFile = createMockFile({
        parent: null,
      });
      const createdFile = createMockFile();
      mockVault.create.mockResolvedValue(createdFile);

      await service.createTask(
        sourceFile,
        baseMetadata,
        AssetClass.PROJECT,
      );

      expect(mockVault.create).toHaveBeenCalledWith(
        "test-uuid-1234-5678-9abc-def012345678.md",
        expect.any(String),
      );
    });

    it("should not include taskSize when null", async () => {
      const sourceFile = createMockFile();
      const createdFile = createMockFile();
      mockVault.create.mockResolvedValue(createdFile);

      await service.createTask(
        sourceFile,
        baseMetadata,
        AssetClass.PROJECT,
        undefined,
        null,
      );

      const content = mockVault.create.mock.calls[0][1];
      expect(content).not.toContain("ems__Task_size");
    });

    it("should handle wiki-link sourceClass like [[ems__Project]]", async () => {
      const sourceFile = createMockFile();
      const createdFile = createMockFile();
      mockVault.create.mockResolvedValue(createdFile);

      await service.createTask(
        sourceFile,
        baseMetadata,
        `"[[${AssetClass.PROJECT}]]"`,
      );

      expect(mockVault.create).toHaveBeenCalled();
    });
  });

  describe("createRelatedTask", () => {
    it("should create a related task and add relation to source file", async () => {
      const sourceFile = createMockFile();
      const createdFile = createMockFile({
        path: "projects/test-uuid-1234-5678-9abc-def012345678.md",
      });
      mockVault.create.mockResolvedValue(createdFile);

      const sourceContent = `---
exo__Asset_uid: source-uid
---

Body content`;
      mockVault.read.mockResolvedValue(sourceContent);

      const result = await service.createRelatedTask(
        sourceFile,
        baseMetadata,
      );

      expect(result).toBe(createdFile);
      // Should create the new task
      expect(mockVault.create).toHaveBeenCalled();
      // Should modify the source file to add relation
      expect(mockVault.modify).toHaveBeenCalledWith(
        sourceFile,
        expect.stringContaining("exo__Asset_relates"),
      );
    });

    it("should create related task with label", async () => {
      const sourceFile = createMockFile();
      const createdFile = createMockFile();
      mockVault.create.mockResolvedValue(createdFile);
      mockVault.read.mockResolvedValue("---\nexo__Asset_uid: uid\n---\nBody");

      await service.createRelatedTask(
        sourceFile,
        baseMetadata,
        "Related Label",
      );

      const content = mockVault.create.mock.calls[0][1];
      expect(content).toContain("Related Label");
    });

    it("should create related task with taskSize", async () => {
      const sourceFile = createMockFile();
      const createdFile = createMockFile();
      mockVault.create.mockResolvedValue(createdFile);
      mockVault.read.mockResolvedValue("---\nexo__Asset_uid: uid\n---\nBody");

      await service.createRelatedTask(
        sourceFile,
        baseMetadata,
        undefined,
        "M",
      );

      const content = mockVault.create.mock.calls[0][1];
      expect(content).toContain("ems__Task_size: M");
    });

    it("should handle source file with null parent", async () => {
      const sourceFile = createMockFile({ parent: null });
      const createdFile = createMockFile();
      mockVault.create.mockResolvedValue(createdFile);
      mockVault.read.mockResolvedValue("---\nexo__Asset_uid: uid\n---\nBody");

      await service.createRelatedTask(
        sourceFile,
        baseMetadata,
      );

      expect(mockVault.create).toHaveBeenCalledWith(
        "test-uuid-1234-5678-9abc-def012345678.md",
        expect.any(String),
      );
    });

    it("should add relation to source file that has existing relates property", async () => {
      const sourceFile = createMockFile();
      const createdFile = createMockFile();
      mockVault.create.mockResolvedValue(createdFile);

      const sourceContent = `---
exo__Asset_uid: source-uid
exo__Asset_relates:
  - "[[existing-relation]]"
---

Body content`;
      mockVault.read.mockResolvedValue(sourceContent);

      await service.createRelatedTask(sourceFile, baseMetadata);

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).toContain("[[existing-relation]]");
      expect(modifiedContent).toContain("[[test-uuid-1234-5678-9abc-def012345678]]");
    });

    it("should add frontmatter to source file that has no frontmatter", async () => {
      const sourceFile = createMockFile();
      const createdFile = createMockFile();
      mockVault.create.mockResolvedValue(createdFile);

      mockVault.read.mockResolvedValue("Just body content, no frontmatter");

      await service.createRelatedTask(sourceFile, baseMetadata);

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).toContain("---");
      expect(modifiedContent).toContain("exo__Asset_relates:");
    });
  });

  describe("generateTaskFrontmatter", () => {
    it("should delegate to frontmatterGenerator", () => {
      const result = service.generateTaskFrontmatter(
        baseMetadata,
        "source-name",
        AssetClass.PROJECT,
        "Label",
        "uid-123",
        "S",
        "2025-06-15T10:00:00",
      );

      expect(result).toHaveProperty("exo__Asset_uid", "uid-123");
      expect(result).toHaveProperty("exo__Asset_label", "Label");
      expect(result).toHaveProperty("ems__Task_size", "S");
      expect(result).toHaveProperty("ems__Effort_plannedStartTimestamp", "2025-06-15T10:00:00");
    });

    it("should work without optional params", () => {
      const result = service.generateTaskFrontmatter(
        baseMetadata,
        "source-name",
        AssetClass.PROJECT,
      );

      expect(result).toHaveProperty("exo__Instance_class");
      expect(result).toHaveProperty("ems__Effort_status");
    });
  });

  describe("addRelationToFrontmatter (via createRelatedTask)", () => {
    it("should handle CRLF line endings in source content", async () => {
      const sourceFile = createMockFile();
      const createdFile = createMockFile();
      mockVault.create.mockResolvedValue(createdFile);

      const sourceContent = "---\r\nexo__Asset_uid: source-uid\r\n---\r\n\r\nBody";
      mockVault.read.mockResolvedValue(sourceContent);

      await service.createRelatedTask(sourceFile, baseMetadata);

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).toContain("exo__Asset_relates:");
    });

    it("should handle source with relates property but no items match", async () => {
      const sourceFile = createMockFile();
      const createdFile = createMockFile();
      mockVault.create.mockResolvedValue(createdFile);

      // relates property exists but with non-standard format
      const sourceContent = `---
exo__Asset_uid: source-uid
exo__Asset_relates:
---

Body`;
      mockVault.read.mockResolvedValue(sourceContent);

      await service.createRelatedTask(sourceFile, baseMetadata);

      expect(mockVault.modify).toHaveBeenCalled();
    });
  });
});
