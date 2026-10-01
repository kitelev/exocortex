/**
 * Issue #4469 / req `2d072437-c19d-49a4-ae89-f20b6185571f` — the COMMAND write
 * channel (`FrontmatterService`, the TEXT path behind `set-property`,
 * `remove-property`, `set-body` and every `apply <cmd>` that writes a property)
 * recognises a frontmatter block through core's SHARED `matchFrontmatterBlock`.
 *
 * Before this, the class carried `/^---\n([\s\S]*?)\n---/` — LF-only AND defeated
 * by any leading BOM — so on a lone-CR / CRLF / BOM asset it decided "no block
 * here" and PREPENDED a second one, leaving the original frontmatter as body
 * text. Measured on the published v17.7.13: 4 fence lines on a lone-CR asset, 4
 * on CRLF, 3 on a single-BOM one.
 *
 * Two properties are asserted TOGETHER, because the fix is only correct with
 * both: WHICH span is recognised (the shared predicate) and WHAT the rewrite
 * puts back (the file's own line endings, every untouched line byte-identical —
 * `updateProperty` is a one-line text edit, not a js-yaml re-dump).
 *
 * Revert-verify — `FrontmatterService.write-channels-4469.spec.json`
 * (`python3 ~/.claude/bin/mutant-driver.py <resolved spec>`).
 */
import { describe, it, expect } from "@jest/globals";
import { FrontmatterService } from "../../../src/utilities/FrontmatterService";

const REQ = "@req:2d072437-c19d-49a4-ae89-f20b6185571f";
const BOM = "﻿";

/** Physical lines that are exactly `---`, BOM-insensitive. */
function fenceLines(content: string): number {
  return content
    .replace(/^﻿+/, "")
    .split(/\r\n|\r|\n/)
    .filter((line) => line === "---").length;
}

function eolProfile(content: string): {
  crlf: number;
  cr: number;
  lf: number;
} {
  const crlf = (content.match(/\r\n/g) ?? []).length;
  return {
    crlf,
    cr: (content.match(/\r/g) ?? []).length - crlf,
    lf: (content.match(/\n/g) ?? []).length - crlf,
  };
}

