import "reflect-metadata";
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { ConceptCreationService } from "../../../src/services/ConceptCreationService";
import type { IVaultAdapter, IFile } from "../../../src/interfaces/IVaultAdapter";

describe("ConceptCreationService", () => {
  let service: ConceptCreationService;
  let mockVault: jest.Mocked<IVaultAdapter>;

  beforeEach(() => {
    mockVault = {
      create: jest.fn<(path: string, content: string) => Promise<IFile>>(),
      createFolder: jest.fn<(path: string) => Promise<void>>(),
      getAbstractFileByPath: jest.fn(),
    } as unknown as jest.Mocked<IVaultAdapter>;

    mockVault.create.mockResolvedValue({ path: "concepts/test.md", basename: "test" } as IFile);

    service = new (ConceptCreationService as any)(mockVault);
  });

  describe("createNarrowerConcept", () => {
    it("should create file in concepts folder", async () => {
      const parentFile = { basename: "BroadConcept" } as IFile;

      await service.createNarrowerConcept(parentFile, "narrow", "A definition", []);

      expect(mockVault.create).toHaveBeenCalledWith(
        expect.stringContaining("concepts/"),
        expect.any(String),
      );
    });

    it("should create concepts folder if not exists", async () => {
      mockVault.getAbstractFileByPath.mockReturnValue(null);
      const parentFile = { basename: "BroadConcept" } as IFile;

      await service.createNarrowerConcept(parentFile, "narrow", "def", []);

      expect(mockVault.createFolder).toHaveBeenCalledWith("concepts");
    });

    it("should not create folder if already exists", async () => {
      mockVault.getAbstractFileByPath.mockReturnValue({ path: "concepts", name: "concepts" });
      const parentFile = { basename: "BroadConcept" } as IFile;

      await service.createNarrowerConcept(parentFile, "narrow", "def", []);

      expect(mockVault.createFolder).not.toHaveBeenCalled();
    });

    it("should set broader concept reference", async () => {
      const parentFile = { basename: "ParentConcept" } as IFile;

      await service.createNarrowerConcept(parentFile, "narrow", "def", []);

      const content = mockVault.create.mock.calls[0][1];
      expect(content).toContain("ims__Concept_broader");
      expect(content).toContain("[[ParentConcept]]");
    });

    it("should include definition", async () => {
      const parentFile = { basename: "Parent" } as IFile;

      await service.createNarrowerConcept(parentFile, "narrow", "My definition text", []);

      const content = mockVault.create.mock.calls[0][1];
      expect(content).toContain("ims__Concept_definition");
      expect(content).toContain("My definition text");
    });

    it("should include aliases when provided", async () => {
      const parentFile = { basename: "Parent" } as IFile;

      await service.createNarrowerConcept(parentFile, "narrow", "def", ["alias1", "alias2"]);

      const content = mockVault.create.mock.calls[0][1];
      expect(content).toContain("aliases");
      expect(content).toContain("alias1");
      expect(content).toContain("alias2");
    });

    it("should not include aliases when empty array", async () => {
      const parentFile = { basename: "Parent" } as IFile;

      await service.createNarrowerConcept(parentFile, "narrow", "def", []);

      const content = mockVault.create.mock.calls[0][1];
      expect(content).not.toContain("aliases");
    });

    it("should add .md extension to filename if missing", async () => {
      const parentFile = { basename: "Parent" } as IFile;

      await service.createNarrowerConcept(parentFile, "my-concept", "def", []);

      const filePath = mockVault.create.mock.calls[0][0];
      expect(filePath).toMatch(/\.md$/);
    });

    it("should not double .md extension", async () => {
      const parentFile = { basename: "Parent" } as IFile;

      await service.createNarrowerConcept(parentFile, "my-concept.md", "def", []);

      const filePath = mockVault.create.mock.calls[0][0];
      expect(filePath).not.toContain(".md.md");
    });

    it("should include ims__Concept instance class", async () => {
      const parentFile = { basename: "Parent" } as IFile;

      await service.createNarrowerConcept(parentFile, "narrow", "def", []);

      const content = mockVault.create.mock.calls[0][1];
      expect(content).toContain("exo__Instance_class");
      expect(content).toContain("ims__Concept");
    });
  });
});
