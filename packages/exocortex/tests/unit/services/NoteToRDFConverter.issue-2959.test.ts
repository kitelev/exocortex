import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import { IVaultAdapter, IFile, IFrontmatter } from "../../../src/interfaces/IVaultAdapter";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

/**
 * Regression suite for Issue #2959 — exocmd__Precondition "Is in Done status"
 * returned `false` on tasks with `ems__Effort_status: "[[ems__EffortStatusDone]]"`.
 *
 * Root cause (H2): when a class-named wikilink ([[ems__EffortStatusDone]])
 * resolved to its class-definition file (`ems/ems__EffortStatusDone.md`),
 * `valueToRDFObject` emitted the file IRI (`obsidian://vault/...`) instead
 * of the namespace class IRI (`<https://exocortex.my/ontology/ems#EffortStatusDone>`).
 *
 * SPARQL ASK preconditions like
 *   ASK { ?s ems:Effort_status <ems:EffortStatusDone> }
 * therefore returned false on tasks that were actually Done — the
 * "Archive Completed" command stayed hidden.
 *
 * The fix mirrors Issue #2782 (UUID wikilink class normalization) and
 * extends it to class-named wikilinks: when the resolved target file's
 * basename expands to a class IRI (any namespace prefix), emit the
 * namespace IRI instead of the file IRI.
 */