describe(`FrontmatterService write channel (#4469)`, () => {
  const service = new FrontmatterService();

  const loneCr =
    "---\r" +
    "exo__Asset_uid: 11111111-1111-4111-8111-111111111111\r" +
    "keep__me: original\r" +
    "---\r" +
    "body first line\r" +
    "body second line\r";

  it(`CH1 ${REQ} a property write on a lone-CR asset REPLACES the block — one block, keys intact, body CRs intact`, () => {
    const out = service.updateProperty(loneCr, "smoke__marker", "written");

    expect(fenceLines(out)).toBe(1 * 2);
    expect(out).toContain("keep__me: original");
    expect(out).toContain(
      "exo__Asset_uid: 11111111-1111-4111-8111-111111111111",
    );
    expect(out).toContain("smoke__marker: written");
    // The body after the block is not the rewrite's business at all.
    expect(out).toContain("body first line\rbody second line\r");
  });

  it(`CH2 ${REQ} the NEWLY inserted line carries the file's own line ending, and the block gains no LF`, () => {
    const out = service.updateProperty(loneCr, "smoke__marker", "written");

    expect(out).toContain("smoke__marker: written\r");
    // 6 CRs in the fixture + exactly ONE for the inserted line.
    expect(eolProfile(loneCr)).toEqual({ crlf: 0, cr: 6, lf: 0 });
    expect(eolProfile(out)).toEqual({ crlf: 0, cr: 7, lf: 0 });
  });

  it(`CH3 ${REQ} a RUN of leading BOMs collapses to exactly ONE on write`, () => {
    const nbom =
      BOM +
      BOM +
      BOM +
      "---\nexo__Asset_uid: 22222222-2222-4222-8222-222222222222\nkeep__me: original\n---\nbody\n";

    const out = service.updateProperty(nbom, "smoke__marker", "written");

    expect(out.length - out.replace(/^﻿+/, "").length).toBe(1);
    expect(fenceLines(out)).toBe(2);
    expect(out).toContain("keep__me: original");
    expect(out).toContain("smoke__marker: written");
  });

  it(`CH4 ${REQ} a CRLF asset keeps its CRLF style — the new line included, and no lone LF appears`, () => {
    const crlf =
      "---\r\nexo__Asset_uid: 44444444-4444-4444-8444-444444444444\r\nkeep__me: original\r\n---\r\nbody\r\n";

    const out = service.updateProperty(crlf, "smoke__marker", "written");

    expect(fenceLines(out)).toBe(2);
    expect(out).toContain("smoke__marker: written\r\n");
    expect(eolProfile(out).cr).toBe(0);
    expect(eolProfile(out).lf).toBe(0);
    // Everything the write did not address is byte-identical.
    expect(out).toBe(
      "---\r\nexo__Asset_uid: 44444444-4444-4444-8444-444444444444\r\nkeep__me: original\r\nsmoke__marker: written\r\n---\r\nbody\r\n",
    );
  });

  it(`CH5 ${REQ} CONTROL — the pure-LF path is byte-identical to what it always was`, () => {
    const lf = "---\nfoo: bar\n---\nBody";

    expect(service.updateProperty(lf, "status", "draft")).toBe(
      "---\nfoo: bar\nstatus: draft\n---\nBody",
    );
    expect(
      service.updateProperty("---\nstatus: old\n---\nBody", "status", "new"),
    ).toBe("---\nstatus: new\n---\nBody");
  });

  it(`CH6 ${REQ} a SINGLE leading BOM is recognised and survives the write`, () => {
    const one = BOM + "---\nfoo: bar\n---\nBody";

    const out = service.updateProperty(one, "status", "draft");

    expect(out).toBe(BOM + "---\nfoo: bar\nstatus: draft\n---\nBody");
  });

  it(`CH7 ${REQ} the write stays a one-line TEXT edit — a comment, a block scalar and a flow sequence survive verbatim`, () => {
    const rich =
      "---\r\n" +
      "aliases:\r\n" +
      "  # Русские\r\n" +
      "  - первый\r\n" +
      "exocmd__Precondition_sparqlAsk: |-\r\n" +
      "  ASK { ?s ?p ?o }\r\n" +
      "exo__Instance_class: [a, b]\r\n" +
      "keep__me: original\r\n" +
      "---\r\n" +
      "body\r\n";

    const out = service.updateProperty(rich, "smoke__marker", "written");

    expect(out).toBe(
      rich.replace(
        "keep__me: original\r\n---",
        "keep__me: original\r\nsmoke__marker: written\r\n---",
      ),
    );
  });

  it(`CH8 ${REQ} removeProperty on a lone-CR asset keeps ONE block and the file's line endings`, () => {
    const out = service.removeProperty(loneCr, "keep__me");

    expect(fenceLines(out)).toBe(2);
    expect(out).not.toContain("keep__me");
    expect(out).toContain(
      "exo__Asset_uid: 11111111-1111-4111-8111-111111111111",
    );
    expect(eolProfile(out).lf).toBe(0);
    expect(eolProfile(out).crlf).toBe(0);
  });

  it(`CH9 ${REQ} removing the LAST key of a lone-CR block leaves no blank line before the closing fence`, () => {
    const two = "---\ra: 1\rb: 2\r---\rbody\r";

    expect(service.removeProperty(two, "b")).toBe("---\ra: 1\r---\rbody\r");
  });

  it(`CH10 ${REQ} parseObject reads a lone-CR block — a \\r is a line ending too`, () => {
    expect(service.parseObject(loneCr)).toEqual({
      exo__Asset_uid: "11111111-1111-4111-8111-111111111111",
      keep__me: "original",
    });
  });

  it(`CH11 ${REQ} CONTROL — no fence at all, and a "---" that is not an OPENING fence`, () => {
    const noFence = "just a body, no frontmatter\n";
    expect(service.updateProperty(noFence, "status", "draft")).toBe(
      "---\nstatus: draft\n---\njust a body, no frontmatter\n",
    );

    const notOpening = "intro line\n---\nnot: frontmatter\n---\ntail\n";
    const out = service.updateProperty(notOpening, "status", "draft");
    expect(out).toBe("---\nstatus: draft\n---\n" + notOpening);
    // the original text survives in full, below the newly created block
    expect(out).toContain(notOpening);
  });
});
