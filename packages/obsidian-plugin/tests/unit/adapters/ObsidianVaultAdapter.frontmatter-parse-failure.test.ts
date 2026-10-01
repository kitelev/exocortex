/**
 * #4440 — the PLUGIN half of req `fe50da38`'s three-outcome promise.
 *
 * The requirement says a malformed asset produces zero triples AND is reported
 * as skipped. PR #4439 delivered that for the CLI adapter; `ObsidianVaultAdapter`
 * did not implement `getFrontmatterParseFailure` at all, so on the surface most
 * users actually run, a file whose frontmatter block is present and unparseable
 * was dropped with NO skip-list entry — the "N file(s) skipped" list was
 * silently non-exhaustive.
 *
 * Two levels of axis here, on purpose:
 *
 *  - `A*` — the adapter's own predicate: all THREE outcomes, not just the one
 *    that reports. Without the paired controls, an over-wide fix (report ANY
 *    null frontmatter) would pass a report-only acceptance too — the risk PR
 *    #4439's body named explicitly.
 *  - `B*` — the REAL `ObsidianVaultAdapter` driven through the REAL
 *    `NoteToRDFConverter.convertVaultWithValidation`, i.e. the production
 *    loader path, not a mock at the `getFrontmatter` seam.
 *
 * ⛤ Why `parseYaml` is spied on in the "does not parse" axes: the shared
 * Obsidian test double implements `parseYaml` as a naive line parser that
 * NEVER throws and always returns an object. Feeding it genuinely malformed
 * YAML would therefore exercise nothing (`test-fixture-realism`), and a green
 * axis would prove only that the double is lenient. Real Obsidian's `parseYaml`
 * is js-yaml `load`: it throws on malformed input and returns a SCALAR for a
 * non-mapping document. Both real behaviours are injected at that boundary —
 * which is also exactly the contract under test ("the reason is derived from
 * the parser, not authored here").
 */
import * as obsidian from "obsidian";
import { App, MetadataCache, TFile, Vault } from "obsidian";
import { IFile, NoteToRDFConverter } from "@kitelev/exocortex-core";
import { ObsidianVaultAdapter } from "../../../src/adapters/ObsidianVaultAdapter";

/** A `TFile` that survives the adapter's `instanceof TFile` narrowing. */
function tfile(path: string): TFile {
  const f = Object.create(TFile.prototype) as TFile;
  const basename = path.replace(/\.md$/, "").split("/").pop() ?? path;
  Object.assign(f, {
    path,
    basename,
    name: `${basename}.md`,
    parent: null,
  });
  return f;
}

/**
 * A vault double holding real bytes, so the adapter's raw-read path is the one
 * under test. `getFileCache` is a SEPARATE snapshot from the file contents —
 * that is the real contract (metadataCache lags writes, and is cold at boot),
 * and modelling it as a live view of the files would hide the very conflation
 * this suite exists to pin.
 */
function makeVault(files: Record<string, string>, opts: { warm: boolean }) {
  const tfiles = Object.keys(files).map(tfile);

  const vault = {
    read: jest.fn(async (f: TFile) => {
      const content = files[f.path];
      if (content === undefined) throw new Error(`ENOENT: ${f.path}`);
      return content;
    }),
    getMarkdownFiles: jest.fn(() => tfiles),
    getAbstractFileByPath: jest.fn(
      (p: string) => tfiles.find((f) => f.path === p) ?? null,
    ),
    create: jest.fn(),
    modify: jest.fn(),
    createFolder: jest.fn(),
  } as unknown as jest.Mocked<Vault>;

  const metadataCache = {
    // Cold cache ⇒ `null` for every file: Obsidian has not parsed them yet.
    // Warm cache ⇒ an entry exists, but its `frontmatter` is only populated for
    // the files Obsidian could parse — which is precisely why the cache cannot
    // tell "no block" from "unparseable block".
    getFileCache: jest.fn((f: TFile) => {
      if (!opts.warm) return null;
      const content = files[f.path] ?? "";
      const m = /^---\n([\s\S]*?)\n---/.exec(content);
      if (!m || !m[1].trim()) return {};
      try {
        const parsed = obsidian.parseYaml(m[1]);
        return typeof parsed === "object" && parsed !== null
          ? { frontmatter: parsed }
          : {};
      } catch {
        return {};
      }
    }),
    getFirstLinkpathDest: jest.fn(() => null),
  } as unknown as jest.Mocked<MetadataCache>;

  const app = { fileManager: {} } as unknown as App;

  return {
    vault,
    metadataCache,
    adapter: new ObsidianVaultAdapter(vault, metadataCache, app),
  };
}

