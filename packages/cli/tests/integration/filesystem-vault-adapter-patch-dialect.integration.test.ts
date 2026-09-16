/**
 * req 2a020489 — the CLI `FileSystemVaultAdapter.updateFrontmatter` writes
 * through the SAME core carrier as the plugin adapter
 * (`FrontmatterService.applyPatch`): canonical key, legacy-spelling drop,
 * canonical-wins on a dual payload, IRI normalisation, PATCH semantics
 * (unreturned keys preserved, omission is not deletion).
 *
 * Production-shape: a real temp vault on disk, the real adapter, the real
 * core — no mocks. Every axis reads the file BACK from disk and parses it,
 * so what is asserted is what the next reader (plugin, CLI, SPARQL indexer)
 * will see.
 *
 * Axes C1-C7 mirror the plugin adapter's A-axes
 * (`packages/obsidian-plugin/tests/unit/ObsidianVaultAdapter.test.ts`, req
 * de7131ae A1-A5 + req 2a020489 A6-A7). Revert-verify (PR body): mutant M2
 * (restore the pre-req replace-whole-block write in THIS adapter) reddens
 * C1-C4, C6, C7 and leaves every A-axis green; mutants on the helper body
 * (M3-M7) redden the matching C- AND A-axes — the dialect has one carrier.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs-extra";
import path from "path";
import os from "os";
import { parseYamlFrontmatterTolerant } from "@kitelev/exocortex-core";
import { FileSystemVaultAdapter } from "../../src/adapters/FileSystemVaultAdapter.js";

const REQ = "@req:2a020489-00db-4fe9-b2ca-1481cb7da9b1";
const REL =
  "assetspaces/kitelev/exoas-my/my-efforts/c1000000-0000-4000-8000-0000000000c1.md";

describe("FileSystemVaultAdapter.updateFrontmatter — chokepoint key dialect via FrontmatterService.applyPatch (req 2a020489) [REVERT-VERIFY]", () => {
  let root: string;
  let adapter: FileSystemVaultAdapter;

  beforeEach(async () => {
    root = await fs.mkdtemp(
      path.join(os.tmpdir(), "fs-adapter-patch-dialect-"),
    );
    adapter = new FileSystemVaultAdapter(root);
  });

  afterEach(async () => {
    await fs.remove(root);
  });

  /** Seed the file with a YAML block, run the real adapter, parse the file back from disk. */
  async function write(
    live: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): Promise<{ fm: Record<string, unknown>; raw: string }> {
    const lines = Object.entries(live).map(
      ([k, v]) => `${k}: ${JSON.stringify(v)}`,
    );
    const seed = `---\n${lines.join("\n")}\n---\nBody stays.\n`;
    await fs.outputFile(path.join(root, REL), seed, "utf-8");
    const file = adapter.getAbstractFileByPath(REL);
    if (!file || !("basename" in file))
      throw new Error(`seed not found: ${REL}`);
    await adapter.updateFrontmatter(file, () => patch);
    const raw = await fs.readFile(path.join(root, REL), "utf-8");
    const block = /^---\n([\s\S]*?)\n---/.exec(raw)?.[1];
    if (block === undefined)
      throw new Error(`no frontmatter block after write:\n${raw}`);
    const fm = parseYamlFrontmatterTolerant(block);
    if (!fm) throw new Error(`unparseable frontmatter after write:\n${raw}`);
    return { fm, raw };
  }

  it(`C1 writes exo__Asset_archived and DROPS the legacy bare \`archived\` key on a legacy carrier ${REQ}`, async () => {
    const { fm } = await write(
      { archived: true, exo__Asset_uid: "u" },
      { archived: true, exo__Asset_uid: "u", exo__Asset_archived: false },
    );
    expect(fm.exo__Asset_archived).toBe(false);
    expect(fm).not.toHaveProperty("archived");
    expect(
      Object.keys(fm).filter((k) => k.toLowerCase().includes("archived")),
    ).toEqual(["exo__Asset_archived"]);
  });

  it(`C2 upgrades a bare \`archived\` payload key to exo__Asset_archived (never writes the bare form) ${REQ}`, async () => {
    const { fm } = await write({}, { archived: true });
    expect(fm).toEqual({ exo__Asset_archived: true });
  });

  it(`C3 writes the prefixed exo__Asset_aliases under the live \`aliases:\` key ${REQ}`, async () => {
    const { fm } = await write({}, { exo__Asset_aliases: ["x"] });
    expect(fm).toEqual({ aliases: ["x"] });
    expect(fm).not.toHaveProperty("exo__Asset_aliases");
  });

  it(`C4 resolves a payload carrying BOTH spellings canonical-wins, in either insertion order ${REQ}`, async () => {
    // Legacy entry FIRST — a last-write-wins rule would let the canonical value
    // survive here by accident; the second call flips the order.
    const a = await write({}, { archived: true, exo__Asset_archived: false });
    expect(a.fm).toEqual({ exo__Asset_archived: false });
    const b = await write({}, { exo__Asset_archived: false, archived: true });
    expect(b.fm).toEqual({ exo__Asset_archived: false });
  });

  it(`C5 (negative control) leaves keys outside the canonical-key rule untouched ${REQ}`, async () => {
    const { fm } = await write(
      {},
      {
        exo__Asset_isDefinedBy: "[[x]]",
        ems__Effort_status: "[[y]]",
        aliases: ["a"],
      },
    );
    expect(fm).toEqual({
      exo__Asset_isDefinedBy: "[[x]]",
      ems__Effort_status: "[[y]]",
      aliases: ["a"],
    });
  });

  it(`C6 PATCH: keys the updater does not return are preserved — omission is not deletion ${REQ}`, async () => {
    const { fm, raw } = await write(
      {
        exo__Asset_uid: "u",
        exo__Asset_label: "L",
        ems__Effort_status: "[[s]]",
      },
      { exo__Asset_label: "New" },
    );
    expect(fm).toEqual({
      exo__Asset_uid: "u",
      exo__Asset_label: "New",
      ems__Effort_status: "[[s]]",
    });
    // The body after the block is untouched by a frontmatter patch.
    expect(raw.endsWith("---\nBody stays.\n")).toBe(true);
  });

  it(`C7 an IRI-form key and an obsidian:// value are normalised to the Obsidian dialect ${REQ}`, async () => {
    const { fm } = await write(
      {},
      {
        "https://exocortex.my/ontology/ems#Effort_status":
          "obsidian://vault/x/ems__EffortStatusDoing.md",
      },
    );
    expect(Object.keys(fm)).toEqual(["ems__Effort_status"]);
    expect(String(fm.ems__Effort_status)).toContain(
      "[[ems__EffortStatusDoing]]",
    );
    expect(String(fm.ems__Effort_status)).not.toContain("obsidian://");
  });
});
