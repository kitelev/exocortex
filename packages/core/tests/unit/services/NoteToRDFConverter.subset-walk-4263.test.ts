/**
 * #4263 — the three ADDITIVE options of `convertVaultWithValidation` that the
 * CLI triple cache's delta refresh relies on:
 *
 *   C1  `files`            restricts the walk to a subset; folder exclusions
 *                          still apply; wikilink targets still resolve through
 *                          the FULL vault (same triples as a full walk)
 *   C2  `fileSpacePrefixes` bypasses FileSpace discovery (no getFrontmatter
 *                          sweep) and applies the given prefixes verbatim
 *   C3  `onFileTriples`    fires once per COMMITTED file with exactly that
 *                          file's triples; skipped files never reach it; a
 *                          throwing observer never aborts the walk
 *   C4  omitting all three leaves the walk byte-identical to before
 *
 * Requirement: @req:42812747-8b76-4525-aaaa-00857ea98599
 */
import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import { FILE_SPACE_CLASS_UID } from "../../../src/services/FileSpaceDiscovery";
import { vaultPathToIRI } from "../../../src/infrastructure/vault/iri";
import type {
  IVaultAdapter,
  IFile,
  IFrontmatter,
} from "../../../src/interfaces/IVaultAdapter";
import type { ILogger } from "../../../src/interfaces/ILogger";
import type { Triple } from "../../../src/domain/models/rdf/Triple";

const REQ = "@req:42812747-8b76-4525-aaaa-00857ea98599";
const TASK_CLASS_UID = "1b20a8f0-59ac-4e5d-a5a8-0bab7e2b1ec4";

function file(path: string): IFile {
  const parts = path.split("/");
  const name = parts[parts.length - 1];
  return { path, basename: name.replace(/\.md$/, ""), name, parent: null };
}

