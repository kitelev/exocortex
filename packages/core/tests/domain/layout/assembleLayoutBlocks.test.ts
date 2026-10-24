/**
 * Block → Layout assembly — RFC 9821a379 AC3 (ticket 035da1eb).
 *
 * Blocks name their Layout through `exo__LayoutBlock_layout`; the Layout's
 * block list is assembled in `exo__LayoutBlock_order` ASC (unordered blocks
 * after the numbered ones, ties by uid ASC); a block of another Layout does not
 * get in; a Layout no block names is not selected.
 *
 * Every axis goes through the production parsers (frontmatter → parse →
 * assemble), so the `layoutRefs` / `order` extraction is exercised too.
 * Revert-verify: mutant-driver spec `assembleLayoutBlocks.spec.json`.
 */

import { assembleLayoutBlocks } from "../../../src/domain/layout/assembleLayoutBlocks";
import { createLayoutFromFrontmatter, isLayout, type Layout } from "../../../src/domain/layout/Layout";
import {
  createLayoutBlockFromFrontmatter,
  PROPERTIES_BLOCK_CLASS_IRI,
  QUERY_TABLE_BLOCK_CLASS_UID,
  type LayoutBlock,
} from "../../../src/domain/layout/LayoutBlock";
import { LayoutSelector } from "../../../src/application/services/LayoutSelector";

const L1 = "4b0d2c11-1f6a-4e8e-9d3a-6a1c7e2f0b01";
const L2 = "4b0d2c11-1f6a-4e8e-9d3a-6a1c7e2f0b02";

function layout(uid: string, extra: Record<string, unknown> = {}, path = `layouts/${uid}.md`): Layout {
  const parsed = createLayoutFromFrontmatter(
    {
      exo__Asset_uid: uid,
      exo__Asset_label: `Layout ${uid.slice(-2)}`,
      exo__Instance_class: ["[[exo__Layout]]"],
      exo__Layout_targetClass: "[[pn__DailyNote]]",
      ...extra,
    },
    { sourcePath: path },
  );
  if (parsed === null) throw new Error(`fixture Layout ${uid} did not parse`);
  return parsed;
}

function block(uid: string, extra: Record<string, unknown>, warn?: (m: string) => void): LayoutBlock {
  const parsed = createLayoutBlockFromFrontmatter(
    {
      exo__Asset_uid: uid,
      exo__Instance_class: [`[[${PROPERTIES_BLOCK_CLASS_IRI}]]`],
      ...extra,
    },
    { sourcePath: `blocks/${uid}.md`, warn },
  );
  if (parsed === null) throw new Error(`fixture block ${uid} did not parse`);
  return parsed;
}

