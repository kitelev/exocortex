/**
 * Issue #3800 (b) — `exocortex repair-frontmatter <path>`: the dogfood-clean
 * repair for the invisible/unrepairable duplicate-key class. Removes duplicated
 * top-level YAML keys keeping the LAST occurrence (matches the `{ json: true }`
 * tolerant parse), operating on raw text so it can fix a file the parser itself
 * cannot read.
 *
 * Tests the pure `dedupeFrontmatterKeys` (single-line, array-valued, multi-key,
 * CRLF, no-op cases) AND drives the REAL `repairFrontmatterCommand()` action
 * end-to-end against a temp fixture, reading the written bytes back from disk
 * (test-fixture-realism — no hand-injected result).
 *
 * Revert-verify: replace the keep-last filter with `return true` (keep all) and
 * the "duplicate removed" assertions go RED; the no-op cases stay GREEN.
 */
import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { dedupeFrontmatterKeys, repairFrontmatterCommand } = await import(
  "../../src/commands/repair-frontmatter.js"
);

describe("#3800 (b) dedupeFrontmatterKeys (pure)", () => {
  it("removes a single-line duplicated key, keeping the last occurrence", () => {
    const content = [
      "---",
      "exo__Asset_uid: abc",
      'exo__Asset_prototype: "[[aaa]]"',
      "ems__Effort_status: Backlog",
      'exo__Asset_prototype: "[[bbb]]"',
      "---",
      "body",
    ].join("\n");

    const r = dedupeFrontmatterKeys(content);

    expect(r.changed).toBe(true);
    expect(r.removed).toEqual([
      { key: "exo__Asset_prototype", removedOccurrences: 1 },
    ]);
    // Exactly one prototype line remains, and it is the LAST (bbb).
    const protoLines = r.content
      .split("\n")
      .filter((l) => l.startsWith("exo__Asset_prototype:"));
    expect(protoLines).toEqual(['exo__Asset_prototype: "[[bbb]]"']);
    // Non-duplicated keys and the body are preserved untouched.
    expect(r.content).toContain("exo__Asset_uid: abc");
    expect(r.content).toContain("ems__Effort_status: Backlog");
    expect(r.content).toContain("\nbody");
  });

  it("keeps the last occurrence of a duplicated ARRAY-valued key (whole block)", () => {
    const content = [
      "---",
      "exo__Asset_uid: abc",
      "exo__Instance_class:",
      '  - "[[first]]"',
      "exo__Asset_label: L",
      "exo__Instance_class:",
      '  - "[[second]]"',
      '  - "[[third]]"',
      "---",
    ].join("\n");

    const r = dedupeFrontmatterKeys(content);

    expect(r.changed).toBe(true);
    expect(r.removed).toEqual([
      { key: "exo__Instance_class", removedOccurrences: 1 },
    ]);
    // The surviving block is the LAST one, kept whole (both array items).
    expect(r.content).toContain('  - "[[second]]"');
    expect(r.content).toContain('  - "[[third]]"');
    expect(r.content).not.toContain('  - "[[first]]"');
    // The non-duplicated key that sat BETWEEN the two blocks is preserved.
    expect(r.content).toContain("exo__Asset_label: L");
  });

  it("handles MULTIPLE distinct duplicated keys in one pass", () => {
    const content = [
      "---",
      "a: 1",
      "b: 1",
      "a: 2",
      "b: 2",
      "a: 3",
      "---",
    ].join("\n");

    const r = dedupeFrontmatterKeys(content);

    expect(r.changed).toBe(true);
    const removedByKey = Object.fromEntries(
      r.removed.map((x) => [x.key, x.removedOccurrences]),
    );
    expect(removedByKey).toEqual({ a: 2, b: 1 });
    // last-wins per key.
    expect(r.content).toContain("a: 3");
    expect(r.content).toContain("b: 2");
    expect(r.content).not.toContain("a: 1");
    expect(r.content).not.toContain("a: 2");
  });

  it("does NOT corrupt `$`-sequences in surviving values (M1: no string-replace $ interpretation)", () => {
    // A string `content.replace(match[0], newBlock)` would interpret `$$`, `$&`,
    // `$1`, `` $` `` in the frontmatter VALUES → silent corruption. A repair tool
    // must keep every surviving value byte-identical.
    const dollarValue = 'label: "cost $$100 & $& and $1 ref plus $`tail"';
    const content = ["---", "a: 1", dollarValue, "a: 2", "---", "body"].join(
      "\n",
    );

    const r = dedupeFrontmatterKeys(content);

    expect(r.changed).toBe(true);
    // The `a` key deduped (keep-last), the $-laden label untouched.
    expect(r.content).toContain(dollarValue);
    expect(r.content).toContain("a: 2");
    expect(r.content).not.toContain("a: 1");
    // Nothing from the regex machinery leaked into the value.
    expect(r.content).not.toContain("---\n---\n"); // no group/whole-match splice
  });

  it("preserves CRLF line endings", () => {
    const content = ["---", "a: 1", "a: 2", "---", "body"].join("\r\n");
    const r = dedupeFrontmatterKeys(content);
    expect(r.changed).toBe(true);
    expect(r.content).toContain("\r\n");
    expect(r.content).toContain("a: 2");
    expect(r.content).not.toContain("a: 1");
  });

  it("is a no-op when there are no duplicated keys", () => {
    const content = ["---", "a: 1", "b: 2", "---", "body"].join("\n");
    const r = dedupeFrontmatterKeys(content);
    expect(r.changed).toBe(false);
    expect(r.content).toBe(content);
    expect(r.removed).toEqual([]);
  });

  it("is a no-op when there is no frontmatter block", () => {
    const content = "just a body\nwith no frontmatter";
    const r = dedupeFrontmatterKeys(content);
    expect(r.changed).toBe(false);
    expect(r.content).toBe(content);
  });
});

