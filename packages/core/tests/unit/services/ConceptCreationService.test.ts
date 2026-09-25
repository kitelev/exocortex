import "reflect-metadata";
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { ConceptCreationService } from "../../../src/services/ConceptCreationService";
import type { IVaultAdapter, IFile } from "../../../src/interfaces/IVaultAdapter";
import { parseYamlFrontmatterTolerant } from "../../../src/utilities/parseYamlFrontmatter";

describe("ConceptCreationService", () => {
  let service: ConceptCreationService;
  let mockVault: jest.Mocked<IVaultAdapter>;

  beforeEach(() => {
    mockVault = {
      create: jest.fn<(path: string, content: string) => Promise<IFile>>(),
      createFolder: jest.fn<(path: string) => Promise<void>>(),
      getAbstractFileByPath: jest.fn(),
      // Part of IVaultAdapter's contract, and the service reads it to inherit the parent's
      // anchor. Absent from this mock until #4357, which is why the whole suite could not see
      // that the service never consulted the parent at all (test-fixture-realism).
      getFrontmatter: jest.fn(() => null),
    } as unknown as jest.Mocked<IVaultAdapter>;

    mockVault.create.mockResolvedValue({ path: "concepts/test.md", basename: "test" } as IFile);

    service = new (ConceptCreationService as any)(mockVault);
  });

  describe("createNarrowerConcept", () => {
    // ⛔ This test previously asserted `stringContaining("concepts/")` and passed while the
    // service wrote to a hardcoded top-level `concepts/` — the vault ROOT, outside every
    // assetspace, where ExoSync never carried the file (issue #4357). `stringContaining` could
    // not tell the two apart: the correct path `.../exoas-concept/concept/x.md` contains
    // "concept/" too. Anchored on the PARENT's folder, which is what co-location means here.
    it("[C5] creates the concept BESIDE its parent, not in a top-level folder", async () => {
      const parentFile = { basename: "BroadConcept", path: "assetspaces/kitelev/exoas-concept/concept/BroadConcept.md" } as IFile;

      await service.createNarrowerConcept(parentFile, "narrow", "A definition", []);

      const [writtenPath] = mockVault.create.mock.calls[0] as [string, string];
      expect(writtenPath).toBe("assetspaces/kitelev/exoas-concept/concept/narrow.md");
      // The defect, stated negatively: never the vault root.
      expect(writtenPath.startsWith("concepts/")).toBe(false);
    });

    it("[C6] creates the PARENT's folder when it is missing — never a top-level one", async () => {
      mockVault.getAbstractFileByPath.mockReturnValue(null);
      const parentFile = { basename: "BroadConcept", path: "assetspaces/kitelev/exoas-concept/concept/BroadConcept.md" } as IFile;

      await service.createNarrowerConcept(parentFile, "narrow", "def", []);

      expect(mockVault.createFolder).toHaveBeenCalledWith("assetspaces/kitelev/exoas-concept/concept");
      expect(mockVault.createFolder).not.toHaveBeenCalledWith("concepts");
    });

    it("should not create folder if already exists", async () => {
      mockVault.getAbstractFileByPath.mockReturnValue({ path: "concepts", name: "concepts" });
      const parentFile = { basename: "BroadConcept", path: "assetspaces/kitelev/exoas-concept/concept/BroadConcept.md" } as IFile;

      await service.createNarrowerConcept(parentFile, "narrow", "def", []);

      expect(mockVault.createFolder).not.toHaveBeenCalled();
    });

    it("[C7] declares the PARENT's ontology anchor, so the child is co-located with what it names", async () => {
      const parentFile = { basename: "BroadConcept", path: "assetspaces/kitelev/exoas-concept/concept/BroadConcept.md" } as IFile;
      mockVault.getFrontmatter.mockReturnValue({
        exo__Asset_isDefinedBy: "[[13447b69-9541-4263-8f47-c28f3f0c89d6|$concept]]",
      } as never);

      await service.createNarrowerConcept(parentFile, "narrow", "def", []);

      const content = mockVault.create.mock.calls[0][1];
      expect(content).toContain(
        'exo__Asset_isDefinedBy: "[[13447b69-9541-4263-8f47-c28f3f0c89d6|$concept]]"',
      );
      // The bang anchor is fail-open for `audit co-location` — that is exactly why the old
      // placement bug could not be caught by that audit. Inheriting a real anchor is what makes
      // the placement checkable at all.
      expect(content).not.toContain("[[!concepts]]");
    });

    it("[C8] falls back to the previous anchor when the parent declares none", async () => {
      const parentFile = { basename: "BroadConcept", path: "assetspaces/kitelev/exoas-concept/concept/BroadConcept.md" } as IFile;
      mockVault.getFrontmatter.mockReturnValue(null);

      await service.createNarrowerConcept(parentFile, "narrow", "def", []);

      const content = mockVault.create.mock.calls[0][1];
      expect(content).toContain('exo__Asset_isDefinedBy: "[[!concepts]]"');
    });

    it("[C9] reads the parent through the DISK FALLBACK, so a cold metadataCache cannot silently drop the anchor", async () => {
      const parentFile = {
        basename: "BroadConcept",
        path: "assetspaces/kitelev/exoas-concept/concept/BroadConcept.md",
      } as IFile;
      // Exactly the cold-cache shape: the cached reader knows nothing yet, the disk does.
      // Without the fallback the anchor degrades to the fail-open `[[!concepts]]` sentinel,
      // which `audit co-location` skips BY DESIGN — so the regression would be invisible.
      mockVault.getFrontmatter.mockReturnValue(null);
      (mockVault as unknown as {
        getFrontmatterWithFallback: () => Promise<Record<string, unknown>>;
      }).getFrontmatterWithFallback = jest.fn(async () => ({
        exo__Asset_isDefinedBy: "[[9d1d2e9d|$concept]]",
      }));

      await service.createNarrowerConcept(parentFile, "narrow", "def", []);

      const content = mockVault.create.mock.calls[0][1];
      expect(content).toContain('exo__Asset_isDefinedBy: "[[9d1d2e9d|$concept]]"');
      expect(content).not.toContain("[[!concepts]]");
    });

    it("[C10] round-trips an anchor containing a double quote — the shared serializer owns quoting, not a hand-rolled wrapper", async () => {
      const parentFile = {
        basename: "BroadConcept",
        path: "assetspaces/kitelev/exoas-concept/concept/BroadConcept.md",
      } as IFile;
      // A parent alias may legitimately contain `"`. Pre-quoting the value by hand produced
      // `""[[…]]""`, which the serializer then escaped wholesale: the reader decoded a LITERAL
      // string with quote characters as data instead of a wikilink.
      const anchorValue = '[[9d1d2e9d|Some "Quoted" Alias]]';
      mockVault.getFrontmatter.mockReturnValue({
        exo__Asset_isDefinedBy: anchorValue,
      } as never);

      await service.createNarrowerConcept(parentFile, "narrow", "def", []);

      const content = mockVault.create.mock.calls[0][1];
      const yamlBlock = content.split("---")[1];
      // Parsed with the PRODUCT's own reader, not a hand-written expectation about bytes.
      const parsed = parseYamlFrontmatterTolerant(yamlBlock);
      expect(parsed?.["exo__Asset_isDefinedBy"]).toBe(anchorValue);
    });

    it("[C1] writes the parent as concept__Concept_genus — NOT the retired ims__ prefix and NOT the deprecated concept__Concept_broader", async () => {
      const parentFile = { basename: "ParentConcept", path: "assetspaces/kitelev/exoas-concept/concept/ParentConcept.md" } as IFile;

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
      const parentFile = { basename: "Parent", path: "assetspaces/kitelev/exoas-concept/concept/Parent.md" } as IFile;

      await service.createNarrowerConcept(parentFile, "narrow", "My definition text", []);

      expect(mockVault.create).toHaveBeenCalledTimes(1);
      const content = mockVault.create.mock.calls[0][1];
      expect(content).toContain("concept__Concept_definition");
      expect(content).toContain("My definition text");
      expect(content).not.toContain("ims__Concept_definition");
    });

    it("should include aliases when provided", async () => {
      const parentFile = { basename: "Parent", path: "assetspaces/kitelev/exoas-concept/concept/Parent.md" } as IFile;

      await service.createNarrowerConcept(parentFile, "narrow", "def", ["alias1", "alias2"]);

      const content = mockVault.create.mock.calls[0][1];
      expect(content).toContain("aliases");
      expect(content).toContain("alias1");
      expect(content).toContain("alias2");
    });

    it("should not include aliases when empty array", async () => {
      const parentFile = { basename: "Parent", path: "assetspaces/kitelev/exoas-concept/concept/Parent.md" } as IFile;

      await service.createNarrowerConcept(parentFile, "narrow", "def", []);

      const content = mockVault.create.mock.calls[0][1];
      expect(content).not.toContain("aliases");
    });

    it("should add .md extension to filename if missing", async () => {
      const parentFile = { basename: "Parent", path: "assetspaces/kitelev/exoas-concept/concept/Parent.md" } as IFile;

      await service.createNarrowerConcept(parentFile, "my-concept", "def", []);

      const filePath = mockVault.create.mock.calls[0][0];
      expect(filePath).toMatch(/\.md$/);
    });

    it("should not double .md extension", async () => {
      const parentFile = { basename: "Parent", path: "assetspaces/kitelev/exoas-concept/concept/Parent.md" } as IFile;

      await service.createNarrowerConcept(parentFile, "my-concept.md", "def", []);

      const filePath = mockVault.create.mock.calls[0][0];
      expect(filePath).not.toContain(".md.md");
    });

    it("[C3] types the created asset as the live concept__Concept class — a retired-namespace class resolves to nothing, so SHACL and the command resolver would both skip the asset", async () => {
      const parentFile = { basename: "Parent", path: "assetspaces/kitelev/exoas-concept/concept/Parent.md" } as IFile;

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
