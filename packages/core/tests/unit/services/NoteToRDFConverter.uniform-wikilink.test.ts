/**
 * Tests for three-step wikilink resolver — Phase A (UUID-only Step 3).
 *
 * RFC 4724eb62-7396-4928-a129-1d17a0f190ee, behavioral rule
 * aiKnow 64d2a7ac-cf4a-4f81-80f0-4982ae63cbf0: `[[...]]` should always
 * be an asset reference. Phase A delivers this for UUID-form wikilinks
 * (~80% of vault violations); Phase B extends to non-UUID identifier
 * forms after migrating downstream consumers like CommandResolver.normalizeWikilink.
 *
 * Resolution order for unresolved wikilinks (line 962-990 in NoteToRDFConverter):
 *   Step 1: canonical namespace (prefix__LocalName) — existing
 *   Step 2: vault file lookup via getFirstLinkpathDest — existing
 *   Step 3: synthesised vault-path IRI — NEW, gated on isUUID(linkpath)
 *
 * Prior attempt: Fix 3 in ed5be839, reverted as d9e700d8; PR #3106 retry,
 * closed 2026-05-14 after same E2E shards (3/4/5) regressed.
 */
import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import { IVaultAdapter, IFile } from "../../../src/interfaces/IVaultAdapter";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";

describe("NoteToRDFConverter — wikilink resolver Phase A (UUID-only Step 3)", () => {
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

  describe("Step 1 regression guard: canonical namespace mapping", () => {
    it("resolves [[ems__EffortStatusReview]] to canonical namespace IRI when file missing", async () => {
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
  });

  describe("Step 3 Phase A: synthesised vault-path IRI for unresolved UUID-form wikilinks", () => {
    it("emits IRI (not Literal) for unresolved UUID-form wikilink", async () => {
      const uuid = "e3347bcf-bb50-4fb7-9064-14266469384b";
      mockVault.getFrontmatter.mockReturnValue({
        exo__Asset_relates: `[[${uuid}]]`,
      });
      mockVault.getFirstLinkpathDest.mockReturnValue(null);

      const triples = await converter.convertNote(file);
      const relatesTriple = triples.find((t) =>
        (t.predicate as IRI).value.endsWith("Asset_relates"),
      );

      expect(relatesTriple).toBeDefined();
      expect(relatesTriple!.object).toBeInstanceOf(IRI);
      expect((relatesTriple!.object as IRI).value).toBe(
        `obsidian://vault/${uuid}.md`,
      );
    });

    it("emits IRI for [[uuid|alias]] format, stripping alias", async () => {
      const uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
      mockVault.getFrontmatter.mockReturnValue({
        exo__Asset_relates: `[[${uuid}|Display Label]]`,
      });
      mockVault.getFirstLinkpathDest.mockReturnValue(null);

      const triples = await converter.convertNote(file);
      const relatesTriple = triples.find((t) =>
        (t.predicate as IRI).value.endsWith("Asset_relates"),
      );

      expect(relatesTriple).toBeDefined();
      expect(relatesTriple!.object).toBeInstanceOf(IRI);
      expect((relatesTriple!.object as IRI).value).toBe(
        `obsidian://vault/${uuid}.md`,
      );
    });
  });

  describe("Phase A scope: non-UUID identifiers stay as Literal (defer to Phase B)", () => {
    it("emits Literal for unresolved non-UUID wikilink [[Sales Platform]]", async () => {
      mockVault.getFrontmatter.mockReturnValue({
        exo__Asset_relates: "[[Sales Platform]]",
      });
      mockVault.getFirstLinkpathDest.mockReturnValue(null);

      const triples = await converter.convertNote(file);
      const relatesTriple = triples.find((t) =>
        (t.predicate as IRI).value.endsWith("Asset_relates"),
      );

      expect(relatesTriple).toBeDefined();
      expect(relatesTriple!.object).toBeInstanceOf(Literal);
      // Phase B will change this to synthesised IRI; for now Literal
      // is preserved to keep CommandResolver.normalizeWikilink working
      // on e2e-bind-* style slugs.
      expect((relatesTriple!.object as Literal).value).toBe(
        "[[Sales Platform]]",
      );
    });

    it("emits Literal for unresolved slug-form wikilink [[e2e-bind-status-done-for-tasks]]", async () => {
      mockVault.getFrontmatter.mockReturnValue({
        exocmd__CommandBinding_command: "[[e2e-bind-status-done-for-tasks|Complete]]",
      });
      mockVault.getFirstLinkpathDest.mockReturnValue(null);

      const triples = await converter.convertNote(file);
      const triple = triples.find((t) =>
        (t.predicate as IRI).value.endsWith("CommandBinding_command"),
      );

      expect(triple).toBeDefined();
      expect(triple!.object).toBeInstanceOf(Literal);
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
    });

    it("preserves xsd:dateTime literal datatype", async () => {
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
