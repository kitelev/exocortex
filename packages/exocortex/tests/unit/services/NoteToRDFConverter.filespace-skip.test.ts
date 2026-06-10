/**
 * AC1 (ExoSync C2 / onto-RFC 18808c73 Phase 5): FileSpace content is
 * skipped by the RDF indexer — both Space subtypes exercised in ONE vault:
 * the AssetSpace's content IS parsed, the FileSpace's content is NOT
 * (no triples, no SHACL validation, no skippedFiles record). The skip is
 * driven by the `rdf:type` declaration (`exo__Instance_class` →
 * `exo__FileSpace`), never by hardcoded paths.
 */
import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import { FILE_SPACE_CLASS_UID } from "../../../src/services/FileSpaceDiscovery";
import type {
  IVaultAdapter,
  IFile,
  IFrontmatter,
} from "../../../src/interfaces/IVaultAdapter";
import type { ILogger } from "../../../src/interfaces/ILogger";

const ASSET_SPACE_CLASS_UID = "73bd00e4-ccc0-4f3f-b20d-c4388c4588fb";

function file(path: string): IFile {
  const parts = path.split("/");
  const name = parts[parts.length - 1];
  return { path, basename: name.replace(/\.md$/, ""), name, parent: null };
}

function mockLogger(): jest.Mocked<ILogger> {
  return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

/** Vault fixture: frontmatter + body per path; resolver is basename-based. */
function vaultOf(
  fixtures: Record<string, { fm: IFrontmatter; body?: string }>,
): IVaultAdapter {
  const files = Object.keys(fixtures).map(file);
  return {
    getAllFiles: jest.fn(() => files),
    getFrontmatter: jest.fn(
      (f: IFile) => fixtures[f.path]?.fm ?? null,
    ),
    read: jest.fn(async (f: IFile) => fixtures[f.path]?.body ?? ""),
    getFirstLinkpathDest: jest.fn((linkpath: string) => {
      const target = files.find(
        (f) => f.basename === linkpath.replace(/\.md$/, ""),
      );
      return target ?? null;
    }),
    exists: jest.fn(async () => true),
    getAbstractFileByPath: jest.fn(() => null),
    create: jest.fn(),
    modify: jest.fn(),
    delete: jest.fn(),
    process: jest.fn(),
    rename: jest.fn(),
    updateLinks: jest.fn(),
    createFolder: jest.fn(),
    getDefaultNewFileParent: jest.fn(() => null),
    updateFrontmatter: jest.fn(),
  } as unknown as IVaultAdapter;
}

const FIXTURES: Record<string, { fm: IFrontmatter; body?: string }> = {
  // ---- declarations (live OUTSIDE their mounts, per convention) ----
  "spaces/asset-space.md": {
    fm: {
      exo__Asset_uid: "11111111-2222-4333-8444-555566667777",
      exo__Asset_label: "Ontology Space",
      exo__Instance_class: [`[[${ASSET_SPACE_CLASS_UID}|exo__AssetSpace]]`],
      exo__AssetSpace_source: "https://github.com/owner/asset-repo",
    },
  },
  "spaces/file-space.md": {
    fm: {
      exo__Asset_uid: "22222222-3333-4444-8555-666677778888",
      exo__Asset_label: "Attachments",
      exo__Instance_class: [`[[${FILE_SPACE_CLASS_UID}|exo__FileSpace]]`],
      exo__AssetSpace_source: "https://github.com/owner/files-repo",
    },
  },
  // ---- content under the ASSET space mount → MUST be parsed ----
  "assetspaces/owner/asset-repo/task.md": {
    fm: {
      exo__Asset_uid: "33333333-4444-4555-8666-777788889999",
      exo__Asset_label: "A Task",
      exo__Instance_class: ["[[ems__Task]]"],
    },
  },
  // ---- content under the FILE space mount → MUST be skipped ----
  // Deliberately VIOLATES asset invariants (no uid, empty class) — were it
  // parsed/validated, it would land in skippedFiles with a warn-log; the
  // FileSpace skip keeps it invisible to the whole pipeline.
  "assetspaces/owner/files-repo/notes/readme.md": {
    fm: { exo__Instance_class: "" },
  },
};

describe("NoteToRDFConverter — FileSpace skip (AC1, both subtypes)", () => {
  let converter: NoteToRDFConverter;
  let logger: jest.Mocked<ILogger>;

  beforeEach(() => {
    logger = mockLogger();
    converter = new NoteToRDFConverter(vaultOf(FIXTURES), logger);
  });

  it("parses AssetSpace content, skips FileSpace content", async () => {
    const result = await converter.convertVaultWithValidation();

    const subjects = new Set(result.triples.map((t) => t.subject.toString()));

    // AssetSpace subtype: declaration AND mount content are indexed.
    expect(
      [...subjects].some((s) => s.includes("asset-repo/task.md")),
    ).toBe(true);
    expect([...subjects].some((s) => s.includes("asset-space.md"))).toBe(true);

    // FileSpace subtype: the declaration itself is indexed…
    expect([...subjects].some((s) => s.includes("file-space.md"))).toBe(true);
    // …but its mount content produced NO triples,
    expect([...subjects].some((s) => s.includes("files-repo"))).toBe(false);
    // NO validation noise (treated as if it never existed),
    expect(result.skippedFiles).toEqual([]);
    // and is absent from the walk totals.
    expect(result.summary.total).toBe(3);

    // The discovery result is surfaced for live-event consumers.
    expect(result.fileSpaces.prefixes).toEqual([
      "assetspaces/owner/files-repo/",
    ]);
    expect(result.fileSpaces.declarationPaths).toEqual(["spaces/file-space.md"]);
  });

  it("skip is declaration-driven: removing the declaration re-includes content", async () => {
    const { "spaces/file-space.md": _declaration, ...withoutDeclaration } =
      FIXTURES;
    converter = new NoteToRDFConverter(vaultOf(withoutDeclaration), logger);

    const result = await converter.convertVaultWithValidation();

    // Same path, same content — but with no FileSpace declaration the file
    // is an ordinary (invalid) asset: it gets validated and skip-logged.
    expect(result.fileSpaces.prefixes).toEqual([]);
    expect(
      result.skippedFiles.some((s) =>
        s.path.includes("files-repo/notes/readme.md"),
      ),
    ).toBe(true);
  });
});
