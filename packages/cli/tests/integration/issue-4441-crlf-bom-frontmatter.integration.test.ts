/**
 * Integration axes for issue #4441 / req `c05a3565-7b8d-42dc-bc9f-7e71d47d9364` —
 * a frontmatter block is recognised when its fences are CRLF or when a BOM
 * precedes it.
 *
 * Sibling of req `fe50da38-4798-46e6-bb0a-b4b88596c340` (#4439), which closed
 * "block present but does not PARSE" and explicitly scoped this trigger out:
 * widening the block predicate makes a currently-invisible **valid** block
 * visible, which is new behaviour rather than conformance.
 *
 * ⛔ Fixtures are BUILT PER CASE into their own temporary vault, never added to
 *    `tests/fixtures/issue-2997/`: the mixed-vault axis over that directory
 *    asserts `skipped === BAD_FIXTURES.length` and equality of the skip list, so
 *    a new file there would redden a foreign req's axis.
 *
 * ⛔ Axis names are `B<n>` FIRST TOKEN on purpose — the mutant driver extracts
 *    redness from the jest `● <suite> › <name>` line, so the name is a machine
 *    key (integration-test-revert-verify §A47 / §A104). Prose goes after it.
 *
 * ⛤ TWO REQUIREMENTS LIVE IN THIS FILE, by `@req` tag, not by file split.
 *    `c05a3565` (#4441) owns B1-B14 and B17 — LF, CRLF, a single BOM.
 *    `74419202` (#4452) owns B15, B16 and B18-B25 — lone-CR fences and a RUN of
 *    leading BOMs, read AND write. B15/B16 were `c05a3565`'s two "OUT OF SCOPE
 *    — stays invisible" pins, naming its §Non-goals; #4452 closed both, so they
 *    were FLIPPED here and re-tagged rather than left beside new parallel axes.
 *    They stay in this file because their controls (B6/B7 no-fence and
 *    fence-in-body, B10-B12 the LF/CRLF/BOM write paths, B13/B14 the body-link
 *    pair) are the ones that must remain green, and an axis judged far from its
 *    control is an axis whose over-widening nobody sees.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { NoteToRDFConverter } from "@kitelev/exocortex-core";
import { FileSystemVaultAdapter } from "../../src/adapters/FileSystemVaultAdapter.js";

const REQ = "@req:c05a3565-7b8d-42dc-bc9f-7e71d47d9364";
/**
 * The SIBLING requirement (#4452): lone-CR fences and a RUN of leading BOMs, on
 * read AND on write.
 *
 * ⛔ B15/B16 below carry THIS tag, not `REQ`. They used to pin `c05a3565`'s two
 *    named §Non-goals as "stays invisible"; now that the gap is closed they
 *    assert the new behaviour, so they are this requirement's evidence — and
 *    leaving `c05a3565`'s tag on them would bind an Active requirement to an
 *    assertion its own §Non-goals exclude. `c05a3565` keeps B1-B14/B17.
 */
const REQ_4452 = "@req:74419202-264e-4394-a634-0b36d47357f8";
const BOM = "﻿";

/** A minimal but genuinely VALID asset body (LF), modelled on the #2997 valid-tree fixture. */
const VALID_YAML = [
  'exo__Asset_isDefinedBy: "[[!kitelev]]"',
  "exo__Asset_uid: 4441a11d-0000-4000-8000-00000000000",
  "exo__Asset_createdAt: 2026-09-29T00:00:00+0500",
  "exo__Asset_updatedAt: 2026-09-29T00:00:00+0500",
  "exo__Instance_class:",
  '  - "[[ems__Project]]"',
  'exo__Asset_label: "CRLF/BOM repro — issue #4441"',
].join("\n");

/** Present, non-blank, and NOT parseable as a YAML mapping. */
const MALFORMED_YAML = "exo__Asset_uid: 4441b22d\n  : : :\nbroken: [unclosed";

let tempRoot: string;

/** Write `content` VERBATIM (no normalisation) as the only asset of a fresh vault. */
async function vaultWith(
  name: string,
  files: Record<string, string>,
): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tempRoot, `${name}-`));
  for (const [filename, content] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, filename), content, "utf-8");
  }
  return dir;
}

/** `---\n<body>\n---\n<rest>` with every newline of the FENCES turned into CRLF. */
function crlfFenced(yamlBody: string, body = "\nbody text\n"): string {
  return `---\r\n${yamlBody.replace(/\n/g, "\r\n")}\r\n---\r\n${body}`;
}

function lfFenced(yamlBody: string, body = "\nbody text\n"): string {
  return `---\n${yamlBody}\n---\n${body}`;
}

/**
 * `---\r<body>\r---\r<rest>` — classic pre-OS9 Mac endings, and the point is
 * that the result contains **no `\n` at all**: that is what made such a file
 * invisible to a `\r?\n` predicate (req `74419202`, #4452).
 */
function crFenced(yamlBody: string, body = "\rbody text\r"): string {
  return `---\r${yamlBody.replace(/\n/g, "\r")}\r---\r${body}`;
}

