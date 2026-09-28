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
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { NoteToRDFConverter } from "@kitelev/exocortex-core";
import { FileSystemVaultAdapter } from "../../src/adapters/FileSystemVaultAdapter.js";

const REQ = "@req:c05a3565-7b8d-42dc-bc9f-7e71d47d9364";
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

  // ── The two encodings this fix deliberately does NOT reach ────────────────
  // Both were surfaced by the review of this PR. They are pinned, not fixed:
  // the widened predicate is `\r?\n` and a SINGLE leading U+FEFF, and saying so
  // in an executable axis is what keeps the requirement's prose from drifting
  // into "regardless of its line endings".
  //
  // ⛤ These are ABSENCE-OF-EFFECT axes, like B6/B8: green under every mutant of
  //    this PR by construction. Their product is the pin, not a flip — and the
  //    pin is what a later session needs in order to see that the gap is known
  //    rather than overlooked.

  it(`B15 OUT OF SCOPE lone-CR fences stay invisible — the fix reaches \\r?\\n, not bare \\r ${REQ}`, async () => {
    // Classic pre-OS9 Mac line endings: `\r` with no `\n` anywhere. The block
    // predicate requires a `\n`, so such a file is still read as "no block at
    // all" — the same silent-invisibility class as #4441, entered through a
    // third door.
    // ⛔ Only the READ pair is pinned. The write consequence (an unrelated
    //    property patch PREPENDS a second block, leaving the original as body
    //    text) is a live defect, not a desired state, and pinning it as expected
    //    would freeze it. That consequence is why lone-CR needs its own
    //    requirement rather than a widening tacked onto this one.
    const vault = await vaultWith("b15-lone-cr", {
      "lone-cr.md": "---\rkey: value\r---\rbody\r",
    });
    const { adapter, file } = only(vault);

    expect(adapter.getFrontmatter(file)).toBeNull();
    expect(adapter.getFrontmatterParseFailure(file)).toBeNull();

    const result = await convert(vault);
    expect(result.triples).toEqual([]);
    expect(result.skippedFiles).toEqual([]);
  });

  it(`B16 OUT OF SCOPE a DOUBLE BOM stays invisible — exactly one U+FEFF is skipped ${REQ}`, async () => {
    // Two stacked BOM bytes — the artifact of a naive "ensure a BOM" tool that
    // does not check for an existing one. `bomLength` skips at most one, so the
    // second still defeats the `^` anchor. The requirement says "a leading
    // U+FEFF", singular; this axis is what makes that word load-bearing instead
    // of incidental.
    const vault = await vaultWith("b16-double-bom", {
      "double-bom.md": BOM + BOM + lfFenced(VALID_YAML),
    });
    const { adapter, file } = only(vault);

    expect(adapter.getFrontmatter(file)).toBeNull();
    expect(adapter.getFrontmatterParseFailure(file)).toBeNull();

    const result = await convert(vault);
    expect(result.triples).toEqual([]);
    expect(result.skippedFiles).toEqual([]);
  });
});
