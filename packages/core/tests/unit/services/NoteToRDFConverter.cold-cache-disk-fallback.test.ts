import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import {
  IVaultAdapter,
  IFile,
} from "../../../src/interfaces/IVaultAdapter";
import type { ILogger } from "../../../src/interfaces/ILogger";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

function createMockLogger(): jest.Mocked<ILogger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

/** Adapter WITHOUT the optional disk fallback — the CLI adapter and the
 *  in-memory test doubles look like this. */
function createVaultWithoutFallback(): jest.Mocked<IVaultAdapter> {
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
  } as unknown as jest.Mocked<IVaultAdapter>;
}

/** Adapter WITH the disk fallback — the Obsidian one (req c3072a80). */
function createVaultWithFallback(): jest.Mocked<IVaultAdapter> {
  const v = createVaultWithoutFallback() as jest.Mocked<IVaultAdapter> & {
    getFrontmatterWithFallback: jest.Mock;
  };
  v.getFrontmatterWithFallback = jest.fn();
  return v;
}

const FILE: IFile = {
  path: "assetspaces/kitelev/exoas-my/my-efforts/96e2a59a.md",
  basename: "96e2a59a",
  name: "96e2a59a.md",
} as IFile;

const ON_DISK = {
  exo__Asset_uid: "96e2a59a-6ac1-47fb-83ab-12a9964a5bea",
  exo__Asset_label: "Выпить Бринтелликс 10 мг",
};

/**
 * @req:7d00a60b-5ca3-457e-a160-5bf955e8c195
 *
 * Tier 1 of RFC 8f93ff95 — the asset's OWN frontmatter must not be gated on
 * Obsidian's metadataCache. The break this guards, measured live on the desktop
 * (2026-08-29, plugin 16.235.1, vault-my):
 *
 *   cold cache -> getFrontmatter() === null -> convertNote returns []
 *   -> ZERO triples -> the store is empty -> no exocmd bindings match
 *   -> 4 of 7 inline buttons vanish (the dynamic ones; the 3 static ones stay).
 *
 * The selective disappearance is what proves the store — not the render — was
 * empty: an unfinished render would have dropped ALL buttons.
 */
describe("NoteToRDFConverter — cold metadataCache (Tier 1, req 7d00a60b)", () => {
  it("emits triples from DISK when the metadata cache is cold", async () => {
    const vault = createVaultWithFallback();
    vault.getFrontmatter.mockReturnValue(null); // cold cache
    (
      vault as unknown as { getFrontmatterWithFallback: jest.Mock }
    ).getFrontmatterWithFallback.mockResolvedValue(ON_DISK); // disk has it

    const converter = new NoteToRDFConverter(vault, createMockLogger());
    const triples = await converter.convertNote(FILE);

    expect(triples.length).toBeGreaterThan(0);
    const predicates = triples.map((t) => t.predicate.toString());
    expect(predicates).toContain(Namespace.EXO.term("Asset_label").toString());
  });

  it("still uses the cached read when the adapter has no disk fallback", async () => {
    const vault = createVaultWithoutFallback();
    vault.getFrontmatter.mockReturnValue(ON_DISK);

    const converter = new NoteToRDFConverter(vault, createMockLogger());
    const triples = await converter.convertNote(FILE);

    expect(vault.getFrontmatter).toHaveBeenCalledWith(FILE);
    expect(triples.length).toBeGreaterThan(0);
  });
});
