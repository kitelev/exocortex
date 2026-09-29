/**
 * #4453 — the PLUGIN half of #4441's CRLF/BOM fix. Req `1dfbd427-9a96-4fc2-a49e-146f6b2a46e5`.
 *
 * The CLI adapter has recognised a CRLF-fenced or BOM-led frontmatter block
 * since PR #4450. Three plugin sites kept their own LF-only predicates, so the
 * SAME `.md` file produced triples through `exocortex-cli` and zero triples
 * through the plugin — a parity defect decided by which surface read it, not by
 * the data.
 *
 * Axis layout:
 *   `C*` — the shared core predicate itself (`frontmatterBlockBody` /
 *          `matchFrontmatterBlock`), including its deliberate LIMITS.
 *   `P*` — each of the three plugin sites, driven through its own public entry
 *          point (not through the helper), so the axes prove the SITE is wired
 *          to the helper, not merely that the helper works.
 *   `X*` — cross-surface: the real `ObsidianVaultAdapter` through the real
 *          `NoteToRDFConverter.convertVaultWithValidation`, which is the parity
 *          property the requirement exists to restore.
 *
 * ⛤ On `parseYaml` — corrected after the review of PR #4458, which caught the
 * earlier version of this note claiming more than it proved. The shared
 * Obsidian double is a hand-rolled line parser whose tolerance of `\r` is an
 * ACCIDENT of `String.prototype.trim()`, not evidence about Obsidian's own
 * implementation. Since this change makes both `ObsidianVaultAdapter` and
 * `VaultRDFIndexer` hand a `\r`-RETAINING body to the real `parseYaml` for the
 * first time, that distinction matters:
 *
 *   - `C5` closes the substantive half with a REAL YAML implementation —
 *     js-yaml, which this repo already uses for frontmatter
 *     (`parseYamlFrontmatterTolerant`): a `\r`-retaining body parses to the
 *     same mapping as its LF twin.
 *   - ⛔ What remains open, stated rather than papered over: Obsidian's OWN
 *     `parseYaml` is not exercised by any axis here — only in Docker e2e. The
 *     commit body says so too. This is a test-fixture-realism limit, not a
 *     known defect: js-yaml and the YAML spec both treat `\r\n` as a line
 *     break.
 */
import * as obsidian from "obsidian";
import { App, MetadataCache, TFile, Vault } from "obsidian";
import {
  IFile,
  NoteToRDFConverter,
  frontmatterBlockBody,
  matchFrontmatterBlock,
} from "@kitelev/exocortex-core";
import * as realYaml from "js-yaml";
import { ObsidianVaultAdapter } from "../../../src/adapters/ObsidianVaultAdapter";
import { ObsidianFileSystemAdapter } from "../../../src/adapters/ObsidianFileSystemAdapter";
import { VaultRDFIndexer } from "../../../src/infrastructure/VaultRDFIndexer";

const BOM = "﻿";

/** Same asset, four encodings of the SAME meaning. */
const FM_LINES = [
  "exo__Asset_uid: 11111111-1111-1111-1111-111111111111",
  "exo__Instance_class: ems__Task",
  "exo__Asset_label: Encoded",
];
const LF = `---\n${FM_LINES.join("\n")}\n---\n\nbody\n`;
const CRLF = `---\r\n${FM_LINES.join("\r\n")}\r\n---\r\n\r\nbody\r\n`;
const BOM_LF = BOM + LF;
const BOM_CRLF = BOM + CRLF;

/** Controls that MUST stay unrecognised. */
const NO_FENCE = "Just a note.\n\nNothing fenced here.\n";
const FENCE_IN_BODY = "intro\n\n---\nnot: frontmatter\n---\n\nmore\n";
const LONE_CR = `---\r${FM_LINES.join("\r")}\r---\r`;
const DOUBLE_BOM = BOM + BOM + LF;

function tfile(path: string): TFile {
  const f = Object.create(TFile.prototype) as TFile;
  const basename = path.replace(/\.md$/, "").split("/").pop() ?? path;
  Object.assign(f, { path, basename, name: `${basename}.md`, parent: null });
  return f;
}

