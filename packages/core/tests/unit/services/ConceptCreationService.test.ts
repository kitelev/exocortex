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

    it("[C1] writes the parent as concept__Concept_genus — NOT the retired ims__ prefix and NOT the deprecated concept__Concept_broader", async () => {
      const parentFile = { basename: "ParentConcept" } as IFile;

      await service.createNarrowerConcept(parentFile, "narrow", "def", []);

      // The negative half is load-bearing and must be guarded by «a file was
      // created» — a bare `not.toContain` is vacuously green when nothing was
      // written at all (integration-test-revert-verify §A63).
      expect(mockVault.create).toHaveBeenCalledTimes(1);
      const content = mockVault.create.mock.calls[0][1];
      expect(content).toContain("concept__Concept_genus");
      expect(content).toContain("[[ParentConcept]]");
      expect(content).not.toContain("ims__Concept_broader");
      expect(content).not.toContain("concept__Concept_broader");
    });

    it("[C2] writes the definition under the live concept__ namespace, not the retired ims__ one", async () => {
      const parentFile = { basename: "Parent" } as IFile;

      await service.createNarrowerConcept(parentFile, "narrow", "My definition text", []);

      expect(mockVault.create).toHaveBeenCalledTimes(1);
      const content = mockVault.create.mock.calls[0][1];
      expect(content).toContain("concept__Concept_definition");
      expect(content).toContain("My definition text");
      expect(content).not.toContain("ims__Concept_definition");
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

    it("[C3] types the created asset as the live concept__Concept class — a retired-namespace class resolves to nothing, so SHACL and the command resolver would both skip the asset", async () => {
      const parentFile = { basename: "Parent" } as IFile;

      await service.createNarrowerConcept(parentFile, "narrow", "def", []);

      expect(mockVault.create).toHaveBeenCalledTimes(1);
      const content = mockVault.create.mock.calls[0][1];
      expect(content).toContain("exo__Instance_class");
      // ANCHORED on the emitted list ITEM, not on the bare substring. «concept__Concept»
      // alone has three witnesses in this frontmatter — the class value and the keys
      // `concept__Concept_genus` / `concept__Concept_definition` — so a bare toContain
      // stays green even when the asset is typed as something else entirely
      // (integration-test-revert-verify §A33: one witness cannot be removed by a
      // one-place mutation when three exist). Mutant M4 is what holds this line.
      //
      // The expected value is a LITERAL, deliberately not `AssetClass.CONCEPT`: an
      // expectation derived from the very constant under test follows it anywhere it
      // moves and can never disagree with it (§A21).
      expect(content).toContain('- "[[concept__Concept]]"');
      // Substring-safe: «concept__Concept» is a prefix of «concept__Concept_genus»,
      // so assert the retired form is absent rather than counting occurrences.
      expect(content).not.toContain("ims__Concept");
    });
  });
});