/**
 * Fence lines on ANY of the three line-ending forms.
 *
 * ⛔ A separate predicate from {@link fenceCount} on purpose, not a widening of
 *    it: that one is the measuring instrument of `c05a3565`'s axes and changing
 *    it would put this work item's fingerprints on their verdict. This one
 *    normalises CR/CRLF to LF first, so a lone-CR file — which has no `\n` for
 *    `^…$` to anchor against — is measured at all.
 */
function fenceCountAnyEol(content: string): number {
  const normalised = content.replace(/\r\n|\r/g, "\n");
  return (normalised.match(/^﻿*---$/gm) ?? []).length;
}

/**
 * How many fence lines the file carries.
 *
 * ⛔ `^---$` is NOT enough: on a BOM-prefixed file the opening fence shares its
 *    line with the byte, so the anchor does not match it and a correct
 *    single-block file reads as ZERO fences. The optional `﻿?` is what makes
 *    this predicate measure the same thing on all four encodings.
 */
function fenceCount(content: string): number {
  return (content.match(/^﻿?---\r?$/gm) ?? []).length;
}

async function convert(vaultRoot: string, strict = false) {
  const adapter = new FileSystemVaultAdapter(vaultRoot);
  const converter = new NoteToRDFConverter(adapter);
  return converter.convertVaultWithValidation({ strict });
}

function only(vaultRoot: string): {
  adapter: FileSystemVaultAdapter;
  file: ReturnType<FileSystemVaultAdapter["getAllFiles"]>[number];
} {
  const adapter = new FileSystemVaultAdapter(vaultRoot);
  const files = adapter.getAllFiles();
  expect(files).toHaveLength(1);
  return { adapter, file: files[0] };
}