function asIFile(path: string): IFile {
  const basename = path.replace(/\.md$/, "").split("/").pop() ?? path;
  return { path, basename, name: `${basename}.md`, parent: null };
}

/**
 * A vault double holding real bytes. `getFileCache` is a SEPARATE snapshot that
 * is always COLD here — which is the honest model for these axes: Obsidian's own
 * cache is not the subject, the plugin's own raw-read predicates are, and those
 * are exactly what a cold cache falls back to.
 */
function makeApp(files: Record<string, string>) {
  const tfiles = Object.keys(files).map(tfile);
  const read = jest.fn(async (f: TFile) => {
    const c = files[f.path];
    if (c === undefined) throw new Error(`ENOENT: ${f.path}`);
    return c;
  });
  const adapterRead = jest.fn(async (p: string) => {
    const c = files[p];
    if (c === undefined) throw new Error(`ENOENT: ${p}`);
    return c;
  });

  const vault = {
    read,
    getMarkdownFiles: jest.fn(() => tfiles),
    getAbstractFileByPath: jest.fn(
      (p: string) => tfiles.find((f) => f.path === p) ?? null,
    ),
    create: jest.fn(),
    modify: jest.fn(),
    createFolder: jest.fn(),
    adapter: {
      read: adapterRead,
      write: jest.fn(),
      exists: jest.fn(async (p: string) => files[p] !== undefined),
      remove: jest.fn(),
      rename: jest.fn(),
      mkdir: jest.fn(),
    },
  } as unknown as jest.Mocked<Vault>;

  const metadataCache = {
    getFileCache: jest.fn(() => null), // cold — the raw-read predicates decide
    getFirstLinkpathDest: jest.fn(() => null),
    on: jest.fn(() => ({})),
    off: jest.fn(),
  } as unknown as jest.Mocked<MetadataCache>;

  const app = {
    vault,
    metadataCache,
    fileManager: {},
  } as unknown as App;

  return { app, vault, metadataCache };
}

