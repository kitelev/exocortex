/**
 * `query__TableBlock` parse — RFC 9821a379 AC2 (ticket 035da1eb).
 *
 * A block of class `query__TableBlock` (by label or by the code-constant UID)
 * with `query__TableBlock_query` parses into kind `query-table`; the query is
 * the TARGET of the wikilink (the uid in `[[uid|label]]`, not the alias);
 * without `_query` the block is rejected with a warning — the repository then
 * never indexes it, so it is never drawn.
 *
 * Revert-verify (mutant-driver spec `QueryTableBlock.spec.json`): every axis
 * below is reddened by exactly the mutant named in its spec entry.
 */

import {
  QUERY_TABLE_BLOCK_CLASS_IRI,
  QUERY_TABLE_BLOCK_CLASS_UID,
  QUERY_TABLE_BLOCK_DEFAULT_EMPTY_TEXT,
  QUERY_TABLE_BLOCK_DEFAULT_LIMIT,
  createLayoutBlockFromFrontmatter,
  isLayoutBlockFrontmatter,
  isQueryTableBlock,
} from "../../../src/domain/layout/LayoutBlock";

const QUERY_UID = "7a3c1f20-5b9e-4d11-8c2a-0f6e9d4b2a71";
const SRC = { sourcePath: "blocks/episodes-of-day.md" };

