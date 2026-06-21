import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import {
  IVaultAdapter,
  IFile,
  IFrontmatter,
} from "../../../src/interfaces/IVaultAdapter";
import type { ILogger } from "../../../src/interfaces/ILogger";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

function createMockLogger(): jest.Mocked<ILogger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function createVault(): jest.Mocked<IVaultAdapter> {
  return {
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
    updateLinks: jest.fn(),
    getDefaultNewFileParent: jest.fn(),
  } as jest.Mocked<IVaultAdapter>;
}

/**
 * RFC 1ce2a226 Phase 3 acceptance tests for `exo:Asset_filename` parser emit.
 *
 * Verifies:
 *  - Test 1: every parsed file emits exactly one `exo:Asset_filename` triple.
 *  - Test 2 (idempotency): two convertNote → addAll cycles produce identical
 *    triple graph (no duplicate filename triple).
 *  - Test 3 (rename overwrite): when a file's basename changes between
 *    reindex cycles, the simulated indexer flow (remove-by-subject + addAll)
 *    leaves only the new filename triple, no leftover from the old basename.
 *  - Test 4 (anchor preservation) lives in
 *    `packages/cli/tests/unit/services/RenameToUidService.test.ts`.
 */
describe("NoteToRDFConverter — exo:Asset_filename (RFC 1ce2a226 Phase 3)", () => {
  const FILENAME_PREDICATE = Namespace.EXO.term("Asset_filename");

  let converter: NoteToRDFConverter;
  let mockVault: jest.Mocked<IVaultAdapter>;

  beforeEach(() => {
    mockVault = createVault();
    converter = new NoteToRDFConverter(mockVault, createMockLogger());
  });

  describe("Test 1: single-file emit", () => {
    it("emits exactly one exo:Asset_filename triple per legacy note", async () => {
      const file: IFile = {
        path: "03 Knowledge/ems/some-task.md",
        basename: "some-task",
        name: "some-task.md",
        parent: null,
      };
      const frontmatter: IFrontmatter = {
        exo__Asset_uid: "11111111-1111-1111-1111-111111111111",
        exo__Asset_label: "Some Task",
        exo__Instance_class: ["[[ems__Task]]"],
      };
      mockVault.getFrontmatter.mockReturnValue(frontmatter);

      const triples = await converter.convertNote(file);

      const filenameTriples = triples.filter((t) =>
        t.predicate.equals(FILENAME_PREDICATE),
      );
      expect(filenameTriples).toHaveLength(1);
      expect((filenameTriples[0].object as Literal).value).toBe("some-task");
      expect((filenameTriples[0].subject as IRI).value).toBe(
        "obsidian://vault/03%20Knowledge/ems/some-task.md",
      );
    });

    it("preserves spaces in basename (URL-decoded literal, encoded IRI)", async () => {
      const file: IFile = {
        path: "Notes/My Note.md",
        basename: "My Note",
        name: "My Note.md",
        parent: null,
      };
      const frontmatter: IFrontmatter = {
        exo__Asset_uid: "22222222-2222-2222-2222-222222222222",
        exo__Asset_label: "My Note",
      };
      mockVault.getFrontmatter.mockReturnValue(frontmatter);

      const triples = await converter.convertNote(file);

      const filenameTriple = triples.find((t) =>
        t.predicate.equals(FILENAME_PREDICATE),
      );
      expect(filenameTriple).toBeDefined();
      expect((filenameTriple!.object as Literal).value).toBe("My Note");
      expect((filenameTriple!.subject as IRI).value).toBe(
        "obsidian://vault/Notes/My%20Note.md",
      );
    });

    it("emits exo:Asset_filename for Exo 0.0.3 notes as well", async () => {
      const file: IFile = {
        path: "exo003/sample.md",
        basename: "sample",
        name: "sample.md",
        parent: null,
      };
      // Minimal valid Exo 0.0.3 Namespace metadata. Even if the converter
      // returns zero domain triples, the filename triple must still be
      // emitted at the convertNote level.
      const frontmatter: IFrontmatter = {
        metadata: "namespace",
        prefix: "ex",
        uri: "https://example.org/ns#",
      };
      mockVault.getFrontmatter.mockReturnValue(frontmatter);

      const triples = await converter.convertNote(file);

      const filenameTriples = triples.filter((t) =>
        t.predicate.equals(FILENAME_PREDICATE),
      );
      expect(filenameTriples).toHaveLength(1);
      expect((filenameTriples[0].object as Literal).value).toBe("sample");
    });
  });

  describe("Test 2: idempotency on double reindex", () => {
    it("double convertNote + addAll → set semantics keeps single filename triple", async () => {
      const file: IFile = {
        path: "idempotent.md",
        basename: "idempotent",
        name: "idempotent.md",
        parent: null,
      };
      const frontmatter: IFrontmatter = {
        exo__Asset_uid: "33333333-3333-3333-3333-333333333333",
        exo__Asset_label: "Idempotent Note",
      };
      mockVault.getFrontmatter.mockReturnValue(frontmatter);

      const store = new InMemoryTripleStore();

      // First indexing pass.
      const firstTriples = await converter.convertNote(file);
      await store.addAll(firstTriples);

      // Second indexing pass — identical file state.
      const secondTriples = await converter.convertNote(file);
      await store.addAll(secondTriples);

      const filenameTriples = await store.match(
        undefined,
        FILENAME_PREDICATE,
        undefined,
      );
      expect(filenameTriples).toHaveLength(1);
      expect((filenameTriples[0].object as Literal).value).toBe("idempotent");
    });
  });

  describe("Test 3: rename overwrite via remove-by-subject + addAll", () => {
    it("after basename change + remove-by-subject + re-add → only new filename triple remains", async () => {
      const store = new InMemoryTripleStore();
      const fileOld: IFile = {
        path: "rename-source.md",
        basename: "rename-source",
        name: "rename-source.md",
        parent: null,
      };
      mockVault.getFrontmatter.mockReturnValue({
        exo__Asset_uid: "44444444-4444-4444-4444-444444444444",
        exo__Asset_label: "Rename Source",
      });

      // Initial indexing — file is "rename-source.md".
      const initialTriples = await converter.convertNote(fileOld);
      await store.addAll(initialTriples);

      // Simulate VaultRDFIndexer.renameFile flow: removeFileTriples(oldPath)
      // before re-emitting under new path. This is the production overwrite
      // semantics described in RFC 1ce2a226 §Phase 3b.
      const oldSubjectIRI = new IRI(
        "obsidian://vault/rename-source.md",
      );
      const staleTriples = await store.match(oldSubjectIRI, undefined, undefined);
      await store.removeAll(staleTriples);

      // File renamed to "renamed-target.md".
      const fileNew: IFile = {
        path: "renamed-target.md",
        basename: "renamed-target",
        name: "renamed-target.md",
        parent: null,
      };
      const newTriples = await converter.convertNote(fileNew);
      await store.addAll(newTriples);

      const allFilenames = await store.match(
        undefined,
        FILENAME_PREDICATE,
        undefined,
      );
      expect(allFilenames).toHaveLength(1);
      expect((allFilenames[0].object as Literal).value).toBe("renamed-target");
      expect((allFilenames[0].subject as IRI).value).toBe(
        "obsidian://vault/renamed-target.md",
      );

      // Verify old filename triple is gone.
      const staleFilename = await store.match(
        oldSubjectIRI,
        FILENAME_PREDICATE,
        undefined,
      );
      expect(staleFilename).toHaveLength(0);
    });
  });
});
