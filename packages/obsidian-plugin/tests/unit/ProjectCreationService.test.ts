import { ProjectCreationService } from "exocortex";

describe("ProjectCreationService", () => {
  let service: ProjectCreationService;
  let mockVault: any;

  beforeEach(() => {
    mockVault = {
      create: jest.fn().mockResolvedValue({ path: "test-project.md" }),
    };
    service = new ProjectCreationService(mockVault);
  });

  describe("generateProjectFrontmatter", () => {
    it("should generate frontmatter with ems__Effort_area for Area", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[Ontology/EMS]]"',
      };

      const frontmatter = service.generateProjectFrontmatter(
        sourceMetadata,
        "My Area",
        "ems__Area",
      );

      expect(frontmatter.exo__Instance_class).toEqual(['"[[ems__Project]]"']);
      expect(frontmatter.exo__Asset_isDefinedBy).toBe('"[[Ontology/EMS]]"');
      expect(frontmatter.ems__Effort_area).toBe('"[[My Area]]"');
      expect(frontmatter.exo__Asset_uid).toBeDefined();
      expect(frontmatter.exo__Asset_createdAt).toBeDefined();
    });

    it("should generate frontmatter with ems__Effort_parent for Initiative", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[Ontology/EMS]]"',
      };

      const frontmatter = service.generateProjectFrontmatter(
        sourceMetadata,
        "My Initiative",
        "ems__Initiative",
      );

      expect(frontmatter.exo__Instance_class).toEqual(['"[[ems__Project]]"']);
      expect(frontmatter.exo__Asset_isDefinedBy).toBe('"[[Ontology/EMS]]"');
      expect(frontmatter.ems__Effort_parent).toBe('"[[My Initiative]]"');
      expect(frontmatter.exo__Asset_uid).toBeDefined();
      expect(frontmatter.exo__Asset_createdAt).toBeDefined();
    });

    it("should generate frontmatter with ems__Effort_parent for Project", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[Ontology/EMS]]"',
      };

      const frontmatter = service.generateProjectFrontmatter(
        sourceMetadata,
        "Parent Project",
        "ems__Project",
      );

      expect(frontmatter.exo__Instance_class).toEqual(['"[[ems__Project]]"']);
      expect(frontmatter.exo__Asset_isDefinedBy).toBe('"[[Ontology/EMS]]"');
      expect(frontmatter.ems__Effort_parent).toBe('"[[Parent Project]]"');
      expect(frontmatter.exo__Asset_uid).toBeDefined();
      expect(frontmatter.exo__Asset_createdAt).toBeDefined();
    });

    it("should use provided UUID for exo__Asset_uid", () => {
      const testUid = "12345678-1234-4123-8123-123456789abc";
      const frontmatter = service.generateProjectFrontmatter(
        {},
        "Test Area",
        "ems__Area",
        undefined,
        testUid,
      );

      expect(frontmatter.exo__Asset_uid).toBe(testUid);
    });

    it("should generate valid UUIDv4 when no UUID provided", () => {
      const frontmatter = service.generateProjectFrontmatter(
        {},
        "Test Area",
        "ems__Area",
      );

      const uuidPattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      expect(frontmatter.exo__Asset_uid).toMatch(uuidPattern);
    });

    it("should generate ISO 8601 timestamp for exo__Asset_createdAt", () => {
      const frontmatter = service.generateProjectFrontmatter(
        {},
        "Test Area",
        "ems__Area",
      );

      const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
      expect(frontmatter.exo__Asset_createdAt).toMatch(isoPattern);
    });

    it("should copy exo__Asset_isDefinedBy from source metadata", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[Custom/Ontology]]"',
      };

      const frontmatter = service.generateProjectFrontmatter(
        sourceMetadata,
        "Area",
        "ems__Area",
      );

      expect(frontmatter.exo__Asset_isDefinedBy).toBe('"[[Custom/Ontology]]"');
    });

    it("should handle array format for exo__Asset_isDefinedBy", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: ['"[[!toos]]"'],
      };

      const frontmatter = service.generateProjectFrontmatter(
        sourceMetadata,
        "Area",
        "ems__Area",
      );

      expect(frontmatter.exo__Asset_isDefinedBy).toBe('"[[!toos]]"');
    });

    it("should add quotes to exo__Asset_isDefinedBy when missing", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: "[[!toos]]",
      };

      const frontmatter = service.generateProjectFrontmatter(
        sourceMetadata,
        "Area",
        "ems__Area",
      );

      expect(frontmatter.exo__Asset_isDefinedBy).toBe('"[[!toos]]"');
    });

    it("should default to empty quotes when exo__Asset_isDefinedBy is missing", () => {
      const sourceMetadata = {};

      const frontmatter = service.generateProjectFrontmatter(
        sourceMetadata,
        "Area",
        "ems__Area",
      );

      expect(frontmatter.exo__Asset_isDefinedBy).toBe('""');
    });

    it("should create quoted wiki-link to source Area in ems__Effort_area", () => {
      const frontmatter = service.generateProjectFrontmatter(
        {},
        "Sprint Planning",
        "ems__Area",
      );

      expect(frontmatter.ems__Effort_area).toBe('"[[Sprint Planning]]"');
    });

    it("should create quoted wiki-link to source Initiative in ems__Effort_parent", () => {
      const frontmatter = service.generateProjectFrontmatter(
        {},
        "Product Launch",
        "ems__Initiative",
      );

      expect(frontmatter.ems__Effort_parent).toBe('"[[Product Launch]]"');
    });

    it("should handle wiki-link formatted source class", () => {
      const frontmatter = service.generateProjectFrontmatter(
        {},
        "Test",
        "[[ems__Initiative]]",
      );

      expect(frontmatter.ems__Effort_parent).toBe('"[[Test]]"');
    });

    it("should default to ems__Effort_area for unknown source class", () => {
      const frontmatter = service.generateProjectFrontmatter(
        {},
        "Test",
        "ems__UnknownClass",
      );

      expect(frontmatter.ems__Effort_area).toBe('"[[Test]]"');
    });

    it("should include exo__Asset_label when label parameter is provided", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[Ontology/EMS]]"',
      };

      const frontmatter = service.generateProjectFrontmatter(
        sourceMetadata,
        "My Area",
        "ems__Area",
        "Test Label",
      );

      expect(frontmatter.exo__Asset_label).toBe("Test Label");
    });

    it("should NOT include exo__Asset_label when label parameter is empty string", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[Ontology/EMS]]"',
      };

      const frontmatter = service.generateProjectFrontmatter(
        sourceMetadata,
        "My Area",
        "ems__Area",
        "",
      );

      expect(frontmatter.exo__Asset_label).toBeUndefined();
    });

    it("should trim whitespace from label parameter", () => {
      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[Ontology/EMS]]"',
      };

      const frontmatter = service.generateProjectFrontmatter(
        sourceMetadata,
        "My Area",
        "ems__Area",
        "  Test Label  ",
      );

      expect(frontmatter.exo__Asset_label).toBe("Test Label");
    });
  });

  describe("createProject", () => {
    it("should create file with UUID-based filename", async () => {
      const mockSourceFile = {
        basename: "Test Area",
        parent: { path: "03 Knowledge/user" },
      } as any;

      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[!user]]"',
      };

      await service.createProject(mockSourceFile, sourceMetadata, "ems__Area");

      expect(mockVault.create).toHaveBeenCalledTimes(1);
      const [filePath] = mockVault.create.mock.calls[0];

      expect(filePath).toMatch(
        /^03 Knowledge\/user\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.md$/,
      );
    });

    it("should use same UUID for filename and exo__Asset_uid", async () => {
      const mockSourceFile = {
        basename: "Test Initiative",
        parent: { path: "03 Knowledge/user" },
      } as any;

      const sourceMetadata = {
        exo__Asset_isDefinedBy: '"[[!user]]"',
      };

      await service.createProject(
        mockSourceFile,
        sourceMetadata,
        "ems__Initiative",
      );

      const [filePath, content] = mockVault.create.mock.calls[0];

      const filenameMatch = filePath.match(
        /([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.md$/,
      );
      expect(filenameMatch).not.toBeNull();
      const filenameUid = filenameMatch![1];

      const uidMatch = content.match(/exo__Asset_uid: ([0-9a-f-]+)/);
      expect(uidMatch).not.toBeNull();
      const frontmatterUid = uidMatch![1];

      expect(filenameUid).toBe(frontmatterUid);
    });
  });
});
