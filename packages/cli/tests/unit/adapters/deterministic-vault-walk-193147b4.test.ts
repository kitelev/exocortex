import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs-extra";
import { parseYamlFrontmatterTolerant } from "../../../../core/src/utilities/parseYamlFrontmatter.js";
import { FrontmatterService } from "../../../../core/src/utilities/FrontmatterService.js";

/**
 * req 265844b7 (ticket 193147b4) — the CLI vault walk is deterministic BY
 * CONSTRUCTION, not by the filesystem.
 *
 * `FileSystemVaultAdapter.walkDirectory()` hydrates the CLI triple store
 * (`loadVaultTriples` → `getAllFiles()` → `NoteToRDFConverter.convertVault`),
 * and `InMemoryTripleStore.matchP` iterates `pso` — a `Map`, i.e. INSERTION
 * order — so "which definition wins" among duplicate property labels is decided
 * by the order this walk emits.
 *
 * ⛔ These axes STUB `readdirSync` and make it hand entries back UNORDERED
 * (neither ascending nor descending). That is not decoration: measured 2026-09-22, APFS returns
 * directory entries already sorted (files created `zz yy mm bb aa` came back
 * `aa bb mm yy zz`), so an axis reading the real filesystem is GREEN with and
 * without the fix on this machine — vacuous exactly where the defect lives
 * (integration-test-revert-verify §A105). With the stub the axis is RED on any
 * filesystem. ext4 is NOT measured here and is not claimed.
 *
 * The guarantee is PARITY WITH `PropertyNameValidator.walk` — the same JS
 * default string comparator (UTF-16 code units), not UTF-8 byte order; the two
 * differ on surrogate pairs, and it is the validator this walk must agree with.
 */

// Literal @req token for requirements-trace's STATIC scanner, which cannot read
// the template-literal form the titles below use (archgate REQ-001 /
// no-template-literal-only-req-binding): @req:265844b7-74db-44e4-98b9-37fe77407bdb
const REQ = "265844b7-74db-44e4-98b9-37fe77407bdb";

// Same barrel mock as the sibling suite for this subject
// (tests/unit/adapters/FileSystemVaultAdapter.test.ts): the real core carriers
// are imported from source, past the mock.
jest.unstable_mockModule("@kitelev/exocortex-core", () => ({
  IVaultAdapter: class {},
  IFile: class {},
  IFolder: class {},
  IFrontmatter: class {},
  FrontmatterService,
  parseYamlFrontmatterTolerant,
}));

const { FileSystemVaultAdapter } = await import(
  "../../../src/adapters/FileSystemVaultAdapter.js"
);

/** One directory level of the synthetic tree: name → children (`null` = file). */
type Tree = { [name: string]: Tree | null };

/**
 * `a` / `a-c.md` / `a-d` / `a.md` carry the discriminating shapes: a directory
 * name that is a PREFIX of a file name is exactly where per-directory order and
 * full-path order disagree (`/` 0x2F against `-` 0x2D and `.` 0x2E).
 */
const TREE: Tree = {
  "zz.md": null,
  "mm-dir": { "y.md": null, "b.md": null },
  "a.md": null,
  "a-c.md": null,
  "a-d": { "e.md": null },
  a: { "b.md": null },
  ".obsidian": { "ignored.md": null },
};

const ROOT = "/synthetic-vault";

interface StubDirent {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}

function nodeAt(dir: string): Tree | null {
  if (dir === ROOT) return TREE;
  if (!dir.startsWith(`${ROOT}/`)) return null;
  let cur: Tree | null = TREE;
  for (const seg of dir.slice(ROOT.length + 1).split("/")) {
    const next: Tree | null | undefined = cur?.[seg];
    if (next === undefined || next === null) return null;
    cur = next;
  }
  return cur;
}

/**
 * Entries handed back in the order TREE declares them — deliberately NEITHER
 * ascending NOR descending, the shape a hash-ordered filesystem produces.
 *
 * ⛤ Why not simply reversed: under a reversed stub the two mutants of the guard
 * ("no sort" and "comparator inverted") emit BYTE-IDENTICAL output, because a
 * reversed input is already in descending order. The sets of reddened axes would
 * then coincide for an arithmetic reason rather than a coverage one
 * (integration-test-revert-verify §A110). With an unordered stub the two mutants
 * produce different sequences, and the shared axis set is simply what ONE guard
 * with two failure modes looks like.
 */
function fsOrderEntries(dir: string): StubDirent[] {
  const node = nodeAt(dir);
  if (node === null) {
    const err = new Error(`ENOENT: ${dir}`) as NodeJS.ErrnoException;
    err.code = "ENOENT";
    throw err;
  }
  return Object.keys(node) // insertion order of TREE — not sorted, not reversed
    .map((name) => ({
      name,
      isDirectory: () => node[name] !== null,
      isFile: () => node[name] === null,
    }));
}

/** `PropertyNameValidator.walk`, reproduced verbatim over the same stub. */
function validatorWalk(): string[] {
  const out: string[] = [];
  const rec = (dir: string): void => {
    let entries: StubDirent[];
    try {
      entries = fsOrderEntries(dir);
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".")) continue; // mirrors shouldSkipDirectory
        rec(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        out.push(full.slice(ROOT.length + 1));
      }
    }
  };
  rec(ROOT);
  return out;
}

const EXPECTED = [
  "a/b.md",
  "a-c.md",
  "a-d/e.md",
  "a.md",
  "mm-dir/b.md",
  "mm-dir/y.md",
  "zz.md",
];

describe("CLI vault walk is deterministic by construction (ticket 193147b4)", () => {
  let readdirSyncSpy: jest.SpiedFunction<typeof fs.readdirSync>;
  let adapter: InstanceType<typeof FileSystemVaultAdapter>;

  beforeEach(() => {
    adapter = new FileSystemVaultAdapter(ROOT);
    readdirSyncSpy = jest.spyOn(fs, "readdirSync");
    readdirSyncSpy.mockImplementation(
      ((dir: string) => fsOrderEntries(dir)) as never,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it(`D1 emits the validator's comparator order even when the filesystem hands entries back unordered @req:${REQ}`, () => {
    const emitted = adapter.getAllFiles().map((f) => f.path);
    // `.obsidian` is skipped by shouldSkipDirectory, exactly as before.
    expect(emitted).toEqual(EXPECTED);
  });

  it(`D2 emits the SAME sequence as PropertyNameValidator.walk on one and the same tree — the parity first-wins assumes @req:${REQ}`, () => {
    const fromAdapter = adapter.getAllFiles().map((f) => f.path);
    expect(fromAdapter).toEqual(validatorWalk());
    // ⛔ Pin the sequence literally too: without this the equality could be
    // satisfied by BOTH sides regressing together (the same point K10 of ticket
    // 534a7a46 makes on the range-typing path).
    expect(validatorWalk()).toEqual(EXPECTED);
  });

  it(`D3 the order is NOT the full-path order NodeFsAdapter.getMarkdownFiles produces — the third order is named, not adopted @req:${REQ}`, () => {
    const perDirectory = adapter.getAllFiles().map((f) => f.path);
    const fullPathOrder = [...perDirectory].sort();
    // If these ever become equal, the Non-goal in req 265844b7 has silently
    // changed and must be re-decided rather than absorbed.
    expect(perDirectory).not.toEqual(fullPathOrder);
    expect(fullPathOrder[0]).toBe("a-c.md");
    expect(perDirectory[0]).toBe("a/b.md");
  });
});