describe("NoteToRDFConverter — Issue #2959 regression", () => {
  let converter: NoteToRDFConverter;
  let mockVault: jest.Mocked<IVaultAdapter>;

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
      createFolder: jest.fn(),
      getFirstLinkpathDest: jest.fn(),
      process: jest.fn(),
      updateLinks: jest.fn(),
      getDefaultNewFileParent: jest.fn(),
    } as jest.Mocked<IVaultAdapter>;

    converter = new NoteToRDFConverter(mockVault);
  });

  const taskFile: IFile = {
    path: "03 Knowledge/kitelev/d18fbf07-044f-4412-86fd-d8e2e6be954b.md",
    basename: "d18fbf07-044f-4412-86fd-d8e2e6be954b",
    name: "d18fbf07-044f-4412-86fd-d8e2e6be954b.md",
    parent: null,
  };

  const buildClassFile = (basename: string): IFile => ({
    path: `03 Knowledge/ems/${basename}.md`,
    basename,
    name: `${basename}.md`,
    parent: null,
  });

  describe("class-named wikilink → class IRI normalization", () => {
    it.each([
      ["ems__EffortStatusBacklog", "EffortStatusBacklog"],
      ["ems__EffortStatusDoing", "EffortStatusDoing"],
      ["ems__EffortStatusDone", "EffortStatusDone"],
      ["ems__EffortStatusCancelled", "EffortStatusCancelled"],
      ["ems__EffortStatusReview", "EffortStatusReview"],
      ["ems__EffortStatusWaiting", "EffortStatusWaiting"],
      ["ems__EffortStatusBlocked", "EffortStatusBlocked"],
      ["ems__EffortStatusAnalysis", "EffortStatusAnalysis"],
    ])(
      "stores ems__Effort_status [[%s]] as class namespace IRI when target file resolves",
      async (statusClass, localName) => {
        const enumFile = buildClassFile(statusClass);

        const taskFrontmatter: IFrontmatter = {
          ems__Effort_status: `[[${statusClass}]]`,
        };

        mockVault.getFrontmatter.mockImplementation((f: IFile) => {
          if (f.path === taskFile.path) return taskFrontmatter;
          return null;
        });

        mockVault.getFirstLinkpathDest.mockImplementation((linkpath: string) => {
          if (linkpath === statusClass) return enumFile;
          return null;
        });

        const triples = await converter.convertNote(taskFile);

        const statusTriples = triples.filter(
          (t) => (t.predicate as IRI).value === Namespace.EMS.term("Effort_status").value
        );

        // Replace, not additive: ASK is existential — file IRI bindings
        // would defeat preconditions of the form
        //   ASK { ?s ems:Effort_status <ems:EffortStatusDone> }
        expect(statusTriples).toHaveLength(1);
        expect(statusTriples[0].object).toBeInstanceOf(IRI);
        expect((statusTriples[0].object as IRI).value).toBe(
          Namespace.EMS.term(localName).value
        );
      }
    );

    it("empirical reproduction — vault-2025 task d18fbf07 with ems__EffortStatusDone", async () => {
      // Mirrors the exact frontmatter from
      //   /Users/kitelev/vault-2025/03 Knowledge/kitelev/d18fbf07-…b.md
      // discovered live via Obsidian DevTools 2026-04-25:
      //
      //   const cr = app.plugins.plugins.exocortex.commandResolver;
      //   const pe = app.plugins.plugins.exocortex.preconditionEvaluator;
      //   const c = await cr.loadCommand('52c88678-…');
      //   pe.evaluate(c.precondition, subjectIRI, ctx)  // → false ❌  (expected: true)
      const enumFile = buildClassFile("ems__EffortStatusDone");

      const taskFrontmatter: IFrontmatter = {
        exo__Instance_class: ["[[ems__Task]]"],
        ems__Effort_status: "[[ems__EffortStatusDone]]",
        exo__Asset_label: "Заполнить таблетницу на 2026-W18",
      };

      mockVault.getFrontmatter.mockImplementation((f: IFile) => {
        if (f.path === taskFile.path) return taskFrontmatter;
        return null;
      });

      mockVault.getFirstLinkpathDest.mockImplementation((linkpath: string) => {
        if (linkpath === "ems__EffortStatusDone") return enumFile;
        return null;
      });

      const triples = await converter.convertNote(taskFile);

      const statusTriples = triples.filter(
        (t) => (t.predicate as IRI).value === Namespace.EMS.term("Effort_status").value
      );

      // Pre-fix: returned obsidian://vault/03%20Knowledge/ems/ems__EffortStatusDone.md
      // Post-fix: returns <https://exocortex.my/ontology/ems#EffortStatusDone>
      expect(statusTriples).toHaveLength(1);
      expect(statusTriples[0].object).toBeInstanceOf(IRI);
      expect((statusTriples[0].object as IRI).value).toBe(
        "https://exocortex.my/ontology/ems#EffortStatusDone"
      );
    });

    it("falls back to file IRI when target basename is NOT a class reference", async () => {
      const ordinaryFile: IFile = {
        path: "03 Knowledge/notes/Some Note.md",
        basename: "Some Note",
        name: "Some Note.md",
        parent: null,
      };

      const taskFrontmatter: IFrontmatter = {
        exo__Asset_relates: "[[Some Note]]",
      };

      mockVault.getFrontmatter.mockImplementation((f: IFile) => {
        if (f.path === taskFile.path) return taskFrontmatter;
        return null;
      });

      mockVault.getFirstLinkpathDest.mockImplementation((linkpath: string) => {
        if (linkpath === "Some Note") return ordinaryFile;
        return null;
      });

      const triples = await converter.convertNote(taskFile);

      const relatesTriples = triples.filter(
        (t) => (t.predicate as IRI).value === Namespace.EXO.term("Asset_relates").value
      );

      expect(relatesTriples).toHaveLength(1);
      expect(relatesTriples[0].object).toBeInstanceOf(IRI);
      expect((relatesTriples[0].object as IRI).value).toContain("Some%20Note.md");
    });

    it("UUID wikilink on non-prototype predicate emits single IRI (Fix #ff3858e5)", async () => {
      // Fix #ff3858e5 narrowed dual-storage to exo__Asset_prototype only.
      // Non-prototype predicates (e.g. ems__Effort_parent) now emit a single file IRI.
      const ordinaryFile: IFile = {
        path: "03 Knowledge/inbox/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.md",
        basename: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        name: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.md",
        parent: null,
      };

      const taskFrontmatter: IFrontmatter = {
        ems__Effort_parent: "[[aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee]]",
      };

      mockVault.getFrontmatter.mockImplementation((f: IFile) => {
        if (f.path === taskFile.path) return taskFrontmatter;
        if (f.path === ordinaryFile.path) return { exo__Asset_label: "Some other task" };
        return null;
      });

      mockVault.getFirstLinkpathDest.mockImplementation((linkpath: string) => {
        if (linkpath === "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee") return ordinaryFile;
        return null;
      });

      const triples = await converter.convertNote(taskFile);

      const parentTriples = triples.filter(
        (t) => (t.predicate as IRI).value === Namespace.EMS.term("Effort_parent").value
      );

      // Single file IRI expected — UUID Literal no longer emitted for non-prototype predicates.
      expect(parentTriples).toHaveLength(1);
      const objectValues = parentTriples.map((t) => (t.object as IRI | { value: string }).value);
      expect(objectValues.some((v) => v.includes("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.md"))).toBe(true);
      expect(objectValues.some((v) => v.startsWith("https://exocortex.my/ontology/"))).toBe(false);
    });
  });
});