function mockLogger(): jest.Mocked<ILogger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function vaultOf(
  fixtures: Record<string, { fm: IFrontmatter | null; body?: string }>,
): IVaultAdapter {
  const files = Object.keys(fixtures).map(file);
  return {
    getAllFiles: jest.fn(() => files),
    getFrontmatter: jest.fn((f: IFile) => fixtures[f.path]?.fm ?? null),
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

const PARENT_UID = "7f2f0a4b-0f2e-4a1c-9d1e-4263b0000001";
const CHILD_UID = "7f2f0a4b-0f2e-4a1c-9d1e-4263b0000002";
const OTHER_UID = "7f2f0a4b-0f2e-4a1c-9d1e-4263b0000003";
const BROKEN_UID = "7f2f0a4b-0f2e-4a1c-9d1e-4263b0000004";

const FIXTURES: Record<string, { fm: IFrontmatter | null; body?: string }> = {
  "spaces/file-space.md": {
    fm: {
      exo__Asset_uid: "22222222-3333-4444-8555-666677778888",
      exo__Asset_label: "Attachments",
      exo__Instance_class: [`[[${FILE_SPACE_CLASS_UID}|exo__FileSpace]]`],
      exo__AssetSpace_source: "https://github.com/owner/files-repo",
    },
  },
  "assetspaces/owner/files-repo/blob.md": {
    fm: {
      exo__Asset_uid: "33333333-3333-4333-8333-333333333333",
      exo__Instance_class: `[[${TASK_CLASS_UID}]]`,
    },
  },
  [`efforts/${PARENT_UID}.md`]: {
    fm: {
      exo__Asset_uid: PARENT_UID,
      exo__Instance_class: `[[${TASK_CLASS_UID}]]`,
      exo__Asset_label: "Parent",
    },
  },
  [`efforts/${CHILD_UID}.md`]: {
    fm: {
      exo__Asset_uid: CHILD_UID,
      exo__Instance_class: `[[${TASK_CLASS_UID}]]`,
      exo__Asset_label: "Child",
      ems__Effort_parent: `[[${PARENT_UID}]]`,
    },
  },
  [`efforts/${OTHER_UID}.md`]: {
    fm: {
      exo__Asset_uid: OTHER_UID,
      exo__Instance_class: `[[${TASK_CLASS_UID}]]`,
      exo__Asset_label: "Other",
    },
  },
  [`efforts/${BROKEN_UID}.md`]: {
    // invariant violation: required exo__Instance_class empty → skipped, never committed
    fm: { exo__Asset_uid: BROKEN_UID, exo__Instance_class: "" },
  },
};

function key(t: Triple): string {
  return `${String(t.subject)} ${String(t.predicate)} ${String(t.object)}`;
}

describe(`NoteToRDFConverter.convertVaultWithValidation — subset walk / prefixes / per-file observer (#4263) ${REQ}`, () => {
  it(`C1 \`files\` restricts the walk to the subset, keeps exclusions, and resolves targets through the full vault ${REQ}`, async () => {
    const vault = vaultOf(FIXTURES);
    const converter = new NoteToRDFConverter(vault, mockLogger());
    const full = await converter.convertVaultWithValidation();
    const fullChild = full.triples
      .filter(
        (t) => String(t.subject) === vaultPathToIRI(`efforts/${CHILD_UID}.md`),
      )
      .map(key)
      .sort();
    expect(fullChild.length).toBeGreaterThan(0);
    // the subset walk emits the same triples for the child — including the
    // parent link resolved to the parent's file-IRI, which lives OUTSIDE the subset
    const subset = await converter.convertVaultWithValidation({
      files: [
        file(`efforts/${CHILD_UID}.md`),
        file("assetspaces/owner/files-repo/blob.md"),
      ],
    });
    expect(subset.triples.map(key).sort()).toEqual(fullChild);
    expect(subset.triples.map(key).join("\n")).toContain(
      vaultPathToIRI(`efforts/${PARENT_UID}.md`),
    );
    // the blob sits under the FileSpace mount → excluded even in the subset
    expect(subset.triples.map(key).join("\n")).not.toContain(
      "assetspaces/owner/files-repo/blob.md",
    );
    expect(subset.summary.total).toBe(1);
    expect(subset.fileSpaces.prefixes).toEqual([
      "assetspaces/owner/files-repo/",
    ]);
  });

  it(`C2 \`fileSpacePrefixes\` bypasses discovery and applies the given prefixes verbatim ${REQ}`, async () => {
    const vault = vaultOf(FIXTURES);
    const converter = new NoteToRDFConverter(vault, mockLogger());
    const getFrontmatter = vault.getFrontmatter as jest.Mock;
    getFrontmatter.mockClear();

    // explicit prefixes → NO discovery sweep: getFrontmatter is called only by
    // the per-file validation/conversion of the walked files (2 files, not the
    // whole vault), and the given prefix is honoured even though no
    // declaration for it exists
    const result = await converter.convertVaultWithValidation({
      files: [
        file(`efforts/${OTHER_UID}.md`),
        file(`efforts/${PARENT_UID}.md`),
      ],
      fileSpacePrefixes: ["efforts/7f2f0a4b-0f2e-4a1c-9d1e-4263b0000003"],
    });
    expect(result.fileSpaces).toEqual({
      prefixes: ["efforts/7f2f0a4b-0f2e-4a1c-9d1e-4263b0000003"],
      declarationPaths: [],
      warnings: [],
    });
    expect(result.summary.total).toBe(1);
    expect(result.triples.map(key).join("\n")).not.toContain(OTHER_UID);
    expect(result.triples.map(key).join("\n")).toContain(PARENT_UID);
    const swept = getFrontmatter.mock.calls.map((c) => (c[0] as IFile).path);
    expect(swept).not.toContain("spaces/file-space.md");
    expect(swept).not.toContain(`efforts/${CHILD_UID}.md`);

    // an EMPTY list is honoured as "no FileSpaces" (discovery skipped, nothing excluded)
    const none = await converter.convertVaultWithValidation({
      fileSpacePrefixes: [],
    });
    expect(none.fileSpaces.prefixes).toEqual([]);
    expect(none.triples.map(key).join("\n")).toContain(
      "assetspaces/owner/files-repo/blob.md",
    );
  });

  it(`C3 \`onFileTriples\` fires once per committed file with exactly its triples; skipped files never reach it; a throwing observer is isolated ${REQ}`, async () => {
    const vault = vaultOf(FIXTURES);
    const converter = new NoteToRDFConverter(vault, mockLogger());
    const seen = new Map<string, Triple[]>();
    let calls = 0;
    const result = await converter.convertVaultWithValidation({
      onFileTriples: (f, triples) => {
        calls++;
        seen.set(f.path, triples);
        if (f.path === `efforts/${OTHER_UID}.md`) {
          throw new Error("observer failure must not abort the walk");
        }
      },
    });
    // committed files: 4 (parent, child, other, file-space declaration) —
    // the broken one is skipped, the attachment is excluded
    expect(calls).toBe(4);
    expect([...seen.keys()].sort()).toEqual(
      [
        "spaces/file-space.md",
        `efforts/${PARENT_UID}.md`,
        `efforts/${CHILD_UID}.md`,
        `efforts/${OTHER_UID}.md`,
      ].sort(),
    );
    expect(seen.has(`efforts/${BROKEN_UID}.md`)).toBe(false);
    expect(result.skippedFiles.map((s) => s.path)).toEqual([
      `efforts/${BROKEN_UID}.md`,
    ]);
    // per-file slices concatenate to the walk's own result, in commit order
    const concatenated: string[] = [];
    for (const [, triples] of seen) concatenated.push(...triples.map(key));
    expect(concatenated).toEqual(result.triples.map(key));
    // the throwing observer did not stop the file AFTER it from being committed
    expect(seen.has(`efforts/${BROKEN_UID}.md`)).toBe(false);
    expect(result.summary.indexed).toBe(4);
  });

  it(`C4 without the new options the walk is unchanged (whole vault, discovery on, no observer) ${REQ}`, async () => {
    const vault = vaultOf(FIXTURES);
    const converter = new NoteToRDFConverter(vault, mockLogger());
    const result = await converter.convertVaultWithValidation();
    expect(result.summary).toEqual({ total: 5, indexed: 4, skipped: 1 });
    expect(result.fileSpaces.prefixes).toEqual([
      "assetspaces/owner/files-repo/",
    ]);
    expect(result.fileSpaces.declarationPaths).toEqual([
      "spaces/file-space.md",
    ]);
    expect(
      (vault.getAllFiles as jest.Mock).mock.calls.length,
    ).toBeGreaterThanOrEqual(1);
  });
});