describe("Issue #4441 — CRLF/BOM-led frontmatter is recognised by the vault loader", () => {
  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "exo-4441-"));
  });

  afterAll(async () => {
    if (tempRoot) await fs.remove(tempRoot);
  });

  it(`B1 a VALID asset whose fences are CRLF is indexed — triples > 0, no skip entry ${REQ}`, async () => {
    const vault = await vaultWith("b1-crlf-valid", {
      "crlf-valid.md": crlfFenced(VALID_YAML),
    });

    const result = await convert(vault);

    expect(result.skippedFiles).toEqual([]);
    expect(result.summary.skipped).toBe(0);
    expect(result.summary.indexed).toBe(1);
    expect(result.triples.length).toBeGreaterThan(0);
    // Not merely "some triples": the asset's OWN label must be among them, so a
    // future change that emits only the filename triple cannot satisfy this.
    expect(
      result.triples.some(
        (t) =>
          (t.predicate as { value: string }).value.endsWith("Asset_label") &&
          (t.object as { value: string }).value ===
            "CRLF/BOM repro — issue #4441",
      ),
    ).toBe(true);
  });

  it(`B2 a VALID asset preceded by a BOM is indexed — triples > 0, no skip entry ${REQ}`, async () => {
    const vault = await vaultWith("b2-bom-valid", {
      "bom-valid.md": BOM + lfFenced(VALID_YAML),
    });

    const result = await convert(vault);

    expect(result.skippedFiles).toEqual([]);
    expect(result.summary.indexed).toBe(1);
    expect(
      result.triples.some(
        (t) =>
          (t.predicate as { value: string }).value.endsWith("Asset_label") &&
          (t.object as { value: string }).value ===
            "CRLF/BOM repro — issue #4441",
      ),
    ).toBe(true);
  });

  it(`B3 a MALFORMED CRLF-fenced asset is NAMED in the skip list, not dropped silently ${REQ}`, async () => {
    const vault = await vaultWith("b3-crlf-bad", {
      "crlf-bad.md": crlfFenced(MALFORMED_YAML),
    });

    const result = await convert(vault);

    expect(result.triples).toEqual([]);
    expect(result.skippedFiles).toHaveLength(1);
    expect(result.skippedFiles[0].path).toBe("crlf-bad.md");
    expect(result.skippedFiles[0].reason).toMatch(/^Unparseable frontmatter: /);
    // The reason is DERIVED from js-yaml, not authored here — proven by the
    // `(line:column)` suffix only the parser can know. ⛔ Do not pin the wording
    // itself; it belongs to a dependency (verify-before-assert §A18).
    expect(result.skippedFiles[0].reason).toMatch(/\(\d+:\d+\)/);
  });

  it(`B4 the same MALFORMED CRLF-fenced asset THROWS in strict mode ${REQ}`, async () => {
    const vault = await vaultWith("b4-crlf-bad-strict", {
      "crlf-bad.md": crlfFenced(MALFORMED_YAML),
    });

    await expect(convert(vault, true)).rejects.toThrow(
      /Unparseable frontmatter in "crlf-bad\.md"/,
    );
  });

  it(`B5 a MALFORMED BOM-prefixed asset is NAMED in the skip list ${REQ}`, async () => {
    const vault = await vaultWith("b5-bom-bad", {
      "bom-bad.md": BOM + lfFenced(MALFORMED_YAML),
    });

    const result = await convert(vault);

    expect(result.triples).toEqual([]);
    expect(result.skippedFiles).toHaveLength(1);
    expect(result.skippedFiles[0].path).toBe("bom-bad.md");
    expect(result.skippedFiles[0].reason).toMatch(/^Unparseable frontmatter: /);
  });

  it(`B6 CONTROL a note with no block at all stays silent — zero triples, no skip entry ${REQ}`, async () => {
    const vault = await vaultWith("b6-no-block", {
      "plain.md": "# Just a note\n\nNo fence anywhere.\n",
    });

    const result = await convert(vault);

    expect(result.triples).toEqual([]);
    expect(result.skippedFiles).toEqual([]);
    expect(result.summary.skipped).toBe(0);
  });

  it(`B7 CONTROL a "---" that is not an opening fence stays silent ${REQ}`, async () => {
    // The only `---` sits inside a fenced code block, on line 4 — never at
    // column 0 of line 1. Guards against an over-wide predicate, the class the
    // #4439 review already caught once.
    const vault = await vaultWith("b7-fence-in-body", {
      "code-fence.md": "# Note\n\n```yaml\n---\nkey: value\n---\n```\n",
    });

    const result = await convert(vault);

    expect(result.triples).toEqual([]);
    expect(result.skippedFiles).toEqual([]);
  });

  it(`B8 OUT OF SCOPE an opening "---" with no closing fence behaves exactly as before — silent ${REQ}`, async () => {
    // Ambiguous with a note whose body starts with a markdown horizontal rule.
    // This requirement deliberately leaves it undecided; the axis PINS today's
    // behaviour so the widened predicate cannot absorb it as a side effect.
    // CRLF form too — the widening is precisely what could have swallowed it.
    const vault = await vaultWith("b8-unclosed", {
      "unclosed-lf.md": "---\nkey: value\n\nstill body, never closed\n",
      "unclosed-crlf.md":
        "---\r\nkey: value\r\n\r\nstill body, never closed\r\n",
    });

    const result = await convert(vault);

    expect(result.triples).toEqual([]);
    expect(result.skippedFiles).toEqual([]);
  });

  it(`B9 the read path and the diagnostic path agree on EVERY encoding ${REQ}`, async () => {
    // This axis is the one that fails if only ONE of the two paths were fixed:
    // it asserts the pair (getFrontmatter, getFrontmatterParseFailure) for the
    // valid and the malformed shape of each encoding.
    const cases: Array<{
      filename: string;
      content: string;
      expectParsed: boolean;
    }> = [
      {
        filename: "lf-valid.md",
        content: lfFenced(VALID_YAML),
        expectParsed: true,
      },
      {
        filename: "crlf-valid.md",
        content: crlfFenced(VALID_YAML),
        expectParsed: true,
      },
      {
        filename: "bom-valid.md",
        content: BOM + lfFenced(VALID_YAML),
        expectParsed: true,
      },
      {
        filename: "bomcrlf-valid.md",
        content: BOM + crlfFenced(VALID_YAML),
        expectParsed: true,
      },
      {
        filename: "lf-bad.md",
        content: lfFenced(MALFORMED_YAML),
        expectParsed: false,
      },
      {
        filename: "crlf-bad.md",
        content: crlfFenced(MALFORMED_YAML),
        expectParsed: false,
      },
      {
        filename: "bom-bad.md",
        content: BOM + lfFenced(MALFORMED_YAML),
        expectParsed: false,
      },
    ];

    for (const c of cases) {
      const vault = await vaultWith("b9", { [c.filename]: c.content });
      const { adapter, file } = only(vault);

      const parsed = adapter.getFrontmatter(file);
      const failure = adapter.getFrontmatterParseFailure(file);

      if (c.expectParsed) {
        // Block present AND parseable: the read path sees it, so the diagnostic
        // has nothing to report.
        expect({ case: c.filename, parsed: parsed !== null }).toEqual({
          case: c.filename,
          parsed: true,
        });
        expect({ case: c.filename, failure }).toEqual({
          case: c.filename,
          failure: null,
        });
      } else {
        // Block present and NOT parseable: the read path returns null and the
        // diagnostic MUST name it. One path fixed without the other lands here.
        expect({ case: c.filename, parsed }).toEqual({
          case: c.filename,
          parsed: null,
        });
        expect({
          case: c.filename,
          named: failure !== null && failure.reason.length > 0,
        }).toEqual({ case: c.filename, named: true });
      }
    }
  });

  it(`B10 a property write on a BOM-prefixed file keeps the BOM and does not duplicate the block ${REQ}`, async () => {
    const vault = await vaultWith("b10-bom-write", {
      "bom-write.md": BOM + lfFenced(VALID_YAML, "\nbody stays\n"),
    });
    const { adapter, file } = only(vault);

    await adapter.updateFrontmatter(file, (current) => ({
      ...current,
      exo__Asset_label: "patched",
    }));

    const after = await fs.readFile(path.join(vault, "bom-write.md"), "utf-8");

    // The BOM is the user's byte, not ours: an unrelated property write must
    // not strip it.
    expect(after.charCodeAt(0)).toBe(0xfeff);
    // Exactly ONE block (two fence lines). Before the fix the write path saw no
    // block and PREPENDED a second one, leaving the original as body text —
    // silent data loss on an otherwise ordinary patch.
    expect(fenceCount(after)).toBe(2);
    expect(after.match(/^﻿---\n/)).not.toBeNull();
    // Unreturned keys survive and the patched one is applied — asserted on the
    // RE-PARSED frontmatter, not on the dumped bytes: js-yaml quotes only what
    // it must, so a byte assertion would pin this axis to the serialiser's
    // quoting policy rather than to the patch semantics.
    const reread = only(vault);
    expect(reread.adapter.getFrontmatter(reread.file)).toMatchObject({
      exo__Asset_uid: "4441a11d-0000-4000-8000-00000000000",
      exo__Asset_label: "patched",
    });
    expect(after).toContain("body stays");
  });

  it(`B11 a property write on a CRLF-fenced file replaces the block instead of prepending a second one ${REQ}`, async () => {
    const vault = await vaultWith("b11-crlf-write", {
      "crlf-write.md": crlfFenced(VALID_YAML, "\r\nbody stays\r\n"),
    });
    const { adapter, file } = only(vault);

    await adapter.updateFrontmatter(file, (current) => ({
      ...current,
      exo__Asset_label: "patched",
    }));

    const after = await fs.readFile(path.join(vault, "crlf-write.md"), "utf-8");

    expect(fenceCount(after)).toBe(2);
    const reread = only(vault);
    expect(reread.adapter.getFrontmatter(reread.file)).toMatchObject({
      exo__Asset_uid: "4441a11d-0000-4000-8000-00000000000",
      exo__Asset_label: "patched",
    });
    expect(after).toContain("body stays");
  });

  it(`B12 CONTROL the LF write path is unchanged — one block, keys preserved, body intact ${REQ}`, async () => {
    const vault = await vaultWith("b12-lf-write", {
      "lf-write.md": lfFenced(VALID_YAML, "\nbody stays\n"),
    });
    const { adapter, file } = only(vault);

    await adapter.updateFrontmatter(file, (current) => ({
      ...current,
      exo__Asset_label: "patched",
    }));

    const after = await fs.readFile(path.join(vault, "lf-write.md"), "utf-8");

    expect(after.charCodeAt(0)).toBe("-".charCodeAt(0));
    expect(fenceCount(after)).toBe(2);
    const reread = only(vault);
    expect(reread.adapter.getFrontmatter(reread.file)).toMatchObject({
      exo__Asset_uid: "4441a11d-0000-4000-8000-00000000000",
      exo__Asset_label: "patched",
    });
    expect(after.endsWith("\nbody stays\n")).toBe(true);
  });

  it(`B17 a write to a BOM-prefixed file with NO block inserts the block AFTER the BOM ${REQ}`, async () => {
    // The other branch of `replaceFrontmatter`, and the only axis that can see
    // it: B10/B11/B12 all have an existing block to replace. Prepending would
    // leave the BOM stranded in the middle of the file — a byte-order mark that
    // is not at byte 0 is not a byte-order mark, it is garbage in the body.
    const vault = await vaultWith("b17-bom-no-block", {
      "bom-plain.md": BOM + "# Just a note\n\nNo fence anywhere.\n",
    });
    const { adapter, file } = only(vault);

    await adapter.updateFrontmatter(file, (current) => ({
      ...current,
      exo__Asset_label: "created",
    }));

    const after = await fs.readFile(path.join(vault, "bom-plain.md"), "utf-8");

    expect(after.charCodeAt(0)).toBe(0xfeff);
    // The block opens on the very first line, sharing it with the BOM.
    expect(after.startsWith(`${BOM}---\n`)).toBe(true);
    expect(fenceCount(after)).toBe(2);
    const reread = only(vault);
    expect(reread.adapter.getFrontmatter(reread.file)).toMatchObject({
      exo__Asset_label: "created",
    });
    expect(after).toContain("# Just a note");
  });

  it(`B13 a BOM-prefixed asset does not get its FRONTMATTER wikilinks indexed as BODY links ${REQ}`, async () => {
    // The second half of the same gap, in `NoteToRDFConverter.extractBodyContent`:
    // its regex was already CRLF-tolerant, but a BOM defeats the `^` anchor, so
    // the whole block came back AS BODY and `[[ems__Project]]` / `[[!kitelev]]`
    // were emitted a second time under `exo:Asset_bodyLink`.
    const vault = await vaultWith("b13-bom-bodylink", {
      "bom-bodylink.md":
        BOM + lfFenced(VALID_YAML, "\nNo wikilink in this body.\n"),
    });

    const result = await convert(vault);

    const bodyLinks = result.triples.filter((t) =>
      (t.predicate as { value: string }).value.endsWith("Asset_bodyLink"),
    );
    expect(bodyLinks.map((t) => (t.object as { value: string }).value)).toEqual(
      [],
    );
    // ⛔ Control on the SAME axis, and `summary.indexed` is NOT enough for it:
    //    `indexed` = files − skipped, so a file that produced NOTHING still
    //    counts as indexed, and the empty list above would be satisfied
    //    vacuously. Measured, not reasoned: with the adapter's BOM skip removed
    //    (mutant M2_bom_never_skipped) this axis stayed GREEN on `indexed`
    //    alone. The asset's OWN label triple is the predicate that cannot be
    //    satisfied by absence.
    expect(result.summary.indexed).toBe(1);
    expect(
      result.triples.some(
        (t) =>
          (t.predicate as { value: string }).value.endsWith("Asset_label") &&
          (t.object as { value: string }).value ===
            "CRLF/BOM repro — issue #4441",
      ),
    ).toBe(true);
  });

  it(`B14 CONTROL a BOM-prefixed asset WITH a real body wikilink still gets it indexed ${REQ}`, async () => {
    // Pairs with B13: an over-wide "return nothing as body" fix would satisfy
    // B13 and break this one.
    const vault = await vaultWith("b14-bom-realbodylink", {
      "bom-realbodylink.md":
        BOM + lfFenced(VALID_YAML, "\nSee [[some-body-target]] here.\n"),
    });

    const result = await convert(vault);

    const bodyLinks = result.triples.filter((t) =>
      (t.predicate as { value: string }).value.endsWith("Asset_bodyLink"),
    );
    expect(
      bodyLinks.map((t) => (t.object as { value: string }).value),
    ).toContain("some-body-target");
  });

  // ── The two encodings #4441 deliberately did NOT reach — NOW CLOSED ───────
  // B15/B16 were surfaced by the review of PR #4450 and pinned as
  // "stays invisible", naming req `c05a3565`'s two §Non-goals and their work
  // item #4452. Req `74419202` (#4452) closes both, so these axes are FLIPPED
  // rather than left beside new parallel ones: an axis that asserted the old
  // limit cannot survive the limit being lifted, and a fix whose diff only ADDS
  // axes leaves the old verdict standing as the repo's stated intent.
  //
  // ⛔ Their tag changed with their meaning — see `REQ_4452` above.

  it(`B15 a VALID lone-CR-fenced asset is indexed — no \\n anywhere, triples > 0, no skip entry ${REQ_4452}`, async () => {
    // Classic pre-OS9 Mac line endings: `\r` with no `\n` in the whole file.
    // Both fences and the YAML body are CR-separated, and js-yaml 1.1 treats a
    // bare `\r` as a line break (measured on js-yaml 5.3.0, the version
    // `packages/cli` resolves), so the body parses to the same mapping as its
    // LF twin.
    const content = crFenced(VALID_YAML);
    expect(content).not.toContain("\n");

    const vault = await vaultWith("b15-lone-cr", { "lone-cr.md": content });
    const { adapter, file } = only(vault);

    expect(adapter.getFrontmatter(file)).not.toBeNull();
    // Valid AND parseable ⇒ the diagnostic path has nothing to report.
    expect(adapter.getFrontmatterParseFailure(file)).toBeNull();

    const result = await convert(vault);

    expect(result.skippedFiles).toEqual([]);
    expect(result.summary.indexed).toBe(1);
    // ⛔ Not merely "some triples": the asset's OWN label, so an over-wide
    //    change that emits only the filename triple cannot satisfy this
    //    (the same reason B1/B13 assert the label).
    expect(
      result.triples.some(
        (t) =>
          (t.predicate as { value: string }).value.endsWith("Asset_label") &&
          (t.object as { value: string }).value ===
            "CRLF/BOM repro — issue #4441",
      ),
    ).toBe(true);
  });

  it(`B16 a VALID asset preceded by a RUN of BOMs is indexed — N ≥ 2 U+FEFF are skipped ${REQ_4452}`, async () => {
    // Two stacked BOM bytes — the artifact of a naive "ensure a BOM" tool that
    // does not check for an existing one. `leadingBomLength` now counts the
    // whole run, so the `^` anchor is reached.
    const vault = await vaultWith("b16-double-bom", {
      "double-bom.md": BOM + BOM + lfFenced(VALID_YAML),
    });
    const { adapter, file } = only(vault);

    expect(adapter.getFrontmatter(file)).not.toBeNull();
    expect(adapter.getFrontmatterParseFailure(file)).toBeNull();

    const result = await convert(vault);

    expect(result.skippedFiles).toEqual([]);
    expect(result.summary.indexed).toBe(1);
    expect(
      result.triples.some(
        (t) =>
          (t.predicate as { value: string }).value.endsWith("Asset_label") &&
          (t.object as { value: string }).value ===
            "CRLF/BOM repro — issue #4441",
      ),
    ).toBe(true);
  });

  it(`B18 a MALFORMED lone-CR-fenced asset is NAMED in the skip list and THROWS in strict mode ${REQ_4452}`, async () => {
    // Parity with B3/B5: "visible" has to mean "accounted for", not just
    // "sometimes indexed". A block that is present but does not parse must be
    // NAMED — otherwise widening the predicate would move the file from one
    // kind of silence to another.
    const vault = await vaultWith("b18-lone-cr-bad", {
      "lone-cr-bad.md": crFenced(MALFORMED_YAML),
    });

    const result = await convert(vault);

    expect(result.skippedFiles).toHaveLength(1);
    expect(result.skippedFiles[0].path).toContain("lone-cr-bad.md");
    expect(result.skippedFiles[0].reason.length).toBeGreaterThan(0);
    expect(result.summary.skipped).toBe(1);

    await expect(convert(vault, true)).rejects.toThrow();
  });

  it(`B19 a property write on a lone-CR file REPLACES the block and keeps the file's own line endings ${REQ_4452}`, async () => {
    // The write half, and the reason this needed its own requirement rather
    // than a widening tacked onto #4441: before the fix `replaceFrontmatter`
    // saw no block here and PREPENDED a second one, leaving the original
    // pseudo-frontmatter as body text — silent data loss on an ordinary patch.
    const vault = await vaultWith("b19-cr-write", {
      "cr-write.md": crFenced(VALID_YAML, "\rbody stays\r"),
    });
    const { adapter, file } = only(vault);

    await adapter.updateFrontmatter(file, (current) => ({
      ...current,
      exo__Asset_label: "patched",
    }));

    const after = await fs.readFile(path.join(vault, "cr-write.md"), "utf-8");

    // Exactly ONE block: two fence lines, not four.
    expect(fenceCountAnyEol(after)).toBe(2);
    // Unreturned keys survive and the patched one is applied — asserted on the
    // RE-PARSED frontmatter, so this axis is about patch semantics rather than
    // about the serialiser's quoting policy.
    const reread = only(vault);
    expect(reread.adapter.getFrontmatter(reread.file)).toMatchObject({
      exo__Asset_uid: "4441a11d-0000-4000-8000-00000000000",
      exo__Asset_label: "patched",
    });
    // Decision 1 of req `74419202`: NOTHING is normalised. The body after the
    // block keeps its bare CRs, so the file is still a lone-CR file.
    expect(after).toContain("\rbody stays\r");
    expect(after.slice(after.indexOf("body stays"))).not.toContain("\n");
  });

  it(`B20 a property write on a file with a RUN of BOMs leaves EXACTLY ONE U+FEFF ${REQ_4452}`, async () => {
    // Decision 2 of req `74419202`, and the ONE place this write path
    // normalises: `N>1` is corruption, not a style, so it is not carried
    // across. The asymmetry against B19 is deliberate and named in the
    // requirement's §Non-goals.
    const vault = await vaultWith("b20-double-bom-write", {
      "double-bom-write.md":
        BOM + BOM + BOM + lfFenced(VALID_YAML, "\nbody stays\n"),
    });
    const { adapter, file } = only(vault);

    await adapter.updateFrontmatter(file, (current) => ({
      ...current,
      exo__Asset_label: "patched",
    }));

    const after = await fs.readFile(
      path.join(vault, "double-bom-write.md"),
      "utf-8",
    );

    expect(after.charCodeAt(0)).toBe(0xfeff);
    // ⛔ The assertion that makes "exactly one" load-bearing: the SECOND
    //    character must already be the fence, and no U+FEFF may survive
    //    anywhere else (a run carried into the body would be garbage, not a
    //    byte-order mark).
    expect(after.startsWith(`${BOM}---\n`)).toBe(true);
    expect(after.split(BOM)).toHaveLength(2);
    expect(fenceCountAnyEol(after)).toBe(2);
    const reread = only(vault);
    expect(reread.adapter.getFrontmatter(reread.file)).toMatchObject({
      exo__Asset_uid: "4441a11d-0000-4000-8000-00000000000",
      exo__Asset_label: "patched",
    });
    expect(after).toContain("body stays");
  });

  it(`B21 a lone-CR asset does not get its FRONTMATTER wikilinks indexed as BODY links ${REQ_4452}`, async () => {
    // The §Scope half of req `74419202`: `NoteToRDFConverter.extractBodyContent`
    // was the last TWIN of the block predicate (its own `\r?\n` regex plus a
    // one-BOM skip). Widening the read predicate without it would index such an
    // asset AND hand its whole frontmatter to the body-wikilink scanner —
    // exactly the defect B13 declares a defect for the BOM case.
    const vault = await vaultWith("b21-cr-bodylink", {
      "cr-bodylink.md": crFenced(VALID_YAML, "\rNo wikilink in this body.\r"),
    });

    const result = await convert(vault);

    const bodyLinks = result.triples.filter((t) =>
      (t.predicate as { value: string }).value.endsWith("Asset_bodyLink"),
    );
    expect(bodyLinks.map((t) => (t.object as { value: string }).value)).toEqual(
      [],
    );
    // ⛔ Control on the SAME axis (B13's lesson): an empty list is satisfied
    //    vacuously by a file that produced NOTHING, and `summary.indexed`
    //    counts files − skipped, so it cannot tell them apart either. The
    //    asset's own label triple is the predicate absence cannot satisfy.
    expect(result.summary.indexed).toBe(1);
    expect(
      result.triples.some(
        (t) =>
          (t.predicate as { value: string }).value.endsWith("Asset_label") &&
          (t.object as { value: string }).value ===
            "CRLF/BOM repro — issue #4441",
      ),
    ).toBe(true);
  });

  it(`B22 CONTROL a lone-CR asset WITH a real body wikilink still gets it indexed ${REQ_4452}`, async () => {
    // Pairs with B21 exactly as B14 pairs with B13: an over-wide "return
    // nothing as body" change would satisfy B21 and break this one.
    const vault = await vaultWith("b22-cr-realbodylink", {
      "cr-realbodylink.md": crFenced(
        VALID_YAML,
        "\rSee [[some-body-target]] here.\r",
      ),
    });

    const result = await convert(vault);

    const bodyLinks = result.triples.filter((t) =>
      (t.predicate as { value: string }).value.endsWith("Asset_bodyLink"),
    );
    expect(
      bodyLinks.map((t) => (t.object as { value: string }).value),
    ).toContain("some-body-target");
  });

  it(`B23 the read path and the diagnostic path agree on the TWO NEW encodings too ${REQ_4452}`, async () => {
    // B9's shape, extended to this requirement's shapes: the pair
    // (getFrontmatter, getFrontmatterParseFailure) must agree, so a fix applied
    // to only one of the two paths lands here.
    const cases: Array<{
      filename: string;
      content: string;
      expectParsed: boolean;
    }> = [
      {
        filename: "cr-valid.md",
        content: crFenced(VALID_YAML),
        expectParsed: true,
      },
      {
        filename: "nbom-valid.md",
        content: BOM + BOM + lfFenced(VALID_YAML),
        expectParsed: true,
      },
      {
        filename: "crbom-valid.md",
        content: BOM + BOM + crFenced(VALID_YAML),
        expectParsed: true,
      },
      {
        filename: "cr-bad.md",
        content: crFenced(MALFORMED_YAML),
        expectParsed: false,
      },
      {
        filename: "nbom-bad.md",
        content: BOM + BOM + lfFenced(MALFORMED_YAML),
        expectParsed: false,
      },
    ];

    for (const c of cases) {
      const vault = await vaultWith("b23", { [c.filename]: c.content });
      const { adapter, file } = only(vault);

      const parsed = adapter.getFrontmatter(file);
      const failure = adapter.getFrontmatterParseFailure(file);

      if (c.expectParsed) {
        expect({ case: c.filename, parsed: parsed !== null }).toEqual({
          case: c.filename,
          parsed: true,
        });
        expect({ case: c.filename, failure }).toEqual({
          case: c.filename,
          failure: null,
        });
      } else {
        expect({ case: c.filename, parsed }).toEqual({
          case: c.filename,
          parsed: null,
        });
        expect({
          case: c.filename,
          named: failure !== null && failure.reason.length > 0,
        }).toEqual({ case: c.filename, named: true });
      }
    }
  });

  it(`B24 CONTROL a lone-CR note with NO fence stays silent, and a lone-CR "---" that is not an opening fence stays silent ${REQ_4452}`, async () => {
    // The over-widening direction, on the new encoding: B6/B7 assert it for LF,
    // and without this pair "recognises a bare \r" could be satisfied by a
    // predicate that lost its `^` anchor or matched any `---` at all.
    const vault = await vaultWith("b24-cr-controls", {
      "cr-nofence.md": "Just a note.\rNothing fenced here.\r",
      "cr-fence-in-body.md": "intro\r\r---\rnot: frontmatter\r---\r\rmore\r",
    });

    const result = await convert(vault);

    expect(result.triples).toEqual([]);
    expect(result.skippedFiles).toEqual([]);
  });

  it(`B25 a write to a file with a RUN of BOMs and NO block inserts the block after ONE U+FEFF ${REQ_4452}`, async () => {
    // The OTHER branch of `replaceFrontmatter`, and the only axis that can see
    // it on this requirement's shapes — B19/B20 both have a block to replace,
    // and B17 covers the single-BOM case. Before #4452 that branch counted at
    // most one byte, so the surplus BOMs would have been left stranded AFTER
    // the inserted block: a byte-order mark that is not at byte 0 is not a
    // byte-order mark, it is garbage in the body.
    const vault = await vaultWith("b25-nbom-no-block", {
      "nbom-plain.md": BOM + BOM + "# Just a note\n\nNo fence anywhere.\n",
    });
    const { adapter, file } = only(vault);

    await adapter.updateFrontmatter(file, (current) => ({
      ...current,
      exo__Asset_label: "created",
    }));

    const after = await fs.readFile(path.join(vault, "nbom-plain.md"), "utf-8");

    expect(after.startsWith(`${BOM}---\n`)).toBe(true);
    expect(after.split(BOM)).toHaveLength(2);
    expect(fenceCountAnyEol(after)).toBe(2);
    const reread = only(vault);
    expect(reread.adapter.getFrontmatter(reread.file)).toMatchObject({
      exo__Asset_label: "created",
    });
    expect(after).toContain("# Just a note");
  });

  it(`B26 CONTROL two stacked "---" on a CRLF file are NOT a block — one physical CRLF may not serve both fences ${REQ_4452}`, async () => {
    // ⛔ The over-widening THIS requirement introduced and its own review caught.
    //    A single pattern with an alternation at both fences let the engine
    //    split one `\r\n` between them — `\r` closing the opening fence, the
    //    same sequence's `\n` closing the closing one — so a CRLF file whose
    //    first two lines are both a bare `---` (two stacked horizontal rules)
    //    read as an EMPTY frontmatter block. Both consequences were real: the
    //    two rules vanished from the indexed body, and the next property write
    //    spliced over them. Measured against origin/main, whose indivisible
    //    `\r?\n` returns null here — so this axis pins PARITY with main on an
    //    input the widening was never meant to reach.
    // ⛤ Its LF twin is B7's neighbour (`---\n---` is not a block either) and
    //    its CR twin is B24's; this file had no axis for the shape in ANY
    //    encoding, which is why the regression was invisible to 24 green axes.
    // ⛔ THE OBSERVABLE HAD TO BE THE WRITE PATH, and finding that out cost a
    //    vacuous first draft of this axis. Under the regression the spurious
    //    block's body is EMPTY, so `getFrontmatter` returns null anyway (an
    //    empty block parses to nothing), the diagnostic stays silent by design,
    //    and the file contributes no triples either way — read-side assertions
    //    are satisfied identically with and without the defect, and the mutant
    //    Q7 duly reddened NOTHING. What genuinely differs is DATA LOSS: with
    //    the regression `replaceFrontmatter` sees a block spanning the two
    //    rules and SPLICES OVER THEM; without it, no block is found and the new
    //    one is inserted ahead, leaving the user's text intact.
    for (const [name, content, eol] of [
      ["crlf", "---\r\n---\r\nActual body, two rules at top\r\n", "\r\n"],
      ["lf", "---\n---\nActual body\n", "\n"],
      ["cr", "---\r---\rActual body\r", "\r"],
    ] as const) {
      const vault = await vaultWith(`b26-${name}`, {
        [`${name}-two-rules.md`]: content,
      });
      const { adapter, file } = only(vault);

      await adapter.updateFrontmatter(file, (current) => ({
        ...current,
        exo__Asset_label: "patched",
      }));

      const after = await fs.readFile(
        path.join(vault, `${name}-two-rules.md`),
        "utf-8",
      );

      // The user's two rules and their body survive: the written file still
      // contains the original text, in its original line endings.
      expect({ case: name, kept: after.includes(`---${eol}---${eol}`) }).toEqual(
        { case: name, kept: true },
      );
      expect({ case: name, body: after.includes("Actual body") }).toEqual({
        case: name,
        body: true,
      });
      // …and the patch itself landed, so this axis cannot be satisfied by a
      // write that simply did nothing.
      const reread = only(vault);
      expect({
        case: name,
        label: reread.adapter.getFrontmatter(reread.file)?.exo__Asset_label,
      }).toEqual({ case: name, label: "patched" });
    }
  });

  it(`B27 CONTROL a genuinely EMPTY block is still recognised in all three encodings — the B26 fix must not over-narrow ${REQ_4452}`, async () => {
    // Pairs with B26 exactly as B14 pairs with B13. `---\n\n---` is the blessed
    // "no keys yet" shape (its own comment in getFrontmatterParseFailure says
    // so), and it has TWO separators to give — which is what distinguishes it
    // from B26's single CRLF and makes the behaviour symmetric across
    // encodings. A fix that simply required `\r\n` at both fences would satisfy
    // B26 and break this one for CR.
    for (const [name, content] of [
      ["lf", "---\n\n---\nbody\n"],
      ["crlf", "---\r\n\r\n---\r\nbody\r\n"],
      ["cr", "---\r\r---\rbody\r"],
    ] as const) {
      const vault = await vaultWith(`b27-${name}`, { [`${name}-empty.md`]: content });
      const { adapter, file } = only(vault);
      // An EMPTY block parses to nothing, so `getFrontmatter` is null — the
      // observable that separates "block found, no keys" from "no block" is the
      // diagnostic path, which stays silent on a blank body by design.
      expect({ case: name, failure: adapter.getFrontmatterParseFailure(file) }).toEqual({
        case: name,
        failure: null,
      });
      const result = await convert(vault);
      expect({ case: name, skipped: result.skippedFiles }).toEqual({
        case: name,
        skipped: [],
      });
    }
  });
});
