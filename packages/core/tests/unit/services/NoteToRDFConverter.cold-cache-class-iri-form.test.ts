import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import { IVaultAdapter, IFile } from "../../../src/interfaces/IVaultAdapter";
import type { ILogger } from "../../../src/interfaces/ILogger";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

function createMockLogger(): jest.Mocked<ILogger> {
  return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

const CLASS_UID = "11111111-2222-4333-8444-555555555555";

/** UID-CANON: a class file's NAME is its uuid, so the basename carries no
 *  namespace — the symbolic IRI can only come from its exo__Asset_label. */
const CLASS_FILE: IFile = {
  path: "assetspaces/kitelev/exoas-exo/exo/" + CLASS_UID + ".md",
  basename: CLASS_UID,
  name: CLASS_UID + ".md",
} as IFile;

const ASSET_FILE: IFile = {
  path: "assetspaces/kitelev/exoas-my/my-efforts/96e2a59a.md",
  basename: "96e2a59a",
  name: "96e2a59a.md",
} as IFile;

const ASSET_FM = {
  exo__Asset_uid: "96e2a59a-6ac1-47fb-83ab-12a9964a5bea",
  exo__Instance_class: "[[" + CLASS_UID + "]]", // uid-bare form
};

const CLASS_FM = { exo__Asset_label: "exo__Prototype" };

/** The Obsidian-shaped adapter: it HAS the disk fallback (req c3072a80). */
function createVault(): jest.Mocked<IVaultAdapter> & {
  getFrontmatterWithFallback: jest.Mock;
} {
  const v = {
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
    getFrontmatterWithFallback: jest.fn(),
  } as unknown as jest.Mocked<IVaultAdapter> & {
    getFrontmatterWithFallback: jest.Mock;
  };
  return v;
}

/**
 * @req:7d00a60b-5ca3-457e-a160-5bf955e8c195
 *
 * Tier 3 — the FORM of the class IRI under a cold cache.
 *
 * Tier 1 (own frontmatter) and Tier 2 (linkpath -> file) are closed: on a cold
 * cache the store is no longer empty and the class reference no longer collapses
 * to a Literal. What is NOT closed is the FORM the class IRI takes.
 *
 * req 7d00a60b.covers promises: "the SYMBOLIC type-IRI is emitted". Under a cold
 * cache valueToClassURI resolves the class FILE (Tier 2, from disk) but then reads
 * its label through the CACHE only (`this.vault.getFrontmatter(resolvedFile)`) —
 * no disk fallback. Cold => null => the label is never seen => the code falls
 * through to notePathToIRI() and emits a FILE-IRI instead.
 *
 * A file-IRI is graph-traversable, so buttons gated on a *path* still work — but
 * every ASK precondition that compares against the symbolic form silently stops
 * matching. Measured on vault-my (2026-08-29): 3 of 36 preconditions compare
 * symbolically, one of them being "Is Prototype", which gates the prototype
 * buttons — matching the observed "some buttons missing, not all".
 */
describe("NoteToRDFConverter — cold cache, class IRI FORM (Tier 3, req 7d00a60b)", () => {
  it("emits the SYMBOLIC class IRI when only the cache is cold", async () => {
    const vault = createVault();
    const converter = new NoteToRDFConverter(vault, createMockLogger());

    // cold cache: nothing is in metadataCache
    vault.getFrontmatter.mockReturnValue(null);
    // Tier 1 + Tier 2 already work: the asset's own fm and the class FILE resolve
    vault.getFrontmatterWithFallback.mockImplementation(async (f: IFile) =>
      f.path === ASSET_FILE.path ? ASSET_FM : CLASS_FM,
    );
    (vault.getFirstLinkpathDest as jest.Mock).mockReturnValue(CLASS_FILE);

    const triples = await converter.convertNote(ASSET_FILE);

    const typePred = Namespace.EXO.term("Instance_class").toString();
    const classObjects = triples
      .filter((t) => t.predicate.toString() === typePred)
      .map((t) => t.object.toString());

    expect(classObjects.length).toBeGreaterThan(0);
    expect(classObjects[0]).toBe(
      Namespace.EXO.term("Prototype").toString(),
    );
  });

  /** req 7d00a60b scenario 2: "the already-working forms are not disturbed —
   *  the class IRI is produced WITHOUT any disk or cache lookup". The Tier-3
   *  pre-resolution must not add a lookup for the label-bare form. */
  it("does NOT touch disk for the label-bare form", async () => {
    const vault = createVault();
    const converter = new NoteToRDFConverter(vault, createMockLogger());

    vault.getFrontmatter.mockReturnValue(null);
    vault.getFrontmatterWithFallback.mockResolvedValue({
      exo__Asset_uid: "96e2a59a-6ac1-47fb-83ab-12a9964a5bea",
      exo__Instance_class: "[[exo__Prototype]]", // label-bare: no lookup needed
    });
    (vault.getFirstLinkpathDest as jest.Mock).mockReturnValue(CLASS_FILE);

    const triples = await converter.convertNote(ASSET_FILE);

    const typePred = Namespace.EXO.term("Instance_class").toString();
    const objects = triples
      .filter((t) => t.predicate.toString() === typePred)
      .map((t) => t.object.toString());

    expect(objects[0]).toBe(Namespace.EXO.term("Prototype").toString());
    // exactly ONE fallback read: the asset's own frontmatter (Tier 1). The class
    // reference resolved from its own text, so no second read was issued.
    expect(vault.getFrontmatterWithFallback).toHaveBeenCalledTimes(1);
  });
});
