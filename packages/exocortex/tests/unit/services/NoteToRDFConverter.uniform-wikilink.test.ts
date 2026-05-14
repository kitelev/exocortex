/**
 * Tests for three-step wikilink resolver (RFC 4724eb62-7396-4928-a129-1d17a0f190ee).
 *
 * Behavioral rule (aiKnow 64d2a7ac-cf4a-4f81-80f0-4982ae63cbf0):
 * `[[...]]` is always an asset reference (existing or future).
 * Never Literal, never context-dependent.
 *
 * Resolution order in NoteToRDFConverter.valueToRDFObject for unresolved wikilinks:
 *   Step 1: canonical namespace mapping for prefix__LocalName form
 *   Step 2: vault file lookup (handled before this branch via getFirstLinkpathDest)
 *   Step 3: synthesised vault-path IRI (new — replaces Literal fallback)
 *
 * Prior attempt: Fix 3 in commit ed5be839 reverted as d9e700d8 due to E2E regression.
 * Audit P1 (2026-05-14) identified Step 1 (canonical namespace) was already present
 * before line 970; only Step 3 was missing. This narrow change emits IRI in place
 * of Literal for unresolved non-class wikilinks.
 */
import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import { IVaultAdapter, IFile } from "../../../src/interfaces/IVaultAdapter";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";

describe("NoteToRDFConverter — uniform wikilink resolver (RFC P3')", () => {
  let mockVault: jest.Mocked<IVaultAdapter>;
  let converter: NoteToRDFConverter;
  let file: IFile;

  beforeEach(() => {
    mockVault = {
      getFrontmatter: jest.fn(),
      getAllFiles: jest.fn().mockReturnValue([]),
      read: jest.fn().mockResolvedValue(""),
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
      updateLinks: jest.fn(),
      getDefaultNewFileParent: jest.fn(),
    } as jest.Mocked<IVaultAdapter>;
    converter = new NoteToRDFConverter(mockVault);
    file = {
      path: "test/source.md",
      basename: "source",
      extension: "md",
      name: "source.md",
      parent: null,
    } as IFile;
  });

  describe("Step 1: canonical namespace mapping (existing behavior, regression guard)", () => {
    it("resolves [[ems__EffortStatusReview]] to canonical namespace IRI even when file missing", async () => {
      mockVault.getFrontmatter.mockReturnValue({
        ems__Effort_status: "[[ems__EffortStatusReview]]",
      });
      mockVault.getFirstLinkpathDest.mockReturnValue(null);

      const triples = await converter.convertNote(file);
      const statusTriple = triples.find((t) =>
        (t.predicate as IRI).value.endsWith("ems#Effort_status"),
      );

      expect(statusTriple).toBeDefined();
      expect(statusTriple!.object).toBeInstanceOf(IRI);
      expect((statusTriple!.object as IRI).value).toBe(
        "https://exocortex.my/ontology/ems#EffortStatusReview",
      );
    });

    it("resolves [[exo__Theory]] to canonical namespace IRI when file missing", async () => {
      mockVault.getFrontmatter.mockReturnValue({
        exo__Asset_relates: "[[exo__Theory]]",
      });
      mockVault.getFirstLinkpathDest.mockReturnValue(null);

      const triples = await converter.convertNote(file);
      const relatesTriple = triples.find((t) =>
        (t.predicate as IRI).value.endsWith("Asset_relates"),
      );

      expect(relatesTriple).toBeDefined();
      expect(relatesTriple!.object).toBeInstanceOf(IRI);
      expect((relatesTriple!.object as IRI).value).toBe(
        "https://exocortex.my/ontology/exo#Theory",
      );
    });
  });

  describe("Step 3: synthesised vault-path IRI for unresolved non-class wikilinks (NEW)", () => {
    it("emits IRI (not Literal) for unresolved [[Sales Platform]]", async () => {
      mockVault.getFrontmatter.mockReturnValue({
        exo__Asset_relates: "[[Sales Platform]]",
      });
      mockVault.getFirstLinkpathDest.mockReturnValue(null);

      const triples = await converter.convertNote(file);
      const relatesTriple = triples.find((t) =>
        (t.predicate as IRI).value.endsWith("Asset_relates"),
      );

      expect(relatesTriple).toBeDefined();
      expect(relatesTriple!.object).toBeInstanceOf(IRI);
      expect(relatesTriple!.object).not.toBeInstanceOf(Literal);
      expect((relatesTriple!.object as IRI).value).toBe(
        "obsidian://vault/Sales%20Platform.md",
      );
    });

    it("emits IRI for unresolved [[Some Random Name]] with spaces", async () => {
      mockVault.getFrontmatter.mockReturnValue({
        exo__Asset_relates: "[[Some Random Name]]",
      });
      mockVault.getFirstLinkpathDest.mockReturnValue(null);

      const triples = await converter.convertNote(file);
      const relatesTriple = triples.find((t) =>
        (t.predicate as IRI).value.endsWith("Asset_relates"),
      );

      expect(relatesTriple).toBeDefined();
      expect(relatesTriple!.object).toBeInstanceOf(IRI);
      expect((relatesTriple!.object as IRI).value).toContain(
        "obsidian://vault/Some%20Random%20Name.md",
      );
    });

    it("strips |alias suffix before synthesising IRI", async () => {
      mockVault.getFrontmatter.mockReturnValue({
        exo__Asset_relates: "[[abc-uuid|Display Label]]",
      });
      mockVault.getFirstLinkpathDest.mockReturnValue(null);

      const triples = await converter.convertNote(file);
      const relatesTriple = triples.find((t) =>
        (t.predicate as IRI).value.endsWith("Asset_relates"),
      );

      expect(relatesTriple).toBeDefined();
      expect(relatesTriple!.object).toBeInstanceOf(IRI);
      // Synthesised IRI should use the identifier part, not the alias.
      expect((relatesTriple!.object as IRI).value).toBe(
        "obsidian://vault/abc-uuid.md",
      );
    });
  });

  describe("Negative cases: no regression on non-wikilink values", () => {
    it("leaves plain string values as Literal", async () => {
      mockVault.getFrontmatter.mockReturnValue({
        exo__Asset_label: "Plain text title",
      });

      const triples = await converter.convertNote(file);
      const labelTriple = triples.find((t) =>
        (t.predicate as IRI).value.endsWith("Asset_label"),
      );

      expect(labelTriple).toBeDefined();
      expect(labelTriple!.object).toBeInstanceOf(Literal);
      expect((labelTriple!.object as Literal).value).toBe("Plain text title");
    });

    it("does not turn ISO 8601 dateTime into IRI", async () => {
      mockVault.getFrontmatter.mockReturnValue({
        exo__Asset_createdAt: "2026-05-14T10:00:00+05:00",
      });

      const triples = await converter.convertNote(file);
      const createdTriple = triples.find((t) =>
        (t.predicate as IRI).value.endsWith("Asset_createdAt"),
      );

      expect(createdTriple).toBeDefined();
      expect(createdTriple!.object).toBeInstanceOf(Literal);
    });
  });
});
