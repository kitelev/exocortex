import { ConceptCreationService, AssetClass } from "exocortex";

describe("ConceptCreationService", () => {
  let service: ConceptCreationService;
  let mockVault: any;

  beforeEach(() => {
    mockVault = {
      create: jest.fn().mockResolvedValue({ path: "concepts/test-concept.md" }),
      getAbstractFileByPath: jest.fn().mockReturnValue(null),
      createFolder: jest.fn().mockResolvedValue(undefined),
    };
    service = new ConceptCreationService(mockVault);
  });

  describe("createNarrowerConcept", () => {
    it("should create concept file with basic frontmatter", async () => {
      const mockParentFile = {
        basename: "Parent Concept",
      } as any;

      await service.createNarrowerConcept(
        mockParentFile,
        "Child Concept",
        "Definition of child concept",
        ["alias1", "alias2"],
      );

      expect(mockVault.create).toHaveBeenCalledTimes(1);
      const [filePath, content] = mockVault.create.mock.calls[0];

      expect(filePath).toBe("concepts/Child Concept.md");
      expect(content).toContain('exo__Asset_isDefinedBy: "[[!concepts]]"');
      expect(content).toContain("exo__Instance_class:");
      expect(content).toContain(`- "[[${AssetClass.CONCEPT}]]"`);
      expect(content).toContain('ims__Concept_broader: "[[Parent Concept]]"');
      expect(content).toContain(
        "ims__Concept_definition: Definition of child concept",
      );
      expect(content).toContain("aliases:");
      expect(content).toContain("  - alias1");
      expect(content).toContain("  - alias2");
    });

    it("should add .md extension if not provided", async () => {
      const mockParentFile = {
        basename: "Parent Concept",
      } as any;

      await service.createNarrowerConcept(
        mockParentFile,
        "Child Concept",
        "Definition",
        [],
      );

      const [filePath] = mockVault.create.mock.calls[0];
      expect(filePath).toBe("concepts/Child Concept.md");
    });

    it("should not duplicate .md extension if already provided", async () => {
      const mockParentFile = {
        basename: "Parent Concept",
      } as any;

      await service.createNarrowerConcept(
        mockParentFile,
        "Child Concept.md",
        "Definition",
        [],
      );

      const [filePath] = mockVault.create.mock.calls[0];
      expect(filePath).toBe("concepts/Child Concept.md");
    });

    it("should create concepts folder if it does not exist", async () => {
      mockVault.getAbstractFileByPath.mockReturnValue(null);

      const mockParentFile = {
        basename: "Parent Concept",
      } as any;

      await service.createNarrowerConcept(
        mockParentFile,
        "Child Concept",
        "Definition",
        [],
      );

      expect(mockVault.getAbstractFileByPath).toHaveBeenCalledWith("concepts");
      expect(mockVault.createFolder).toHaveBeenCalledWith("concepts");
    });

    it("should not create concepts folder if it already exists", async () => {
      mockVault.getAbstractFileByPath.mockReturnValue({
        path: "concepts",
      });

      const mockParentFile = {
        basename: "Parent Concept",
      } as any;

      await service.createNarrowerConcept(
        mockParentFile,
        "Child Concept",
        "Definition",
        [],
      );

      expect(mockVault.getAbstractFileByPath).toHaveBeenCalledWith("concepts");
      expect(mockVault.createFolder).not.toHaveBeenCalled();
    });

    it("should generate valid UUIDv4 for exo__Asset_uid", async () => {
      const mockParentFile = {
        basename: "Parent Concept",
      } as any;

      await service.createNarrowerConcept(
        mockParentFile,
        "Child Concept",
        "Definition",
        [],
      );

      const [, content] = mockVault.create.mock.calls[0];

      const uuidPattern =
        /exo__Asset_uid: ([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/;
      expect(content).toMatch(uuidPattern);
    });

    it("should generate ISO 8601 timestamp for exo__Asset_createdAt", async () => {
      const mockParentFile = {
        basename: "Parent Concept",
      } as any;

      await service.createNarrowerConcept(
        mockParentFile,
        "Child Concept",
        "Definition",
        [],
      );

      const [, content] = mockVault.create.mock.calls[0];

      const isoPattern =
        /exo__Asset_createdAt: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
      expect(content).toMatch(isoPattern);
    });

    it("should omit aliases if empty array provided", async () => {
      const mockParentFile = {
        basename: "Parent Concept",
      } as any;

      await service.createNarrowerConcept(
        mockParentFile,
        "Child Concept",
        "Definition",
        [],
      );

      const [, content] = mockVault.create.mock.calls[0];

      expect(content).not.toContain("aliases:");
    });

    it("should include single alias", async () => {
      const mockParentFile = {
        basename: "Parent Concept",
      } as any;

      await service.createNarrowerConcept(
        mockParentFile,
        "Child Concept",
        "Definition",
        ["single-alias"],
      );

      const [, content] = mockVault.create.mock.calls[0];

      expect(content).toContain("aliases:");
      expect(content).toContain("  - single-alias");
    });

    it("should include multiple aliases", async () => {
      const mockParentFile = {
        basename: "Parent Concept",
      } as any;

      await service.createNarrowerConcept(
        mockParentFile,
        "Child Concept",
        "Definition",
        ["alias1", "alias2", "alias3"],
      );

      const [, content] = mockVault.create.mock.calls[0];

      expect(content).toContain("aliases:");
      expect(content).toContain("  - alias1");
      expect(content).toContain("  - alias2");
      expect(content).toContain("  - alias3");
    });

    it("should handle parent concept name with special characters", async () => {
      const mockParentFile = {
        basename: "Parent & Special: Concept",
      } as any;

      await service.createNarrowerConcept(
        mockParentFile,
        "Child Concept",
        "Definition",
        [],
      );

      const [, content] = mockVault.create.mock.calls[0];

      expect(content).toContain(
        'ims__Concept_broader: "[[Parent & Special: Concept]]"',
      );
    });

    it("should handle empty definition", async () => {
      const mockParentFile = {
        basename: "Parent Concept",
      } as any;

      await service.createNarrowerConcept(
        mockParentFile,
        "Child Concept",
        "",
        [],
      );

      const [, content] = mockVault.create.mock.calls[0];

      expect(content).toMatch(/ims__Concept_definition:\s*$/m);
    });

    it("should handle definition with special characters", async () => {
      const mockParentFile = {
        basename: "Parent Concept",
      } as any;

      await service.createNarrowerConcept(
        mockParentFile,
        "Child Concept",
        "Definition with: quotes, commas, & symbols!",
        [],
      );

      const [, content] = mockVault.create.mock.calls[0];

      expect(content).toContain(
        "ims__Concept_definition: Definition with: quotes, commas, & symbols!",
      );
    });

    it("should return created file", async () => {
      const mockCreatedFile = {
        path: "concepts/Child Concept.md",
        basename: "Child Concept",
      };
      mockVault.create.mockResolvedValue(mockCreatedFile);

      const mockParentFile = {
        basename: "Parent Concept",
      } as any;

      const result = await service.createNarrowerConcept(
        mockParentFile,
        "Child Concept",
        "Definition",
        [],
      );

      expect(result).toBe(mockCreatedFile);
    });

    it("should handle file creation error", async () => {
      mockVault.create.mockRejectedValue(new Error("Vault error"));

      const mockParentFile = {
        basename: "Parent Concept",
      } as any;

      await expect(
        service.createNarrowerConcept(
          mockParentFile,
          "Child Concept",
          "Definition",
          [],
        ),
      ).rejects.toThrow("Vault error");
    });

    it("should handle folder creation error", async () => {
      mockVault.getAbstractFileByPath.mockReturnValue(null);
      mockVault.createFolder.mockRejectedValue(new Error("Folder error"));

      const mockParentFile = {
        basename: "Parent Concept",
      } as any;

      await expect(
        service.createNarrowerConcept(
          mockParentFile,
          "Child Concept",
          "Definition",
          [],
        ),
      ).rejects.toThrow("Folder error");
    });

    it("should handle null parent file basename", async () => {
      const mockParentFile = {
        basename: null,
      } as any;

      await service.createNarrowerConcept(
        mockParentFile,
        "Child Concept",
        "Definition",
        [],
      );

      const [, content] = mockVault.create.mock.calls[0];

      expect(content).toContain('ims__Concept_broader: "[[null]]"');
    });

    it("should handle undefined parent file basename", async () => {
      const mockParentFile = {
        basename: undefined,
      } as any;

      await service.createNarrowerConcept(
        mockParentFile,
        "Child Concept",
        "Definition",
        [],
      );

      const [, content] = mockVault.create.mock.calls[0];

      expect(content).toContain('ims__Concept_broader: "[[undefined]]"');
    });

    it("should create file in concepts folder regardless of parent location", async () => {
      const mockParentFile = {
        basename: "Parent Concept",
        parent: { path: "some/other/folder" },
      } as any;

      await service.createNarrowerConcept(
        mockParentFile,
        "Child Concept",
        "Definition",
        [],
      );

      const [filePath] = mockVault.create.mock.calls[0];

      expect(filePath).toBe("concepts/Child Concept.md");
    });

    it("should include CONCEPT asset class", async () => {
      const mockParentFile = {
        basename: "Parent Concept",
      } as any;

      await service.createNarrowerConcept(
        mockParentFile,
        "Child Concept",
        "Definition",
        [],
      );

      const [, content] = mockVault.create.mock.calls[0];

      expect(content).toContain(`"[[${AssetClass.CONCEPT}]]"`);
      expect(AssetClass.CONCEPT).toBe("ims__Concept");
    });
  });
});
