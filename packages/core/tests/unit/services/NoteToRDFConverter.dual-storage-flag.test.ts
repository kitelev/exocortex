import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import { IVaultAdapter, IFile, IFrontmatter } from "../../../src/interfaces/IVaultAdapter";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";

/**
 * Issue #3353 (Sub-task B of #3282): env-flag-gated dual-storage emission
 * extension. `EXOCORTEX_DUAL_STORAGE_PREDICATES=Effort_area,Effort_parent`
 * enables (file IRI + UUID Literal) emission for the listed predicates;
 * default unset preserves single-IRI behavior (Fix #ff3858e5 contract).
 *
 * Empirical revert-verify discipline (per
 * ~/dotfiles/.claude/rules/integration-test-revert-verify.md):
 * - "default off" must FAIL if dual emission shipped unconditionally
 * - "flag on" must FAIL if env check is removed
 * - "prototype dual preserved" must PASS in both states (regression guard)
 */
describe("NoteToRDFConverter dual-storage env-flag (Issue #3353)", () => {
  let converter: NoteToRDFConverter;
  let mockVault: jest.Mocked<IVaultAdapter>;
  let originalEnv: string | undefined;

  const sourceUUID = "11111111-1111-1111-1111-111111111111";
  const areaUUID = "22222222-2222-2222-2222-222222222222";
  const parentUUID = "33333333-3333-3333-3333-333333333333";
  const protoUUID = "44444444-4444-4444-4444-444444444444";

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
  const parentFile: IFile = {
    path: `03 Knowledge/ems/${parentUUID}.md`,
    basename: parentUUID,
    name: `${parentUUID}.md`,
    parent: null,
  };
  const protoFile: IFile = {
    path: `03 Knowledge/ems/${protoUUID}.md`,
    basename: protoUUID,
    name: `${protoUUID}.md`,
    parent: null,
  };

  beforeEach(() => {
    originalEnv = process.env.EXOCORTEX_DUAL_STORAGE_PREDICATES;
    delete process.env.EXOCORTEX_DUAL_STORAGE_PREDICATES;

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

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.EXOCORTEX_DUAL_STORAGE_PREDICATES;
    } else {
      process.env.EXOCORTEX_DUAL_STORAGE_PREDICATES = originalEnv;
    }
  });

  it("default (env unset): ems__Effort_area emits single IRI only", async () => {
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

    const triples = await converter.convertNote(sourceFile);
    const areaTriples = triples.filter((t) =>
      (t.predicate as IRI).value.endsWith("#Effort_area"),
    );

    expect(areaTriples).toHaveLength(1);
    expect(areaTriples[0].object).toBeInstanceOf(IRI);
  });

  it("default (env unset): ems__Effort_parent emits single IRI only", async () => {
    mockVault.getFrontmatter.mockImplementation((f: IFile) => {
      if (f.path === sourceFile.path) {
        return { ems__Effort_parent: `[[${parentUUID}]]` } as IFrontmatter;
      }
      if (f.path === parentFile.path) {
        return { exo__Asset_label: "Parent Task" } as IFrontmatter;
      }
      return null;
    });
    mockVault.getFirstLinkpathDest.mockImplementation((linkpath: string) => {
      if (linkpath === parentUUID) return parentFile;
      return null;
    });
    mockVault.read.mockResolvedValue("");

    const triples = await converter.convertNote(sourceFile);
    const parentTriples = triples.filter((t) =>
      (t.predicate as IRI).value.endsWith("#Effort_parent"),
    );

    expect(parentTriples).toHaveLength(1);
    expect(parentTriples[0].object).toBeInstanceOf(IRI);
  });

  it("flag set: ems__Effort_area emits BOTH IRI and UUID Literal", async () => {
    process.env.EXOCORTEX_DUAL_STORAGE_PREDICATES = "Effort_area,Effort_parent";

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

    const triples = await converter.convertNote(sourceFile);
    const areaTriples = triples.filter((t) =>
      (t.predicate as IRI).value.endsWith("#Effort_area"),
    );

    expect(areaTriples).toHaveLength(2);
    expect(areaTriples.some((t) => t.object instanceof IRI)).toBe(true);
    const literalTriple = areaTriples.find((t) => t.object instanceof Literal);
    expect(literalTriple).toBeDefined();
    expect((literalTriple!.object as Literal).value).toBe(areaUUID);
  });

  it("flag set: ems__Effort_parent emits BOTH IRI and UUID Literal", async () => {
    process.env.EXOCORTEX_DUAL_STORAGE_PREDICATES = "Effort_area,Effort_parent";

    mockVault.getFrontmatter.mockImplementation((f: IFile) => {
      if (f.path === sourceFile.path) {
        return { ems__Effort_parent: `[[${parentUUID}]]` } as IFrontmatter;
      }
      if (f.path === parentFile.path) {
        return { exo__Asset_label: "Parent" } as IFrontmatter;
      }
      return null;
    });
    mockVault.getFirstLinkpathDest.mockImplementation((linkpath: string) => {
      if (linkpath === parentUUID) return parentFile;
      return null;
    });
    mockVault.read.mockResolvedValue("");

    const triples = await converter.convertNote(sourceFile);
    const parentTriples = triples.filter((t) =>
      (t.predicate as IRI).value.endsWith("#Effort_parent"),
    );

    expect(parentTriples).toHaveLength(2);
    const literalTriple = parentTriples.find((t) => t.object instanceof Literal);
    expect(literalTriple).toBeDefined();
    expect((literalTriple!.object as Literal).value).toBe(parentUUID);
  });

  it("flag set with whitespace: 'Effort_area, Effort_parent' (comma+space) trims correctly", async () => {
    process.env.EXOCORTEX_DUAL_STORAGE_PREDICATES = "Effort_area, Effort_parent";

    mockVault.getFrontmatter.mockImplementation((f: IFile) => {
      if (f.path === sourceFile.path) {
        return { ems__Effort_area: `[[${areaUUID}]]` } as IFrontmatter;
      }
      if (f.path === areaFile.path) {
        return { exo__Asset_label: "Area" } as IFrontmatter;
      }
      return null;
    });
    mockVault.getFirstLinkpathDest.mockImplementation((linkpath: string) => {
      if (linkpath === areaUUID) return areaFile;
      return null;
    });
    mockVault.read.mockResolvedValue("");

    const triples = await converter.convertNote(sourceFile);
    const areaTriples = triples.filter((t) =>
      (t.predicate as IRI).value.endsWith("#Effort_area"),
    );

    expect(areaTriples).toHaveLength(2);
  });

  it("flag set selectively: only listed predicates get dual storage", async () => {
    // Only Effort_area in flag — Effort_parent should remain single IRI.
    process.env.EXOCORTEX_DUAL_STORAGE_PREDICATES = "Effort_area";

    mockVault.getFrontmatter.mockImplementation((f: IFile) => {
      if (f.path === sourceFile.path) {
        return {
          ems__Effort_area: `[[${areaUUID}]]`,
          ems__Effort_parent: `[[${parentUUID}]]`,
        } as IFrontmatter;
      }
      if (f.path === areaFile.path) return { exo__Asset_label: "Area" } as IFrontmatter;
      if (f.path === parentFile.path) return { exo__Asset_label: "Parent" } as IFrontmatter;
      return null;
    });
    mockVault.getFirstLinkpathDest.mockImplementation((linkpath: string) => {
      if (linkpath === areaUUID) return areaFile;
      if (linkpath === parentUUID) return parentFile;
      return null;
    });
    mockVault.read.mockResolvedValue("");

    const triples = await converter.convertNote(sourceFile);
    const areaTriples = triples.filter((t) =>
      (t.predicate as IRI).value.endsWith("#Effort_area"),
    );
    const parentTriples = triples.filter((t) =>
      (t.predicate as IRI).value.endsWith("#Effort_parent"),
    );

    expect(areaTriples).toHaveLength(2);
    expect(parentTriples).toHaveLength(1);
  });

  it("regression: exo__Asset_prototype dual storage preserved regardless of flag", async () => {
    // env unset (default) — prototype must still emit IRI + Literal (Issue #2102 / #ff3858e5)
    mockVault.getFrontmatter.mockImplementation((f: IFile) => {
      if (f.path === sourceFile.path) {
        return { exo__Asset_prototype: `[[${protoUUID}]]` } as IFrontmatter;
      }
      if (f.path === protoFile.path) {
        return { exo__Asset_label: "Some template" } as IFrontmatter;
      }
      return null;
    });
    mockVault.getFirstLinkpathDest.mockImplementation((linkpath: string) => {
      if (linkpath === protoUUID) return protoFile;
      return null;
    });
    mockVault.read.mockResolvedValue("");

    const triples = await converter.convertNote(sourceFile);
    const protoTriples = triples.filter((t) =>
      (t.predicate as IRI).value.endsWith("Asset_prototype"),
    );

    expect(protoTriples).toHaveLength(2);
    expect(protoTriples.some((t) => t.object instanceof IRI)).toBe(true);
    expect(protoTriples.some((t) => t.object instanceof Literal)).toBe(true);
  });

  it("regression: exo__Asset_prototype dual storage preserved WHEN flag set for other predicates", async () => {
    // Prototype dual emission must not be affected by env-flag presence.
    process.env.EXOCORTEX_DUAL_STORAGE_PREDICATES = "Effort_area,Effort_parent";

    mockVault.getFrontmatter.mockImplementation((f: IFile) => {
      if (f.path === sourceFile.path) {
        return { exo__Asset_prototype: `[[${protoUUID}]]` } as IFrontmatter;
      }
      if (f.path === protoFile.path) {
        return { exo__Asset_label: "Some template" } as IFrontmatter;
      }
      return null;
    });
    mockVault.getFirstLinkpathDest.mockImplementation((linkpath: string) => {
      if (linkpath === protoUUID) return protoFile;
      return null;
    });
    mockVault.read.mockResolvedValue("");

    const triples = await converter.convertNote(sourceFile);
    const protoTriples = triples.filter((t) =>
      (t.predicate as IRI).value.endsWith("Asset_prototype"),
    );

    expect(protoTriples).toHaveLength(2);
  });

  it("empty/whitespace flag value behaves as unset (single IRI for Effort_area)", async () => {
    process.env.EXOCORTEX_DUAL_STORAGE_PREDICATES = "  ,  ,";

    mockVault.getFrontmatter.mockImplementation((f: IFile) => {
      if (f.path === sourceFile.path) {
        return { ems__Effort_area: `[[${areaUUID}]]` } as IFrontmatter;
      }
      if (f.path === areaFile.path) return { exo__Asset_label: "Area" } as IFrontmatter;
      return null;
    });
    mockVault.getFirstLinkpathDest.mockImplementation((linkpath: string) => {
      if (linkpath === areaUUID) return areaFile;
      return null;
    });
    mockVault.read.mockResolvedValue("");

    const triples = await converter.convertNote(sourceFile);
    const areaTriples = triples.filter((t) =>
      (t.predicate as IRI).value.endsWith("#Effort_area"),
    );

    expect(areaTriples).toHaveLength(1);
  });
});