describe("#4453 — CRLF/BOM frontmatter on the plugin surface (req 1dfbd427)", () => {
  describe("C — the shared core predicate", () => {
    it.each([
      ["LF", LF],
      ["CRLF", CRLF],
      ["BOM + LF", BOM_LF],
      ["BOM + CRLF", BOM_CRLF],
    ])(
      "C1 @req:1dfbd427-9a96-4fc2-a49e-146f6b2a46e5 recognises a %s block and returns its body verbatim",
      (_name, content) => {
        const body = frontmatterBlockBody(content);
        expect(body).not.toBeNull();
        // Verbatim: `\r` is NOT stripped from the body. Asserted rather than
        // assumed, because the offsets the helper returns must keep matching
        // the text it returns.
        for (const line of FM_LINES) {
          expect(body).toContain(line.replace(/\n/g, ""));
        }
      },
    );

    it("C2 @req:1dfbd427-9a96-4fc2-a49e-146f6b2a46e5 a CRLF body keeps its carriage returns", () => {
      expect(frontmatterBlockBody(CRLF)).toContain("\r");
      expect(frontmatterBlockBody(LF)).not.toContain("\r");
    });

    it("C3 @req:1dfbd427-9a96-4fc2-a49e-146f6b2a46e5 offsets are into the ORIGINAL string, so a BOM is never inside the block", () => {
      const m = matchFrontmatterBlock(BOM_CRLF);
      expect(m).not.toBeNull();
      // blockStart skips the BOM, so a splice around [start, end) leaves the
      // byte where the user put it.
      expect(m?.blockStart).toBe(1);
      expect(BOM_CRLF.slice(0, m!.blockStart)).toBe(BOM);
      expect(BOM_CRLF.slice(m!.blockStart, m!.blockEnd)).toMatch(/^---/);
      expect(BOM_CRLF.slice(m!.blockStart, m!.blockEnd)).toMatch(/---$/);
    });

    it("C5 @req:1dfbd427-9a96-4fc2-a49e-146f6b2a46e5 a REAL YAML parser reads the \\r-retaining body to the same mapping as its LF twin", () => {
      // The substantive half of the `\r`-verbatim decision, on a real YAML
      // implementation rather than the hand-rolled double: js-yaml is what
      // `parseYamlFrontmatterTolerant` (core) uses for frontmatter. Without
      // this, the only evidence that retaining `\r` is safe came from a double
      // whose tolerance is incidental (review of PR #4458).
      const crlfBody = frontmatterBlockBody(CRLF);
      const lfBody = frontmatterBlockBody(LF);
      expect(crlfBody).toContain("\r");
      expect(lfBody).not.toContain("\r");
      expect(
        realYaml.load(crlfBody as string, { schema: realYaml.YAML11_SCHEMA }),
      ).toEqual(
        realYaml.load(lfBody as string, { schema: realYaml.YAML11_SCHEMA }),
      );
    });

    it.each([
      ["a note with no fence", NO_FENCE],
      ["a fence that is not at position 0", FENCE_IN_BODY],
      ["lone-CR fences (#4452 territory)", LONE_CR],
      ["a DOUBLED BOM (#4452 territory)", DOUBLE_BOM],
    ])(
      "C4 @req:1dfbd427-9a96-4fc2-a49e-146f6b2a46e5 control — %s stays unrecognised",
      (_name, content) => {
        expect(frontmatterBlockBody(content)).toBeNull();
      },
    );
  });

  describe("P — each plugin site, through its own entry point", () => {
    it.each([
      ["CRLF", CRLF],
      ["BOM + LF", BOM_LF],
      ["BOM + CRLF", BOM_CRLF],
    ])(
      "P1 @req:1dfbd427-9a96-4fc2-a49e-146f6b2a46e5 ObsidianVaultAdapter.getFrontmatterWithFallback reads a %s asset (today: null)",
      async (_name, content) => {
        const { app, vault, metadataCache } = makeApp({ "a.md": content });
        const adapter = new ObsidianVaultAdapter(vault, metadataCache, app);

        const fm = await adapter.getFrontmatterWithFallback(asIFile("a.md"));

        expect(fm).not.toBeNull();
        expect(fm?.exo__Asset_uid).toBe(
          "11111111-1111-1111-1111-111111111111",
        );
      },
    );

    it("P2 @req:1dfbd427-9a96-4fc2-a49e-146f6b2a46e5 ObsidianVaultAdapter control — a fence-less note stays null on the fallback path", async () => {
      const { app, vault, metadataCache } = makeApp({ "a.md": NO_FENCE });
      const adapter = new ObsidianVaultAdapter(vault, metadataCache, app);
      await expect(
        adapter.getFrontmatterWithFallback(asIFile("a.md")),
      ).resolves.toBeNull();
    });

    it.each([
      ["CRLF", CRLF],
      ["BOM + LF", BOM_LF],
      ["BOM + CRLF", BOM_CRLF],
    ])(
      "P3 @req:1dfbd427-9a96-4fc2-a49e-146f6b2a46e5 ObsidianFileSystemAdapter.getFileMetadata reads a %s asset (today: {})",
      async (_name, content) => {
        const { app } = makeApp({ "a.md": content });
        const fs = new ObsidianFileSystemAdapter(app.vault);

        const meta = await fs.getFileMetadata("a.md");

        expect(meta.exo__Asset_uid).toBe("11111111-1111-1111-1111-111111111111");
      },
    );

    it("P4 @req:1dfbd427-9a96-4fc2-a49e-146f6b2a46e5 ObsidianFileSystemAdapter.findFileByUID finds a CRLF asset (today: not found)", async () => {
      const { app } = makeApp({ "a.md": CRLF });
      const fs = new ObsidianFileSystemAdapter(app.vault);

      await expect(
        fs.findFileByUID("11111111-1111-1111-1111-111111111111"),
      ).resolves.toBe("a.md");
    });

    it("P5 @req:1dfbd427-9a96-4fc2-a49e-146f6b2a46e5 ObsidianFileSystemAdapter control — a fence-less note yields {}", async () => {
      const { app } = makeApp({ "a.md": NO_FENCE });
      const fs = new ObsidianFileSystemAdapter(app.vault);
      await expect(fs.getFileMetadata("a.md")).resolves.toEqual({});
    });

    it.each([
      ["CRLF", CRLF],
      ["BOM + LF", BOM_LF],
      ["BOM + CRLF", BOM_CRLF],
      ["LF", LF],
    ])(
      "P6 @req:1dfbd427-9a96-4fc2-a49e-146f6b2a46e5 VaultRDFIndexer's disk-reindex path indexes a %s asset — the tolerance is now PINNED, not incidental",
      async (_name, content) => {
        // This site was already tolerant, by whole-content normalisation that
        // no test pinned. The axis exists so a refactor of that normalisation
        // (now removed in favour of the shared predicate) cannot regress it
        // silently — the risk #4453 names explicitly.
        const { app } = makeApp({ "a.md": content });
        const indexer = new VaultRDFIndexer(app);

        await indexer.reindexPathsFromDisk(["a.md"]);

        const store = indexer.getTripleStore();
        const triples = await store.match(undefined, undefined, undefined);
        expect(
          triples.filter((t) => t.subject.toString().includes("a.md")).length,
        ).toBeGreaterThan(0);
      },
    );

    it("P7 @req:1dfbd427-9a96-4fc2-a49e-146f6b2a46e5 VaultRDFIndexer control — a fence-less note contributes nothing", async () => {
      const { app } = makeApp({ "a.md": NO_FENCE });
      const indexer = new VaultRDFIndexer(app);

      await indexer.reindexPathsFromDisk(["a.md"]);

      const triples = await indexer.getTripleStore().match(undefined, undefined, undefined);
      expect(
        triples.filter((t) => t.subject.toString().includes("a.md")),
      ).toHaveLength(0);
    });
  });

  describe("X — cross-surface parity through the real loader", () => {
    it("X1 @req:1dfbd427-9a96-4fc2-a49e-146f6b2a46e5 all four encodings of the SAME asset produce the same triple count through the real vault walk", async () => {
      // The parity property the requirement exists to restore, asserted as an
      // EQUALITY across encodings rather than as "> 0" for each: a fix that
      // made CRLF visible but dropped a property would pass the weaker form.
      const counts: Record<string, number> = {};
      for (const [name, content] of [
        ["lf", LF],
        ["crlf", CRLF],
        ["bomlf", BOM_LF],
        ["bomcrlf", BOM_CRLF],
      ] as const) {
        const { app, vault, metadataCache } = makeApp({ [`${name}.md`]: content });
        const adapter = new ObsidianVaultAdapter(vault, metadataCache, app);
        const result = await new NoteToRDFConverter(
          adapter,
        ).convertVaultWithValidation();
        expect(result.skippedFiles).toEqual([]);
        counts[name] = result.triples.length;
      }
      expect(counts.lf).toBeGreaterThan(0);
      expect(counts.crlf).toBe(counts.lf);
      expect(counts.bomlf).toBe(counts.lf);
      expect(counts.bomcrlf).toBe(counts.lf);
    });

    it("X2 @req:1dfbd427-9a96-4fc2-a49e-146f6b2a46e5 a malformed CRLF-fenced asset is NAMED in the skip list, not silently dropped", async () => {
      // Composition with #4440: once the block is recognised, a body that does
      // not parse must reach the skip list rather than vanish. Without the
      // widening the file is "no block at all" and is reported by nothing.
      const malformed = `---\r\nexo__Asset_uid: 2222\r\n  bad: indentation\r\n---\r\n\r\nbody\r\n`;
      // Spy on the SAME module object the adapter imports (moduleNameMapper
      // points "obsidian" at the shared double). The double's `parseYaml` is a
      // naive line parser that never throws, so without this the axis would be
      // vacuous — it would assert nothing about a body that genuinely fails.
      const realParse = obsidian.parseYaml;
      jest.spyOn(obsidian, "parseYaml").mockImplementation((y: string) => {
        if (y.includes("bad: indentation")) {
          throw new Error("bad indentation of a mapping entry (3:3)");
        }
        return realParse(y);
      });

      const { app, vault, metadataCache } = makeApp({ "m.md": malformed });
      const adapter = new ObsidianVaultAdapter(vault, metadataCache, app);

      const result = await new NoteToRDFConverter(
        adapter,
      ).convertVaultWithValidation();

      const entry = result.skippedFiles.find((s) => s.path === "m.md");
      expect(entry).toBeDefined();
      expect(entry?.reason).toContain("Unparseable frontmatter");
    });
  });
});
