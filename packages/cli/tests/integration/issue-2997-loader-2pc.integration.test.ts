/**
 * Phase 2 integration tests for issue #2997 — Loader two-phase commit.
 *
 * RFC `0810aad3-90fc-46bb-a103-26ca8172970b` Phase 2.
 *
 * Walks each of the 11 bad-file fixtures in
 * `tests/fixtures/issue-2997/bad-files/` through
 * `NoteToRDFConverter.convertVaultWithValidation` in isolation and
 * asserts the all-or-nothing invariant: a single malformed asset must
 * produce zero triples in the candidate output and must be reported in
 * `skippedFiles`.
 *
 * Each fixture is loaded into its own temporary vault (the file alone)
 * so the per-file invariant is exercised without interference from
 * neighbouring files.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { NoteToRDFConverter } from "@kitelev/exocortex-core";
import { FileSystemVaultAdapter } from "../../src/adapters/FileSystemVaultAdapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BAD_FILES_DIR = resolve(__dirname, "../fixtures/issue-2997/bad-files");
const VALID_TREE_DIR = resolve(__dirname, "../fixtures/issue-2997/valid-tree");

interface BadFixture {
  filename: string;
  expectedReasonContains: string;
}

const BAD_FIXTURES: BadFixture[] = [
  { filename: "01-invalid-iri-class.md", expectedReasonContains: "Invalid Instance_class IRI" },
  { filename: "02-empty-locked-by.md", expectedReasonContains: "ems__Effort_lockedBy" },
  { filename: "03-empty-lock-expires.md", expectedReasonContains: "ems__Effort_lockExpires" },
  { filename: "04-missing-asset-uid.md", expectedReasonContains: "exo__Asset_uid" },
  // 05-missing-asset-isdefinedby removed: exo__Asset_isDefinedBy is now
  // optional — downstream consumers handle the missing case via defaults.
  // 06-empty-asset-label removed: exo__Asset_label is now optional with basename fallback.
  { filename: "07-empty-instance-class.md", expectedReasonContains: "exo__Instance_class" },
  { filename: "08-empty-effort-status.md", expectedReasonContains: "ems__Effort_status" },
  { filename: "09-empty-effort-parent.md", expectedReasonContains: "ems__Effort_parent" },
  { filename: "10-empty-asset-updatedat.md", expectedReasonContains: "exo__Asset_updatedAt" },
  { filename: "11-empty-effort-start-timestamp.md", expectedReasonContains: "ems__Effort_startTimestamp" },
  // 12 — the frontmatter BLOCK is present and does not parse. Before the fix
  // this family was the one the loader dropped SILENTLY: no skippedFiles
  // entry, no log line, while every other rejection was named. Listing it
  // here also tightens the mixed-vault case below, which counts the set.
  { filename: "12-unparseable-frontmatter.md", expectedReasonContains: "Unparseable frontmatter" },
];

let tempRoot: string;

async function makeTempVaultWith(fixturePath: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tempRoot, "issue-2997-2pc-"));
  const dest = path.join(dir, path.basename(fixturePath));
  await fs.copy(fixturePath, dest);
  return dir;
}

describe("Issue #2997 Phase 2 — Loader two-phase commit (all-or-nothing)", () => {
  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "exo-2997-phase2-"));
  });

  afterAll(async () => {
    if (tempRoot) await fs.remove(tempRoot);
  });

  it.each(BAD_FIXTURES)(
    "rejects $filename without leaking any triples",
    async ({ filename, expectedReasonContains }) => {
      const fixturePath = path.join(BAD_FILES_DIR, filename);
      const vaultRoot = await makeTempVaultWith(fixturePath);

      const adapter = new FileSystemVaultAdapter(vaultRoot);
      const converter = new NoteToRDFConverter(adapter);

      const result = await converter.convertVaultWithValidation();

      expect(result.triples).toEqual([]);
      expect(result.summary.indexed).toBe(0);
      expect(result.summary.skipped).toBe(1);
      expect(result.summary.total).toBe(1);
      expect(result.skippedFiles).toHaveLength(1);
      expect(result.skippedFiles[0].path).toBe(filename);
      expect(result.skippedFiles[0].reason).toContain(expectedReasonContains);
    },
  );

  it("indexes the well-formed control tree with non-empty triples and zero skips", async () => {
    const adapter = new FileSystemVaultAdapter(VALID_TREE_DIR);
    const converter = new NoteToRDFConverter(adapter);

    const result = await converter.convertVaultWithValidation();

    expect(result.summary.skipped).toBe(0);
    expect(result.triples.length).toBeGreaterThan(0);
    expect(result.skippedFiles).toEqual([]);
  });

  it(
    "loads the full mixed fixture vault: only valid files contribute triples, all 11 bad files reported as skipped @req:fe50da38-4798-46e6-bb0a-b4b88596c340",
    async () => {
      const fixtureRoot = resolve(__dirname, "../fixtures/issue-2997");
      const adapter = new FileSystemVaultAdapter(fixtureRoot);
      const converter = new NoteToRDFConverter(adapter);

      const result = await converter.convertVaultWithValidation();

      expect(result.summary.skipped).toBe(BAD_FIXTURES.length);
      expect(result.skippedFiles.map((f) => path.basename(f.path)).sort()).toEqual(
        BAD_FIXTURES.map((f) => f.filename).sort(),
      );
      // Triples must come exclusively from the valid-tree subset.
      for (const triple of result.triples) {
        const subject = (triple.subject as { value: string }).value;
        for (const bad of BAD_FIXTURES) {
          expect(subject).not.toContain(bad.filename);
        }
      }
      expect(result.triples.length).toBeGreaterThan(0);
    },
    30_000,
  );

  // ⛔ TWO axes, not one — the change ADDS A CALL into an existing function, so
  //    "the branch does what it promises" and "the branch is WIRED into the
  //    production path" are different claims (feature-sdd Step 4).
  //    (a) the unparseable file is NAMED, with the parser's OWN message;
  //    (b) a plain note in the SAME vault stays silent — without it an
  //        over-wide fix (report every null frontmatter) passes (a) too.
  it(
    "names a file whose frontmatter block does not parse, and stays silent about a note that has no block @req:fe50da38-4798-46e6-bb0a-b4b88596c340",
    async () => {
      const fixtureRoot = resolve(__dirname, "../fixtures/issue-2997");
      const adapter = new FileSystemVaultAdapter(fixtureRoot);
      const converter = new NoteToRDFConverter(adapter);

      const result = await converter.convertVaultWithValidation();

      const unparseable = result.skippedFiles.find((f) =>
        f.path.endsWith("12-unparseable-frontmatter.md"),
      );
      expect(unparseable).toBeDefined();
      expect(unparseable!.reason).toMatch(/^Unparseable frontmatter: /);
      // The reason is DERIVED from the parser, not authored here. Proven by the
      // `(line:column)` suffix: only js-yaml knows where the block broke, so a
      // hand-written reason could not carry it.
      // ⛔ Do NOT assert the wording itself — it belongs to the parser, and the
      //    two parsers disagree on this very fixture: pyyaml says "mapping
      //    values are not allowed here", js-yaml 5 (YAML11) says "bad
      //    indentation of a mapping entry". Pinning either would lock this axis
      //    to a dependency's prose (verify-before-assert §A18).
      expect(unparseable!.reason).toMatch(/\(\d+:\d+\)/);

      // README.md has no frontmatter block at all: legitimately not an asset,
      // and reporting it would turn a useful notice into noise.
      expect(
        result.skippedFiles.some((f) => f.path.endsWith("README.md")),
      ).toBe(false);

      // ⛤ SECOND silent-by-design shape, found by review: a block whose body is
      //    only a YAML comment. Non-blank by `trim()`, but it loads to an EMPTY
      //    DOCUMENT and means what the blessed `---\n\n---` means. Without this
      //    the diagnostic reported it as "expected a document, but the input is
      //    empty" — noise on a legitimate authoring shape.
      expect(
        result.skippedFiles.some((f) =>
          f.path.endsWith("comment-only-frontmatter.md"),
        ),
      ).toBe(false);
    },
    30_000,
  );
});
