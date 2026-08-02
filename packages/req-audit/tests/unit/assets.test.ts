import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdirSync, rmSync, writeFileSync, symlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  extractFrontmatter,
  parseYamlFrontmatterTolerant,
  loadMarkdownAssets,
} from "../../src/assets.js";

/**
 * RFC 7c7859d1 W-req — the markdown/frontmatter layer that replaced the CLI's
 * `CachingNodeFsAdapter.indexedAssets()` when the traceability checker was
 * extracted out of `@kitelev/exocortex-cli`.
 *
 * These pin the behaviours the audit silently depends on: a requirement whose
 * frontmatter fails to parse would VANISH from the report (an orphan/active
 * violation would go unreported), so the tolerant-parse and the walk semantics
 * are load-bearing for the gate, not incidental IO.
 */
describe("parseYamlFrontmatterTolerant", () => {
  const warn = console.warn;
  beforeEach(() => {
    console.warn = () => {};
  });
  afterEach(() => {
    console.warn = warn;
  });

  it("parses well-formed frontmatter strictly", () => {
    expect(parseYamlFrontmatterTolerant('a: 1\nb: "x"')).toEqual({
      a: 1,
      b: "x",
    });
  });

  it("tolerates a DUPLICATED mapping key (last-wins) instead of collapsing the asset", () => {
    // A strict yaml.load throws here; the retry in JSON-compat mode resolves
    // last-wins. Without it the whole requirement would read as `{}` — i.e.
    // silently disappear from the audit (#3800 class of failure).
    const parsed = parseYamlFrontmatterTolerant(
      "req__Requirement_status: A\nreq__Requirement_status: B",
    );
    expect(parsed).toEqual({ req__Requirement_status: "B" });
  });

  it("returns null for genuinely-unparseable YAML (not a mere duplicate key)", () => {
    expect(parseYamlFrontmatterTolerant('a: "unterminated')).toBeNull();
  });

  it("returns null when the block is not a non-null mapping", () => {
    expect(parseYamlFrontmatterTolerant("just a scalar")).toBeNull();
    expect(parseYamlFrontmatterTolerant("")).toBeNull();
  });
});

describe("extractFrontmatter", () => {
  it("extracts the leading --- fenced mapping", () => {
    expect(extractFrontmatter("---\nuid: x\n---\n\n# Body\n")).toEqual({
      uid: "x",
    });
  });

  it("returns {} when there is no frontmatter fence", () => {
    expect(extractFrontmatter("# Body only\n")).toEqual({});
  });

  it("returns {} (never throws) for malformed frontmatter", () => {
    expect(extractFrontmatter('---\na: "unterminated\n---\n')).toEqual({});
  });
});

describe("loadMarkdownAssets", () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `req-audit-assets-${Date.now()}-${Math.random()}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function write(rel: string, body: string): void {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body, "utf-8");
  }

  it("walks nested markdown and returns ROOT-RELATIVE paths with parsed frontmatter", () => {
    write("a.md", "---\nexo__Asset_uid: a\n---\n");
    write("nested/deep/b.md", "---\nexo__Asset_uid: b\n---\n");

    return loadMarkdownAssets(root).then((assets) => {
      expect(assets.map((x) => x.path)).toEqual(["a.md", "nested/deep/b.md"]);
      expect(assets[1].metadata["exo__Asset_uid"]).toBe("b");
    });
  });

  it("returns a DETERMINISTIC (sorted) order so report findings are stable across runs", async () => {
    write("z.md", "---\nexo__Asset_uid: z\n---\n");
    write("m.md", "---\nexo__Asset_uid: m\n---\n");
    write("a.md", "---\nexo__Asset_uid: a\n---\n");

    const first = (await loadMarkdownAssets(root)).map((x) => x.path);
    const second = (await loadMarkdownAssets(root)).map((x) => x.path);
    expect(first).toEqual(["a.md", "m.md", "z.md"]);
    expect(second).toEqual(first);
  });

  it("ignores non-markdown files and dot-directories (a cloned reqs tree carries its own .git)", async () => {
    write("keep.md", "---\nexo__Asset_uid: keep\n---\n");
    write("notes.txt", "not markdown");
    write(".git/HEAD.md", "---\nexo__Asset_uid: vcs\n---\n");

    const assets = await loadMarkdownAssets(root);
    expect(assets.map((x) => x.path)).toEqual(["keep.md"]);
  });

  it("yields {} metadata (not a crash) for a file without frontmatter", async () => {
    write("plain.md", "# no frontmatter\n");
    const assets = await loadMarkdownAssets(root);
    expect(assets).toEqual([{ path: "plain.md", metadata: {} }]);
  });

  it("skips an unreadable entry rather than aborting the whole walk (fail-open)", async () => {
    write("good.md", "---\nexo__Asset_uid: good\n---\n");
    // A broken symlink matches the glob but cannot be read.
    symlinkSync(join(root, "missing-target.md"), join(root, "broken.md"));

    const assets = await loadMarkdownAssets(root);
    expect(assets.map((x) => x.path)).toEqual(["good.md"]);
  });
});
