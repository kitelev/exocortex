import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import {
  IVaultAdapter,
  IFile,
  IFrontmatter,
} from "../../../src/interfaces/IVaultAdapter";
import { IRI } from "../../../src/domain/models/rdf/IRI";

/**
 * Issue #3469: iOS WebKit has no Node `process` global. The dual-storage
 * env-flag read (Issue #3353) at NoteToRDFConverter's wikilink conversion
 * path accessed `process.env` unguarded, so `ensureLoadedByIRI` → convert
 * threw `ReferenceError: Can't find variable: process` on mobile and no
 * command buttons rendered on assets.
 *
 * These tests run the exact convert path with the `process` global removed
 * (mirroring the iOS runtime) and require it to behave as "env unset":
 * single IRI emission, no throw.
 *
 * Empirically verified per
 * ~/dotfiles/.claude/rules/integration-test-revert-verify.md:
 * FAILS (ReferenceError) without the `typeof process` guard, PASSES with it.
 */
describe("NoteToRDFConverter without process global (Issue #3469)", () => {
  let converter: NoteToRDFConverter;
  let mockVault: jest.Mocked<IVaultAdapter>;

  const sourceUUID = "11111111-1111-1111-1111-111111111111";
  const areaUUID = "22222222-2222-2222-2222-222222222222";

  const sourceFile: IFile = {
    path: `03 Knowledge/kitelev/${sourceUUID}.md`,
    basename: sourceUUID,
    name: `${sourceUUID}.md`,
    parent: null,
  };
  const areaFile: IFile = {
    path: `03 Knowledge/ems/${areaUUID}.md`,
    basename: areaUUID,
    name: `${areaUUID}.md`,
    parent: null,
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
      createFolder: jest.fn(),
      getFirstLinkpathDest: jest.fn(),
      process: jest.fn(),
      updateLinks: jest.fn(),
      getDefaultNewFileParent: jest.fn(),
    } as jest.Mocked<IVaultAdapter>;

    mockVault.getFrontmatter.mockImplementation((f: IFile) => {
      if (f.path === sourceFile.path) {
        return { ems__Effort_area: `[[${areaUUID}]]` } as IFrontmatter;
      }
      if (f.path === areaFile.path) {
        return { exo__Asset_label: "Some Area" } as IFrontmatter;
      }
      return null;
    });
    mockVault.getFirstLinkpathDest.mockImplementation((linkpath: string) => {
      if (linkpath === areaUUID) return areaFile;
      return null;
    });
    mockVault.read.mockResolvedValue("");

    converter = new NoteToRDFConverter(mockVault);
  });

  it("convertNote does not throw when the process global is absent (iOS runtime)", async () => {
    const saved = globalThis.process;
    let triples;
    try {
      delete (globalThis as { process?: unknown }).process;
      triples = await converter.convertNote(sourceFile);
    } finally {
      (globalThis as { process?: unknown }).process = saved;
    }

    const areaTriples = triples.filter((t) =>
      (t.predicate as IRI).value.endsWith("#Effort_area"),
    );
    // No process → env flag unreadable → default single-IRI emission.
    expect(areaTriples).toHaveLength(1);
    expect(areaTriples[0].object).toBeInstanceOf(IRI);
  });

  it("no-process emission matches the env-unset desktop emission (same triples)", async () => {
    const withProcessEnvUnset = process.env.EXOCORTEX_DUAL_STORAGE_PREDICATES;
    delete process.env.EXOCORTEX_DUAL_STORAGE_PREDICATES;
    let desktopTriples;
    let mobileTriples;
    try {
      desktopTriples = await converter.convertNote(sourceFile);
      const saved = globalThis.process;
      try {
        delete (globalThis as { process?: unknown }).process;
        mobileTriples = await converter.convertNote(sourceFile);
      } finally {
        (globalThis as { process?: unknown }).process = saved;
      }
    } finally {
      if (withProcessEnvUnset !== undefined) {
        process.env.EXOCORTEX_DUAL_STORAGE_PREDICATES = withProcessEnvUnset;
      }
    }

    const shape = (
      triples: Awaited<ReturnType<NoteToRDFConverter["convertNote"]>>,
    ) =>
      triples.map((t) => ({
        p: (t.predicate as IRI).value,
        o: String((t.object as { value: unknown }).value),
      }));
    expect(shape(mobileTriples)).toEqual(shape(desktopTriples));
  });
});