describe("query__TableBlock — parse into the query-table kind (RFC 9821a379 AC2)", () => {
  test("Q1 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe class by code-constant UID, `_query` as bare [[uid]] → query-table with defaults", () => {
    const block = createLayoutBlockFromFrontmatter(
      {
        exo__Asset_uid: "b-episodes",
        exo__Asset_label: "Эпизоды дня",
        exo__Instance_class: [`[[${QUERY_TABLE_BLOCK_CLASS_UID}]]`],
        query__TableBlock_query: `[[${QUERY_UID}]]`,
      },
      SRC,
    );
    expect(block).not.toBeNull();
    expect(block?.kind).toBe("query-table");
    if (block && isQueryTableBlock(block)) {
      expect(block.query).toBe(QUERY_UID);
      expect(block.limit).toBe(QUERY_TABLE_BLOCK_DEFAULT_LIMIT);
      expect(block.limit).toBe(100);
      expect(block.emptyText).toBe(QUERY_TABLE_BLOCK_DEFAULT_EMPTY_TEXT);
      expect(block.emptyText).toBe("Нет строк");
      expect(block.title).toBe("Эпизоды дня");
    }
  });

  test("Q2 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe `_query` as [[uid|метка]] → query is the uid (target), not the alias", () => {
    const block = createLayoutBlockFromFrontmatter(
      {
        exo__Asset_uid: "b-episodes",
        exo__Instance_class: [`[[${QUERY_TABLE_BLOCK_CLASS_IRI}]]`],
        query__TableBlock_query: `[[${QUERY_UID}|Эпизоды, покрывающие день]]`,
      },
      SRC,
    );
    expect(block?.kind).toBe("query-table");
    if (block && isQueryTableBlock(block)) {
      expect(block.query).toBe(QUERY_UID);
    }
  });

  test("Q3 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe no `_query` → rejected (null) with a warning naming the property", () => {
    const warnings: string[] = [];
    const frontmatter = {
      exo__Asset_uid: "b-no-query",
      exo__Instance_class: [`[[${QUERY_TABLE_BLOCK_CLASS_UID}|${QUERY_TABLE_BLOCK_CLASS_IRI}]]`],
      query__TableBlock_emptyText: "Эпизодов нет",
    };
    // It IS a block frontmatter (the repository will try to parse it) …
    expect(isLayoutBlockFrontmatter(frontmatter)).toBe(true);
    // … and the parse refuses it, so the repository never indexes it.
    const block = createLayoutBlockFromFrontmatter(frontmatter, {
      ...SRC,
      warn: (m) => warnings.push(m),
    });
    expect(block).toBeNull();
    expect(warnings.some((w) => w.includes("query__TableBlock_query required"))).toBe(true);
  });

  test("Q4 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe `_limit` and `_emptyText` are read; a non-positive limit falls back to 100 with a warning", () => {
    const set = createLayoutBlockFromFrontmatter(
      {
        exo__Asset_uid: "b",
        exo__Instance_class: [`[[${QUERY_TABLE_BLOCK_CLASS_IRI}]]`],
        query__TableBlock_query: `[[${QUERY_UID}]]`,
        query__TableBlock_limit: 25,
        query__TableBlock_emptyText: "Эпизодов нет",
      },
      SRC,
    );
    expect(set && isQueryTableBlock(set) ? [set.limit, set.emptyText] : null).toEqual([
      25,
      "Эпизодов нет",
    ]);

    const warnings: string[] = [];
    const bad = createLayoutBlockFromFrontmatter(
      {
        exo__Asset_uid: "b",
        exo__Instance_class: [`[[${QUERY_TABLE_BLOCK_CLASS_IRI}]]`],
        query__TableBlock_query: `[[${QUERY_UID}]]`,
        query__TableBlock_limit: 0,
      },
      { ...SRC, warn: (m) => warnings.push(m) },
    );
    expect(bad && isQueryTableBlock(bad) ? bad.limit : null).toBe(100);
    expect(warnings.some((w) => w.includes("query__TableBlock_limit"))).toBe(true);
  });

  test("Q6 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe `_query` given as a LIST is rejected with its own message, not «required»", () => {
    const warnings: string[] = [];
    const block = createLayoutBlockFromFrontmatter(
      {
        exo__Asset_uid: "b-list",
        exo__Instance_class: [`[[${QUERY_TABLE_BLOCK_CLASS_IRI}]]`],
        query__TableBlock_query: [`[[${QUERY_UID}]]`],
      },
      { ...SRC, warn: (m) => warnings.push(m) },
    );
    expect(block).toBeNull();
    expect(warnings.some((w) => w.includes("must be a single wikilink"))).toBe(true);
    expect(warnings.some((w) => w.includes("required"))).toBe(false);
  });

  test("Q7 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe a `#subpath` in `_query` is not part of the query uid", () => {
    const block = createLayoutBlockFromFrontmatter(
      {
        exo__Asset_uid: "b",
        exo__Instance_class: [`[[${QUERY_TABLE_BLOCK_CLASS_IRI}]]`],
        query__TableBlock_query: `[[${QUERY_UID}#Запрос|Эпизоды]]`,
      },
      SRC,
    );
    expect(block && isQueryTableBlock(block) ? block.query : null).toBe(QUERY_UID);
  });

  test("Q8 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe `_query` naming the query by LABEL is kept (the page shows the runner's error) but warned: the runner finds queries only by uid", () => {
    const warnings: string[] = [];
    const block = createLayoutBlockFromFrontmatter(
      {
        exo__Asset_uid: "b-label",
        exo__Instance_class: [`[[${QUERY_TABLE_BLOCK_CLASS_IRI}]]`],
        query__TableBlock_query: "[[Эпизоды, покрывающие день]]",
      },
      { ...SRC, warn: (m) => warnings.push(m) },
    );
    expect(block && isQueryTableBlock(block) ? block.query : null).toBe("Эпизоды, покрывающие день");
    expect(warnings.some((w) => w.includes("not a uid"))).toBe(true);
    // A uid target is NOT warned (Q1/Q2 shape).
    const quiet: string[] = [];
    createLayoutBlockFromFrontmatter(
      {
        exo__Asset_uid: "b-uid",
        exo__Instance_class: [`[[${QUERY_TABLE_BLOCK_CLASS_IRI}]]`],
        query__TableBlock_query: `[[${QUERY_UID}]]`,
      },
      { ...SRC, warn: (m) => quiet.push(m) },
    );
    expect(quiet).toEqual([]);
  });

  test("Q9 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe `_limit` is a STRICT integer — \"2.5\", \"10abc\", \"1e2\" fall back to 100 with a warning; \"25\" is 25", () => {
    for (const raw of ["2.5", "10abc", "1e2", 2.5]) {
      const warnings: string[] = [];
      const block = createLayoutBlockFromFrontmatter(
        {
          exo__Asset_uid: "b",
          exo__Instance_class: [`[[${QUERY_TABLE_BLOCK_CLASS_IRI}]]`],
          query__TableBlock_query: `[[${QUERY_UID}]]`,
          query__TableBlock_limit: raw,
        },
        { ...SRC, warn: (m) => warnings.push(m) },
      );
      expect([raw, block && isQueryTableBlock(block) ? block.limit : null]).toEqual([raw, 100]);
      expect(warnings.some((w) => w.includes("query__TableBlock_limit"))).toBe(true);
    }
    const ok = createLayoutBlockFromFrontmatter(
      {
        exo__Asset_uid: "b",
        exo__Instance_class: [`[[${QUERY_TABLE_BLOCK_CLASS_IRI}]]`],
        query__TableBlock_query: `[[${QUERY_UID}]]`,
        query__TableBlock_limit: " 25 ",
      },
      SRC,
    );
    expect(ok && isQueryTableBlock(ok) ? ok.limit : null).toBe(25);
  });

  test("Q10 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe a NEGATIVE `_limit` (-5, \"-5\") is not a positive integer — 100 with a warning", () => {
    // A strict integer, but not positive: an implementation that only rejects 0
    // would hand the plugin rows.slice(0, -5) — the table minus its last rows.
    for (const raw of [-5, "-5"]) {
      const warnings: string[] = [];
      const block = createLayoutBlockFromFrontmatter(
        {
          exo__Asset_uid: "b",
          exo__Instance_class: [`[[${QUERY_TABLE_BLOCK_CLASS_IRI}]]`],
          query__TableBlock_query: `[[${QUERY_UID}]]`,
          query__TableBlock_limit: raw,
        },
        { ...SRC, warn: (m) => warnings.push(m) },
      );
      expect([raw, block && isQueryTableBlock(block) ? block.limit : null]).toEqual([raw, 100]);
      expect([raw, warnings.some((w) => w.includes("query__TableBlock_limit"))]).toEqual([raw, true]);
    }
  });

  test("Q11 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe `_query` given as a NUMBER is rejected as not a single wikilink — the message does not call it a list", () => {
    const warnings: string[] = [];
    const block = createLayoutBlockFromFrontmatter(
      {
        exo__Asset_uid: "b-number",
        exo__Instance_class: [`[[${QUERY_TABLE_BLOCK_CLASS_IRI}]]`],
        query__TableBlock_query: 42,
      },
      { ...SRC, warn: (m) => warnings.push(m) },
    );
    expect(block).toBeNull();
    const message = warnings.find((w) => w.includes("must be a single wikilink"));
    expect(message).toContain("not a value of type number");
    expect(message).not.toContain("list");
  });

  test("Q5 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe isLayoutBlockFrontmatter recognises query__TableBlock by label and by UID; an unrelated class is not a block", () => {
    expect(
      isLayoutBlockFrontmatter({ exo__Instance_class: [`[[${QUERY_TABLE_BLOCK_CLASS_IRI}]]`] }),
    ).toBe(true);
    expect(
      isLayoutBlockFrontmatter({ exo__Instance_class: [`[[${QUERY_TABLE_BLOCK_CLASS_UID}]]`] }),
    ).toBe(true);
    expect(
      isLayoutBlockFrontmatter({ exo__Instance_class: ["[[query__NamedQuery]]"] }),
    ).toBe(false);
  });
});