describe("assembleLayoutBlocks — blocks name their Layout (RFC 9821a379 AC3)", () => {
  test("A1 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe blocks are collected by exo__LayoutBlock_layout in exo__LayoutBlock_order ASC", () => {
    // uids sort OPPOSITE to the order, so «order ignored, uid ASC» would read
    // [a-third, m-second, x-first] — the axis tells the two apart.
    const blocks = [
      block("m-second", { exo__LayoutBlock_layout: `[[${L1}]]`, exo__LayoutBlock_order: 2 }),
      block("x-first", { exo__LayoutBlock_layout: `[[${L1}]]`, exo__LayoutBlock_order: 1 }),
      block("a-third", { exo__LayoutBlock_layout: `[[${L1}]]`, exo__LayoutBlock_order: "3" }),
    ];
    const [assembled] = assembleLayoutBlocks([layout(L1)], blocks);
    expect(assembled.blocks).toEqual(["x-first", "m-second", "a-third"]);
  });

  test("A2 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe blocks without an order go after the numbered ones; ties and the unordered tail by uid ASC", () => {
    // Input order is adversarial on purpose: the 5s come before the 1, so a
    // stable sort that ignored the order would keep them first.
    const blocks = [
      block("m-five", { exo__LayoutBlock_layout: `[[${L1}]]`, exo__LayoutBlock_order: 5 }),
      block("c-none", { exo__LayoutBlock_layout: `[[${L1}]]` }),
      block("k-five", { exo__LayoutBlock_layout: `[[${L1}]]`, exo__LayoutBlock_order: 5 }),
      block("a-none", { exo__LayoutBlock_layout: `[[${L1}]]` }),
      block("z-one", { exo__LayoutBlock_layout: `[[${L1}]]`, exo__LayoutBlock_order: 1 }),
    ];
    const [assembled] = assembleLayoutBlocks([layout(L1)], blocks);
    expect(assembled.blocks).toEqual(["z-one", "k-five", "m-five", "a-none", "c-none"]);
  });

  test("A3 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe a block of another Layout does not get in (negative)", () => {
    const blocks = [
      block("mine", { exo__LayoutBlock_layout: `[[${L1}]]` }),
      block("theirs", { exo__LayoutBlock_layout: `[[${L2}]]` }),
    ];
    const assembled = assembleLayoutBlocks([layout(L1), layout(L2)], blocks);
    expect(assembled.map((l) => [l.uid, l.blocks])).toEqual([
      [L1, ["mine"]],
      [L2, ["theirs"]],
    ]);
  });

  test("A4 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe a Layout no block names is dropped with a warning — and the selector never picks it", () => {
    const warnings: string[] = [];
    const lonely = layout(L1, { exo__Layout_blocks: ["[[legacy-block]]"] });
    const legacy = block("legacy-block", {});
    const assembled = assembleLayoutBlocks([lonely], [legacy], (m) => warnings.push(m));
    expect(assembled).toEqual([]);
    expect(
      warnings.some((w) => w.includes(L1) && w.includes("exo__Layout_blocks is no longer read")),
    ).toBe(true);
    const selector = new LayoutSelector({ all: assembled });
    expect(selector.resolve(["[[pn__DailyNote]]"])).toBeNull();
  });

  test("A5 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe the link resolves in every wikilink form — [[uid]], [[uid|label]], [[label]], [[file basename]]", () => {
    const named = layout(L1, { exo__Asset_label: "Дневная заметка" }, "layouts/daily-note-layout.md");
    const blocks = [
      block("b1", { exo__LayoutBlock_layout: `[[${L1}]]`, exo__LayoutBlock_order: 1 }),
      block("b2", { exo__LayoutBlock_layout: `[[${L1}|Дневная заметка]]`, exo__LayoutBlock_order: 2 }),
      block("b3", { exo__LayoutBlock_layout: "[[Дневная заметка]]", exo__LayoutBlock_order: 3 }),
      block("b4", { exo__LayoutBlock_layout: "[[daily-note-layout]]", exo__LayoutBlock_order: 4 }),
    ];
    const [assembled] = assembleLayoutBlocks([named], blocks);
    expect(assembled.blocks).toEqual(["b1", "b2", "b3", "b4"]);
  });

  test("A6 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe a reference naming two Layouts (shared label) attaches to none, with a warning", () => {
    const warnings: string[] = [];
    const a = layout(L1, { exo__Asset_label: "Same" });
    const b = layout(L2, { exo__Asset_label: "Same" });
    const blocks = [
      block("ambiguous", { exo__LayoutBlock_layout: "[[Same]]" }),
      block("own-a", { exo__LayoutBlock_layout: `[[${L1}]]` }),
      block("own-b", { exo__LayoutBlock_layout: `[[${L2}]]` }),
    ];
    const assembled = assembleLayoutBlocks([a, b], blocks, (m) => warnings.push(m));
    expect(assembled.map((l) => l.blocks)).toEqual([["own-a"], ["own-b"]]);
    expect(warnings.some((w) => w.includes("ambiguous") && w.includes("names 2 Layouts"))).toBe(true);
  });

  test("A7 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe a non-integer order is treated as absent, with a warning", () => {
    const warnings: string[] = [];
    const blocks = [
      block("bad-order", { exo__LayoutBlock_layout: `[[${L1}]]`, exo__LayoutBlock_order: "first" }, (m) =>
        warnings.push(m),
      ),
      block("numbered", { exo__LayoutBlock_layout: `[[${L1}]]`, exo__LayoutBlock_order: 9 }),
    ];
    const [assembled] = assembleLayoutBlocks([layout(L1)], blocks);
    expect(assembled.blocks).toEqual(["numbered", "bad-order"]);
    expect(warnings.some((w) => w.includes("exo__LayoutBlock_order must be an integer"))).toBe(true);
  });

  test("A9 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe the display text after `|` is ignored — [[L1|<label of L2>]] and [[L1|any text]] attach to L1", () => {
    const warnings: string[] = [];
    const a = layout(L1, { exo__Asset_label: "Layout A" });
    const b = layout(L2, { exo__Asset_label: "Layout B" });
    const blocks = [
      // copied from L2's block: uid changed, alias left behind
      block("copied", { exo__LayoutBlock_layout: `[[${L1}|Layout B]]`, exo__LayoutBlock_order: 1 }),
      block("free-text", { exo__LayoutBlock_layout: `[[${L1}|что угодно]]`, exo__LayoutBlock_order: 2 }),
      block("own-b", { exo__LayoutBlock_layout: `[[${L2}]]` }),
    ];
    const assembled = assembleLayoutBlocks([a, b], blocks, (m) => warnings.push(m));
    expect(assembled.map((l) => [l.uid, l.blocks])).toEqual([
      [L1, ["copied", "free-text"]],
      [L2, ["own-b"]],
    ]);
    expect(warnings).toEqual([]);
  });

  test("A10 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe isLayout accepts the parser's Layout (blocks: []) and the assembled one", () => {
    const parsed = layout(L1);
    expect(parsed.blocks).toEqual([]);
    expect(isLayout(parsed)).toBe(true);
    const [assembled] = assembleLayoutBlocks([parsed], [block("b", { exo__LayoutBlock_layout: `[[${L1}]]` })]);
    expect(isLayout(assembled)).toBe(true);
  });

  test("A11 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe exo__LayoutBlock_order is a STRICT integer — \"1.5\", \"2nd\", 1.5 count as absent, with a warning", () => {
    for (const raw of ["1.5", "2nd", 1.5]) {
      const warnings: string[] = [];
      const blocks = [
        block("a-odd", { exo__LayoutBlock_layout: `[[${L1}]]`, exo__LayoutBlock_order: raw }, (m) =>
          warnings.push(m),
        ),
        block("z-nine", { exo__LayoutBlock_layout: `[[${L1}]]`, exo__LayoutBlock_order: 9 }),
      ];
      const [assembled] = assembleLayoutBlocks([layout(L1)], blocks);
      expect([raw, assembled.blocks]).toEqual([raw, ["z-nine", "a-odd"]]);
      expect(warnings.some((w) => w.includes("exo__LayoutBlock_order must be an integer"))).toBe(true);
    }
  });

  test("A12 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe a Layout still carrying exo__Layout_blocks is warned that the list is not read", () => {
    const warnings: string[] = [];
    const parsed = createLayoutFromFrontmatter(
      {
        exo__Asset_uid: L1,
        exo__Layout_targetClass: "[[pn__DailyNote]]",
        exo__Layout_blocks: ["[[b1]]"],
      },
      { sourcePath: "layouts/old.md", warn: (m) => warnings.push(m) },
    );
    expect(parsed?.blocks).toEqual([]);
    expect(warnings.some((w) => w.includes("exo__Layout_blocks is no longer read"))).toBe(true);
    const quiet: string[] = [];
    createLayoutFromFrontmatter(
      { exo__Asset_uid: L2, exo__Layout_targetClass: "[[pn__DailyNote]]" },
      { sourcePath: "layouts/new.md", warn: (m) => quiet.push(m) },
    );
    expect(quiet).toEqual([]);
  });

  test("A8 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe a query__TableBlock joins its Layout like any other kind; the assembled Layout is what the selector returns", () => {
    const qt = createLayoutBlockFromFrontmatter(
      {
        exo__Asset_uid: "qt",
        exo__Instance_class: [`[[${QUERY_TABLE_BLOCK_CLASS_UID}]]`],
        query__TableBlock_query: "[[7a3c1f20-5b9e-4d11-8c2a-0f6e9d4b2a71]]",
        exo__LayoutBlock_layout: `[[${L1}]]`,
        exo__LayoutBlock_order: 1,
      },
      { sourcePath: "blocks/qt.md" },
    );
    expect(qt).not.toBeNull();
    const assembled = assembleLayoutBlocks([layout(L1)], qt ? [qt] : []);
    const selected = new LayoutSelector({ all: assembled }).resolve(["[[pn__DailyNote]]"]);
    expect(selected?.uid).toBe(L1);
    expect(selected?.blocks).toEqual(["qt"]);
  });
});
