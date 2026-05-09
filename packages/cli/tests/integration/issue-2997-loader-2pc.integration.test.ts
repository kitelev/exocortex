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
import { NoteToRDFConverter } from "exocortex";
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
  { filename: "05-missing-asset-isdefinedby.md", expectedReasonContains: "exo__Asset_isDefinedBy" },
  { filename: "06-empty-asset-label.md", expectedReasonContains: "exo__Asset_label" },
  { filename: "07-empty-instance-class.md", expectedReasonContains: "exo__Instance_class" },
  { filename: "08-empty-effort-status.md", expectedReasonContains: "ems__Effort_status" },
  { filename: "09-empty-effort-parent.md", expectedReasonContains: "ems__Effort_parent" },
  { filename: "10-empty-asset-updatedat.md", expectedReasonContains: "exo__Asset_updatedAt" },
  { filename: "11-empty-effort-start-timestamp.md", expectedReasonContains: "ems__Effort_startTimestamp" },
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
    "loads the full mixed fixture vault: only valid files contribute triples, all 11 bad files reported as skipped",
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
});