function asIFile(path: string): IFile {
  const basename = path.replace(/\.md$/, "").split("/").pop() ?? path;
  return { path, basename, name: `${basename}.md`, parent: null };
}

/**
 * Satisfies the loader's file-level invariants (`exo__Asset_uid` +
 * `exo__Instance_class`), so B3 measures the fix and not an unrelated skip.
 * The class is the LABEL form on purpose: a `uid`-form wikilink would make the
 * converter pre-resolve the target from disk, adding reads that B4 counts.
 */
const VALID = `---\nexo__Asset_uid: 11111111-1111-1111-1111-111111111111\nexo__Instance_class: ems__Task\nexo__Asset_label: Valid\n---\n\nbody\n`;
const PLAIN = `Just a note.\n\nNo frontmatter fence anywhere.\n`;
const EMPTY_BLOCK = `---\n\n---\n\nbody\n`;
const COMMENT_ONLY = `---\n# just a comment\n\n---\n\nbody\n`;
const MALFORMED = `---\nexo__Asset_uid: 22222222-2222-2222-2222-222222222222\n  bad: indentation\n---\n\nbody\n`;

/** js-yaml's real shape: first line is the diagnosis, the rest is a snippet. */
const YAML_ERROR_MESSAGE =
  "bad indentation of a mapping entry (3:3)\n\n 2 | exo__Asset_uid: 2222…\n 3 |   bad: indentation\n";

/**
 * Make `parseYaml` behave like the real one for ONE body: throw (or return a
 * scalar) for `malformedBody`, delegate everything else to the double.
 */
function stubRealisticParseYaml(
  malformedBodyMarker: string,
  outcome: { throws: true } | { returns: unknown },
): jest.SpyInstance {
  const real = obsidian.parseYaml;
  return jest
    .spyOn(obsidian, "parseYaml")
    .mockImplementation((yamlContent: string) => {
      if (yamlContent.includes(malformedBodyMarker)) {
        if ("throws" in outcome) throw new Error(YAML_ERROR_MESSAGE);
        return outcome.returns;
      }
      return real(yamlContent);
    });
}