describe("#3800 (b) repairFrontmatterCommand end-to-end", () => {
  let vault: string;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let stdoutChunks: string[];
  let exitCodes: number[];
  const dupRel = "assets/16458983.md";

  const DUP_MD = [
    "---",
    "exo__Asset_uid: 16458983",
    'exo__Asset_prototype: "[[aaa]]"',
    "ems__Effort_status: Backlog",
    'exo__Asset_prototype: "[[bbb]]"',
    "---",
    "body",
    "",
  ].join("\n");

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-3800b-"));
    fs.mkdirSync(path.join(vault, "assets"), { recursive: true });
    fs.writeFileSync(path.join(vault, dupRel), DUP_MD);
    stdoutChunks = [];
    exitCodes = [];
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: unknown) => {
        stdoutChunks.push(String(chunk));
        return true;
      }) as never);
    exitSpy = jest.spyOn(process, "exit").mockImplementation(((code?: number) => {
      exitCodes.push(code ?? 0);
      return undefined as never;
    }) as never);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
    fs.rmSync(vault, { recursive: true, force: true });
  });

  async function run(extraArgs: string[]): Promise<{ stdout: string }> {
    const cmd = repairFrontmatterCommand();
    await cmd.parseAsync([dupRel, "--vault", vault, ...extraArgs], {
      from: "user",
    });
    return { stdout: stdoutChunks.join("") };
  }

  it("--dry-run reports the dedupe WITHOUT writing", async () => {
    const { stdout } = await run(["--dry-run"]);
    const out = JSON.parse(stdout.trim());
    expect(out).toMatchObject({
      changed: true,
      dryRun: true,
      removed: [{ key: "exo__Asset_prototype", removedOccurrences: 1 }],
    });
    // File on disk is UNCHANGED (still two prototype lines).
    const onDisk = fs.readFileSync(path.join(vault, dupRel), "utf-8");
    expect(
      onDisk.split("\n").filter((l) => l.startsWith("exo__Asset_prototype:"))
        .length,
    ).toBe(2);
  });

  it("writes the deduped file (keep-last) and reports the removed key", async () => {
    const { stdout } = await run([]);
    const out = JSON.parse(stdout.trim());
    expect(out).toMatchObject({ changed: true, dryRun: false });

    const onDisk = fs.readFileSync(path.join(vault, dupRel), "utf-8");
    const protoLines = onDisk
      .split("\n")
      .filter((l) => l.startsWith("exo__Asset_prototype:"));
    expect(protoLines).toEqual(['exo__Asset_prototype: "[[bbb]]"']);
    // Other content preserved.
    expect(onDisk).toContain("exo__Asset_uid: 16458983");
    expect(onDisk).toContain("ems__Effort_status: Backlog");
  });
});
