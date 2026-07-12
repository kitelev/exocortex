/**
 * Issue #3800 — a duplicated YAML mapping key must NOT make an asset invisible.
 *
 * Production-shape revert-verify (test-fixture-realism +
 * integration-test-revert-verify): a real dup-key `.md` is written to a temp
 * vault on disk, then read back through the REAL adapters and the REAL
 * `NoteToRDFConverter.convertNote` — the exact pipeline `apply`/`query` use to
 * build the triple store that every precondition ASK runs against. Nothing is
 * hand-injected past the buggy `extractFrontmatter` stage.
 *
 * With the tolerant-parse fix (`parseYamlFrontmatterTolerant`, `{ json: true }`
 * last-wins), the adapters return the frontmatter and the converter emits the
 * asset's triples. Revert the fix (bare `yaml.load` throws → `{}`/null) and:
 *   - FileSystemVaultAdapter.getFrontmatter → null   → status assertion RED
 *   - NodeFsAdapter.getFileMetadata        → {}      → status assertion RED
 *   - NoteToRDFConverter.convertNote       → []      → triple assertions RED
 * The clean-asset negative control stays GREEN either way (non-vacuity).
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { NoteToRDFConverter, NullLogger, type IFile } from "@kitelev/exocortex-core";

const { FileSystemVaultAdapter } = await import(
  "../../src/adapters/FileSystemVaultAdapter.js"
);
const { NodeFsAdapter } = await import("../../src/adapters/NodeFsAdapter.js");

const DUPKEY_UID = "16458983-1302-403a-bc70-b23896d1caec";
const CLEAN_UID = "c1eanc1e-0000-4000-8000-000000000001";

/** A freshly-seeded dup-key repro: exo__Asset_prototype twice (lines 3 & 5). */
const DUPKEY_MD = [
  "---",
  `exo__Asset_uid: ${DUPKEY_UID}`,
  'exo__Instance_class: "[[1b20a8f0-d745-4e93-91db-4531b3df120e|ems__Task]]"',
  'exo__Asset_prototype: "[[aaa]]"',
  'ems__Effort_status: "[[753a44d5-846c-4b82-9196-4fd9a4d48777|ems__EffortStatusBacklog]]"',
  'exo__Asset_prototype: "[[bbb]]"',
  'exo__Asset_label: "Dup key repro"',
  "---",
  "body",
  "",
].join("\n");

const CLEAN_MD = [
  "---",
  `exo__Asset_uid: ${CLEAN_UID}`,
  'exo__Instance_class: "[[1b20a8f0-d745-4e93-91db-4531b3df120e|ems__Task]]"',
  'ems__Effort_status: "[[753a44d5-846c-4b82-9196-4fd9a4d48777|ems__EffortStatusBacklog]]"',
  'exo__Asset_label: "Clean asset"',
  "---",
  "body",
  "",
].join("\n");

describe("#3800: duplicated YAML key keeps the asset visible", () => {
  let vault: string;
  const dupRel = `assets/${DUPKEY_UID}.md`;
  const cleanRel = `assets/${CLEAN_UID}.md`;

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-3800-"));
    fs.mkdirSync(path.join(vault, "assets"), { recursive: true });
    fs.writeFileSync(path.join(vault, dupRel), DUPKEY_MD);
    fs.writeFileSync(path.join(vault, cleanRel), CLEAN_MD);
  });

  afterEach(() => {
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it("FileSystemVaultAdapter.getFrontmatter returns the dup-key frontmatter (last-wins)", () => {
    const adapter = new FileSystemVaultAdapter(vault);
    const file = adapter.getAllFiles().find((f: IFile) => f.path.includes(DUPKEY_UID));
    expect(file).toBeDefined();

    const fm = adapter.getFrontmatter(file!);

    // The bug returned null here → precondition ASK found no binding.
    expect(fm).not.toBeNull();
    expect(fm!.ems__Effort_status).toBe(
      "[[753a44d5-846c-4b82-9196-4fd9a4d48777|ems__EffortStatusBacklog]]",
    );
    // last-wins: the second exo__Asset_prototype value survives.
    expect(fm!.exo__Asset_prototype).toBe("[[bbb]]");
  });

  it("NodeFsAdapter.getFileMetadata returns the dup-key frontmatter (not {})", async () => {
    const adapter = new NodeFsAdapter(vault);
    const fm = await adapter.getFileMetadata(dupRel);

    expect(Object.keys(fm).length).toBeGreaterThan(0);
    expect(fm.ems__Effort_status).toBe(
      "[[753a44d5-846c-4b82-9196-4fd9a4d48777|ems__EffortStatusBacklog]]",
    );
    expect(fm.exo__Asset_prototype).toBe("[[bbb]]");
  });

  it("NoteToRDFConverter.convertNote emits the asset's triples (0 → visible)", async () => {
    const adapter = new FileSystemVaultAdapter(vault);
    const converter = new NoteToRDFConverter(adapter, NullLogger);
    const dupFile = adapter
      .getAllFiles()
      .find((f: IFile) => f.path.includes(DUPKEY_UID))!;

    const triples = await converter.convertNote(dupFile);

    // The bug: getFrontmatter → null → convertNote → [] (0 triples = invisible).
    expect(triples.length).toBeGreaterThan(0);
    const hasStatus = triples.some((t) =>
      t.predicate.value.includes("Effort_status"),
    );
    expect(hasStatus).toBe(true);
  });

  it("negative control: a clean asset is visible both ways (non-vacuity)", async () => {
    const adapter = new FileSystemVaultAdapter(vault);
    const cleanFile = adapter
      .getAllFiles()
      .find((f: IFile) => f.path.includes(CLEAN_UID))!;

    const fm = adapter.getFrontmatter(cleanFile);
    expect(fm!.ems__Effort_status).toBeDefined();

    const converter = new NoteToRDFConverter(adapter, NullLogger);
    const triples = await converter.convertNote(cleanFile);
    expect(
      triples.some((t) => t.predicate.value.includes("Effort_status")),
    ).toBe(true);
  });
});