describe("ObsidianVaultAdapter.getFrontmatterParseFailure — plugin parity (#4440)", () => {
  describe("A — the adapter's own predicate: three outcomes kept apart", () => {
    it("A1 @req:fe50da38-4798-46e6-bb0a-b4b88596c340 a note with NO frontmatter block is silent (control — an over-wide fix reddens here)", async () => {
      const { adapter } = makeVault({ "n.md": PLAIN }, { warm: true });
      await expect(
        adapter.getFrontmatterParseFailure(asIFile("n.md")),
      ).resolves.toBeNull();
    });

    it("A2 @req:fe50da38-4798-46e6-bb0a-b4b88596c340 a note with VALID frontmatter is silent (control)", async () => {
      const { adapter } = makeVault({ "n.md": VALID }, { warm: true });
      await expect(
        adapter.getFrontmatterParseFailure(asIFile("n.md")),
      ).resolves.toBeNull();
    });

    it("A3 @req:fe50da38-4798-46e6-bb0a-b4b88596c340 an EMPTY block ('no keys yet') is silent (control)", async () => {
      const { adapter } = makeVault({ "n.md": EMPTY_BLOCK }, { warm: true });
      await expect(
        adapter.getFrontmatterParseFailure(asIFile("n.md")),
      ).resolves.toBeNull();
    });

    it("A4 @req:fe50da38-4798-46e6-bb0a-b4b88596c340 a COMMENT-ONLY block carries no keys — silent, not noise", async () => {
      // Real `parseYaml` (js-yaml) loads a comment-only document to nothing, so
      // WITHOUT the no-content-line predicate this shape would fall through to
      // the failure branch and be reported — noise on a legitimate authoring
      // shape. The shared double returns `{}` here instead, which would make
      // the axis vacuous, so the real behaviour is injected.
      stubRealisticParseYaml("just a comment", { returns: null });
      const { adapter } = makeVault({ "n.md": COMMENT_ONLY }, { warm: true });
      await expect(
        adapter.getFrontmatterParseFailure(asIFile("n.md")),
      ).resolves.toBeNull();
    });

    it("A5 @req:fe50da38-4798-46e6-bb0a-b4b88596c340 a block that is PRESENT and THROWS is reported with the PARSER's own first line", async () => {
      stubRealisticParseYaml("bad: indentation", { throws: true });
      const { adapter } = makeVault({ "n.md": MALFORMED }, { warm: true });

      const failure = await adapter.getFrontmatterParseFailure(asIFile("n.md"));

      expect(failure).not.toBeNull();
      // Derived from the mechanism, not authored: the exact diagnosis js-yaml
      // produced, truncated to its first line (the snippet is console noise).
      expect(failure?.reason).toBe("bad indentation of a mapping entry (3:3)");
      expect(failure?.reason).not.toContain("\n");
    });

    it("A6 @req:fe50da38-4798-46e6-bb0a-b4b88596c340 a block that parses into a NON-MAPPING is reported too", async () => {
      stubRealisticParseYaml("bad: indentation", { returns: "a bare scalar" });
      const { adapter } = makeVault({ "n.md": MALFORMED }, { warm: true });

      const failure = await adapter.getFrontmatterParseFailure(asIFile("n.md"));

      expect(failure?.reason).toBe("frontmatter is not a mapping");
    });

    it("A7 @req:fe50da38-4798-46e6-bb0a-b4b88596c340 an UNREADABLE file is not claimed to be a parse failure", async () => {
      const { adapter } = makeVault({ "n.md": VALID }, { warm: true });
      await expect(
        adapter.getFrontmatterParseFailure(asIFile("gone.md")),
      ).resolves.toBeNull();
    });
  });

  describe("B — the real loader path: ObsidianVaultAdapter + NoteToRDFConverter", () => {
    const FILES = {
      "valid.md": VALID,
      "plain.md": PLAIN,
      "malformed.md": MALFORMED,
    };

    it("B1 @req:fe50da38-4798-46e6-bb0a-b4b88596c340 a malformed asset contributes ZERO triples AND is NAMED in the skip list", async () => {
      stubRealisticParseYaml("bad: indentation", { throws: true });
      const { adapter } = makeVault(FILES, { warm: true });

      const result = await new NoteToRDFConverter(
        adapter,
      ).convertVaultWithValidation();

      const entry = result.skippedFiles.find((s) => s.path === "malformed.md");
      expect(entry).toBeDefined();
      expect(entry?.reason).toContain("Unparseable frontmatter");
      expect(entry?.reason).toContain("bad indentation of a mapping entry (3:3)");
      expect(
        result.triples.filter((t) => t.subject.toString().includes("malformed")),
      ).toHaveLength(0);
    });

    it("B2 @req:fe50da38-4798-46e6-bb0a-b4b88596c340 a plain note is NOT in the skip list (control — the over-wide fix reddens here)", async () => {
      stubRealisticParseYaml("bad: indentation", { throws: true });
      const { adapter } = makeVault(FILES, { warm: true });

      const result = await new NoteToRDFConverter(
        adapter,
      ).convertVaultWithValidation();

      expect(result.skippedFiles.map((s) => s.path)).not.toContain("plain.md");
    });

    it("B3 @req:fe50da38-4798-46e6-bb0a-b4b88596c340 the valid asset is untouched — triples produced, not skipped (control)", async () => {
      stubRealisticParseYaml("bad: indentation", { throws: true });
      const { adapter } = makeVault(FILES, { warm: true });

      const result = await new NoteToRDFConverter(
        adapter,
      ).convertVaultWithValidation();

      expect(result.skippedFiles.map((s) => s.path)).not.toContain("valid.md");
      expect(
        result.triples.filter((t) => t.subject.toString().includes("valid")).length,
      ).toBeGreaterThan(0);
    });

    it("B4 @req:fe50da38-4798-46e6-bb0a-b4b88596c340 on a COLD metadataCache the probe is asked about the MALFORMED file only", async () => {
      // The cost guarantee, stated as behaviour rather than as a read count:
      // the loader resolves frontmatter through the disk-fallback tier, so a
      // well-formed file is never asked the diagnostic question at all — which
      // is what keeps the plugin's cold eager walk at its current number of
      // reads instead of adding one per file (12k+ on a phone).
      //
      // ⛤ Two-sided ON PURPOSE. "not called for valid.md" alone would be
      // vacuously green if the walk broke outright; pairing it with "called
      // exactly once, for malformed.md" makes the axis unable to pass for the
      // wrong reason. Reverting the loader to the cache-only reader reddens the
      // first half (every file gets probed on a cold cache).
      stubRealisticParseYaml("bad: indentation", { throws: true });
      const { adapter } = makeVault(
        { "valid.md": VALID, "malformed.md": MALFORMED },
        { warm: false },
      );
      const probe = jest.spyOn(adapter, "getFrontmatterParseFailure");

      await new NoteToRDFConverter(adapter).convertVaultWithValidation();

      expect(probe.mock.calls.map(([f]) => (f as IFile).path)).toEqual([
        "malformed.md",
      ]);
    });

    it("B5 @req:fe50da38-4798-46e6-bb0a-b4b88596c340 on a COLD metadataCache a valid asset still contributes triples", async () => {
      // The other half of B4's guarantee, and the one with teeth: resolving in
      // the loop is only safe BECAUSE it goes through the disk-fallback tier.
      // A loop that resolves from the cache alone and hands THAT on produces
      // zero triples for every file while the cache is cold — the plugin's
      // eager walk is exactly that window (Issue #2780).
      const { adapter } = makeVault({ "valid.md": VALID }, { warm: false });

      const result = await new NoteToRDFConverter(
        adapter,
      ).convertVaultWithValidation();

      expect(result.skippedFiles).toEqual([]);
      expect(
        result.triples.filter((t) => t.subject.toString().includes("valid"))
          .length,
      ).toBeGreaterThan(0);
    });

    it("B6 @req:fe50da38-4798-46e6-bb0a-b4b88596c340 the loader resolves each file's frontmatter ONCE, not once per consumer", async () => {
      // Pins the reuse, not a read count: asserting "N disk reads" would drift
      // with any unrelated read the converter makes (it reads the BODY too), so
      // the axis counts the RESOLUTION instead. Handing the already-resolved
      // frontmatter to `convertNoteFromFrontmatter` is what keeps this at one;
      // calling `convertNote` again resolves the same file a second time.
      const { adapter } = makeVault(
        { "valid.md": VALID, "plain.md": PLAIN },
        { warm: false },
      );
      const resolve = jest.spyOn(adapter, "getFrontmatterWithFallback");

      await new NoteToRDFConverter(adapter).convertVaultWithValidation();

      expect(resolve.mock.calls.map(([f]) => (f as IFile).path).sort()).toEqual([
        "plain.md",
        "valid.md",
      ]);
    });

    it("B7 @req:fe50da38-4798-46e6-bb0a-b4b88596c340 the vault walk still parses each file THROUGH convertNote (the seam other requirements count)", async () => {
      // Two already-merged requirements measure "which files were re-parsed" by
      // spying on `NoteToRDFConverter.prototype.convertNote` (req 42812747 —
      // cache-manifest delta; req cb707868 — `--use-cache` write-through).
      // Reusing the resolved frontmatter must therefore pass it INTO
      // convertNote, not bypass convertNote: an earlier draft of this change
      // called `convertNoteFromFrontmatter` directly and left 7 of their axes
      // counting zero while the loader worked perfectly. Nothing on their side
      // could have caught that — hence this axis here, next to the change that
      // can break it.
      const { adapter } = makeVault(
        { "valid.md": VALID, "plain.md": PLAIN },
        { warm: true },
      );
      const spy = jest.spyOn(NoteToRDFConverter.prototype, "convertNote");

      await new NoteToRDFConverter(adapter).convertVaultWithValidation();

      expect(
        spy.mock.calls.map(([f]) => (f as IFile).path).sort(),
      ).toEqual(["plain.md", "valid.md"]);
      spy.mockRestore();
    });
  });
});
